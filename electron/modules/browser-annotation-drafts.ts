import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserAnnotationDraft,BrowserDraftCopy,BrowserDraftInput,BrowserDraftIssue,BrowserDraftRecovery,BrowserAnnotationTarget} from '../../shared/browser-workspace'

type ChatDrafts={rows:Map<string,BrowserAnnotationDraft>;copies:Map<string,BrowserDraftCopy>;issues:BrowserDraftIssue[]}
/** The main process serializes atomic writes, including rejected editing buffers. */
export class BrowserAnnotationDraftStore {
  private chats=new Map<string,ChatDrafts>()
  constructor(private files:Pick<WorkspaceFiles,'resolve'>){}
  private validId(id:string){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('invalid_annotation_id')}
  private input(input:BrowserDraftInput){
    if(!input||typeof input.text!=='string'||input.text.length>4000||typeof input.baseComment!=='string'||input.baseComment.length>4000||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<1||typeof input.editorId!=='string'||!input.editorId||input.editorId.length>100||!Number.isSafeInteger(input.sequence)||input.sequence<1||typeof input.deleted!=='boolean')throw Error('invalid_annotation_draft')
  }
  private atomic(chatId:string,relative:string,row:BrowserAnnotationDraft){
    const file=this.files.resolve(chatId,relative),temporary=this.files.resolve(chatId,relative+'.tmp')
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(row));fs.renameSync(temporary,file)
  }
  private copyId(id:string,editorId:string){return createHash('sha256').update(JSON.stringify([id,editorId])).digest('hex')}
  private load(chatId:string){
    const cached=this.chats.get(chatId);if(cached)return cached
    const data:ChatDrafts={rows:new Map(),copies:new Map(),issues:[]}
    for(const kind of ['','/conflicts']){
      const relative=`browser-annotations/drafts${kind}`,directory=this.files.resolve(chatId,relative)
      if(!fs.existsSync(directory))continue
      for(const name of fs.readdirSync(directory)){
        const corrupt=name.match(/^(.*\.json)\.corrupt-[a-f0-9-]+$/)
        const issue=(fileName:string)=>({fileName:`${kind?'conflicts/':''}${fileName}`,annotationId:!kind&&/^[a-zA-Z0-9_-]{1,100}\.json$/.test(corrupt?.[1]||name)?(corrupt?.[1]||name).slice(0,-5):undefined})
        if(corrupt){data.issues.push(issue(name));continue}
        if(!name.endsWith('.json'))continue
        const file=this.files.resolve(chatId,`${relative}/${name}`)
        try{
          if(!fs.statSync(file).isFile()||fs.statSync(file).size>40000)throw Error('invalid_file')
          const row=JSON.parse(fs.readFileSync(file,'utf8')) as BrowserDraftCopy
          this.input(row);this.validId(row.annotationId)
          if(!Number.isSafeInteger(row.version)||row.version<(kind?0:1)||!Number.isSafeInteger(row.updatedAt)||row.updatedAt<0)throw Error('invalid_draft')
          if(kind){if(!/^[a-f0-9]{64}$/.test(row.id)||name!==row.id+'.json'||row.id!==this.copyId(row.annotationId,row.editorId))throw Error('invalid_copy');data.copies.set(row.id,row)}
          else {if(name!==row.annotationId+'.json')throw Error('invalid_annotation_id');data.rows.set(row.annotationId,row)}
        }catch{
          // Preserve the original bytes while allowing healthy drafts to load.
          // If isolation fails, abort rather than permit an overwrite.
          const isolated=`${name}.corrupt-${randomUUID()}`
          fs.renameSync(file,this.files.resolve(chatId,`${relative}/${isolated}`))
          data.issues.push(issue(isolated))
        }
      }
    }
    this.chats.set(chatId,data);return data
  }
  private preserve(chatId:string,id:string,version:number,input:BrowserDraftInput){
    const data=this.load(chatId),key=this.copyId(id,input.editorId),current=data.copies.get(key)
    if(current&&current.sequence>=input.sequence)return
    const row:BrowserDraftCopy={...input,id:key,annotationId:id,version,updatedAt:Date.now()}
    this.atomic(chatId,`browser-annotations/drafts/conflicts/${key}.json`,row)
    data.copies.set(key,row)
  }
  list(chatId:string){return [...this.load(chatId).rows.values()].map(row=>({...row}))}
  recovery(chatId:string):BrowserDraftRecovery{
    const data=this.load(chatId)
    return {copies:[...data.copies.values()].map(row=>({...row})).sort((a,b)=>b.updatedAt-a.updatedAt),issues:data.issues.map(row=>({...row}))}
  }
  write(chatId:string,id:string,version:number,input:BrowserDraftInput):BrowserAnnotationDraft {
    this.validId(id);this.input(input)
    if(!Number.isSafeInteger(version)||version<0)throw Error('invalid_annotation_draft_version')
    const {rows}=this.load(chatId),current=rows.get(id)
    // Requests from one editor may be in flight together, but another editor
    // must have read the current version before taking over the draft.
    if(current&&current.editorId===input.editorId&&input.sequence<=current.sequence)return {...current}
    if(version!==(current?.version||0)&&current?.editorId!==input.editorId){this.preserve(chatId,id,version,input);throw Error('annotation_draft_conflict')}
    const row:BrowserAnnotationDraft={...input,annotationId:id,version:(current?.version||0)+1,updatedAt:Date.now()}
    this.atomic(chatId,`browser-annotations/drafts/${id}.json`,row)
    rows.set(id,row);return {...row}
  }
  resolve(chatId:string,id:string,version:number,input:BrowserDraftInput,copy:{id:string;sequence:number}){
    this.validId(id);this.input(input)
    const data=this.load(chatId),saved=copy&&data.copies.get(copy.id)
    if(!saved||saved.annotationId!==id||saved.sequence!==copy.sequence)throw Error('annotation_draft_copy_changed')
    if(!Number.isSafeInteger(version)||version<0)throw Error('invalid_annotation_draft_version')
    if(version!==(data.rows.get(id)?.version||0)){
      // A rejected merge is a separate candidate. Reusing this editor's copy
      // would destroy one of the originals before resolution is accepted.
      this.preserve(chatId,id,version,{...input,editorId:`resolve_${randomUUID()}`})
      throw Error('annotation_draft_conflict')
    }
    const current=data.rows.get(id)
    if(current?.editorId===input.editorId&&input.sequence<=current.sequence)throw Error('invalid_annotation_draft_sequence')
    const row=this.write(chatId,id,version,input)
    fs.rmSync(this.files.resolve(chatId,`browser-annotations/drafts/conflicts/${saved.id}.json`),{force:true})
    data.copies.delete(saved.id);return row
  }
  remove(chatId:string,id:string){
    this.validId(id)
    const data=this.load(chatId)
    fs.rmSync(this.files.resolve(chatId,`browser-annotations/drafts/${id}.json`),{force:true})
    data.rows.delete(id)
    for(const row of data.copies.values())if(row.annotationId===id){fs.rmSync(this.files.resolve(chatId,`browser-annotations/drafts/conflicts/${row.id}.json`),{force:true});data.copies.delete(row.id)}
  }
}

