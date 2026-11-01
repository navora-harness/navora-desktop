import type {ChatMessage} from './types'
import {makeFileTab} from './file-tabs'
import {finalOutputs} from './message-presentation'

export type ResourceEvidence={messageId:string;turnId?:string;runId?:string;answerId?:string;operation:string;createdAt:number}
export type WorkspaceResource = {
  id: string
  ownerChatId: string
  path: string
  name: string
  kind: 'image' | 'document' | 'code' | 'file'
  size: number
  mtimeMs: number
  /** Metadata revision, not a content hash. */
  revision: string
  /** A known successful related operation; unknown files have no inferred origin. */
  evidence?: ResourceEvidence
}
export function associateResourceEvidence(entries:readonly WorkspaceResource[],messages:readonly ChatMessage[]):WorkspaceResource[]{
  const wanted=new Set(entries.map(entry=>entry.path)),records=new Map<string,ResourceEvidence>(),pending=new Map<string,ResourceEvidence>()
  const finals=new Set(finalOutputs(messages).map(message=>message.id))
  const completedAnswers=new Map<string,string>()
  let turnId:string|undefined
  const safe=(path:unknown)=>{try{return typeof path==='string'?makeFileTab('evidence',path).path:null}catch{return null}}
  const clear=(path:string)=>{for(const key of records.keys())if(key===path||key.startsWith(path+'/')){records.delete(key);pending.delete(key)}}
  for(const message of messages){
    if(message.role==='user'){
      if(message.meta?.inserted&&message.meta.runId){turnId=message.meta.turnId||turnId;continue}
      turnId=message.id;pending.clear();continue
    }
    if(finals.has(message.id)){
      if(message.meta?.runId)completedAnswers.set(message.meta.runId,message.id)
      for(const [path,record] of pending){
        if(record.runId&&message.meta?.runId&&record.runId!==message.meta.runId)continue
        record.answerId=message.id;pending.delete(path)
      }
      continue
    }
    if(message.role==='log'&&message.meta?.kind==='browser_download'&&message.meta.runId){
      const download=message.meta.download as {state?:string;path?:string}|undefined
      const path=safe(download?.path)
      if(download?.state==='completed'&&path&&wanted.has(path)){
        const record:ResourceEvidence={messageId:message.id,turnId:message.meta.turnId,runId:message.meta.runId,operation:'browser_download',createdAt:message.createdAt}
        const answer=completedAnswers.get(message.meta.runId)
        if(answer)record.answerId=answer
        records.set(path,record);if(!answer)pending.set(path,record)
      }
      continue
    }
    if(message.role!=='tool'||message.meta?.status!=='done'||message.meta?.fromPlugin)continue
    const operation=String(message.meta?.toolName||'')
    if(!['file_write','file_copy','file_move','file_concat','file_download','file_delete','browser_screenshot','desktop_screenshot'].includes(operation))continue
    let result=message.meta?.result
    if(!result&&message.content.length<=262144){try{result=JSON.parse(message.content)}catch{continue}}
    if(!result||typeof result!=='object'||Array.isArray(result))continue
    const data=result as Record<string,unknown>
    if(data.ok!==true)continue
    const path=safe(data.to??data.path)
    if(operation==='file_move'){const from=safe(data.from);if(from)clear(from)}
    if(!path)continue
    if(operation==='file_delete'){clear(path);continue}
    if(!wanted.has(path))continue
    const record:ResourceEvidence={messageId:message.id,turnId:message.meta.turnId||turnId,operation,createdAt:message.createdAt,...(message.meta.runId?{runId:message.meta.runId}:{})}
    records.set(path,record);pending.set(path,record)
  }
  return entries.map(entry=>({...entry,evidence:records.get(entry.path)}))
}

/** Existing, successfully produced workspace files, placed under their actual answer. */
export function replyArtifactGroups(entries:readonly WorkspaceResource[],messages:readonly ChatMessage[]):Map<string,WorkspaceResource[]>{
  const groups=new Map<string,WorkspaceResource[]>()
  for(const entry of associateResourceEvidence(entries,messages)){
    const answerId=entry.evidence?.answerId
    if(!answerId)continue
    const group=groups.get(answerId)||[]
    group.push(entry)
    groups.set(answerId,group)
  }
  return groups
}
export type WorkspaceResourceSnapshot = {
  ok: boolean
  entries: WorkspaceResource[]
  truncated: boolean
  unavailable: number
  error?: string
}
export function resourceKind(path: string): WorkspaceResource['kind'] {
  const extension=path.split('.').at(-1)?.toLowerCase()||''
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(extension)) return 'image'
  if (/^(md|markdown|txt|pdf|docx?|xlsx?|csv|pptx?|jsonl)$/.test(extension)) return 'document'
  if (/^(js|jsx|ts|tsx|html?|css|json|py|rs|go|c|cpp|h|vue|svelte|ya?ml|toml|sh|ps1)$/.test(extension)) return 'code'
  return 'file'
}
export function searchWorkspaceResources(entries: readonly WorkspaceResource[], query: string): WorkspaceResource[] {
  const normalize=(text:string)=>text.normalize('NFKC').toLowerCase()
  const needle=normalize(query.trim()),tokens=needle.split(/\s+/).filter(Boolean)
  const score=(entry:WorkspaceResource)=>normalize(entry.name)===needle?0:normalize(entry.name).startsWith(needle)?1:2
  return entries.filter(entry=>tokens.every(token=>normalize(entry.path).includes(token)))
    .sort((a,b)=>(needle?score(a)-score(b):0)||b.mtimeMs-a.mtimeMs||a.path.localeCompare(b.path))
}
