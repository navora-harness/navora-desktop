import type {ChatSession,SubchatIndexItem,SubChatRunStatus} from './types'
import {subchatAttemptSummary} from './subchat-runtime'
export {subchatGlyph,subchatGlyphUrl} from './subchat-glyph'

export const subchatStatusLabels:Record<SubChatRunStatus,string>={running:'进行中',done:'已完成',failed:'失败',cancelled:'已停止',interrupted:'已中断'}
export function subchatSummary(chat:ChatSession):string{
  const current=chat.subchatRun?.status==='running'?chat.messages.filter(message=>message.meta?.runId===chat.subchatRun?.id&&(message.role==='assistant'||message.role==='log')).at(-1)?.content:undefined
  return (chat.subchatRun?.status==='running'?(current||'正在处理任务…'):(chat.subchatRun?.summary||subchatAttemptSummary(chat)||(!chat.subchatRun?chat.messages.filter(m=>m.role==='log').at(-1)?.content:'')||'')).trim().replace(/\s+/g,' ').slice(0,240)
}
export function subchatIndex(chat:ChatSession,pendingCount=0,resourceCount?:number):SubchatIndexItem{
  return {id:chat.id,parentChatId:chat.parentChatId||'',title:chat.title,purpose:chat.spawnPurpose||'',status:chat.subchatRun?.status||chat.spawnStatus||'done',...(chat.subchatRun?{run:{...chat.subchatRun}}:{}),createdAt:chat.createdAt,updatedAt:chat.updatedAt,revision:chat.subchatRevision||0,messageVersion:chat.subchatMessageVersion||chat.messages.length,summary:subchatSummary(chat),messageCount:chat.messages.length,pendingCount,...(resourceCount!==undefined?{resourceCount}:{})}
}
export function subchatGroup(item:SubchatIndexItem):'attention'|'running'|'done'|'unfinished'{return item.pendingCount?'attention':item.status==='running'?'running':item.status==='done'?'done':'unfinished'}
export function subchatTime(item:SubchatIndexItem,now=Date.now()):string{
  const run=item.run;if(!run?.startedAt)return `更新于 ${new Date(item.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`
  const seconds=Math.max(0,Math.floor(((run.finishedAt??now)-run.startedAt)/1000))
  return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`
}
