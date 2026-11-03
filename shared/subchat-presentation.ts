import type {ChatSession,SubchatIndexItem,SubChatRunStatus} from './types'
import {subchatAttemptSummary} from './subchat-runtime'

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
/** Stable, local vector identity. Version 1 deliberately does not depend on a title or theme. */
export function subchatGlyph(id:string):string{
  let seed=2166136261;for(const char of `v1:${id}`)seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0
  const hue=seed%360,kind=(seed>>>9)%3,count=6+(seed%3),rotation=(seed>>>16)%60
  const shapes=Array.from({length:count},(_,i)=>{const angle=i*360/count;return kind===0?`<ellipse cx="16" cy="8.2" rx="3.2" ry="6.1" transform="rotate(${angle} 16 16)"/>`:kind===1?`<path d="M16 3 23 11 16 16 12 10Z" transform="rotate(${angle} 16 16)"/>`:`<path d="M16 2 20 11 16 16 12 11Z" transform="rotate(${angle} 16 16)"/>`}).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="rotate(${rotation} 16 16)" fill="hsl(${hue} 64% 63%)" fill-opacity=".83" stroke="hsl(${hue} 55% 36%)" stroke-width=".5">${shapes}</g><circle cx="16" cy="16" r="3" fill="hsl(${hue} 55% 35%)" stroke="white" stroke-width=".8"/></svg>`
}
export function subchatGlyphUrl(id:string):string{return `data:image/svg+xml,${encodeURIComponent(subchatGlyph(id))}`}
