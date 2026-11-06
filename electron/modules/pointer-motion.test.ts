import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { dispatchPointerMotion, hasPointerMotion, invalidatePointerMotion, pointerMotionPosition, pointerMotionWasInterpolated } from './pointer-motion'

type Step = {
  kind: string; type: string; position?: {x:number;y:number}; offset?: {x:number;y:number}; atMs: number
  button: string; buttons: number; clickCount?: number; target?: Electron.AgentTarget
}
const point = (step:Step) => step.offset ?? step.position!

type NativeOptions = { signal?: AbortSignal; timeoutMs: number }
type Summary = Record<string, unknown> & { status: string; lastDispatchedIndex: number | null }
type Call = { steps: Step[]; options: NativeOptions }

function completed(steps: Step[]): Summary {
  return { status: 'completed', dispatchedCount: steps.length, lastDispatchedIndex: steps.length - 1, stoppedIndex: null }
}

function mock(handler?: (call: Call, index: number) => Promise<Summary>) {
  const emitter = new EventEmitter()
  const calls: Call[] = []
  let destroyed = false
  const wc = Object.assign(emitter, {
    isDestroyed: () => destroyed,
    dispatchInputSequence: async (steps: Step[], options: NativeOptions) => {
      const call = { steps, options }
      for(const step of steps){
        assert.equal('x' in step || 'y' in step,false,'native .8 steps reject top-level coordinates')
        assert.ok(step.target ? step.offset && !step.position : step.position && !step.offset)
      }
      calls.push(call)
      return handler ? handler(call, calls.length - 1) : completed(steps)
    },
  })
  return {
    wc: wc as unknown as WebContents, calls, emitter,
    destroy() { destroyed = true; emitter.emit('destroyed') },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const motion = { durationMs: 100, intervalMs: 25, jitterPx: 0, seed: 42 }
const target: Electron.AgentTarget = { webContentsId: 10, processId: 20, routingId: 30, documentId: 40, backendNodeId: 50 }

test('unknown position starts with an actual destination event, never invented origin or caller start',async()=>{
  const{wc,calls}=mock()
  const result=await dispatchPointerMotion(wc,{action:'move',from:{x:0,y:0},to:{x:400,y:250},motion})
  assert.equal(calls[0].steps.length,1)
  assert.deepEqual({x:point(calls[0].steps[0]).x,y:point(calls[0].steps[0]).y},{x:400,y:250})
  assert.equal(result.startPosition,'unknown')
  assert.equal(pointerMotionWasInterpolated(result),false)
  assert.deepEqual(pointerMotionPosition(wc).point,{x:400,y:250})
})

test('interpolation diagnostics exclude click dwell, immediate movement and zero-distance batches',async()=>{
  const{wc}=mock()
  await dispatchPointerMotion(wc,{action:'move',to:{x:10,y:20},motion})
  const immediate=await dispatchPointerMotion(wc,{action:'click',to:{x:200,y:300},immediate:true,motion:{holdMs:50}})
  assert.ok(Number(immediate.durationMs)>0,'Click dwell is real elapsed time')
  assert.equal(immediate.movementDurationMs,0)
  assert.equal(pointerMotionWasInterpolated(immediate),false,'Dwell does not turn an instant approach into interpolation')
  const stationary=await dispatchPointerMotion(wc,{action:'move',to:{x:200,y:300},motion})
  assert.equal(pointerMotionWasInterpolated(stationary),false)
})

test('viewport position is per page, partial ack advances only to its last dispatched index',async()=>{
  const{wc,calls}=mock(async(call,index)=>index===0?completed(call.steps):{status:'failed',reason:'STALE_TARGET',dispatchedCount:2,lastDispatchedIndex:1})
  await dispatchPointerMotion(wc,{action:'move',to:{x:10,y:20},motion})
  await dispatchPointerMotion(wc,{action:'move',to:{x:300,y:400},motion})
  assert.deepEqual(pointerMotionPosition(wc).point,{x:point(calls[1].steps[1]).x,y:point(calls[1].steps[1]).y})
  const other=mock();assert.equal(pointerMotionPosition(other.wc).valid,false)
})

test('move submits one native batch with fractional coordinates, exact times and native summary', async () => {
  const { wc, calls } = mock()
  assert.equal(hasPointerMotion(wc), true)
  await dispatchPointerMotion(wc, {action:'move',to:{x:1.25,y:2.5},motion})
  calls.length=0
  const result = await dispatchPointerMotion(wc, { action: 'move', from: { x: 1.25, y: 2.5 }, to: { x: 100.5, y: 200.75 }, motion })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].steps.map(({ atMs }) => atMs), [0, 25, 50, 75, 100])
  assert.deepEqual(calls[0].steps[0], { kind: 'mouse', type: 'mouseMoved', position: {x: 1.25, y: 2.5}, atMs: 0, button: 'none', buttons: 0 })
  assert.equal(point(calls[0].steps.at(-1)!).x, 100.5)
  assert.equal(result.ok, true)
  assert.equal(result.dispatchedCount, 5)
  assert.equal(result.plannedSteps, 5)
  assert.equal(result.durationMs, 100)
  assert.deepEqual(result.lastDispatchedPoint, { x: 100.5, y: 200.75, atMs: 100,coordinateSpace:'main_viewport_css' })
  assert.equal('steps' in result, false)
  assert.equal('points' in result, false)
  assert.equal(calls[0].options.timeoutMs, 30000)
})

