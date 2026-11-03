import type {ChatSession,SubChatRun,SubChatSpawnStatus} from './types'
import {finalOutputs} from './message-presentation'

/** Count registered runs, including abort cleanup; persisted `running` is never a quota lease. */
export function assertSubchatCapacity(chat:ChatSession,children:readonly ChatSession[],runningIds:ReadonlySet<string>,limit:number):void{
  if(chat.kind!=='sub')return
  if(!chat.parentChatId)throw Error('subchat_parent_not_found')
  if(children.filter(child=>child.id!==chat.id&&runningIds.has(child.id)).length>=Math.max(1,Math.min(8,Math.floor(limit)||4)))throw Error('max_subchats')
}
export function subchatInheritance(parent:ChatSession){
  return {permissions:parent.permissions?{preset:parent.permissions.preset,modes:{...parent.permissions.modes}}:undefined,providerId:parent.providerId,model:parent.model,reasoningLevel:parent.reasoningLevel,executionMode:parent.executionMode}
}
export function interruptedSubchatRun(chat:ChatSession,now:number):SubChatRun|undefined{
  if(chat.kind!=='sub'||!(chat.subchatRun?.status==='running'||!chat.subchatRun&&chat.spawnStatus==='running'))return
  return {...(chat.subchatRun||{id:`recovered:${chat.id}`,attempt:1}),status:'interrupted',finishedAt:now,reason:'process_restarted',summary:'上次运行因应用退出而中断，可继续交流或重试。'}
}
export function terminalSubchatStatus(run:SubChatRun|undefined,fallback?:SubChatSpawnStatus){return run?.status||(fallback||'done')}
/** A follow-up failure must never borrow a successful answer from an older attempt. */
export function subchatAttemptSummary(chat:ChatSession):string{
  const run=chat.subchatRun
  const messages=run?chat.messages.filter(message=>message.meta?.runId===run.id||!message.meta?.runId&&run.startedAt!==undefined&&message.createdAt>=run.startedAt):chat.messages
  const answer=finalOutputs(messages).at(-1)?.content.trim().replace(/\s+/g,' ')
  if(answer)return answer.length>1200?`${answer.slice(0,1200)}…`:answer
  return [...messages].reverse().find(message=>message.role==='log'&&message.meta?.kind==='agent_error')?.content.slice(0,500)||''
}
