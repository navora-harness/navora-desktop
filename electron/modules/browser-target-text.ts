/** .7's WebKeyboardEvent has four UTF-16 slots, including its trailing NUL. */
export const NATIVE_KEY_TEXT_LIMIT = 3
export const MAX_NATIVE_TEXT_LENGTH = 20000

type NativeTextElement = Electron.AgentElement & { readOnly?: boolean }
export type SubmissionObservation = {
  status: 'unknown' | 'observed'
  evidence?: 'new_visible_noneditable_text'
  targetState?: 'present' | 'hidden' | 'removed'
  coverage?: 'complete'
  target?: Electron.AgentTarget
  inputTarget?: Electron.AgentTarget
}
export type TargetTextReceipt = {
  target?: Electron.AgentTarget
  phase: 'validation' | 'clear' | 'input' | 'verification' | 'submit' | 'complete'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  requestedCodeUnits: number
  dispatchedSteps: number
  dispatchedCodeUnits: number
  confirmedCodeUnits: number | null
  clearAttempted: boolean
  clearDispatched: boolean
  submitAttempted: boolean
  submitDispatched: boolean
  effect: 'unchanged' | 'confirmed' | 'unknown'
  submission?: { status: 'not_attempted' | 'dispatched' | 'completed' | 'partial' | 'unknown'; dispatchedSteps: number; cleanup: 'confirmed' | 'unknown'; reason?: string }
  pageResult?: SubmissionObservation
  targetObservations?: {stage:'preflight'|'verification';observedAt:number;target:Electron.AgentTarget;visible:boolean;focused?:boolean;readOnly?:boolean;disabled?:boolean}[]
  reason?: string
}
export type TargetTextResult = {
  ok: boolean
  error?: string
  method: 'target_dispatchKeyEvent' | 'target_dispatchInputSequence'
  length: number
  submitted: boolean
  dispatch?: Electron.AgentDispatchResult
  steps: Electron.AgentDispatchResult[]
  sequences?: Electron.InputSequenceResult[]
  input: TargetTextReceipt
}

/** Build the entire plan before selecting or deleting any existing input. */
export function planNativeText(value: unknown): string[] {
  if (typeof value !== 'string') throw Error('text_must_be_string')
  if (value.length > MAX_NATIVE_TEXT_LENGTH) throw Error('text_too_long')
  const chunks: string[] = []
  let chunk = ''
  for (const point of value) {
    const first = point.charCodeAt(0)
    if (point.length === 1 && first >= 0xd800 && first <= 0xdfff) throw Error('text_invalid_unicode')
    // Character events must not turn supplied text into Tab/Backspace/escape commands.
    if ((first < 0x20 && point !== '\n') || first === 0x7f) throw Error('text_unsupported_control_character')
    if (chunk.length + point.length > NATIVE_KEY_TEXT_LIMIT) { chunks.push(chunk); chunk = '' }
    chunk += point
  }
  if (chunk) chunks.push(chunk)
  if (chunks.length > 9990) throw Error('text_too_many_native_steps')
  return chunks
}

export function sameAgentTarget(left: Electron.AgentTarget, right: Electron.AgentTarget): boolean {
  return ['webContentsId', 'processId', 'routingId', 'documentId', 'backendNodeId'].every(key =>
    left[key as keyof Electron.AgentTarget] === right[key as keyof Electron.AgentTarget])
}

/** Runtime .7 emits readOnly even though its public AgentElement type omits it. */
export function validateTextTarget(element: NativeTextElement | undefined, text: string): NativeTextElement {
  if (!element) throw Error('text_target_unavailable')
  if (element.disabled) throw Error('text_target_disabled')
  if (element.readOnly !== false) throw Error(element.readOnly ? 'text_target_readonly' : 'text_target_editability_unknown')
  if (!element.visible) throw Error('text_target_not_visible')
  const tag = element.tagName.toLowerCase()
  const type = element.type.toLowerCase()
  const textualInput = tag === 'input' && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(type)
  // Non-form values are emitted by .7 only for AX-editable elements.
  const contentEditable = !['input', 'textarea', 'select', 'button'].includes(tag) && typeof element.value === 'string'
  if (!textualInput && tag !== 'textarea' && !contentEditable) throw Error('text_target_not_editable')
  if (text.includes('\n') && tag !== 'textarea' && !contentEditable) throw Error('text_target_single_line')
  return element
}