test('clickCount expands actual closed button pairs with dwell and gaps', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc,{action:'move',to:{x:1,y:2},motion});calls.length=0
  await dispatchPointerMotion(wc, { action: 'click', to: { x: 10.5, y: 20.5 }, clickCount: 3, button: 'right', motion: { ...motion, holdMs: 30 } })
  const buttons = calls[0].steps.filter(({ type }) => type !== 'mouseMoved')
  assert.deepEqual(buttons.map(({ type, atMs, clickCount, buttons }) => ({ type, atMs, clickCount, buttons })), [
    { type: 'mousePressed', atMs: 100, clickCount: 1, buttons: 2 },
    { type: 'mouseReleased', atMs: 130, clickCount: 1, buttons: 0 },
    { type: 'mousePressed', atMs: 210, clickCount: 2, buttons: 2 },
    { type: 'mouseReleased', atMs: 240, clickCount: 2, buttons: 0 },
    { type: 'mousePressed', atMs: 320, clickCount: 3, buttons: 2 },
    { type: 'mouseReleased', atMs: 350, clickCount: 3, buttons: 0 },
  ])
  assert.ok(buttons.every(step => step.button === 'right' && point(step).x === 10.5 && point(step).y === 20.5))
  assert.equal(calls.length, 1)
})

test('drag keeps the chosen button pressed through movements and releases in the same batch', async () => {
  for (const [button, bit] of [['left', 1], ['right', 2], ['middle', 4], ['back', 8], ['forward', 16]] as const) {
    const { wc, calls } = mock()
    await dispatchPointerMotion(wc, { action: 'drag', from: { x: 2, y: 3 }, to: { x: 40, y: 50 }, button, motion })
    const steps = calls[0].steps
    assert.equal(calls.length, 1)
    assert.deepEqual(steps.map(({ type }) => type), ['mouseMoved', 'mousePressed', 'mouseMoved', 'mouseMoved', 'mouseMoved', 'mouseMoved', 'mouseReleased'])
    assert.equal(steps[0].buttons, 0)
    assert.equal(steps[1].atMs, 0)
    assert.equal(steps[1].buttons, bit)
    assert.ok(steps.slice(2, -1).every(({ buttons }) => buttons === bit))
    assert.equal(steps.at(-1)!.buttons, 0)
    assert.equal(steps.at(-1)!.atMs, 100)
  }
})

test('target-relative coordinates never borrow or masquerade as viewport coordinates', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 100, y: 200 }, motion })
  await dispatchPointerMotion(wc, { action: 'move', target, to: { x: 5, y: 7 }, motion })
  assert.ok(calls[1].steps.every((step) => point(step).x === 5 && point(step).y === 7))
  assert.ok(calls[1].steps.every((step) => assert.deepEqual(step.target, target) === undefined))
  await dispatchPointerMotion(wc, { action: 'move', target: { ...target }, to: { x: 20, y: 30 }, motion })
  assert.deepEqual({ x: point(calls[2].steps[0]).x, y: point(calls[2].steps[0]).y }, { x: 20, y: 30 })
  assert.equal(pointerMotionPosition(wc).valid,false)
  await dispatchPointerMotion(wc, { action: 'move', target: { ...target, documentId: 41 }, to: { x: 1, y: 2 }, motion })
  assert.deepEqual({ x: point(calls[3].steps[0]).x, y: point(calls[3].steps[0]).y }, { x: 1, y: 2 })
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
  assert.deepEqual({ x: point(calls[4].steps[0]).x, y: point(calls[4].steps[0]).y }, { x: 300, y: 400 })
})

