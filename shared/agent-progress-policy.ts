import {isIncompleteAgentReply} from './incomplete-reply'
import {isBrowserPageInput,requiresBrowserObservation,normalizeBrowserToolCall} from './browser-tool-policy'
import type {ComposerDocument,ComposerNode} from './composer-document'
import {normalizeExecutionReceipt,type ExecutionEvidenceFragmentV1,type KeyboardEffectState} from './agent-execution-evidence'

export type AgentTaskIntent = 'action' | 'lookup' | 'plan' | 'unknown'
export const AGENT_PROGRESS_POLICY_VERSION = 3

/** Host accounting; tool calls and model rounds are deliberately separate. */
export type AgentRoundBudget = {
  version: 1
  unit: 'model_rounds'
  initialLimit: number
  limit: number
  used: number
  toolRounds: number
  toolCalls: number
  providerAttempts: number
  auxiliaryRequests: number
  summaryRound: boolean
  summaryRoundReached: boolean
  limitReached: boolean
  continuationRequests: number
  extensions: number
}
type BudgetEvidence = Pick<AgentRoundBudget, 'summaryRound' | 'limitReached'>

/** Context blocks can contain page/file instructions and are not user intent. */
export function agentInstructionText(fallback:string,document?:ComposerDocument):string {
  if(!document)return fallback
  if(!Array.isArray(document.content))return ''
  const text=(nodes:ComposerNode[],depth=0):string=>depth>32?'':nodes.filter(node=>node&&typeof node==='object').map(node=>node.type==='contextBlock'||node.type==='contextInline'?'':node.type==='text'?typeof node.text==='string'?node.text:'':node.type==='hardBreak'?'\n':text(Array.isArray(node.content)?node.content:[],depth+1)+'\n').join('')
  return text(document.content).trim()
}

/** Only trusted user instructions enter this classifier. Page/tool text never does. */
export function agentTaskIntent(userText: string): AgentTaskIntent {
  const text = userText.trim()
  if (/只(?:需|要)?(?:做)?(?:规划|计划|方案|解释)|先(?:写|做|完善)?(?:规划|计划)|不要(?:执行|操作)|仅(?:规划|计划)/u.test(text)) return 'plan'
  if (/自动化|键鼠|连贯.{0,8}(?:测试|操作)|(?:点击|键入|输入|填写|提交|上传|下载|安装|卸载|删除|重命名|保存|创建|运行|执行|打开|关闭|修改|更改|调整|设置为|测试操作)/u.test(text) || /\b(?:click|type into|fill|submit|upload|download|install|delete|rename|create|execute|automate)\b/iu.test(text)) return 'action'
  if (!/全部|所有|分别|对比|比较|研究|详细|多(?:个|项)|整理|汇总|等待|直到|轮询|持续|监测/u.test(text) && /查(?:询|一下|找|看)|搜索|天气|版本|新闻|价格|多少|是什么|\b(?:lookup|weather|latest version)\b/iu.test(text)) return 'lookup'
  return 'unknown'
}

type PolicyReason = 'lookup_evidence_review' | 'repeated_tool_failure' | 'repeated_observation' | 'input_outcome_unresolved' | 'incomplete_reply' | 'unsupported_limit_claim'
export type AgentPolicyDecision = {reason: PolicyReason; stop: boolean; message: string}
type ToolRecord = Record<string, unknown>
const object = (value: unknown): ToolRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as ToolRecord : {}
const targetKeys=['webContentsId','processId','routingId','documentId','backendNodeId'] as const
function nativeTarget(value:unknown):ToolRecord|null {
  const target=object(value)
  return targetKeys.every(key=>Number.isSafeInteger(target[key]))?target:null
}
function sameTarget(left:ToolRecord,right:ToolRecord) {return targetKeys.every(key=>left[key]===right[key])}
function pageScope(args:ToolRecord,name:string) {return typeof args.windowId==='string'?`window:${args.windowId}`:nativeTarget(args.target)?`contents:${object(args.target).webContentsId}`:`tool:${name}`}