/** Unsaved targets are separate records, never empty annotations or fake revisions. */
export class BrowserAnnotationTargetStore{
  constructor(private files:Pick<WorkspaceFiles,'resolve'>){}
  private relative(id:string){if(!/^target_[a-zA-Z0-9_-]{1,120}$/.test(id))throw Error('invalid_annotation_target');return `browser-annotations/targets/${id}.json`}
  private write(chatId:string,row:BrowserAnnotationTarget){const file=this.files.resolve(chatId,this.relative(row.id));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(row));fs.renameSync(file+'.tmp',file);return structuredClone(row)}
  get(chatId:string,id:string):BrowserAnnotationTarget{
    const file=this.files.resolve(chatId,this.relative(id));if(!fs.existsSync(file))throw Error('annotation_target_not_found')
    if(fs.statSync(file).size>40000)throw Error('invalid_annotation_target')
    const row=JSON.parse(fs.readFileSync(file,'utf8')) as BrowserAnnotationTarget
    if(row.id!==id||row.chatId!==chatId||row.screenshotPath!==`browser-annotations/targets/${id}.png`||!Number.isSafeInteger(row.version)||row.version<1||typeof row.comment!=='string'||row.comment.length>4000||!row.selection||typeof row.pageId!=='string')throw Error('invalid_annotation_target')
    return row
  }
  list(chatId:string,pageId:string){const directory=this.files.resolve(chatId,'browser-annotations/targets');if(!fs.existsSync(directory))return [];return fs.readdirSync(directory).filter(name=>/^target_[a-zA-Z0-9_-]{1,120}\.json$/.test(name)).flatMap(name=>{try{const row=this.get(chatId,name.slice(0,-5));return row.pageId===pageId?[row]:[]}catch{return []}}).sort((a,b)=>b.updatedAt-a.updatedAt)}
  create(chatId:string,row:BrowserAnnotationTarget){const file=this.files.resolve(chatId,this.relative(row.id));if(fs.existsSync(file))return this.get(chatId,row.id);if(this.list(chatId,row.pageId).length>=40)throw Error('annotation_target_limit_40');let copied:string|undefined;if(row.conflictOf){const screenshotPath=`browser-annotations/targets/${row.id}.png`;copied=this.files.resolve(chatId,screenshotPath);fs.copyFileSync(this.files.resolve(chatId,row.screenshotPath),copied);row={...row,screenshotPath}}try{return this.write(chatId,row)}catch(error){if(copied)fs.rmSync(copied,{force:true});throw error}}
  update(chatId:string,id:string,version:number,input:{text:string;editorId:string;sequence:number}){
    if(!Number.isSafeInteger(version)||version<1||!input||typeof input.text!=='string'||input.text.length>4000||typeof input.editorId!=='string'||!input.editorId||input.editorId.length>100||!Number.isSafeInteger(input.sequence)||input.sequence<1)throw Error('invalid_annotation_target_draft')
    const row=this.get(chatId,id)
    if(row.editorId===input.editorId&&input.sequence<=row.sequence)return row
    if(version!==row.version&&row.editorId!==input.editorId){const copyId='target_'+createHash('sha256').update(JSON.stringify([id,input.editorId])).digest('hex'),copy=this.create(chatId,{...row,id:copyId,comment:input.text,editorId:input.editorId,sequence:input.sequence,version:1,conflictOf:id,updatedAt:Date.now()});if(input.sequence>copy.sequence)this.write(chatId,{...copy,comment:input.text,sequence:input.sequence,version:copy.version+1,updatedAt:Date.now()});throw Error('annotation_target_draft_conflict')}
    return this.write(chatId,{...row,comment:input.text,editorId:input.editorId,sequence:input.sequence,version:row.version+1,updatedAt:Date.now()})
  }
  remove(chatId:string,id:string,version:number){const row=this.get(chatId,id);if(row.version!==version)throw Error('annotation_target_draft_conflict');fs.rmSync(this.files.resolve(chatId,this.relative(id)),{force:true});return row}
}