test('queued calls plan from the previous confirmed viewport position and a caller from cannot override it', async () => {
  const first = deferred<Summary>()
  const { wc, calls } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const a = dispatchPointerMotion(wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  const b = dispatchPointerMotion(wc, { action: 'move', to: { x: 30, y: 40 }, motion })
  await Promise.resolve()
  assert.equal(calls.length, 1)
  first.resolve(completed(calls[0].steps))
  await Promise.all([a, b])
  assert.deepEqual({ x: point(calls[1].steps[0]).x, y: point(calls[1].steps[0]).y }, { x: 10, y: 20 })
  await dispatchPointerMotion(wc, { action: 'move', from: { x: 4, y: 6 }, to: { x: 80, y: 90 }, motion })
  assert.deepEqual({ x: point(calls[2].steps[0]).x, y: point(calls[2].steps[0]).y }, { x: 30, y: 40 })
})

test('pre-aborted and queued cancelled calls dispatch nothing and do not replay', async () => {
  const first = deferred<Summary>()
  const { wc, calls } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const already = new AbortController()
  already.abort()
  assert.equal((await dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 2 }, signal: already.signal, motion })).status, 'cancelled')
  assert.equal(calls.length, 0)
  const active = dispatchPointerMotion(wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  const controller = new AbortController()
  const cancelled = dispatchPointerMotion(wc, { action: 'click', to: { x: 30, y: 40 }, signal: controller.signal, motion })
  await Promise.resolve()
  controller.abort()
  assert.equal((await cancelled).dispatchedCount, 0)
  assert.equal(calls.length, 1)
  first.resolve(completed(calls[0].steps))
  await active
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 50, y: 60 }, motion })
  assert.equal(calls.length, 2)
  assert.equal(point(calls[1].steps[0]).x, 10)
})

test('in-flight cancellation retains the last acknowledged viewport point without replay', async () => {
  const { wc, calls } = mock(async (call, index) => {
    if (index > 0) return completed(call.steps)
    return new Promise((resolve) => call.options.signal!.addEventListener('abort', () => resolve({
      status: 'cancelled', reason: 'ABORTED', dispatchedCount: 2, lastDispatchedIndex: 1, stoppedIndex: 2,
      cleanup: { dispatched: 1, failed: 0 },
    }), { once: true }))
  })
  const controller = new AbortController()
  const active = dispatchPointerMotion(wc, { action: 'drag',from:{x:2,y:3}, to: { x: 10, y: 20 }, signal: controller.signal, motion })
  await Promise.resolve()
  controller.abort()
  const result = await active
  assert.equal(result.ok, false)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.lastDispatchedIndex, 1)
  assert.deepEqual(result.cleanup, { dispatched: 1, failed: 0 })
  assert.deepEqual(result.lastDispatchedPoint, { x: 2, y: 3, atMs: 0,coordinateSpace:'main_viewport_css' })
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 30, y: 40 }, motion })
  assert.equal(calls.length, 2)
  assert.equal(point(calls[1].steps[0]).x, 2)
})

test('native failure and unexpected rejection preserve uncertainty and never fallback', async () => {
  for (const reject of [false, true]) {
    const { wc, calls } = mock(async (call, index) => {
      if (index > 0) return completed(call.steps)
      if (reject) throw new Error('native rejected')
      return { status: 'failed', reason: 'STALE_TARGET', dispatchedCount: 3, lastDispatchedIndex: 2, stoppedIndex: 3 }
    })
    const result = await dispatchPointerMotion(wc, { action: 'click', to: { x: 100, y: 200 }, motion })
    assert.equal(result.ok, false)
    assert.equal(result.dispatchedCount, reject ? null : 3)
    assert.equal(result.reason, reject ? 'INPUT_SEQUENCE_REJECTED' : 'STALE_TARGET')
    await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
    assert.equal(calls.length, 2)
    assert.equal(point(calls[1].steps[0]).x, reject?300:100)
  }
})

test('navigation, render process exit, and external input invalidate completed positions', async () => {
  for (const event of ['did-start-navigation', 'did-navigate-in-page', 'render-process-gone', 'external']) {
    const { wc, calls, emitter } = mock()
    await dispatchPointerMotion(wc, { action: 'move', to: { x: 100, y: 200 }, motion })
    if (event === 'external') invalidatePointerMotion(wc)
    else emitter.emit(event)
    await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
    assert.equal(point(calls[1].steps[0]).x, 300)
    assert.equal(point(calls[1].steps[0]).y, 400)
  }
})

