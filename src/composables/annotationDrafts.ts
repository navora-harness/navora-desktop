import type {BrowserAnnotation,BrowserAnnotationDraft,BrowserDraftCopy,BrowserDraftRecovery,BrowserDraftInput,BrowserWorkspaceApi} from '@shared/browser-workspace'

type Entry={row:BrowserAnnotationDraft;local:boolean;pending:number;failure?:unknown}
/** Each panel keeps its editing buffer; accepted drafts live in the main process. */
export function createAnnotationDrafts(api:BrowserWorkspaceApi,chatId:string,changed:()=>void){
  const editorId=globalThis.crypto?.randomUUID?.()||`editor_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const entries=new Map<string,Entry>(),writes=new Map<string,Set<Promise<void>>>()
  const versions=new Map<string,number>()
  let recovery:BrowserDraftRecovery={copies:[],issues:[]}
  let sequence=0
  function syncRecovery(value:BrowserDraftRecovery){recovery=value;changed()}
  async function refreshRecovery(){syncRecovery(await api.annotationDraftRecovery(chatId))}
  function copies(id:string){return recovery.copies.filter(copy=>copy.annotationId===id)}
  function copied(entry:Entry){return copies(entry.row.annotationId).some(copy=>copy.editorId===editorId&&copy.sequence>=entry.row.sequence)}
  function sync(rows:BrowserAnnotationDraft[],focusedId?:string){
    for(const row of rows){
      versions.set(row.annotationId,Math.max(versions.get(row.annotationId)||0,row.version))
      const current=entries.get(row.annotationId)
      if(current&&(current.pending||current.failure))continue
      if(current&&current.local&&focusedId===row.annotationId&&row.editorId!==editorId&&row.version>current.row.version&&row.text!==current.row.text){
        current.failure=Error('annotation_draft_conflict')
        // Preserve even when the user has stopped typing before the remote edit.
        void persist({id:row.annotationId,comment:current.row.baseComment,revision:current.row.baseRevision} as BrowserAnnotation,current.row.text,current.row.deleted)
        continue
      }
      if(!current||row.version>=current.row.version)entries.set(row.annotationId,{row:{...row},pending:0,local:current?.local&&row.editorId===editorId||false})
    }
    changed()
  }
  function read(note:BrowserAnnotation){
    const row=entries.get(note.id)?.row
    if(!row||row.deleted||row.text===note.comment)return undefined
    if(row.baseComment===note.comment)row.baseRevision=note.revision
    return row
  }
  function persist(note:BrowserAnnotation,text:string,deleted=false){
    const previous=entries.get(note.id),row=previous?.row,seq=++sequence
    const input:BrowserDraftInput={editorId,sequence:seq,text:deleted?'':text,deleted,baseComment:row&&!row.deleted?row.baseComment:note.comment,baseRevision:row&&!row.deleted?row.baseRevision:note.revision}
    const entry=previous||{row:{...input,annotationId:note.id,version:0,updatedAt:Date.now()},pending:0,local:true}
    entry.row={...entry.row,...input};entry.local=true;entry.pending++;entries.set(note.id,entry);changed()
    // Send immediately: a window transfer cannot strand a debounce timer.
    const pending=api.writeAnnotationDraft(chatId,note.id,row?.version||0,input).then(saved=>{
      versions.set(note.id,Math.max(versions.get(note.id)||0,saved.version))
      entry.row.version=Math.max(entry.row.version,saved.version)
      if(entry.row.sequence===seq){entry.row={...saved};entry.failure=undefined}
    }).catch(async error=>{
      if(entry.row.sequence===seq)entry.failure=error
      try{await refreshRecovery()}catch{/* Keep the unsaved buffer and its error. */}
    }).finally(()=>{entry.pending--;writes.get(note.id)?.delete(pending);changed()})
    const set=writes.get(note.id)||new Set<Promise<void>>();set.add(pending);writes.set(note.id,set)
    return pending
  }
  async function flush(id:string){await Promise.all([...(writes.get(id)||[])]);const error=entries.get(id)?.failure;if(error)throw error}
  async function clear(note:BrowserAnnotation){await flush(note.id);await persist(note,'',true);await flush(note.id)}
  async function reload(note:BrowserAnnotation){
    await Promise.all([...(writes.get(note.id)||[])])
    const current=entries.get(note.id)
    if(current?.failure&&!copied(current))throw current.failure
    const row=(await api.annotationDrafts(chatId)).find(row=>row.annotationId===note.id)
    versions.set(note.id,row?.version||0)
    entries.delete(note.id);if(row)entries.set(note.id,{row:{...row},local:false,pending:0});changed()
    return read(note)?.text??note.comment
  }
  async function resolve(note:BrowserAnnotation,copy:BrowserDraftCopy,text:string){
    await Promise.all([...(writes.get(note.id)||[])])
    const current=entries.get(note.id)
    if(current?.failure&&!copied(current))throw current.failure
    const input:BrowserDraftInput={text,baseComment:note.comment,baseRevision:note.revision,editorId,sequence:++sequence,deleted:text===note.comment}
    try{
      const row=await api.resolveAnnotationDraft(chatId,note.id,versions.get(note.id)||0,input,{id:copy.id,sequence:copy.sequence})
      versions.set(note.id,row.version);entries.set(note.id,{row,local:true,pending:0})
      await refreshRecovery();changed();return read(note)?.text??note.comment
    }catch(error){await refreshRecovery().catch(()=>{});throw error}
  }
  function state(note:BrowserAnnotation){const entry=entries.get(note.id);return {pending:!!entry?.pending,error:entry?.failure?String(entry.failure):'',copied:!!entry&&copied(entry),retained:!!entry&&!entry.row.deleted&&entry.row.text!==note.comment&&!entry.pending&&!entry.failure}}
  return {sync,syncRecovery,copies,issues:()=>recovery.issues,resolve,read,remember:(note:BrowserAnnotation,text:string)=>persist(note,text,text===note.comment),flush,clear,reload,state,forget:(id:string)=>entries.delete(id)}
}
