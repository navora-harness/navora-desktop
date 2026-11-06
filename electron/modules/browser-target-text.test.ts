import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_NATIVE_TEXT_LENGTH, planNativeText, typeNativeTargetText, validateTextTarget } from './browser-target-text'

const target = { webContentsId: 1, processId: 2, routingId: 3, documentId: 4, backendNodeId: 5 }
const editable = (value = 'original') => ({ target, tagName: 'input', type: 'text', visible: true, disabled: false, readOnly: false, focused: true, value } as Electron.AgentElement & { readOnly: boolean })

test('native text plans respect three UTF-16 slots, preserving Chinese, emoji and combining text', () => {
  for (const text of ['a', 'abc', 'abcd', '中文输入连贯测试', '😀a🚀b', 'e\u0301x', '👩‍💻']) {
    const chunks = planNativeText(text)
    assert.equal(chunks.join(''), text)
    assert.ok(chunks.every(chunk => chunk.length <= 3 && [...chunk].every(point => point.length === 2 || !/[\ud800-\udfff]/.test(point))))
  }
  assert.deepEqual(planNativeText(''), [])
  for (const invalid of [undefined, 8, '\ud800', '\udfff', 'a\0b', 'a\rb', 'a\tb', 'a'.repeat(MAX_NATIVE_TEXT_LENGTH + 1)]) {
    assert.throws(() => planNativeText(invalid))
  }
})

test('readonly, disabled, noneditable and single-line newline targets reject before an edit', () => {
  for (const patch of [{ readOnly: true }, { readOnly: undefined }, { disabled: true }, { visible: false }, { tagName: 'button' }]) {
    assert.throws(() => validateTextTarget({ ...editable(), ...patch }, 'new'))
  }
  assert.throws(() => validateTextTarget(editable(), 'two\nlines'), /single_line/)
  assert.equal(validateTextTarget({ ...editable(), tagName: 'textarea' }, 'two\nlines').tagName, 'textarea')
})

function fixture(overrides: Partial<Parameters<typeof typeNativeTargetText>[0]> = {}) {
  let value = 'original', reads = 0
  const events: Electron.KeyEvent[] = []
  const receipts: unknown[] = []
  const options: Parameters<typeof typeNativeTargetText>[0] = {
    text: '中文输入连贯测试', append: false, submit: false, platform: 'win32', timeoutMs: 10000,
    assertCurrent() {},
    async readTarget() { reads++; return editable(value) },
    async dispatch(event) {
      events.push(event)
      if (event.key === 'Backspace' && event.type === 'rawKeyDown') value = ''
      if (event.type === 'char') value += event.text
      return { status: 'dispatched', stage: 'event-dispatch', stages: [] }
    },
    onReceipt(receipt) { receipts.push(receipt) },
    ...overrides,
  }
  return { options, events, receipts, reads: () => reads, value: () => value }
}

test('invalid text and target do not clear the existing text or submit', async () => {
  const invalid = fixture({ text: '\ud800', submit: true })
  const first = await typeNativeTargetText(invalid.options)
  assert.equal(first.input.effect, 'unchanged'); assert.equal(invalid.events.length, 0); assert.equal(invalid.reads(), 0)
  const readonly = fixture({ submit: true, readTarget: async () => ({ ...editable(), readOnly: true }) })
  const second = await typeNativeTargetText(readonly.options)
  assert.equal(second.error, 'text_target_readonly'); assert.equal(readonly.events.length, 0)
  const hidden=fixture({readTarget:async()=>({...editable(),visible:false,focused:false})})
  const result=await typeNativeTargetText(hidden.options)
  assert.equal(result.input.dispatchedSteps,0);assert.deepEqual(result.input.target,target)
  assert.equal(result.input.targetObservations?.[0]?.visible,false);assert.equal(result.input.targetObservations?.[0]?.focused,false)
  assert.doesNotMatch(JSON.stringify(result.input.targetObservations),/original/)
})

test('verified replacement uses bounded char chunks and reports lengths without storing text', async () => {
  const f = fixture(), result = await typeNativeTargetText(f.options)
  assert.equal(result.ok, true); assert.equal(f.value(), f.options.text)
  assert.equal(result.input.dispatchedCodeUnits, 8); assert.equal(result.input.confirmedCodeUnits, 8)
  assert.equal(result.input.clearDispatched, true); assert.equal(result.input.effect, 'confirmed')
  assert.ok(f.events.filter(event => event.type === 'char').every(event => event.text!.length <= 3))
  assert.ok(!JSON.stringify(result).includes(String(f.options.text)))
})