test('navigation during execution prevents a later completion from restoring stale coordinates', async () => {
  const first = deferred<Summary>()
  const { wc, calls, emitter } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const active = dispatchPointerMotion(wc, { action: 'move', to: { x: 100, y: 200 }, motion })
  await Promise.resolve()
  emitter.emit('did-start-navigation')
  first.resolve(completed(calls[0].steps))
  await active
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
  assert.equal(point(calls[1].steps[0]).x, 300)
})

test('destroyed and unsupported runtimes report unavailable without dispatch', async () => {
  const { wc, calls, destroy } = mock()
  destroy()
  assert.equal(hasPointerMotion(wc), false)
  assert.equal((await dispatchPointerMotion(wc, { action: 'move', to: { x: 1, y: 2 } })).reason, 'WEB_CONTENTS_DESTROYED')
  assert.equal(calls.length, 0)
  const unsupported = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as WebContents
  assert.equal(hasPointerMotion(unsupported), false)
  assert.equal((await dispatchPointerMotion(unsupported, { action: 'click', to: { x: 1, y: 2 } })).reason, 'INPUT_SEQUENCE_UNAVAILABLE')
})

test('queue snapshots caller data and keeps independent windows separate', async () => {
  const first = deferred<Summary>()
  const a = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const b = mock()
  const active = dispatchPointerMotion(a.wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  const to = { x: 30, y: 40 }
  const settings = { ...motion }
  const queued = dispatchPointerMotion(a.wc, { action: 'move', to, motion: settings })
  to.x = 999
  settings.durationMs = 999
  await dispatchPointerMotion(b.wc, { action: 'move', to: { x: 50, y: 60 }, motion })
  assert.equal(b.calls.length, 1)
  first.resolve(completed(a.calls[0].steps))
  await Promise.all([active, queued])
  assert.equal(point(a.calls[1].steps.at(-1)!).x, 30)
  assert.equal(a.calls[1].steps.at(-1)!.atMs, 100)
  assert.equal(point(b.calls[0].steps[0]).x, 50)
})

test('final timeline and step caps include every appended button event', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc,{action:'move',to:{x:0,y:0},motion});calls.length=0
  await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 60000, sampleRateHz: 1 } }), /60000/)
  await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 9998, intervalMs: 1 } }), /10000/)
  await assert.rejects(dispatchPointerMotion(wc, { action: 'drag', to: { x: 1, y: 1 }, motion: { durationMs: 9998, intervalMs: 1 } }), /10000/)
  assert.equal(calls.length, 0)
  await dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 9997, intervalMs: 1, holdMs: 0 } })
  assert.equal(calls[0].steps.length, 10000)
})

test('timeouts stay bounded, cover the final time and preserve the caller budget', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc,{action:'move',to:{x:0,y:0},motion});calls.length=0
  for (const timeoutMs of [0, 99, 120001, NaN, Infinity]) {
    await assert.rejects(dispatchPointerMotion(wc, { action: 'move', to: { x: 1, y: 1 }, motion, timeoutMs }), /timeoutMs/)
  }
  assert.equal(calls.length, 0)
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 1, y: 1 }, motion, timeoutMs: 100 })
  assert.equal(calls[0].options.timeoutMs, 100)
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 2, y: 2 }, motion: { durationMs: 60000, sampleRateHz: 1 } })
  assert.equal(calls[1].options.timeoutMs, 65000)
})

test('invalid dwell, count and motion settings fail before native dispatch', async () => {
  const { wc, calls } = mock()
  for (const holdMs of [-1, 1001, Infinity, NaN]) {
    await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { ...motion, holdMs } }), /holdMs/)
  }
  for (const clickCount of [0, 4, 1.5, NaN]) {
    await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, clickCount, motion }), /clickCount/)
  }
  await assert.rejects(dispatchPointerMotion(wc, { action: 'move', to: { x: NaN, y: 0 }, motion }))
  await assert.rejects(dispatchPointerMotion(wc, { action: 'move', to: { x: 1, y: 1 }, motion: { ...motion, speedMultiplier: 0 } }))
  assert.equal(calls.length, 0)
})

