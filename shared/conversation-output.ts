import type {ChatMessage} from './types'
import {isQuietResourceLog,type TranscriptBlock} from './message-presentation'
import {logKindFromMeta} from './run-logs'
/** Never move a late event before prose or attach it to another run's disclosure. */
export function conversationOutputBlocks(messages:readonly ChatMessage[],showLogs=true):TranscriptBlock[]{
  const seen=new Set<string>(),blocks:TranscriptBlock[]=[]
  for(const message of messages){
    if(seen.has(message.id))continue
    seen.add(message.id)
    if(message.role==='log'){
      if(isQuietResourceLog(message)||!showLogs&&logKindFromMeta(message.meta?.kind)!=='error'&&!['agent_stop','round_limit'].includes(String(message.meta?.kind)))continue
      blocks.push({type:'log',key:message.id,message})
    }else if(message.role==='tool')blocks.push({type:'tool',key:message.id,message})
    else if(message.content.trim()||typeof message.meta?.reasoning==='string'&&message.meta.reasoning.trim())blocks.push({type:'chat',key:message.id,message})
  }
  return blocks
}
export function toolActivityLabel(message:ChatMessage,status=String(message.meta?.status||'unconfirmed'),fallback='工具操作'){
  const name=String(message.meta?.toolName||'').toLowerCase()
  const action=/command|terminal|exec/.test(name)?'运行命令':/write|edit|patch/.test(name)?'编辑文件':/read.*file|file.*read/.test(name)?'读取文件':/download/.test(name)?'下载文件':/browser|navigate|snapshot|screenshot/.test(name)?'操作网页':fallback
  if(status==='running')return `正在${action}`
  if(status==='aborted'||status==='stopped')return `${action}已停止`
  if(status==='error')return `${action}未完成`
  if(!['done','success','completed'].includes(status))return `${action} · 状态待确认`
  const past:Record<string,string>={'运行命令':'运行了命令','编辑文件':'编辑了文件','读取文件':'读取了文件','下载文件':'下载了文件','操作网页':'操作了网页'}
  return past[action]||action
}
export function boundedToolOutput(content:string,limit=24000){return {text:content.slice(0,limit),truncated:content.length>limit,total:content.length}}
/** Search reveals a real bounded window around the match instead of rendering an entire huge log. */
export function revealedToolOutput(content:string,reveal?:{from:number;to:number},limit=24000){
  if(!reveal||!Number.isFinite(reveal.from)||!Number.isFinite(reveal.to)||reveal.from<0||reveal.to<=reveal.from||reveal.from>=content.length||reveal.to<=limit)return {...boundedToolOutput(content,limit),start:0}
  const from=Math.min(content.length,Math.floor(reveal.from)),to=Math.min(content.length,Math.floor(reveal.to)),start=Math.max(0,from-3000),end=Math.min(content.length,Math.max(to+3000,start+6000))
  return {text:content.slice(start,end),truncated:start>0||end<content.length,total:content.length,start}
}