test('first or middle dispatch failure stops subsequent input and Enter', async () => {
  for (const failedAt of [0, 3, 7]) {
    const events: Electron.KeyEvent[] = []
    const f = fixture({ submit: true, dispatch: async event => {
      events.push(event)
      return events.length - 1 === failedAt
        ? { status: 'failed', stage: 'event-dispatch', stages: [], reason: 'INJECTED_FAILURE' }
        : { status: 'dispatched', stage: 'event-dispatch', stages: [] }
    } })
    const result = await typeNativeTargetText(f.options)
    assert.equal(result.ok, false); assert.equal(events.length, failedAt + 1)
    assert.equal(result.input.dispatchedSteps, failedAt)
    assert.equal(result.input.submitAttempted, false)
    assert.ok(events.every(event => event.key !== 'Enter'))
  }
})

test('cancellation after submitted text retains partial receipt and never submits or replays', async () => {
  const abort = new AbortController(), f = fixture({ signal: abort.signal, submit: true })
  const dispatch = f.options.dispatch
  f.options.dispatch = async event => {
    const result = await dispatch(event)
    if (event.type === 'char') abort.abort()
    return result
  }
  const result = await typeNativeTargetText(f.options)
  assert.equal(result.input.status, 'cancelled'); assert.equal(result.input.dispatchedCodeUnits, 3)
  assert.equal(result.input.confirmedCodeUnits, null); assert.equal(result.input.submitAttempted, false)
  assert.equal(f.events.filter(event => event.type === 'char').length, 1)
})

test('verification mismatch or moved focus blocks Enter and preserves an unknown effect', async () => {
  for (const after of [editable('unrelated'), { ...editable('中文输入连贯测试'), focused: false }]) {
    let reads = 0
    const f = fixture({ submit: true, readTarget: async () => ++reads === 1 ? editable() : after })
    const result = await typeNativeTargetText(f.options)
    assert.equal(result.ok, false); assert.equal(result.input.effect, 'unknown')
    assert.equal(result.input.submitAttempted, false)
  }
})

test('append moves to document end and empty replacement verifies deletion', async () => {
  const append = fixture({ text: '尾', append: true }), appended = await typeNativeTargetText(append.options)
  assert.equal(appended.ok, true); assert.equal(append.value(), 'original尾')
  assert.ok(append.events.some(event => event.key === 'End' && event.modifiers === 2))
  assert.ok(!append.events.some(event => event.key === 'Backspace'))
  const empty = fixture({ text: '' }), cleared = await typeNativeTargetText(empty.options)
  assert.equal(cleared.ok, true); assert.equal(empty.value(), '')
})

test('macOS selection uses Meta and successful submit is separate from navigation', async () => {
  const f = fixture({ text: 'ok', submit: true, platform: 'darwin' }), result = await typeNativeTargetText(f.options)
  assert.equal(result.ok, true); assert.equal(result.submitted, true)
  assert.equal(f.events[0]!.key, 'Meta'); assert.equal(f.events[1]!.modifiers, 4)
  assert.equal(f.events.filter(event => event.key === 'Enter').length, 3)
  assert.equal(result.input.effect, 'confirmed')
})

function sequenceResult(count: number, extra: Partial<Electron.InputSequenceResult> = {}): Electron.InputSequenceResult {
  return {status:'completed',reason:'',dispatchedCount:count,mouseCount:0,keyCount:count,lastDispatchedIndex:count?count-1:null,stoppedIndex:null,queueMs:0,preparationMs:0,executionMs:0,lateness:{p50:0,p95:0,p99:0,max:0},cleanup:{dispatched:0,failed:0},...extra}
}