test('navigation invalidates queued intentions rather than only clearing their start position', async () => {
  const first = deferred<Summary>()
  const { wc, calls, emitter } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const active = dispatchPointerMotion(wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  await Promise.resolve()
  const stale = dispatchPointerMotion(wc, { action: 'click', to: { x: 30, y: 40 }, motion })
  emitter.emit('did-start-navigation')
  first.resolve(completed(calls[0].steps))
  await active
  assert.equal((await stale).reason, 'POINTER_STATE_INVALIDATED')
  assert.equal(calls.length, 1)
})

test('last ownership check runs after the local queue and before any native events', async () => {
  const first = deferred<Summary>()
  const { wc, calls } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const active = dispatchPointerMotion(wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  await Promise.resolve()
  let checks = 0
  const queued = dispatchPointerMotion(wc, { action: 'click', to: { x: 30, y: 40 }, motion,
    beforeDispatch: () => { checks++; throw new Error('browser_document_changed') } })
  assert.equal(checks, 0)
  first.resolve(completed(calls[0].steps))
  await active
  const result = await queued
  assert.equal(checks, 1)
  assert.equal(result.reason, 'browser_document_changed')
  assert.equal(result.dispatchedCount, 0)
  assert.equal(calls.length, 1)
})

test('disabling interpolation retains an immediate closed drag with fractional endpoints', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc, { action: 'drag', from: { x: 2.5, y: 3.5 }, to: { x: 40.25, y: 50.75 }, immediate: true })
  const steps = calls[0].steps
  assert.deepEqual(steps.map(step => step.type), ['mouseMoved', 'mousePressed', 'mouseMoved', 'mouseReleased'])
  assert.ok(steps.every(step => step.atMs === 0))
  assert.equal(steps[1].buttons, 1)
  assert.deepEqual({ x: point(steps.at(-1)!).x, y: point(steps.at(-1)!).y, buttons: steps.at(-1)!.buttons }, { x: 40.25, y: 50.75, buttons: 0 })
})

test('disabling interpolation also makes the confirmed-position approach to an explicit drag start immediate',async()=>{
  const{wc,calls}=mock()
  const a={x:10,y:20},b={x:2.5,y:3.5},c={x:40.25,y:50.75}
  await dispatchPointerMotion(wc,{action:'move',to:a})
  const result=await dispatchPointerMotion(wc,{action:'drag',from:b,to:c,immediate:true})
  const steps=calls[1].steps,pressed=steps.findIndex(step=>step.type==='mousePressed')
  assert.ok(steps.every(step=>step.atMs===0),'The approach and held drag both obey motion:false')
  assert.deepEqual(point(steps[0]),a)
  assert.deepEqual(point(steps[pressed-1]),b)
  assert.deepEqual(point(steps[pressed]),b)
  assert.ok(steps.slice(0,pressed).every(step=>step.type==='mouseMoved'&&step.buttons===0))
  assert.ok(steps.slice(pressed+1,-1).every(step=>step.type==='mouseMoved'&&step.buttons===1))
  assert.equal(steps.at(-1)!.type,'mouseReleased')
  assert.deepEqual(point(steps.at(-1)!),c)
  assert.equal(result.durationMs,0)
  assert.equal(pointerMotionWasInterpolated(result),false)
})

test('a confirmed approach and drag returning to its start still reports actual interpolation',async()=>{
  const{wc,calls}=mock()
  const a={x:10,y:20},b={x:110,y:90}
  await dispatchPointerMotion(wc,{action:'move',to:a})
  const result=await dispatchPointerMotion(wc,{action:'drag',from:b,to:a,motion})
  assert.deepEqual(point(calls[1].steps[0]),a)
  assert.deepEqual(point(calls[1].steps.at(-1)!),a)
  assert.ok(Number(result.movementDistancePx)>=2*Math.hypot(b.x-a.x,b.y-a.y))
  assert.ok(Number(result.movementDurationMs)>0)
  assert.equal(pointerMotionWasInterpolated(result),true)
})

test('unacknowledged planned movement cannot be reported as applied interpolation',async()=>{
  const{wc}=mock(async(call,index)=>index===0?completed(call.steps):{status:'completed',dispatchedCount:1,lastDispatchedIndex:0})
  await dispatchPointerMotion(wc,{action:'move',to:{x:10,y:20}})
  const result=await dispatchPointerMotion(wc,{action:'move',to:{x:100,y:200},motion})
  assert.ok(Number(result.plannedSteps)>2)
  assert.equal(result.movementSteps,1)
  assert.equal(result.movementDistancePx,0)
  assert.equal(pointerMotionWasInterpolated(result),false)
})
