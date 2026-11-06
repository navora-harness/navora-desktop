import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {MAX_QUESTIONNAIRE_FILE_BYTES,applicableQuestionnaireAnswers,validateQuestionnaireDefinition,validateQuestionnaireAnswers,type QuestionnaireRecord,type QuestionnaireDefinition,type QuestionnaireDraftInput,type QuestionnaireSaveResult,type QuestionnaireSubmitInput,type QuestionnaireSubmitResult,type QuestionnaireTemplate,type QuestionnaireAttachment,type QuestionnaireAnswers} from '../../shared/questionnaire'
import {BUILTIN_QUESTIONNAIRE_TEMPLATES} from '../../shared/questionnaire-templates'

/** Commit before publishing a receipt or waking a run. Failed writes leave the last record intact. */
export class QuestionnaireStore {
  private records = new Map<string,QuestionnaireRecord>()
  private waiters = new Map<string,(record:QuestionnaireRecord)=>void>()
  private listeners = new Set<(record:QuestionnaireRecord)=>void>()
  private directory:string
  private templates = new Map<string,QuestionnaireTemplate>()
  constructor(dataRoot:string) {
    this.directory=path.join(dataRoot,'questionnaires');fs.mkdirSync(this.directory,{recursive:true})
    const templateDirectory=path.join(this.directory,'templates');fs.mkdirSync(templateDirectory,{recursive:true})
    for(const filename of fs.readdirSync(templateDirectory))try{
      const template=JSON.parse(fs.readFileSync(path.join(templateDirectory,filename),'utf8')) as QuestionnaireTemplate
      if(/^[a-zA-Z0-9_-]{1,80}\.json$/.test(filename)&&template.id+'.json'===filename&&!template.builtin&&!BUILTIN_QUESTIONNAIRE_TEMPLATES.some(t=>t.id===template.id)&&!validateQuestionnaireDefinition(template).length)this.templates.set(template.id,template)
    }catch{/* Keep unreadable templates available for recovery. */}
    for(const filename of fs.readdirSync(this.directory)) {
      if(!filename.endsWith('.json'))continue
      try {
        const raw=JSON.parse(fs.readFileSync(path.join(this.directory,filename),'utf8')) as QuestionnaireRecord
        if(raw?.schemaRevision!==1||!raw.id||filename!==raw.id+'.json'||!raw.chatId||!raw.runId||validateQuestionnaireDefinition(raw).length||!raw.draft||!Number.isSafeInteger(raw.draft.revision)||raw.draft.revision<0||validateQuestionnaireAnswers(raw.questions,raw.draft.answers,raw.draft.supplement,false).length||!['pending','submitted','cancelled','stale'].includes(raw.status))continue
        if(raw.status==='submitted'&&(!raw.submission||validateQuestionnaireAnswers(raw.questions,raw.submission.answers,raw.submission.supplement).length))continue
        this.records.set(raw.id,raw)
      }catch{/* Preserve unreadable or newer files verbatim for a compatible recovery. */}
    }
  }
  onChanged(listener:(record:QuestionnaireRecord)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  list(chatId?:string){return [...this.records.values()].filter(r=>!chatId||r.chatId===chatId).sort((a,b)=>a.createdAt-b.createdAt).map(r=>structuredClone(r))}
  get(id:string){const value=this.records.get(id);return value?structuredClone(value):null}
  private require(id:string){const record=this.get(id);if(!record)throw Error('questionnaire_not_found');return record}
  private commit(record:QuestionnaireRecord){
    const filename=path.join(this.directory,record.id+'.json'),temporary=filename+'.'+randomUUID()+'.tmp'
    try {fs.writeFileSync(temporary,JSON.stringify(record),'utf8');fs.renameSync(temporary,filename)}catch(error){try{fs.unlinkSync(temporary)}catch{}throw error}
    this.records.set(record.id,structuredClone(record))
    for(const listener of this.listeners){try{listener(structuredClone(record))}catch(error){console.warn('[questionnaire] listener failed',error)}}
    if(record.status!=='pending'){const resolve=this.waiters.get(record.id);if(resolve){this.waiters.delete(record.id);resolve(structuredClone(record))}}
    return structuredClone(record)
  }
  create(definition:QuestionnaireDefinition,owner:Pick<QuestionnaireRecord,'chatId'|'runId'|'toolCallId'> & Partial<Pick<QuestionnaireRecord,'parentChatId'|'chatTitle'|'taskConstraints'>>,initial?:{answers?:QuestionnaireAnswers;supplement?:string;files?:QuestionnaireAttachment[];source?:QuestionnaireRecord['source']}){
    const errors=validateQuestionnaireDefinition(definition);if(errors.length)throw Error('invalid_questionnaire: '+errors.join('；'))
    if(this.list(owner.chatId).some(r=>r.status==='pending'))throw Error('questionnaire_already_pending')
    const now=Date.now(),record:QuestionnaireRecord={title:definition.title,...(definition.description!==undefined?{description:definition.description}:{}),questions:structuredClone(definition.questions),...structuredClone(owner),id:randomUUID(),schemaRevision:1,status:'pending',createdAt:now,updatedAt:now,...(initial?.source?{source:initial.source}:{}),files:structuredClone(initial?.files||[]),draft:{revision:0,answers:structuredClone(initial?.answers||{}),supplement:initial?.supplement||'',updatedAt:now}}
    return this.commit(record)
  }
  saveDraft(id:string,input:QuestionnaireDraftInput):QuestionnaireSaveResult {
    const record=this.require(id)
    if(record.status!=='pending')return{ok:false,record,error:'questionnaire_not_pending'}
    if(!input||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)throw Error('invalid_draft_revision')
    const errors=validateQuestionnaireAnswers(record.questions,input.answers,input.supplement,false)
    if(errors.length)throw Error('invalid_questionnaire_draft: '+errors.map(e=>e.message).join('；'))
    this.assertOwnedAttachments(record,input.answers)
    if(input.baseRevision!==record.draft.revision){
      const conflict={...structuredClone(input),id:randomUUID(),savedAt:Date.now()}
      record.recoveries=[...(record.recoveries||[]),conflict].slice(-20);record.updatedAt=Date.now()
      return{ok:false,record:this.commit(record),conflict,error:'questionnaire_draft_conflict'}
    }
    record.draft={revision:record.draft.revision+1,answers:structuredClone(input.answers),supplement:input.supplement,updatedAt:Date.now()};record.updatedAt=Date.now()
    return{ok:true,record:this.commit(record)}
  }
  submit(id:string,input:QuestionnaireSubmitInput):QuestionnaireSubmitResult {
    const record=this.require(id)
    if(!input||typeof input.submissionId!=='string'||!input.submissionId||input.submissionId.length>200||/[\u0000-\u0020]/.test(input.submissionId))throw Error('invalid_submission_id')
    if(record.submission?.submissionId===input.submissionId){
      if((input.answers!==undefined&&!isDeepStrictEqual(record.submission.answers,applicableQuestionnaireAnswers(record.questions,input.answers)))||(input.supplement!==undefined&&record.submission.supplement!==input.supplement))return{ok:false,record,conflict:true,error:'submission_id_conflict'}
      return{ok:true,record}
    }
    if(record.status!=='pending')return{ok:false,record,error:'questionnaire_not_pending',conflict:!!record.submission}
    if(input.revision!==record.draft.revision||(input.answers!==undefined&&!isDeepStrictEqual(input.answers,record.draft.answers))||(input.supplement!==undefined&&input.supplement!==record.draft.supplement))return{ok:false,record,conflict:true,error:'questionnaire_draft_conflict'}
    const errors=validateQuestionnaireAnswers(record.questions,record.draft.answers,record.draft.supplement)
    if(errors.length)return{ok:false,record,errors,error:'questionnaire_answers_invalid'}
    const submittedAnswers=applicableQuestionnaireAnswers(record.questions,record.draft.answers)
    this.assertOwnedAttachments(record,submittedAnswers,true)
    record.submission={submissionId:input.submissionId,submittedAt:Date.now(),revision:record.draft.revision,answers:structuredClone(submittedAnswers),supplement:record.draft.supplement}
    record.status='submitted';record.updatedAt=Date.now();record.continuation={state:'pending'}
    return{ok:true,record:this.commit(record)}
  }
  private assertOwnedAttachments(record:QuestionnaireRecord,answers:QuestionnaireAnswers,checkFiles=false){
    for(const answer of Object.values(answers))for(const file of answer.attachments||[]){
      if(!record.files?.some(owned=>isDeepStrictEqual(owned,file)))throw Error('questionnaire_attachment_not_owned')
      if(checkFiles&&(!fs.existsSync(file.path)||fs.statSync(file.path).size!==file.size))throw Error('questionnaire_attachment_missing')
      if(checkFiles&&createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')!==file.sha256)throw Error('questionnaire_attachment_changed')
    }
  }
  attach(id:string,questionId:string,files:Array<{name:string;data:string}>){
    const record=this.require(id),question=record.questions.find(q=>q.id===questionId)
    if(record.status!=='pending'||question?.type!=='attachment')throw Error('questionnaire_attachment_not_allowed')
    if(!Array.isArray(files)||!files.length||files.length>(question.maxFiles??5))throw Error('questionnaire_attachment_count')
    const decoded=files.map(file=>{
      if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>255||/[\\/\u0000-\u001f]/.test(file.name)||typeof file.data!=='string'||file.data.length>Math.ceil((question.maxFileBytes??MAX_QUESTIONNAIRE_FILE_BYTES)/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw Error('questionnaire_attachment_invalid')
      const data=Buffer.from(file.data,'base64')
      if(data.length>(question.maxFileBytes??MAX_QUESTIONNAIRE_FILE_BYTES)||question.accept?.length&&!question.accept.some(ext=>file.name.toLowerCase().endsWith(ext.toLowerCase())))throw Error('questionnaire_attachment_type_or_size')
      return{name:file.name,data}
    })
    if((record.files||[]).reduce((sum,f)=>sum+f.size,0)+decoded.reduce((sum,f)=>sum+f.data.length,0)>50*1024*1024)throw Error('questionnaire_attachment_total_limit')
    const directory=path.join(this.directory,'attachments',record.id),attachments:QuestionnaireAttachment[]=[]
    fs.mkdirSync(directory,{recursive:true})
    try{
      for(const file of decoded){const attachment={id:randomUUID(),name:file.name,size:file.data.length,path:'',sha256:createHash('sha256').update(file.data).digest('hex')},extension=path.extname(file.name);attachment.path=path.join(directory,attachment.id+(/^\.[a-zA-Z0-9]{1,12}$/.test(extension)?extension:'.bin'));fs.writeFileSync(attachment.path,file.data,{flag:'wx'});attachments.push(attachment)}
      record.files=[...(record.files||[]),...attachments];record.updatedAt=Date.now();this.commit(record)
      return structuredClone(attachments)
    }catch(error){for(const file of attachments)try{fs.unlinkSync(file.path)}catch{}throw error}
  }
  attachment(id:string,attachmentId:string){const file=this.require(id).files?.find(f=>f.id===attachmentId);if(!file)throw Error('questionnaire_attachment_not_found');return file}
  readSubmittedAttachment(chatId:string,id:string,attachmentId:string){
    const record=this.require(id)
    if(record.chatId!==chatId||record.status!=='submitted'||!Object.values(record.submission?.answers||{}).some(answer=>answer.attachments?.some(file=>file.id===attachmentId)))throw Error('questionnaire_attachment_access_denied')
    const file=this.attachment(id,attachmentId);this.assertOwnedAttachments(record,{file:{state:'answered',attachments:[file]}},true)
    const data=fs.readFileSync(file.path);if(data.length!==file.size||data.length>MAX_QUESTIONNAIRE_FILE_BYTES||createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('questionnaire_attachment_changed')
    return{file,data}
  }
  revise(id:string){
    const original=this.require(id)
    const existing=this.list(original.chatId).find(r=>r.status==='pending'&&r.source?.kind==='amendment'&&r.source.id===id)
    if(existing)return existing
    if(original.status!=='submitted'||!original.submission||original.continuation?.state!=='done')throw Error('请等待任务处理完成后再修改答案')
    if(this.list(original.chatId).some(r=>r.source?.kind==='amendment'&&r.source.id===id&&r.status==='submitted'))throw Error('这份问卷已有更新版本，请打开最新版本修改')
    return this.create(original,{chatId:original.chatId,runId:randomUUID(),toolCallId:'user-form-'+randomUUID(),chatTitle:original.chatTitle,parentChatId:original.parentChatId,taskConstraints:original.taskConstraints},{answers:original.draft.answers,supplement:original.submission.supplement,files:original.files,source:{kind:'amendment',id,title:original.title}})
  }
  listTemplates(){return structuredClone([...BUILTIN_QUESTIONNAIRE_TEMPLATES,...this.templates.values()])}
  getTemplate(id:string){const template=this.listTemplates().find(t=>t.id===id);if(!template)throw Error('questionnaire_template_not_found');return template}
  saveTemplate(id:string,title:string){
    const record=this.require(id),template:QuestionnaireTemplate={id:randomUUID(),title,description:record.description,questions:structuredClone(record.questions),updatedAt:Date.now()}
    const errors=validateQuestionnaireDefinition(template);if(errors.length)throw Error(errors.join('；'))
    const filename=path.join(this.directory,'templates',template.id+'.json'),temporary=filename+'.tmp'
    try{fs.writeFileSync(temporary,JSON.stringify(template),'utf8');fs.renameSync(temporary,filename)}catch(error){try{fs.unlinkSync(temporary)}catch{}throw error}
    this.templates.set(template.id,template);return structuredClone(template)
  }
  deleteTemplate(id:string){if(!this.templates.has(id))throw Error('questionnaire_template_not_found');fs.unlinkSync(path.join(this.directory,'templates',id+'.json'));this.templates.delete(id)}
  useTemplate(id:string,owner:Parameters<QuestionnaireStore['create']>[1]){const template=this.getTemplate(id);return this.create(template,owner,{source:{kind:'template',id,title:template.title}})}
  cancel(id:string,reason='cancelled'){
    const record=this.require(id)
    if(record.status!=='pending')return{ok:false,record,error:'questionnaire_not_pending'}
    record.status=['stopped','deleted','replaced'].includes(reason)?'stale':'cancelled';record.cancelReason=String(reason).slice(0,200);record.updatedAt=Date.now()
    return{ok:true,record:this.commit(record)}
  }
  invalidateChat(chatId:string,reason='stopped'){
    let count=0
    for(const record of this.list(chatId)){
      if(record.status==='pending'){this.cancel(record.id,reason);count++}
      else if(record.status==='submitted'&&record.continuation?.state!=='done'){
        record.continuation={...record.continuation,state:'done',error:reason};record.updatedAt=Date.now();this.commit(record);count++
      }
    }
    return count
  }
  removeChat(chatId:string){this.invalidateChat(chatId,'deleted');for(const record of this.list(chatId)){
    fs.unlinkSync(path.join(this.directory,record.id+'.json'));this.records.delete(record.id)
    const root=path.resolve(this.directory,'attachments'),target=path.resolve(root,record.id)
    if(path.dirname(target)===root&&target!==root)fs.rmSync(target,{recursive:true,force:true})
  }}
  hasWaiter(id:string){return this.waiters.has(id)}
  wait(id:string,signal:AbortSignal):Promise<QuestionnaireRecord>{
    const record=this.require(id)
    if(record.status!=='pending')return Promise.resolve(record)
    if(signal.aborted)return Promise.reject(Error('aborted'))
    if(this.waiters.has(id))throw Error('questionnaire_already_waiting')
    return new Promise((resolve,reject)=>{
      const aborted=()=>{this.waiters.delete(id);reject(Error('aborted'))}
      this.waiters.set(id,value=>{signal.removeEventListener('abort',aborted);resolve(value)})
      signal.addEventListener('abort',aborted,{once:true})
    })
  }
  setContinuation(id:string,continuation:QuestionnaireRecord['continuation']){const record=this.require(id);record.continuation=continuation;record.updatedAt=Date.now();return this.commit(record)}
  finishRun(runId:string){for(const record of this.list())if(record.status==='submitted'&&record.continuation?.state==='claimed'&&record.continuation.runId===runId)this.setContinuation(record.id,{state:'done',runId})}
  releaseRun(runId:string){for(const record of this.list())if(record.status==='submitted'&&record.continuation?.state==='claimed'&&record.continuation.runId===runId)this.setContinuation(record.id,{state:'pending'})}
}