export async function typeNativeTargetText(options: {
  text: unknown
  append: boolean
  submit: boolean
  platform: string
  readTarget: () => Promise<NativeTextElement | undefined>
  dispatch: (event: Electron.KeyEvent) => Promise<Electron.AgentDispatchResult>
  dispatchSequence?: (events: Electron.KeyEvent[], timeoutMs: number) => Promise<Electron.InputSequenceResult>
  assertCurrent: () => void
  signal?: AbortSignal
  timeoutMs: number
  onReceipt?: (receipt: TargetTextReceipt) => void
  /** Read-only bounded postcondition supplied by the owner; never retries input. */
  observeSubmission?: (expected: string, target: Electron.AgentTarget) => Promise<SubmissionObservation>
  prepareSubmissionObservation?: () => Promise<void>
}): Promise<TargetTextResult> {
  const receipt: TargetTextReceipt = {
    phase: 'validation', status: 'running', requestedCodeUnits: typeof options.text === 'string' ? options.text.length : 0,
    dispatchedSteps: 0, dispatchedCodeUnits: 0, confirmedCodeUnits: 0,
    clearAttempted: false, clearDispatched: false, submitAttempted: false, submitDispatched: false, effect: 'unchanged',
    submission: {status:'not_attempted',dispatchedSteps:0,cleanup:'unknown'}, pageResult:{status:'unknown'},
  }
  const steps: Electron.AgentDispatchResult[] = []
  const sequences: Electron.InputSequenceResult[] = []
  const snapshot = ():TargetTextReceipt => ({...receipt,...(receipt.submission?{submission:{...receipt.submission}}:{}),...(receipt.pageResult?{pageResult:{...receipt.pageResult}}:{}),...(receipt.targetObservations?{targetObservations:receipt.targetObservations.map(item=>({...item,target:{...item.target}}))}:{})})
  const publish = () => options.onReceipt?.(snapshot())
  const observedTarget=async(stage:'preflight'|'verification')=>{
    const element=await options.readTarget()
    if(element){receipt.target={...element.target};(receipt.targetObservations??=[]).push({stage,observedAt:Date.now(),target:{...element.target},visible:element.visible,focused:element.focused,readOnly:element.readOnly,disabled:element.disabled});publish()}
    return element
  }
  let verifiedExpected: string | undefined
  const observe = async () => {
    if(!receipt.submitDispatched||receipt.submission?.cleanup!=='confirmed'||!verifiedExpected||!receipt.target||!options.observeSubmission||options.signal?.aborted)return
    try { receipt.pageResult=await options.observeSubmission(verifiedExpected,receipt.target) }
    catch { receipt.pageResult={status:'unknown'} }
    publish()
  }
  const deadline = Date.now() + options.timeoutMs
  const check = () => {
    options.assertCurrent()
    if (options.signal?.aborted) throw Error('aborted')
    if (Date.now() >= deadline) throw Error('text_input_timeout')
  }
  const result = (ok: boolean): TargetTextResult => ({
    ok, ...(ok ? {} : { error: receipt.reason || 'target_type_failed' }), method: options.dispatchSequence ? 'target_dispatchInputSequence' : 'target_dispatchKeyEvent',
    length: receipt.requestedCodeUnits, submitted: receipt.submitDispatched,
    ...(steps.length ? { dispatch: steps.at(-1) } : {}), steps, ...(sequences.length ? { sequences } : {}), input: snapshot(),
  })
  const dispatch = async (event: Electron.KeyEvent) => {
    check()
    if (receipt.phase === 'clear') receipt.clearAttempted = true
    if (receipt.phase === 'submit') receipt.submitAttempted = true
    // Input may be in flight; acknowledgement alone never proves page effects.
    if(receipt.phase!=='submit'){receipt.effect = 'unknown'; receipt.confirmedCodeUnits = null}
    publish()
    const step = await options.dispatch(event)
    steps.push(step)
    if (step.status !== 'dispatched') throw Error(step.reason || 'target_type_failed')
    receipt.dispatchedSteps++
    if(receipt.phase==='submit'&&receipt.submission){receipt.submission.dispatchedSteps++;receipt.submission.status='dispatched';if(event.type==='rawKeyDown')receipt.submitDispatched=true;if(event.type==='keyUp')receipt.submission.cleanup='confirmed'}
    if (step.deliveryWarning) throw Error(step.deliveryWarning)
    if (event.type === 'char' && receipt.phase !== 'submit') receipt.dispatchedCodeUnits += event.text?.length || 0
    publish()
  }
  const runEvents = async (events: Electron.KeyEvent[], clearCount = 0) => {
    if (!options.dispatchSequence) {
      for (let index = 0; index < events.length; index++) {
        if (receipt.phase !== 'submit') receipt.phase = index < clearCount ? 'clear' : 'input'
        await dispatch(events[index]!)
        if (clearCount && index + 1 === clearCount) receipt.clearDispatched = true
        if (receipt.phase === 'submit' && events[index]!.type === 'rawKeyDown') receipt.submitDispatched = true
      }
      return
    }
    check()
    const submitting = receipt.phase === 'submit'
    receipt.phase = submitting ? 'submit' : clearCount ? 'clear' : 'input'
    receipt.clearAttempted ||= clearCount > 0
    receipt.submitAttempted ||= submitting
    if(!submitting){receipt.effect = 'unknown'; receipt.confirmedCodeUnits = null}
    publish()
    const sequence = await options.dispatchSequence(events, Math.max(1, deadline - Date.now()))
    sequences.push(sequence)
    const count = Math.max(0, Math.min(events.length, sequence.dispatchedCount))
    receipt.dispatchedSteps += count
    if (!submitting) receipt.dispatchedCodeUnits += events.slice(0, count).reduce((total, event) => total + (event.type === 'char' ? event.text?.length || 0 : 0), 0)
    if (clearCount && count >= clearCount) receipt.clearDispatched = true
    if (submitting && count >= 1) receipt.submitDispatched = true
    if(submitting)receipt.submission={status:sequence.status==='completed'&&count===events.length?'completed':count?'partial':'unknown',dispatchedSteps:count,cleanup:sequence.cleanup.failed===0?'confirmed':'unknown',...(sequence.reason?{reason:sequence.reason}:{})}
    if (!submitting) receipt.phase = count < clearCount ? 'clear' : 'input'
    publish()
    if (sequence.cleanup.failed) throw Error('cleanup_unconfirmed')
    if (sequence.status !== 'completed') throw Error(sequence.reason || 'target_type_failed')
    if (count !== events.length) throw Error('text_input_ack_incomplete')
  }
  try {
    publish()
    const chunks = planNativeText(options.text)
    const text = options.text as string
    check()
    const initial = validateTextTarget(await observedTarget('preflight'), text)
    receipt.target = { ...initial.target }; publish()
    check()
    const expected = initial.valueRedacted ? undefined : options.append ? `${initial.value ?? ''}${text}` : text
    const mac = options.platform === 'darwin', modifier = mac ? 'Meta' : 'Control', mask = mac ? 4 : 2
    const end = mac ? 'ArrowDown' : 'End'
    const selection: Electron.KeyEvent[] = options.append && !text ? [] : [
      { type: 'rawKeyDown', key: modifier, code: mac ? 'MetaLeft' : 'ControlLeft', windowsVirtualKeyCode: mac ? 91 : 17 },
      { type: 'rawKeyDown', key: options.append ? end : 'a', code: options.append ? end : 'KeyA', modifiers: mask, windowsVirtualKeyCode: options.append ? mac ? 40 : 35 : 65 },
      { type: 'keyUp', key: options.append ? end : 'a', code: options.append ? end : 'KeyA', modifiers: mask, windowsVirtualKeyCode: options.append ? mac ? 40 : 35 : 65 },
      { type: 'keyUp', key: modifier, code: mac ? 'MetaLeft' : 'ControlLeft', windowsVirtualKeyCode: mac ? 91 : 17 },
      ...(!options.append ? [
        { type: 'rawKeyDown' as const, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
        { type: 'keyUp' as const, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      ] : []),
    ]
    const edits = [...selection, ...chunks.map(chunk => ({ type: 'char' as const, text: chunk }))]
    if (edits.length) await runEvents(edits, options.append ? 0 : selection.length)
    receipt.phase = 'verification'; publish(); check()
    const after = validateTextTarget(await observedTarget('verification'), text)
    check()
    if (receipt.dispatchedSteps && after.focused !== true) throw Error('text_input_focus_changed')
    if (expected === undefined || after.valueRedacted || typeof after.value !== 'string') throw Error('text_input_effect_unverifiable')
    if (after.value !== expected) throw Error('text_input_effect_mismatch')
    receipt.confirmedCodeUnits = text.length; receipt.effect = 'confirmed'; verifiedExpected=expected; publish()
    if (options.submit) {
      await options.prepareSubmissionObservation?.()
      check()
      receipt.phase = 'submit'
      await runEvents([
        { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
        { type: 'char', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
        { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      ])
      // The edit was verified before Enter; submission/navigation is a separate result.
      receipt.confirmedCodeUnits = text.length; receipt.effect = 'confirmed'
      if(receipt.submission)receipt.submission.status='completed'
      await observe()
    }
    receipt.phase = 'complete'; receipt.status = 'completed'; publish()
    return result(true)
  } catch (error) {
    receipt.status = options.signal?.aborted ? 'cancelled' : 'failed'
    receipt.reason = error instanceof Error ? error.message : String(error)
    if(receipt.submitAttempted&&receipt.submission){receipt.submission.status=receipt.submitDispatched?'partial':'unknown';receipt.submission.reason=receipt.reason}
    // A removed editor after Enter does not undo the text readback and is not
    // permission to replay Enter. Cleanup/ownership remain independently guarded.
    if(!/manual|operation_invalidated|document_changed|cleanup|release|aborted|cancelled/iu.test(receipt.reason))await observe()
    publish()
    return result(false)
  }
}