/** Fingerprints remain in memory; diagnostics contain no arguments, page text or input. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value, (key, item) => /^(?:ref|capturedAt|captureMs|durationMs|timestamp|reused)$/u.test(key) ? undefined : item) || ''
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `${text.length}:${hash >>> 0}`
}

function observation(name: string, args: ToolRecord): boolean {
  return name === 'browser_find' || name === 'browser_get' && ['snapshot','agent_snapshot','agent_find','text','dom_summary'].includes(String(args.what || 'text'))
}
const REPLACES_PAGE = new Set(['browser_navigate','browser_reload','browser_back','browser_forward','browser_load_url_with_response','browser_window_close'])

function errorCode(result: ToolRecord): string | undefined {
  if (result.ok !== false) return undefined
  // Error strings can embed site content. Persist only a recognized code.
  const code = String(result.error || '').toLowerCase().match(/^[a-z][a-z0-9_]{2,80}(?=[:\s]|$)/u)?.[0]
  return code || 'tool_failed'
}

export class AgentProgressPolicy {
  intent: AgentTaskIntent
  toolCalls = 0
  recoveries = 0
  stopReason?: 'repeated_tool_failure' | 'repeated_observation' | 'input_outcome_unresolved'
  private lastFailureKey = ''
  private repeatedFailures = 0
  private observations = new Set<string>()
  private repeatedObservations = 0
  private lookupReminderSent = false
  private blockedReason?: string
  private blockedScope?: string
  private inputNeedsObservation = false
  private uncertainScope?:string
  private uncertainTarget?:ToolRecord
  private failedWrite?:{name:string;scope:string}
  private lastError?: string
  private lastWriteFailed = false
  private recoveryObservations = 0
  private uncertainInputs=new Map<string,{target?:ToolRecord;observations:number;failures:number;blocked:number}>()
  private evidence = {textVerified:0,submissionsDispatched:0,pageEffectsObserved:0,failedTools:0,observations:0}
  private keyboardDispatches = {tab:0,selectAll:0,other:0}
  private inputDispatches = 0
  private unknownInputDispatches=false
  private scriptCompletions=0
  private keyboardEffects:{event:'tab'|'select_all'|'other';state:KeyboardEffectState}[]=[]
  private steps:{tool:string;state:'dispatched'|'verified'|'failed'|'unknown'|'script_completed';error?:string}[]=[]

  constructor(userText: string) { this.intent = agentTaskIntent(userText) }

  steer(userText: string) {
    this.intent = agentTaskIntent(userText)
    // User steering changes the objective, not permissions or page ownership.
    this.observations.clear(); this.repeatedObservations = 0
    this.lastFailureKey = ''; this.repeatedFailures = 0; this.stopReason = undefined
    this.lookupReminderSent = false
  }

  /** Existing epoch/permission guards still run inside executeAgentTool. This
   * additional host gate prevents replay while a partial edit is unresolved. */
  guardTool(name:string,args:ToolRecord):ToolRecord|null {
    const call=normalizeBrowserToolCall(name,args)
    this.activateUncertainty(call.args,call.name)
    if(this.inputNeedsObservation&&(requiresBrowserObservation(call.name)||REPLACES_PAGE.has(call.name))&&this.matchesUncertainPage(call.args,call.name))return{
      ok:false,error:'browser_observation_required',requiresObservation:true,retryable:false,
      hint:'A previous input may have partial effects. Read the same native target/value; if it disappeared after Enter, use a full unfiltered agent_snapshot with frame coverage and explicit result evidence. Empty filtered matches are insufficient. At most three recovery reads; never replay the old input or Enter.',
    }
    return null
  }

  private matchesUncertainPage(args:ToolRecord,name:string) {
    if(this.uncertainInputs.size)return [...this.uncertainInputs].some(([scope,input])=>pageScope(args,name)===scope||!!(input.target&&nativeTarget(args.target)&&object(args.target).webContentsId===input.target.webContentsId))
    if(!this.uncertainScope)return true
    return pageScope(args,name)===this.uncertainScope||!!(this.uncertainTarget&&nativeTarget(args.target)&&object(args.target).webContentsId===this.uncertainTarget.webContentsId)
  }

  private activateUncertainty(args:ToolRecord,name:string) {
    const match=[...this.uncertainInputs].find(([scope,input])=>pageScope(args,name)===scope||!!(input.target&&nativeTarget(args.target)&&object(args.target).webContentsId===input.target.webContentsId))
    if(match){this.uncertainScope=match[0];this.uncertainTarget=match[1].target;this.recoveryObservations=match[1].observations}
    return match?.[1]
  }
  private clearUncertainty(scope=this.uncertainScope) {
    if(scope)this.uncertainInputs.delete(scope)
    const next=this.uncertainInputs.entries().next().value
    this.inputNeedsObservation=this.uncertainInputs.size>0
    this.uncertainScope=next?.[0];this.uncertainTarget=next?.[1].target;this.recoveryObservations=next?.[1].observations??0
  }

  private verifiedObservation(name:string,args:ToolRecord,record:ToolRecord) {
    if(name!=='browser_get'||!['agent_find','agent_snapshot'].includes(String(args.what))||!this.uncertainTarget||!this.matchesUncertainPage(args,name))return false
    const value=object(record.value)
    if(record.partial===true||record.waitTimedOut||record.modelTruncated||value.modelTruncation||!Array.isArray(value.elements)||!Array.isArray(value.frames))return false
    const element=value.elements.map(object).find(item=>nativeTarget(item.target)&&sameTarget(object(item.target),this.uncertainTarget!))
    if(!element||element.modelFieldsTruncated||element.valueRedacted||typeof element.value!=='string'||typeof element.readOnly!=='boolean'||typeof element.focused!=='boolean'||typeof element.visible!=='boolean')return false
    const frame=value.frames.map(object).find(item=>['processId','routingId','documentId'].every(key=>item[key]===this.uncertainTarget![key]))
    // A MAX_NODES cap on unrelated nodes does not invalidate a fully captured
    // target in a covered frame. Failed/skipped or otherwise partial frames do.
    return !!frame&&(frame.status==='covered'||frame.status==='partial'&&frame.reason==='MAX_NODES')
  }

  recordTool(name: string, args: ToolRecord, result: unknown, normalizedEvidence?:ExecutionEvidenceFragmentV1) {
    this.toolCalls++
    const normalized=normalizeBrowserToolCall(name,args)
    name=normalized.name;args=normalized.args
    this.activateUncertainty(args,name)
    const record = object(result), code = errorCode(record)
    const receipt=normalizedEvidence||normalizeExecutionReceipt({runId:'policy',messageId:'policy',toolCallId:`tool-${this.toolCalls}`,toolName:name,args,result,at:0})
    const scope=pageScope(args,name),input=object(record.input)
    if(record.ok===true&&name==='browser_press'){
      const key=String(args.key||'').toLowerCase().replace(/\s/g,'')
      this.keyboardDispatches[/^(?:shift\+)?tab$/u.test(key)?'tab':/^(?:ctrl|control|meta|command)\+a$/u.test(key)?'selectAll':'other']++
    }
    if(receipt.inputDispatched===true)this.inputDispatches++
    if(receipt.inputDispatched==='unknown')this.unknownInputDispatches=true
    if(receipt.scriptCompleted)this.scriptCompletions++
    if(name==='browser_press'){
      const key=String(args.key||'').toLowerCase().replace(/\s/g,'')
      this.keyboardEffects.push(receipt.keyboardEffect||{event:/^(?:shift\+)?tab$/u.test(key)?'tab':/^(?:ctrl|control|meta|command)\+a$/u.test(key)?'select_all':'other',state:'not_observed'})
    }
    const submission=object(input.submission),pageResult=object(input.pageResult)
    const reconciled=pageResult.status==='observed'&&pageResult.evidence==='new_visible_noneditable_text'&&pageResult.coverage==='complete'&&['hidden','removed'].includes(String(pageResult.targetState))&&submission.cleanup==='confirmed'
    if(receipt.fieldValueVerified)this.evidence.textVerified++
    if(input.submitDispatched===true)this.evidence.submissionsDispatched++
    if(reconciled)this.evidence.pageEffectsObserved++
    if(observation(name,args))this.evidence.observations++
    const readValue=object(record.value),readIncomplete=observation(name,args)&&(record.partial===true||record.waitTimedOut||record.modelTruncated||readValue.complete===false||readValue.truncated===true||readValue.modelTruncation)
    const state = receipt.scriptCompleted?'script_completed':reconciled||receipt.fieldValueVerified&&!input.submitAttempted?'verified':code?(Number(input.dispatchedSteps)>0||input.submitDispatched?'unknown':'failed'):isBrowserPageInput(name)?'dispatched':readIncomplete?'unknown':'verified'
    this.steps.push({tool:name,state,...(code?{error:code}:{})});if(this.steps.length>80)this.steps.shift()
    if (code) {
      this.evidence.failedTools++
      this.lastError = code
      // Ref generations and a different blocked click must not reset the same
      // unresolved page-input failure and consume the entire model budget.
      const startsUncertainty=isBrowserPageInput(name)&&!observation(name,args)&&(input.effect==='unknown'||Number(input.dispatchedSteps)>0&&input.effect!=='confirmed'||Number(record.dispatchedCount)>0||input.submitDispatched===true&&!reconciled)
      const key = this.inputNeedsObservation&&this.matchesUncertainPage(args,name)?fingerprint(['unresolved_input',this.uncertainScope,this.uncertainTarget?.documentId]):startsUncertainty?fingerprint(['unresolved_input',scope,nativeTarget(input.target)?.documentId]):fingerprint([name,args,code])
      this.repeatedFailures = key === this.lastFailureKey ? this.repeatedFailures + 1 : 1
      this.lastFailureKey = key
      if (/denied|permission|manual_control|operation_invalidated|page_blocked|page_unverified|cleanup.*unconfirmed|release.*unconfirmed|aborted|cancelled/u.test(code)) {this.blockedReason = code;this.blockedScope=scope}
      if (isBrowserPageInput(name)&&!observation(name,args)) {
        this.lastWriteFailed = true
        this.failedWrite={name,scope}
        if (!reconciled&&(input.submitDispatched===true||input.effect==='unknown'||Number(input.dispatchedSteps||0)>0&&input.effect!=='confirmed'||Number(record.dispatchedCount || 0) > 0 || record.status === 'partial' || record.partial === true || record.partialResult)) {
          if(!this.inputNeedsObservation)this.recoveryObservations=0
          this.inputNeedsObservation = true;this.uncertainScope=scope
          const steps=Array.isArray(record.steps)?record.steps.map(object):[]
          this.uncertainTarget=nativeTarget(input.target)||nativeTarget(object(record.dispatch).target)||[...steps].reverse().map(step=>nativeTarget(step.target)).find(Boolean)||nativeTarget(args.target)||undefined
          const previous=this.uncertainInputs.get(scope)
          this.uncertainInputs.set(scope,{target:this.uncertainTarget,observations:previous?.observations??0,failures:previous?.failures??0,blocked:previous?.blocked??0})
        }
        if(reconciled){this.lastWriteFailed=false;this.failedWrite=undefined;this.clearUncertainty(scope)}
      }
      const unresolved=this.activateUncertainty(args,name)
      if(unresolved&&isBrowserPageInput(name))this.repeatedFailures=code==='browser_observation_required'?++unresolved.blocked:++unresolved.failures
      if (this.repeatedFailures >= 3) this.stopReason = 'repeated_tool_failure'
      return
    }
    if (observation(name, args)) {
      const key = fingerprint([name, args, record])
      if (this.observations.has(key)) this.repeatedObservations++
      else { this.observations.add(key); this.repeatedObservations = 0 }
      if(this.inputNeedsObservation&&this.matchesUncertainPage(args,name)){
        this.recoveryObservations++
        const pending=this.activateUncertainty(args,name)
        if(pending)this.recoveryObservations=++pending.observations
        const resolved=object(record.submissionObservation),resolvedInput=nativeTarget(resolved.inputTarget)
        const deferredEffect=record.native===true&&name==='browser_get'&&args.what==='agent_snapshot'&&!args.selector&&resolved.status==='observed'&&resolved.evidence==='new_visible_noneditable_text'&&resolved.coverage==='complete'&&['hidden','removed'].includes(String(resolved.targetState))&&!!resolvedInput&&!!this.uncertainTarget&&sameTarget(resolvedInput,this.uncertainTarget)
        if(deferredEffect){this.evidence.pageEffectsObserved++;this.lastWriteFailed=false;this.failedWrite=undefined}
        if(deferredEffect||this.verifiedObservation(name,args,record))this.clearUncertainty()
        else if(this.recoveryObservations>=3)this.stopReason='input_outcome_unresolved'
      }
      if (this.intent==='lookup'&&this.repeatedObservations >= 3) this.stopReason = 'repeated_observation'
    } else if (isBrowserPageInput(name)) {
      if(requiresBrowserObservation(name)&&!this.inputNeedsObservation&&this.failedWrite?.scope===scope){this.lastWriteFailed=false;this.lastError=undefined;this.failedWrite=undefined}
      if(requiresBrowserObservation(name)&&this.blockedScope===scope){this.blockedReason=undefined;this.blockedScope=undefined}
      this.observations.clear(); this.repeatedObservations = 0
    }
    // Reads do not erase repeated failed writes between attempts.
    if (!observation(name, args)) { this.lastFailureKey = ''; this.repeatedFailures = 0 }
  }

  afterTools(): AgentPolicyDecision | null {
    if (this.stopReason) return {reason:this.stopReason,stop:true,message:'宿主已停止重复失败或重复无进展的工具调用。请依据已有证据说明未完成部分与具体阻断；不要继续调用工具，不要宣称用户目标已完成。'}
    if (this.intent === 'lookup' && this.toolCalls >= 4 && this.observations.size && !this.lookupReminderSent) {
      this.lookupReminderSent = true
      return {reason:'lookup_evidence_review',stop:false,message:'查询进度检查：已有页面证据。足以回答用户时直接给出结论；不足时只补充关键缺口，避免重复读取相同内容。这是效率建议，不是工具次数限额。'}
    }
    return null
  }

  unsupportedLimitClaim(text:string,budget?:BudgetEvidence):boolean {
    if(this.intent!=='action'||/未(?:触发|达到|超出)|没有.{0,12}(?:限额|上限)|不是.{0,12}(?:限额|上限)/u.test(text))return false
    const calls=/(?:已(?:经)?|受到|触发|受限于|达到|用尽|耗尽).{0,16}(?:工具|效率|tool).{0,24}(?:限额|上限|限制|保护)|(?:工具|效率|tool).{0,24}(?:达到|超过|耗尽|用尽|限额已|次数.*(?:用尽|耗尽))/iu.test(text)
    const rounds=/(?:预算|推理轮数|推理轮次|轮数预算|推理上限)[^。！？\n]{0,20}(?:用尽|耗尽|结束|已达|达到|上限)|(?:达到|已达|执行到|用尽|耗尽|受限于)[^。！？\n]{0,20}(?:预算|推理上限|轮数上限)|budget.{0,24}(?:exhausted|reached|used up)/iu.test(text)
    // An actual reserved summary round can report its round budget. It still
    // cannot invent a separate hard limit on the number of tool calls.
    return calls||rounds&&!budget?.limitReached&&!budget?.summaryRound
  }

  incompleteReply(text:string,finishReason?:string|null) {return isIncompleteAgentReply(text,{finishReason})}

  recoverReply(text: string, finishReason?: string | null, budget?:BudgetEvidence): AgentPolicyDecision | null {
    if (this.stopReason || this.blockedReason || this.recoveries >= 3 || this.intent === 'plan' || budget?.limitReached || budget?.summaryRound) return null
    const unsupportedLimit = this.unsupportedLimitClaim(text,budget)
    if (!unsupportedLimit && !isIncompleteAgentReply(text, {finishReason})) return null
    this.recoveries++
    const reason = unsupportedLimit ? 'unsupported_limit_claim' : 'incomplete_reply'
    return {reason,stop:false,message:(unsupportedLimit ? '宿主尚未触发轮数预算或工具次数硬限制，不要把效率建议当作限额。' : '上一轮未给出完整结果。') +
      (this.intent === 'action' ? '请围绕用户已授权的操作目标继续必要步骤；操作是否成功必须核对页面结果。' : '证据足够时作答，否则补充必要观察。') +
      (this.inputNeedsObservation ? '最近一次输入可能已有部分副作用，本轮只能先重新观察当前页面、焦点及控件值，确认结果后才决定新操作。' : '') +
      '不得重放旧输入、重复提交、绕过权限或恢复人工接管的页面。遇到真实权限、接管或结果无法核实的阻断时说明限制并保留现场。'}
  }

  snapshot() {
    return {version:AGENT_PROGRESS_POLICY_VERSION,intent:this.intent,toolCalls:this.toolCalls,recoveries:this.recoveries,
      ...(this.stopReason?{policyReason:this.stopReason}:{}),...(this.blockedReason?{blockedReason:this.blockedReason}:{}),
      ...(this.lastError?{lastToolError:this.lastError}:{}),inputNeedsObservation:this.inputNeedsObservation,lastWriteFailed:this.lastWriteFailed||this.uncertainInputs.size>0,unresolvedInputs:this.uncertainInputs.size,
      recoveryObservations:this.recoveryObservations,evidence:{...this.evidence},steps:this.steps.map(step=>({...step}))}
  }

  /** Counts contain no field values, selectors or page text, and imply no server-side success. */
  completionEvidence() {
    return {version:1,actionsReportedDispatched:this.unknownInputDispatches?'unknown' as const:this.inputDispatches,fieldValuesConfirmed:this.evidence.textVerified,
      submitEventsDispatched:this.evidence.submissionsDispatched,pageEffectsObserved:this.evidence.pageEffectsObserved,
      inputsDispatched:this.unknownInputDispatches?'unknown' as const:this.inputDispatches,scriptCompletions:this.scriptCompletions,businessResultsVerified:'unknown' as const,
      businessCompletion:'not_inferred_from_input' as const,keyboard:{dispatched:{...this.keyboardDispatches},effectsIndependentlyConfirmed:this.keyboardEffects.length>0&&this.keyboardEffects.every(event=>event.state==='confirmed'),effects:this.keyboardEffects.map(event=>({...event}))},
      failedTools:this.evidence.failedTools,unresolvedInputs:this.uncertainInputs.size,blocked:!!this.blockedReason,
      observations:this.evidence.observations}
  }

  /** A target-addressed type call can confirm a value without proving a prior
   * Tab focus change or Ctrl+A selection. Qualify those precise overclaims;
   * runtime retains the provider's original reply alongside this assessment. */
  qualifyFinalReply(text:string) {
    const qualifications=new Set<'tab_focus'|'select_all'>()
    const qualified=text.split('\n').map(line=>{
      const keys=[...(this.keyboardDispatches.tab&&/\bTab\b/iu.test(line)?['tab_focus' as const]:[]),
        ...(this.keyboardDispatches.selectAll&&/(?:Ctrl|Control|Command|Meta)\s*\+\s*A/iu.test(line)?['select_all' as const]:[])]
        .filter(key=>!this.keyboardEffects.filter(effect=>effect.event===(key==='tab_focus'?'tab':'select_all')).every(effect=>effect.state==='confirmed'))
      if(!keys.length||/未(?:经|被)?(?:独立)?(?:核实|确认|验证|完成|生效|执行)|失败|无法确认|不能证明|不代表|仅.{0,10}派发|只.{0,10}派发/u.test(line))return line
      if(!/^\s*\|/u.test(line)&&!/(?:成功|生效|完成|核实|核验|验证|通过|全选|切换焦点|已切换)/u.test(line))return line
      for(const key of keys)qualifications.add(key)
      const name=keys.map(key=>key==='tab_focus'?'Tab':'Ctrl+A').join(' / ')
      const boundary=keys.map(key=>key==='tab_focus'?'焦点切换未独立核实':'选区变化未独立核实').join('；')
      return /^\s*\|/u.test(line)?`| ${name} | 按键已派发 | ${boundary}；后续目标输入仅证明字段值 |`:`${name}：按键已派发；${boundary}。后续指定目标的输入不能证明此前按键效果。`
    }).join('\n')
    return {text:qualified,qualifications:[...qualifications]}
  }

  /** Factual fallback, deliberately contains no inferred task completion or input text. */
  factualSummary(reason:'round_budget_exhausted'|'policy_stop',pagesRetained:number):string {
    const facts:string[]=[]
    if(this.evidence.textVerified)facts.push(`${this.evidence.textVerified} 次文字输入通过控件值回读`)
    if(this.evidence.submissionsDispatched)facts.push(`${this.evidence.submissionsDispatched} 次 Enter 按下已派发`)
    if(this.evidence.pageEffectsObserved)facts.push(`${this.evidence.pageEffectsObserved} 次提交后观察到新显示的匹配文字`)
    return `${reason==='round_budget_exhausted'?'已达到本轮推理预算':'已停止未取得进展的恢复操作'}，任务未确认全部完成。\n\n${facts.length?'已核实：'+facts.join('；')+'。':'尚无足够证据确认操作目标已完成。'}${this.evidence.submissionsDispatched?' Enter 派发和页面文字变化不能证明服务端保存成功。':''}\n\n${this.inputNeedsObservation?'未核实：最近一次输入或提交的页面结果仍不确定，已停止重复输入。':this.evidence.failedTools?`仍有 ${this.evidence.failedTools} 次工具失败，未将失败步骤视为完成。`:'其余目标请依据已有页面证据继续核对。'}${this.blockedReason?' 当前还存在权限、控制权或输入清理阻断。':''}${pagesRetained>0?` 已保留 ${pagesRetained} 个浏览器页面。`:''}继续前需先确认当前页面结果与控制状态；不要直接重放旧输入或提交。`
  }
}
