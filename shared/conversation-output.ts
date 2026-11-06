import type {ChatMessage} from './types'
import {finalOutputs,isQuietResourceLog,type TranscriptBlock} from './message-presentation'
import {logKindFromMeta} from './run-logs'
/** Never move a late event before prose or attach it to another run's disclosure. */
export function conversationOutputBlocks(messages:readonly ChatMessage[],showLogs=true):TranscriptBlock[]{
  const seen=new Set<string>(),blocks:TranscriptBlock[]=[]
  for(const message of messages){
    if(seen.has(message.id))continue
    seen.add(message.id)
    if(message.role==='log'){
      if(isQuietResourceLog(message)||!showLogs&&logKindFromMeta(message.meta?.kind)!=='error'&&!['agent_stop','round_limit','agent_run_end'].includes(String(message.meta?.kind)))continue
      blocks.push({type:'log',key:message.id,message})
    }else if(message.role==='tool')blocks.push({type:'tool',key:message.id,message})
    else if(message.content.trim()||typeof message.meta?.reasoning==='string'&&message.meta.reasoning.trim())blocks.push({type:'chat',key:message.id,message})
  }
  return blocks
}

export type ConversationProcessGroup={key:string;firstId:string;messageIds:string[];processIds:Set<string>;summary:string;warning:boolean;outcome?:{label:string;detail:string;error:boolean}}

/** Disclosures are a view over the original order. Late logs retain their own run identity. */
export function conversationProcessGroups(messages:readonly ChatMessage[],running=false,showLogs=true):ConversationProcessGroup[]{
  const runs=new Map<string,ChatMessage[]>(),seen=new Set<string>()
  let fallback='history'
  for(const message of messages){
    if(seen.has(message.id))continue
    seen.add(message.id)
    if(message.role==='user'||message.role==='system'){fallback=`turn:${message.id}`;continue}
    const key=message.meta?.runId?`run:${message.meta.runId}`:fallback
    const items=runs.get(key)||[];items.push(message);runs.set(key,items)
  }
  const finalIds=new Set(finalOutputs(messages).map(message=>message.id)),shown=new Set(conversationOutputBlocks(messages,showLogs).map(block=>block.key)),current=[...runs.keys()].at(-1),groups:ConversationProcessGroup[]=[]
  for(const [key,items] of runs){
    const explicit=items.filter(message=>message.role==='assistant'&&message.meta?.phase==='final'&&message.content.trim())
    const results=explicit.length?explicit:items.filter(message=>finalIds.has(message.id)).slice(-1)
    const end=items.find(message=>message.meta?.kind==='agent_run_end')
    let terminal:ChatMessage|undefined
    for(let i=items.length-1;i>=0;i--){const message=items[i]!;if(['round_limit','agent_stop','agent_error'].includes(String(message.meta?.kind))){terminal=message;break}}
    // A recorded termination can collapse even without an answer; its truthful outcome stays outside.
    // An idle renderer alone cannot certify that unfinished historical work actually ended.
    if(!results.length&&!end&&!terminal||running&&key===current&&!end)continue
    let outcome:ConversationProcessGroup['outcome']
    if(!results.length){
      const kind=terminal?.meta?.kind,reason=end?.meta?.stopReason
      if(kind==='round_limit'||reason==='round_limit')outcome={label:'已达到轮次上限',detail:'本轮已结束，未生成最终答复。完整过程已保留。',error:false}
      else if(kind==='agent_stop'||reason==='user_cancelled')outcome={label:'任务已停止',detail:'未生成最终答复，可展开查看停止前的过程。',error:false}
      else if(kind==='agent_error')outcome={label:'运行中断',detail:String(terminal?.meta?.summary||terminal?.content||'未生成最终答复。').trim().replace(/\s+/g,' ').slice(0,200),error:true}
      else outcome={label:'本轮已结束',detail:'未记录最终答复，可展开查看完整过程。',error:false}
    }
    const resultIds=new Set(results.map(message=>message.id))
    const process=items.filter(message=>!resultIds.has(message.id)&&!isQuietResourceLog(message))
    if(!process.length&&!results.some(message=>message.meta?.reasoning))continue
    const tools=process.filter(message=>message.role==='tool'),logs=process.filter(message=>message.role==='log'&&!['agent_run_start','agent_run_end'].includes(String(message.meta?.kind)))
    const children=new Set(tools.filter(message=>message.meta?.toolName==='agent_spawn_subchat').map(message=>message.meta?.subChatId||message.id))
    const warning=!!outcome||process.some(message=>message.meta?.status==='error'||message.meta?.kind==='agent_error'||message.meta?.kind==='agent_stop'||message.meta?.kind==='round_limit')
    const start=items.find(message=>message.meta?.kind==='agent_run_start')
    const seconds=start&&end?Math.max(0,Math.round((end.createdAt-start.createdAt)/1000)):undefined
    const summary=[children.size?`${children.size} 个子任务`:'',tools.length?`${tools.length} 次调用`:'',logs.length?`${logs.length} 条日志`:'',seconds!==undefined?`${seconds} 秒`:'',warning?'含未完成记录':''].filter(Boolean).join(' · ')
    const firstId=process.find(message=>shown.has(message.id))?.id||results[0]?.id
    if(firstId)groups.push({key,firstId,messageIds:items.map(message=>message.id),processIds:new Set(process.map(message=>message.id)),summary,warning,...(outcome?{outcome}:{})})
  }
  return groups
}
export function toolActivityLabel(message:ChatMessage,status=String(message.meta?.status||'unconfirmed'),fallback='工具操作'){
  const name=String(message.meta?.toolName||'').toLowerCase()
  if(name==='agent_await_subchats')return status==='running'?'正在等待子任务':status==='error'?'等待子任务未完成':status==='aborted'?'等待已停止':['done','success','completed'].includes(status)?'子任务进展':'子任务进展 · 待确认'
  if(name==='agent_subchat_status')return '子任务进展'
  if(name==='agent_ask_user')return status==='running'?'等待你的回答':['done','success','completed'].includes(status)?'已收到你的回答':'询问记录'
  if(name==='agent_ask_form')return status==='running'?'等待填写问卷':status==='aborted'?'问卷已结束':['done','success','completed'].includes(status)?'问卷记录':'问卷未完成'
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