test('native batch verifies input before a separate submit batch and preserves native receipts', async () => {
  let value = 'old'
  const batches: Electron.KeyEvent[][] = []
  const f = fixture({text:'中文😀',submit:true,readTarget:async()=>editable(value),dispatchSequence:async events=>{
    batches.push(events)
    if(events.some(event=>event.key==='Backspace'))value=''
    for(const event of events)if(event.type==='char'&&event.key!=='Enter')value+=event.text
    return sequenceResult(events.length)
  }})
  const result = await typeNativeTargetText(f.options)
  assert.equal(result.ok,true);assert.equal(result.method,'target_dispatchInputSequence')
  assert.equal(batches.length,2);assert.ok(batches[0]!.every(event=>event.key!=='Enter'))
  assert.equal(batches[1]![1]!.text,'\r');assert.equal(result.input.dispatchedCodeUnits,4)
  assert.equal(result.sequences?.length,2)
})

test('partial native batch failure reports only acknowledged text and never submits', async () => {
  let calls=0
  const f=fixture({submit:true,dispatchSequence:async events=>{
    calls++;assert.ok(events.length>7)
    return sequenceResult(7,{status:'failed',reason:'STALE_TARGET',stoppedIndex:7})
  }})
  const result=await typeNativeTargetText(f.options)
  assert.equal(result.ok,false);assert.equal(calls,1);assert.equal(result.input.clearDispatched,true)
  assert.equal(result.input.dispatchedCodeUnits,3);assert.equal(result.input.confirmedCodeUnits,null)
  assert.equal(result.input.submitAttempted,false);assert.equal(result.input.reason,'STALE_TARGET')
})

test('unknown native cleanup or secret value prevents automatic submission', async () => {
  const failed=fixture({submit:true,dispatchSequence:async()=>sequenceResult(2,{status:'cancelled',reason:'ABORTED',cleanup:{dispatched:0,failed:1}})})
  assert.equal((await typeNativeTargetText(failed.options)).error,'cleanup_unconfirmed')
  const secret=fixture({text:'secret',submit:true,readTarget:async()=>({...editable(''),type:'password',valueRedacted:true})})
  const result=await typeNativeTargetText(secret.options)
  assert.equal(result.error,'text_input_effect_unverifiable');assert.equal(result.input.submitAttempted,false)
  assert.ok(!JSON.stringify(result).includes('secret'))
})

test('Enter target disappearance preserves verified text, partial dispatch and unknown page effect independently',async()=>{
  let value='old',calls=0,observed=0
  const f=fixture({text:'updated',submit:true,readTarget:async()=>editable(value),dispatchSequence:async events=>{
    calls++;if(calls===1){value='updated';return sequenceResult(events.length)}
    return sequenceResult(1,{status:'failed',reason:'STALE_TARGET',stoppedIndex:1})
  },observeSubmission:async()=>{observed++;return{status:'unknown',targetState:'removed'}}})
  const result=await typeNativeTargetText(f.options)
  assert.equal(calls,2);assert.equal(observed,1);assert.equal(result.ok,false);assert.equal(result.error,'STALE_TARGET')
  assert.equal(result.submitted,true);assert.equal(result.input.confirmedCodeUnits,7);assert.equal(result.input.effect,'confirmed')
  assert.deepEqual(result.input.submission,{status:'partial',dispatchedSteps:1,cleanup:'confirmed',reason:'STALE_TARGET'})
  assert.equal(result.input.pageResult?.status,'unknown')
})

test('new visible text evidence never hides a native submission failure; cleanup failure prevents recovery reads',async()=>{
  for(const cleanupFailed of [false,true]){
    let count=0,observed=0
    const f=fixture({text:'updated',submit:true,readTarget:async()=>editable(count?'updated':'old'),dispatchSequence:async events=>{
      if(!count++)return sequenceResult(events.length)
      return sequenceResult(1,{status:'failed',reason:'TARGET_NOT_VISIBLE',cleanup:{dispatched:1,failed:cleanupFailed?1:0}})
    },observeSubmission:async()=>{observed++;return{status:'observed',evidence:'new_visible_noneditable_text',targetState:'hidden',coverage:'complete'}}})
    const result=await typeNativeTargetText(f.options)
    assert.equal(result.ok,false);assert.equal(result.input.effect,'confirmed')
    assert.equal(observed,cleanupFailed?0:1);assert.equal(result.input.pageResult?.status,cleanupFailed?'unknown':'observed')
    assert.equal(result.error,cleanupFailed?'cleanup_unconfirmed':'TARGET_NOT_VISIBLE')
  }
})
