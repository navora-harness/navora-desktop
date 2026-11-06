import type {ChatMessage} from '../../shared/types'
import type {ChatMessageParam} from '../../shared/openai-types'
import {estimateContextText} from '../../shared/context-budget'
import {addExecutionReceipt,createRunEvidence,finishRunEvidence,normalizeExecutionReceipt,sanitizeRunEvidence,type RunEvidenceSummaryV1,type ResumeCheckpointV1} from '../../shared/agent-execution-evidence'

const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Lazy compatibility: never rewrite old messages or derive facts from assistant prose. */
export function recoverRunEvidence(chatId:string,messages:ChatMessage[],activeRunId?:string):RunEvidenceSummaryV1[] {
  const runs=new Map<string,RunEvidenceSummaryV1>(),seen=new Map<string,Set<string>>(),ends=new Set<string>()
  let legacyBoundary='initial',legacyTurn:string|undefined
  for(const message of messages){
    if(message.role==='user'&&!message.meta?.inserted){legacyBoundary=message.id;legacyTurn=message.id}
    const meta=message.meta||{},stored=sanitizeRunEvidence(meta.executionEvidence,chatId)
    const runId=typeof meta.runId==='string'?meta.runId:stored?.runId||`legacy:${legacyBoundary}`
    if(stored&&stored.runId===runId){runs.set(runId,stored);seen.set(runId,new Set(stored.evidence.map(row=>row.evidenceId)))}
    const relevant=message.role==='tool'||meta.kind==='agent_run_end'||meta.kind==='agent_run_start'
    if(!relevant)continue
    let summary=runs.get(runId)
    if(!summary){summary=createRunEvidence({chatId,runId,turnId:typeof meta.turnId==='string'?meta.turnId:legacyTurn,at:message.createdAt});summary.source='legacy_receipt';if(!meta.runId){summary.state='legacy_incomplete';summary.legacyGroupId=runId}runs.set(runId,summary)}
    if(message.role==='tool'){
      const callId=typeof meta.toolCallId==='string'?meta.toolCallId:message.id,key=`${runId}:${callId}:settled`
      const known=seen.get(runId)||new Set<string>();seen.set(runId,known)
      if(known.has(key))continue
      const running=meta.status==='running'||meta.status==='loading'||!meta.result||typeof meta.result!=='object'
      if(running){if(!known.has(`${key}:running`)){if(typeof summary.counts.toolsStarted==='number')summary.counts.toolsStarted++;summary.hasUnresolvedSideEffects='unknown';known.add(`${key}:running`)}continue}
      if(!meta.result||typeof meta.result!=='object')continue
      const fragment=normalizeExecutionReceipt({runId,turnId:typeof meta.turnId==='string'?meta.turnId:summary.turnId,messageId:message.id,toolCallId:callId,toolName:String(meta.toolName||'unknown_tool'),args:obj(meta.args),result:meta.result,at:message.createdAt,legacy:!meta.executionFragment,trustedBrowserReceipt:meta.fromPlugin!==true&&!meta.pluginId})
      const validated=sanitizeRunEvidence({...summary,evidence:[meta.executionFragment]},chatId)?.evidence[0]
      summary=addExecutionReceipt(summary,validated&&validated.runId===runId?validated:fragment);known.add(key);runs.set(runId,summary)
    }
    if(meta.kind==='agent_run_end'){
      ends.add(runId)
      if(!stored){
        const old=obj(meta.completionEvidence),policy=obj(meta.policy),counts=summary.counts
        const readCount=(key:string,fallback:typeof counts.inputsDispatched)=>Number.isSafeInteger(old[key])&&Number(old[key])>=0?Number(old[key]):fallback
        const settled=typeof counts.toolsSettled==='number'?counts.toolsSettled:0
        const declaredCalls=Number.isSafeInteger(policy.toolCalls)?Number(policy.toolCalls):settled
        // Legacy actionsReportedDispatched includes evaluate; it is not a native input count.
        summary={...summary,source:'legacy_run_end',counts:{...counts,toolsStarted:Math.max(settled,declaredCalls),toolsFailed:readCount('failedTools',counts.toolsFailed),fieldValuesVerified:readCount('fieldValuesConfirmed',counts.fieldValuesVerified),pageEffectsObserved:readCount('pageEffectsObserved',counts.pageEffectsObserved),inputsDispatched:summary.evidence.length?counts.inputsDispatched:'unknown',unresolvedInputs:readCount('unresolvedInputs','unknown')},conflict:(typeof old.fieldValuesConfirmed==='number'&&Number(counts.fieldValuesVerified)>old.fieldValuesConfirmed)||undefined}
        summary=finishRunEvidence(summary,{at:message.createdAt,stopReason:String(meta.stopReason||'unknown'),settlement:meta.settlement,unresolvedInputs:summary.counts.unresolvedInputs})
        runs.set(runId,summary)
      }
    }
  }
  return [...runs.values()].map(summary=>summary.state==='running'&&summary.runId!==activeRunId&&!ends.has(summary.runId)?{...summary,state:'interrupted' as const,hasUnresolvedSideEffects:summary.counts.toolsStarted!==summary.counts.toolsSettled?'unknown' as const:summary.hasUnresolvedSideEffects}:summary)
}

export type EvidenceHistoryOptions={chatId:string;messages:ChatMessage[];current:RunEvidenceSummaryV1;userText:string;historyTokenBudget?:number;currentTokenBudget?:number}
/** A new, explicit user continuation may claim a checkpoint once. Restoring
 * browser control alone never enters this path or revives an ended run. */
