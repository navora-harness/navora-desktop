import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { dispatchPointerMotion, hasPointerMotion, invalidatePointerMotion } from './pointer-motion'

type Step = {
  kind: string; type: string; x: number; y: number; atMs: number
  button: string; buttons: number; clickCount?: number; target?: Electron.AgentTarget
}
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

test('move submits one native batch with fractional coordinates, exact times and native summary', async () => {
  const { wc, calls } = mock()
  assert.equal(hasPointerMotion(wc), true)
  const result = await dispatchPointerMotion(wc, { action: 'move', from: { x: 1.25, y: 2.5 }, to: { x: 100.5, y: 200.75 }, motion })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].steps.map(({ atMs }) => atMs), [0, 25, 50, 75, 100])
  assert.deepEqual(calls[0].steps[0], { kind: 'mouse', type: 'mouseMoved', x: 1.25, y: 2.5, atMs: 0, button: 'none', buttons: 0 })
  assert.equal(calls[0].steps.at(-1)!.x, 100.5)
  assert.equal(result.ok, true)
  assert.equal(result.dispatchedCount, 5)
  assert.equal(result.plannedSteps, 5)
  assert.equal(result.durationMs, 100)
  assert.deepEqual(result.lastDispatchedPoint, { x: 100.5, y: 200.75, atMs: 100 })
  assert.equal('steps' in result, false)
  assert.equal('points' in result, false)
  assert.equal(calls[0].options.timeoutMs, 30000)
})

test('clickCount expands actual closed button pairs with dwell and gaps', async () => {
  const { wc, calls } = mock()
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
  assert.ok(buttons.every(({ button, x, y }) => button === 'right' && x === 10.5 && y === 20.5))
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

test('target-relative coordinates stay in one target scope and never borrow viewport coordinates', async () => {
  const { wc, calls } = mock()
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 100, y: 200 }, motion })
  await dispatchPointerMotion(wc, { action: 'move', target, to: { x: 5, y: 7 }, motion })
  assert.ok(calls[1].steps.every((step) => step.x === 5 && step.y === 7))
  assert.ok(calls[1].steps.every((step) => assert.deepEqual(step.target, target) === undefined))
  await dispatchPointerMotion(wc, { action: 'move', target: { ...target }, to: { x: 20, y: 30 }, motion })
  assert.deepEqual({ x: calls[2].steps[0].x, y: calls[2].steps[0].y }, { x: 5, y: 7 })
  await dispatchPointerMotion(wc, { action: 'move', target: { ...target, documentId: 41 }, to: { x: 1, y: 2 }, motion })
  assert.deepEqual({ x: calls[3].steps[0].x, y: calls[3].steps[0].y }, { x: 1, y: 2 })
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
  assert.deepEqual({ x: calls[4].steps[0].x, y: calls[4].steps[0].y }, { x: 0, y: 0 })
})

test('queued calls plan from the previous completed position and explicit from takes precedence', async () => {
  const first = deferred<Summary>()
  const { wc, calls } = mock(async (call, index) => index === 0 ? first.promise : completed(call.steps))
  const a = dispatchPointerMotion(wc, { action: 'move', to: { x: 10, y: 20 }, motion })
  const b = dispatchPointerMotion(wc, { action: 'move', to: { x: 30, y: 40 }, motion })
  await Promise.resolve()
  assert.equal(calls.length, 1)
  first.resolve(completed(calls[0].steps))
  await Promise.all([a, b])
  assert.deepEqual({ x: calls[1].steps[0].x, y: calls[1].steps[0].y }, { x: 10, y: 20 })
  await dispatchPointerMotion(wc, { action: 'move', from: { x: 4, y: 6 }, to: { x: 80, y: 90 }, motion })
  assert.deepEqual({ x: calls[2].steps[0].x, y: calls[2].steps[0].y }, { x: 4, y: 6 })
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
  assert.equal(calls[1].steps[0].x, 0)
})

test('in-flight cancellation keeps native partial summary and invalidates position without retry', async () => {
  const { wc, calls } = mock(async (call, index) => {
    if (index > 0) return completed(call.steps)
    return new Promise((resolve) => call.options.signal!.addEventListener('abort', () => resolve({
      status: 'cancelled', reason: 'ABORTED', dispatchedCount: 2, lastDispatchedIndex: 1, stoppedIndex: 2,
      cleanup: { dispatched: 1, failed: 0 },
    }), { once: true }))
  })
  const controller = new AbortController()
  const active = dispatchPointerMotion(wc, { action: 'drag', to: { x: 10, y: 20 }, signal: controller.signal, motion })
  await Promise.resolve()
  controller.abort()
  const result = await active
  assert.equal(result.ok, false)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.lastDispatchedIndex, 1)
  assert.deepEqual(result.cleanup, { dispatched: 1, failed: 0 })
  assert.deepEqual(result.lastDispatchedPoint, { x: 0, y: 0, atMs: 0 })
  await dispatchPointerMotion(wc, { action: 'move', to: { x: 30, y: 40 }, motion })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].steps[0].x, 0)
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
    assert.equal(calls[1].steps[0].x, 0)
  }
})

test('navigation, render process exit, and external input invalidate completed positions', async () => {
  for (const event of ['did-start-navigation', 'did-navigate-in-page', 'render-process-gone', 'external']) {
    const { wc, calls, emitter } = mock()
    await dispatchPointerMotion(wc, { action: 'move', to: { x: 100, y: 200 }, motion })
    if (event === 'external') invalidatePointerMotion(wc)
    else emitter.emit(event)
    await dispatchPointerMotion(wc, { action: 'move', to: { x: 300, y: 400 }, motion })
    assert.equal(calls[1].steps[0].x, 0)
    assert.equal(calls[1].steps[0].y, 0)
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
  assert.equal(calls[1].steps[0].x, 0)
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
  assert.equal(a.calls[1].steps.at(-1)!.x, 30)
  assert.equal(a.calls[1].steps.at(-1)!.atMs, 100)
  assert.equal(b.calls[0].steps[0].x, 0)
})

test('final timeline and step caps include every appended button event', async () => {
  const { wc, calls } = mock()
  await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 60000, sampleRateHz: 1 } }), /60000/)
  await assert.rejects(dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 9998, intervalMs: 1 } }), /10000/)
  await assert.rejects(dispatchPointerMotion(wc, { action: 'drag', to: { x: 1, y: 1 }, motion: { durationMs: 9998, intervalMs: 1 } }), /10000/)
  assert.equal(calls.length, 0)
  await dispatchPointerMotion(wc, { action: 'click', to: { x: 1, y: 1 }, motion: { durationMs: 9997, intervalMs: 1, holdMs: 0 } })
  assert.equal(calls[0].steps.length, 10000)
})

test('timeouts stay bounded, cover the final time and preserve the caller budget', async () => {
  const { wc, calls } = mock()
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
  assert.deepEqual({ x: steps.at(-1)!.x, y: steps.at(-1)!.y, buttons: steps.at(-1)!.buttons }, { x: 40.25, y: 50.75, buttons: 0 })
})
