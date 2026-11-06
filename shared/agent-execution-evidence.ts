import {normalizeBrowserToolCall,isBrowserObservation} from './browser-tool-policy'

/** Persist only host receipts, identifiers and enums. Never page text or input values. */
export type EvidenceCount=number|'unknown'
export type ExecutionEvidenceState='dispatched'|'value_verified'|'page_effect_observed'|'business_verified'|'failed'|'unresolved'|'script_completed'|'observed'
export type KeyboardEffectState='not_observed'|'confirmed'|'contradicted'|'unavailable'
export type ResumeCheckpointV1={version:1;id:string;chatId:string;runId:string;turnId?:string;windowId:string;observationId?:string;createdAt:number;state:'waiting_for_user'|'cleared';stopReason:'waiting_for_user';lastSettledEvidenceId:string;unresolvedEvidenceIds:string[];pendingSteps:'unknown_requires_observation';taskSourceMessageId?:string}
export type ExecutionEvidenceFragmentV1={
  version:1;evidenceId:string;messageId:string;toolCallId:string;toolName:string;runId:string;turnId?:string;at:number
  phase:'settled';state:ExecutionEvidenceState;source:'native_receipt'|'host_readback'|'tool_result'|'legacy_receipt'
  failed:boolean;inputDispatched:boolean|'unknown';fieldValueVerified:boolean;pageEffectObserved:boolean;businessResultVerified:boolean
  unresolvedInput:boolean;errorCode?:string;windowId?:string;scriptCompleted?:boolean
  keyboardEffect?:{state:KeyboardEffectState;event:'tab'|'select_all'|'other';source:'host_readback'}
  diagnostic?:Record<string,string|number|boolean>
  pageBlocker?:Record<string,unknown>
}
export type RunEvidenceSummaryV1={
  version:1;chatId:string;runId:string;turnId?:string;scope:'current_run';startedAt:number;updatedAt:number
  state:'running'|'ended'|'interrupted'|'legacy_incomplete';source:'native_receipt'|'legacy_run_end'|'legacy_receipt'
  counts:{toolsStarted:EvidenceCount;toolsSettled:EvidenceCount;toolsFailed:EvidenceCount;inputsDispatched:EvidenceCount;fieldValuesVerified:EvidenceCount;pageEffectsObserved:EvidenceCount;businessResultsVerified:EvidenceCount;unresolvedInputs:EvidenceCount}
  evidence:ExecutionEvidenceFragmentV1[];truncated:boolean;stopReason?:string;hasUnresolvedSideEffects:boolean|'unknown';retainedPageCount?:number
  settlement?:{status:'confirmed'|'unconfirmed';rejectedCleanup?:number;nativeReleasesUnconfirmed?:number}
  resumesRunId?:string;resumesTurnId?:string;resumesCheckpointId?:string;resumeCheckpoints?:ResumeCheckpointV1[];taskSourceMessageId?:string;legacyGroupId?:string;conflict?:boolean;pageBlocker?:Record<string,unknown>
}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,512}$/u.test(v)?v:undefined
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined
const bool=(v:unknown)=>typeof v==='boolean'?v:undefined
const counter=(v:unknown):EvidenceCount=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):'unknown'
export function executionErrorCode(value:unknown):string|undefined {
  if(typeof value!=='string')return undefined
  const code=value.toLowerCase().match(/^[a-z][a-z0-9_]{2,80}(?=[:\s]|$)/u)?.[0]
  return code&&/^(?:browser_|target_|agent_|invalid_tool_|permission_|automation_|ref_|window_|page_|frame_|element_|tool_|stale_target$|aborted$|cancelled$|cleanup_unconfirmed$|release_unconfirmed$)/u.test(code)?code:'tool_failed'
}
/** Future diagnostics are ignored rather than copied. No arbitrary strings survive. */
export function sanitizeExecutionDiagnostic(value:unknown):Record<string,string|number|boolean>|undefined {
  const raw=obj(value),out:Record<string,string|number|boolean>={}
  if(['control_changed','document_changed','geometry_changed','run_cancelled','page_destroyed','renderer_gone','native_cleanup_unconfirmed','unknown'].includes(String(raw.cause)))out.cause=String(raw.cause)
  if(['before_dispatch','after_dispatch','cleanup'].includes(String(raw.stage)))out.stage=String(raw.stage)
  for(const key of ['expectedEpoch','actualEpoch','expectedDocumentEpoch','actualDocumentEpoch'])if(finite(raw[key])!==undefined)out[key]=Number(raw[key])
  for(const key of ['dispatched','requiresObservation'])if(bool(raw[key])!==undefined)out[key]=Boolean(raw[key])
  return Object.keys(out).length?out:undefined
}
/** Deliberately independent of page text/schema extensions from arbitrary scripts. */
export function sanitizeEvidenceBlocker(value:unknown):Record<string,unknown>|undefined {
  const raw=obj(value)
  if(raw.version!==1||!['unknown','not_observed','suspected','confirmed'].includes(String(raw.state)))return undefined
  const out:Record<string,unknown>={version:1,state:raw.state}
  for(const key of ['windowId','chatId','observationId'])if(id(raw[key]))out[key]=raw[key]
  for(const key of ['documentEpoch','controlEpoch','observedAt','webContentsId','omittedFrames','previouslyBlockedAt','clearedAt'])if(finite(raw[key])!==undefined)out[key]=raw[key]
  if(id(raw.layoutRevision))out.layoutRevision=raw.layoutRevision
  for(const [key,allowed] of Object.entries({kind:['human_verification','login_required','permission_prompt','site_dialog','other_overlay','unknown'],coverage:['complete_for_scope','partial','unavailable'],scope:['visible_viewport','top_document','selected_frames'],blocksInteraction:['yes','no','unknown'],followup:['none','one_read_only_probe','user_handoff']}))if(allowed.includes(String(raw[key])))out[key]=raw[key]
  for(const key of ['requiresUser','probeUsed','truncated'])if(bool(raw[key])!==undefined)out[key]=raw[key]
  if(Array.isArray(raw.reasonCodes))out.reasonCodes=raw.reasonCodes.filter(v=>typeof v==='string'&&/^[a-zA-Z_]{1,64}$/u.test(v)).slice(0,8)
  if(Array.isArray(raw.evidence))out.evidence=raw.evidence.slice(0,4).flatMap(value=>{const row=obj(value);if(!['visible_verification_text','visible_challenge_control','suspected_frame','blocking_container','foreground_hit_test'].includes(String(row.kind)))return [];return [{kind:row.kind,...Object.fromEntries(['processId','routingId','documentId'].flatMap(key=>finite(row[key])!==undefined?[[key,Number(row[key])]]:[]))}]})
  return out
}
export function createRunEvidence(identity:{chatId:string;runId:string;turnId?:string;at:number;resumesRunId?:string;resumesTurnId?:string;resumesCheckpointId?:string;taskSourceMessageId?:string}):RunEvidenceSummaryV1 {
  return {version:1,chatId:identity.chatId,runId:identity.runId,turnId:identity.turnId,scope:'current_run',startedAt:identity.at,updatedAt:identity.at,state:'running',source:'native_receipt',
    counts:{toolsStarted:0,toolsSettled:0,toolsFailed:0,inputsDispatched:0,fieldValuesVerified:0,pageEffectsObserved:0,businessResultsVerified:'unknown',unresolvedInputs:0},evidence:[],truncated:false,hasUnresolvedSideEffects:false,...(identity.resumesRunId?{resumesRunId:identity.resumesRunId,resumesTurnId:identity.resumesTurnId}:{}),...(identity.resumesCheckpointId?{resumesCheckpointId:identity.resumesCheckpointId}:{}),...(identity.taskSourceMessageId?{taskSourceMessageId:identity.taskSourceMessageId}:{})}
}
export function normalizeExecutionReceipt(input:{runId:string;turnId?:string;messageId:string;toolCallId:string;toolName:string;args:Record<string,unknown>;result:unknown;at:number;legacy?:boolean;trustedBrowserReceipt?:boolean}):ExecutionEvidenceFragmentV1 {
  const normalized=normalizeBrowserToolCall(input.toolName,input.args),name=normalized.name,args=normalized.args,result=obj(input.result),receipt=obj(result.input),pageResult=obj(receipt.pageResult),submission=obj(receipt.submission)
  const failed=result.ok===false,errorCode=failed?executionErrorCode(result.error)||'tool_failed':undefined
  const hostBrowser=input.trustedBrowserReceipt!==false
  const nativeInput=hostBrowser&&new Set(['browser_click','browser_hover','browser_mouse','browser_touch','browser_type','browser_press','browser_scroll','browser_select','browser_upload']).has(name)
  const dispatched=nativeInput&&(result.ok===true||Number(receipt.dispatchedSteps)>0||Number(result.dispatchedCount)>0||receipt.submitDispatched===true||obj(result.diagnostic).dispatched===true)
  const valueVerified=nativeInput&&receipt.effect==='confirmed'
  const pageObserved=nativeInput&&pageResult.status==='observed'&&pageResult.evidence==='new_visible_noneditable_text'&&pageResult.coverage==='complete'&&['hidden','removed'].includes(String(pageResult.targetState))&&submission.cleanup==='confirmed'
  const unresolved=nativeInput&&(receipt.effect==='unknown'||failed&&dispatched||receipt.submitDispatched===true&&!pageObserved)
  const keyboard=obj(result.keyboardEffect),event=['tab','select_all','other'].includes(String(keyboard.event))?keyboard.event as 'tab'|'select_all'|'other':undefined
  const keyboardState=['not_observed','confirmed','contradicted','unavailable'].includes(String(keyboard.state))?keyboard.state as KeyboardEffectState:undefined
  const keyboardEffect=hostBrowser&&name==='browser_press'&&event&&keyboardState&&keyboard.evidenceSource==='host_readback'?{state:keyboardState,event,source:'host_readback' as const}:undefined
  const scriptCompleted=hostBrowser&&name==='browser_evaluate'&&result.ok===true
  // Arbitrary evaluate/plugin results cannot promote themselves to business verification.
  const state:ExecutionEvidenceState=pageObserved?'page_effect_observed':valueVerified?'value_verified':unresolved?'unresolved':failed?'failed':dispatched?'dispatched':scriptCompleted?'script_completed':isBrowserObservation(name,args)?'observed':'unresolved'
  const adapter=hostBrowser&&(name.startsWith('browser_')||['file_download','file_download_compose'].includes(name))
  const diagnostic=adapter?(sanitizeExecutionDiagnostic(result.diagnostic)||(errorCode==='browser_operation_invalidated'?{cause:'unknown'}:undefined)):undefined,pageBlocker=adapter?sanitizeEvidenceBlocker(result.pageBlocker):undefined
  return {version:1,evidenceId:`${input.runId}:${input.toolCallId}:settled`,messageId:input.messageId,toolCallId:input.toolCallId,toolName:name,runId:input.runId,turnId:input.turnId,at:input.at,phase:'settled',state,source:input.legacy?'legacy_receipt':valueVerified||keyboardEffect?'host_readback':nativeInput?'native_receipt':'tool_result',failed,inputDispatched:name==='browser_flow'?'unknown':dispatched,fieldValueVerified:valueVerified,pageEffectObserved:pageObserved,businessResultVerified:false,unresolvedInput:unresolved,...(errorCode?{errorCode}:{}),...(id(args.windowId)?{windowId:String(args.windowId)}:{}),...(scriptCompleted?{scriptCompleted:true}:{}),...(keyboardEffect?{keyboardEffect}:{}),...(diagnostic?{diagnostic}:{}),...(pageBlocker?{pageBlocker}:{})}
}
export function addExecutionReceipt(summary:RunEvidenceSummaryV1,fragment:ExecutionEvidenceFragmentV1):RunEvidenceSummaryV1 {
  if(fragment.runId!==summary.runId||summary.evidence.some(item=>item.evidenceId===fragment.evidenceId))return summary
  const counts={...summary.counts}
  const increment=(key:keyof typeof counts,yes:boolean)=>{if(yes&&typeof counts[key]==='number')counts[key]=Number(counts[key])+1}
  increment('toolsSettled',true);increment('toolsFailed',fragment.failed);increment('inputsDispatched',fragment.inputDispatched===true);increment('fieldValuesVerified',fragment.fieldValueVerified);increment('pageEffectsObserved',fragment.pageEffectObserved)
  if(typeof counts.toolsStarted==='number'&&typeof counts.toolsSettled==='number')counts.toolsStarted=Math.max(counts.toolsStarted,counts.toolsSettled)
  if(fragment.inputDispatched==='unknown')counts.inputsDispatched='unknown'
  increment('unresolvedInputs',fragment.unresolvedInput)
  const evidence=[...summary.evidence,fragment]
  const checkpoints=(summary.resumeCheckpoints||[]).map(checkpoint=>({...checkpoint})),blocker=fragment.pageBlocker,windowId=id(blocker?.windowId)||fragment.windowId
  if(windowId&&blocker?.state==='confirmed'&&blocker.requiresUser===true&&!checkpoints.some(checkpoint=>checkpoint.windowId===windowId&&checkpoint.state==='waiting_for_user'))checkpoints.push({version:1,id:`checkpoint:${summary.runId}:${fragment.toolCallId}`,chatId:summary.chatId,runId:summary.runId,turnId:fragment.turnId||summary.turnId,windowId,observationId:id(blocker.observationId),createdAt:fragment.at,state:'waiting_for_user',stopReason:'waiting_for_user',lastSettledEvidenceId:fragment.evidenceId,unresolvedEvidenceIds:evidence.filter(row=>row.unresolvedInput).map(row=>row.evidenceId).slice(-8),pendingSteps:'unknown_requires_observation',taskSourceMessageId:summary.taskSourceMessageId})
  if(windowId&&blocker?.state==='not_observed')for(const checkpoint of checkpoints)if(checkpoint.windowId===windowId)checkpoint.state='cleared'
  return {...summary,counts,updatedAt:fragment.at,evidence:evidence.slice(-80),truncated:summary.truncated||evidence.length>80||checkpoints.length>8,hasUnresolvedSideEffects:Number(counts.unresolvedInputs)>0,...(fragment.pageBlocker?{pageBlocker:fragment.pageBlocker}:{}),...(checkpoints.length?{resumeCheckpoints:checkpoints.slice(-8)}:{})}
}
export function finishRunEvidence(summary:RunEvidenceSummaryV1,input:{at:number;stopReason:string;settlement?:unknown;unresolvedInputs?:unknown}):RunEvidenceSummaryV1 {
  const raw=obj(input.settlement),status=raw.status==='confirmed'||raw.status==='unconfirmed'?raw.status:undefined
  const unresolved=input.unresolvedInputs!==undefined?counter(input.unresolvedInputs):summary.counts.unresolvedInputs
  const stopReasons=['model_final','tool_blocked','tool_failure','round_budget_summary','round_budget_exhausted','host_policy_stop','recovery_exhausted','user_cancelled','provider_rate_limited','provider_auth_error','provider_timeout','provider_error','run_error','waiting_for_user','page_blocker_detected','history_evidence_unavailable','unknown']
  return {...summary,state:'ended',updatedAt:input.at,stopReason:stopReasons.includes(input.stopReason)?input.stopReason:'unknown',counts:{...summary.counts,unresolvedInputs:unresolved},hasUnresolvedSideEffects:unresolved==='unknown'?'unknown':unresolved>0,
    ...(finite(raw.retainedPages)!==undefined?{retainedPageCount:Number(raw.retainedPages)}:{}),...(status?{settlement:{status,rejectedCleanup:finite(raw.rejectedCleanup),nativeReleasesUnconfirmed:finite(raw.nativeReleasesUnconfirmed)}}:{})}
}
export function sanitizeRunEvidence(value:unknown,chatId:string):RunEvidenceSummaryV1|undefined {
  const raw=obj(value),counts=obj(raw.counts)
  if(raw.version!==1||raw.chatId!==chatId||!id(raw.runId)||raw.scope!=='current_run'||!['running','ended','interrupted','legacy_incomplete'].includes(String(raw.state))||finite(raw.startedAt)===undefined)return undefined
  const base=createRunEvidence({chatId,runId:String(raw.runId),turnId:id(raw.turnId),at:Number(raw.startedAt),resumesRunId:id(raw.resumesRunId),resumesTurnId:id(raw.resumesTurnId),resumesCheckpointId:id(raw.resumesCheckpointId),taskSourceMessageId:id(raw.taskSourceMessageId)})
  base.updatedAt=finite(raw.updatedAt)??base.startedAt;base.state=raw.state as RunEvidenceSummaryV1['state'];base.source=raw.source==='legacy_run_end'||raw.source==='legacy_receipt'?raw.source:'native_receipt'
  for(const key of Object.keys(base.counts) as (keyof typeof base.counts)[])base.counts[key]=counter(counts[key])
  base.hasUnresolvedSideEffects=bool(raw.hasUnresolvedSideEffects)??'unknown';base.truncated=raw.truncated===true;base.stopReason=id(raw.stopReason);base.legacyGroupId=id(raw.legacyGroupId);base.conflict=raw.conflict===true||undefined
  base.retainedPageCount=finite(raw.retainedPageCount)
  const settlement=obj(raw.settlement)
  if(settlement.status==='confirmed'||settlement.status==='unconfirmed')base.settlement={status:settlement.status,rejectedCleanup:finite(settlement.rejectedCleanup),nativeReleasesUnconfirmed:finite(settlement.nativeReleasesUnconfirmed)}
  const pageBlocker=sanitizeEvidenceBlocker(raw.pageBlocker);if(pageBlocker)base.pageBlocker=pageBlocker
  const checkpoints=(Array.isArray(raw.resumeCheckpoints)?raw.resumeCheckpoints:[]).slice(-8).flatMap(value=>{const row=obj(value);if(row.version!==1||row.chatId!==chatId||row.runId!==base.runId||!id(row.id)||!id(row.windowId)||!id(row.lastSettledEvidenceId)||!['waiting_for_user','cleared'].includes(String(row.state)))return [];return [{version:1 as const,id:String(row.id),chatId,runId:base.runId,turnId:id(row.turnId),windowId:String(row.windowId),observationId:id(row.observationId),createdAt:finite(row.createdAt)??base.updatedAt,state:row.state as ResumeCheckpointV1['state'],stopReason:'waiting_for_user' as const,lastSettledEvidenceId:String(row.lastSettledEvidenceId),unresolvedEvidenceIds:(Array.isArray(row.unresolvedEvidenceIds)?row.unresolvedEvidenceIds:[]).flatMap(value=>id(value)?[String(value)]:[]).slice(-8),pendingSteps:'unknown_requires_observation' as const,taskSourceMessageId:id(row.taskSourceMessageId)}]})
  if(checkpoints.length)base.resumeCheckpoints=checkpoints
  // Stored evidence is re-validated independently of any page-provided strings.
  base.evidence=(Array.isArray(raw.evidence)?raw.evidence:[]).slice(-80).flatMap(value=>{
    const row=obj(value)
    if(row.version!==1||row.runId!==base.runId||!id(row.evidenceId)||!id(row.messageId)||!id(row.toolCallId)||!id(row.toolName)||!['dispatched','value_verified','page_effect_observed','business_verified','failed','unresolved','script_completed','observed'].includes(String(row.state)))return []
    const clean:ExecutionEvidenceFragmentV1={version:1,runId:base.runId,turnId:id(row.turnId),evidenceId:String(row.evidenceId),messageId:String(row.messageId),toolCallId:String(row.toolCallId),toolName:String(row.toolName),at:finite(row.at)??base.updatedAt,phase:'settled',state:row.state as ExecutionEvidenceState,source:['native_receipt','host_readback','tool_result','legacy_receipt'].includes(String(row.source))?row.source as ExecutionEvidenceFragmentV1['source']:'tool_result',failed:row.failed===true,inputDispatched:bool(row.inputDispatched)??'unknown',fieldValueVerified:row.fieldValueVerified===true,pageEffectObserved:row.pageEffectObserved===true,businessResultVerified:row.businessResultVerified===true,unresolvedInput:row.unresolvedInput===true}
    if(row.errorCode)clean.errorCode=executionErrorCode(row.errorCode)
    if(id(row.windowId))clean.windowId=String(row.windowId)
    if(row.scriptCompleted===true)clean.scriptCompleted=true
    const diagnostic=sanitizeExecutionDiagnostic(row.diagnostic);if(diagnostic)clean.diagnostic=diagnostic
    const blocker=sanitizeEvidenceBlocker(row.pageBlocker);if(blocker)clean.pageBlocker=blocker
    const keyboard=obj(row.keyboardEffect)
    if(['not_observed','confirmed','contradicted','unavailable'].includes(String(keyboard.state))&&['tab','select_all','other'].includes(String(keyboard.event))&&keyboard.source==='host_readback')clean.keyboardEffect={state:keyboard.state as KeyboardEffectState,event:keyboard.event as 'tab'|'select_all'|'other',source:'host_readback'}
    return [clean]
  })
  return base
}