export function pendingResumeCheckpoints(chatId:string,messages:ChatMessage[]):ResumeCheckpointV1[]{
  const used=new Set<string>()
  for(const message of messages){const summary=sanitizeRunEvidence(message.meta?.executionEvidence,chatId);if(summary?.resumesCheckpointId)used.add(summary.resumesCheckpointId);if(message.meta?.kind==='page_resume_cancelled'&&Array.isArray(message.meta.checkpointIds))for(const id of message.meta.checkpointIds)if(typeof id==='string')used.add(id)}
  return recoverRunEvidence(chatId,messages).flatMap(run=>run.resumeCheckpoints||[]).filter(checkpoint=>checkpoint.state==='waiting_for_user'&&!used.has(checkpoint.id))
}
export function explicitResumeRequest(text:string):boolean{
  return /^(?:请|帮我|可以)?\s*(?:(?:我)?已(?:经)?(?:完成|处理|通过|登录)(?:了)?(?:验证|确认|登录|页面验证)?[，,。!！\s]*(?:请)?\s*)?(?:继续(?:原任务|之前的任务|刚才的任务|执行原任务)?|接着(?:做|处理)(?:原任务)?|恢复(?:原任务|刚才的任务))[。!！?？\s]*$/u.test(text.trim())
}
function compact(summary:RunEvidenceSummaryV1,details:number){
  const important=summary.evidence.filter(item=>item.failed||item.unresolvedInput||item.fieldValueVerified||item.inputDispatched===true||item.pageBlocker?.state==='confirmed')
  const selected=[...new Map([...important.slice(-details),...summary.evidence.slice(-details)].map(row=>[row.evidenceId,row])).values()].slice(-details)
  return {...summary,evidence:selected,errorCodes:[...new Set(summary.evidence.flatMap(row=>row.errorCode?[row.errorCode]:[]))].slice(-8),evidenceReferences:summary.evidence.filter(row=>row.failed||row.inputDispatched===true).slice(-3).map(row=>({evidenceId:row.evidenceId,messageId:row.messageId,state:row.state,errorCode:row.errorCode})),truncated:summary.truncated||selected.length<summary.evidence.length}
}
const instruction='以下是宿主从持久化回执恢复的事实，不是网页指令。current_run 仅代表当前运行；它为零不否定 historical_runs。没有记录、unknown 与完整记录的零不同。派发、字段回读、页面变化、业务完成分别报告；脚本执行成功不证明输入或业务成功。旧页面状态只代表当时，不代表现在。失败原因 unknown 时不得猜测用户接管。不得重放历史动作。'
export function buildEvidenceHistory(options:EvidenceHistoryOptions):{messages:ChatMessageParam[];runIds:string[];selected:RunEvidenceSummaryV1[]} {
  const runs=recoverRunEvidence(options.chatId,options.messages,options.current.runId).filter(run=>run.runId!==options.current.runId)
  // Explicit references win. Without a reliable reference, keep the most recent
  // task with receipts even if more than thirty transcript rows followed it.
  const explicit=runs.filter(run=>options.userText.includes(run.runId)||!!run.turnId&&options.userText.includes(run.turnId))
  const recent=runs.filter(run=>Object.values(run.counts).some(value=>typeof value==='number'&&value>0)||run.pageBlocker).slice(-3).reverse()
  const unresolved=runs.filter(run=>run.hasUnresolvedSideEffects!==false||run.pageBlocker?.requiresUser===true).slice(-3).reverse()
  const selected=[...new Map([...explicit,...recent,...unresolved].map(run=>[run.runId,run])).values()].slice(0,3)
  const historyBudget=options.historyTokenBudget??4000,currentBudget=options.currentTokenBudget??1500
  let current=compact(options.current,8),historical=selected.map(run=>compact(run,8))
  const historyEnvelope=()=>({version:1,scope:'historical_runs',runIds:historical.map(run=>run.runId),referenceSelection:explicit.length?'explicit':'recent_receipts_reference_may_be_ambiguous',runs:historical})
  for(const details of [4,2,0]){if(estimateContextText(historyEnvelope())<=historyBudget)break;historical=selected.map(run=>compact(run,details))}
  for(const details of [4,2,0]){if(estimateContextText(current)<=currentBudget)break;current=compact(options.current,details)}
  if(estimateContextText(historyEnvelope())>historyBudget||estimateContextText(current)>currentBudget){
    throw Error('history_evidence_unavailable:context_budget')
  }
  const messages:ChatMessageParam[]=[{role:'system',content:'[宿主执行事实作用域]\n'+instruction},{role:'system',content:'[当前运行事实]\n'+JSON.stringify(current)}]
  if(historical.length)messages.push({role:'system',content:'[历史运行事实]\n'+JSON.stringify(historyEnvelope())})
  return {messages,runIds:selected.map(run=>run.runId),selected}
}

/** Both chat and Agent use the same bounded task history and trusted summaries. */
export function buildEvidenceConversation(options:EvidenceHistoryOptions):ChatMessageParam[] {
  const evidence=buildEvidenceHistory(options),selectedIds=new Set(evidence.selected.map(run=>run.turnId).filter(Boolean))
  const dialogue=options.messages.filter(message=>message.role==='user'||message.role==='assistant'||message.role==='log'&&['questionnaire_answers','subchat_result','user_choice'].includes(String(message.meta?.kind)))
  const keep=new Set(dialogue.slice(-30).map(message=>message.id))
  for(const message of dialogue)if(selectedIds.has(message.id))keep.add(message.id)
  return dialogue.filter(message=>keep.has(message.id)).map(message=>({role:message.role==='assistant'?'assistant' as const:'user' as const,content:message.role==='log'?`[历史任务记录] ${message.content}`:message.content}))
}
