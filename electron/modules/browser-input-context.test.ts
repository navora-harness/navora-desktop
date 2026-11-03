import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { BrowserPage } from './browser-host'
import type { WsLiteSocket } from './ws-lite'
import { getBrowserAutomationController } from './browser-automation-controller'
import { withBrowserInputOperation, currentBrowserInputOperation, assertBrowserInputCurrent } from './browser-input-context'
import { dispatchTrustedPointer, dispatchTrustedClick } from './trusted-input'
import { clickInIframe } from './iframe-click'
import { BridgeRemoteService } from './bridge-remote'

type Event = Record<string, unknown>
let nextId = 50000
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function fixture(options: { mouse?: (event: Event) => Promise<unknown>; sequence?: (steps: Event[], options: { signal?: AbortSignal }) => Promise<Record<string, unknown>> } = {}) {
  const events: Event[] = []
  const emitter = new EventEmitter()
  const flags = { manual: false }
  const api = Object.assign(emitter, {
    id: nextId++, isDestroyed: () => false, getZoomFactor: () => 2,
    setVirtualCursorEnabled: async () => {}, setVirtualCursorFrameRate: () => {},
    dispatchMouseEvent: async (event: Event) => { events.push(event); return options.mouse?.(event) },
    querySelectorDeep: async () => ({ backendNodeId: 1, tagName: 'IFRAME', x: 20, y: 30, width: 200, height: 100 }),
    executeJavaScript: async () => null,
  }, options.sequence ? { dispatchInputSequence: options.sequence } : {})
  const wc = api as unknown as WebContents
  const controller = getBrowserAutomationController(wc, { getManualControl: () => flags.manual, setManualControl: value => { flags.manual = value } })
  const page = { webContents: wc, automation: controller, isDestroyed: () => false, getContentSize: () => [400, 200], get manualControl() { return flags.manual } } as unknown as BrowserPage
  return { wc, api, controller, events, page }
}

test('nested page contexts survive awaits without leaking across pages or their caller', async () => {
  const a = fixture(), b = fixture()
  try {
    await a.controller.run({}, first => withBrowserInputOperation(a.wc, first, async () => {
      await tick()
      assert.equal(currentBrowserInputOperation(a.wc), first)
      await b.controller.run({}, second => withBrowserInputOperation(b.wc, second, async () => {
        await tick()
        assert.equal(currentBrowserInputOperation(a.wc), first)
        assert.equal(currentBrowserInputOperation(b.wc), second)
      }))
      assert.equal(currentBrowserInputOperation(b.wc), undefined)
    }))
    assert.equal(currentBrowserInputOperation(a.wc), undefined)
  } finally { a.controller.dispose(); b.controller.dispose() }
})

test('late iframe location cannot click after local takeover', async () => {
  const located = deferred<{ backendNodeId: number; tagName: string; x: number; y: number; width: number; height: number }>()
  const started = deferred<void>()
  const f = fixture()
  f.api.querySelectorDeep = () => { started.resolve(); return located.promise }
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () => clickInIframe(f.wc, { iframeSelector: '#frame', offsetRatioX: 0.5 }))).catch(error => error)
    await started.promise
    const handoff = f.controller.takeControl()
    located.resolve({ backendNodeId: 1, tagName: 'IFRAME', x: 20, y: 30, width: 200, height: 100 })
    assert.match(String(await action), /browser_operation_invalidated|browser_manual_control|aborted/)
    assert.equal((await handoff).owner, 'user')
    assert.deepEqual(f.events, [])
  } finally { f.controller.dispose() }
})

test('a legacy move resolving after cancellation never continues into a press', async () => {
  const pending = deferred<void>(), started = deferred<void>()
  const f = fixture({ mouse: async event => { if (event.type === 'mouseMoved') { started.resolve(); await pending.promise } } })
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () => dispatchTrustedClick(f.wc, 70, 80))).catch(error => error)
    await started.promise
    let handedBack = false
    const handoff = f.controller.takeControl().then(state => { handedBack = true; return state })
    await tick(); assert.equal(handedBack, false)
    pending.resolve()
    await action; await handoff
    assert.deepEqual(f.events.map(event => event.type), ['mouseMoved'])
  } finally { f.controller.dispose() }
})

test('takeover waits for owned legacy button cleanup and releases at the latest drag position', async () => {
  const ready = deferred<void>(), release = deferred<void>()
  const f = fixture({ mouse: async event => { if (event.type === 'mouseReleased') await release.promise } })
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, async () => {
      await dispatchTrustedPointer(f.wc, { action: 'down', x: 10, y: 20 })
      await dispatchTrustedPointer(f.wc, { action: 'move', x: 90, y: 100 })
      ready.resolve()
      await new Promise<void>((_, reject) => op.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })).catch(error => error)
    await ready.promise
    let handedBack = false
    const handoff = f.controller.takeControl().then(state => { handedBack = true; return state })
    await tick(); assert.equal(handedBack, false)
    assert.deepEqual(f.events.at(-1), { type: 'mouseReleased', x: 90, y: 100, button: 'left', buttons: 0, clickCount: 1 })
    release.resolve()
    await action; assert.equal((await handoff).owner, 'user')
    assert.equal(f.events.filter(event => event.type === 'mouseReleased').length, 1)
  } finally { f.controller.dispose() }
})

test('old input and owned legacy releases never enter a replacement document', async () => {
  const f = fixture()
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, async () => {
      await dispatchTrustedPointer(f.wc, { action: 'down', x: 10, y: 20 })
      f.api.emit('did-start-navigation', {}, 'https://next.test/', false, true)
      assert.throws(() => assertBrowserInputCurrent(f.wc), /browser_document_changed/)
    }))
    await assert.rejects(action, /cleanup_unconfirmed/)
    assert.deepEqual(f.events.map(event => event.type), ['mousePressed'])
    assert.equal(f.controller.snapshot().error, 'cleanup_unconfirmed')
  } finally { f.controller.dispose() }
})

test('reload forgets an old failed legacy release without replaying it into the new document', async () => {
  let releases = 0
  const f = fixture({ mouse: async event => {
    if (event.type === 'mouseReleased' && ++releases === 1) throw new Error('release_failed')
  } })
  try {
    await assert.rejects(f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () =>
      dispatchTrustedPointer(f.wc, { action: 'down', x: 10, y: 20 }),
    )), /cleanup_unconfirmed/)
    f.api.emit('did-start-navigation', {}, 'https://replacement.test/', false, true)
    await assert.rejects(f.controller.resume(), /cleanup was not confirmed/)
    f.api.emit('did-navigate', {}, 'https://replacement.test/')
    await f.controller.resume()
    await f.controller.run({}, op => withBrowserInputOperation(f.wc, op, async () => {
      await dispatchTrustedPointer(f.wc, { action: 'down', x: 40, y: 50 })
      await dispatchTrustedPointer(f.wc, { action: 'up', x: 60, y: 70 })
    }))
    assert.equal(releases, 2, 'Only the first failed attempt and the new owned release are sent')
    assert.equal(f.events.at(-1)!.x, 60)
  } finally { f.controller.dispose() }
})

test('an expired iframe locate budget still owns its pending page work through takeover', async () => {
  const located = deferred<{ backendNodeId: number; tagName: string; x: number; y: number; width: number; height: number }>()
  const f = fixture()
  f.api.querySelectorDeep = () => located.promise
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () =>
      clickInIframe(f.wc, { iframeSelector: '#frame', offsetRatioX: 0.5, locateBudgetMs: 80 }),
    )).catch(error => error)
    await new Promise(resolve => setTimeout(resolve, 110))
    assert.equal(f.controller.isBusy(), true)
    let handedBack = false
    const handoff = f.controller.takeControl().then(() => { handedBack = true })
    await tick(); assert.equal(handedBack, false)
    located.resolve({ backendNodeId: 1, tagName: 'IFRAME', x: 20, y: 30, width: 200, height: 100 })
    await action; await handoff
    assert.deepEqual(f.events, [])
  } finally { f.controller.dispose() }
})

test('iframe native partial failure stays one closed batch and never falls back to legacy clicking', async () => {
  let calls = 0
  const f = fixture({ sequence: async steps => {
    calls++
    assert.deepEqual(steps.map(event => event.type), ['mouseMoved', 'mousePressed', 'mouseReleased'])
    assert.deepEqual(steps.map(event => event.atMs), [0, 0, 10])
    return { status: 'failed', reason: 'MAX_LATENESS_EXCEEDED', dispatchedCount: 2, cleanup: { dispatched: 1, failed: 0 } }
  } })
  try {
    const result = await f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () => clickInIframe(f.wc, { iframeSelector: '#frame', offsetRatioX: 0.5 })))
    assert.equal(result.ok, false)
    assert.equal(result.status, 'failed')
    assert.equal(result.dispatchedCount, 2)
    assert.equal(calls, 1)
    assert.deepEqual(f.events, [])
  } finally { f.controller.dispose() }
})

test('iframe cancellation reaches the native batch and does not unlock before its cleanup result', async () => {
  const started = deferred<void>(), cancelled = deferred<void>()
  const f = fixture({ sequence: async (_steps, options) => {
    started.resolve()
    await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }))
    await cancelled.promise
    return { status: 'cancelled', reason: 'ABORTED', dispatchedCount: 2, cleanup: { dispatched: 1, failed: 0 } }
  } })
  try {
    const action = f.controller.run({}, op => withBrowserInputOperation(f.wc, op, () => clickInIframe(f.wc, { iframeSelector: '#frame', offsetRatioX: 0.5 }))).catch(error => error)
    await started.promise
    let handedBack = false
    const handoff = f.controller.takeControl().then(state => { handedBack = true; return state })
    await tick(); assert.equal(handedBack, false)
    cancelled.resolve(); await action; await handoff
    assert.equal(f.controller.snapshot().lastResult?.status, 'cancelled')
    assert.deepEqual(f.events, [])
  } finally { f.controller.dispose() }
})

test('remote drag owns the page across packets, maps zoom correctly, and releases before queued AI input', async () => {
  const f = fixture(), client = {} as WsLiteSocket
  const service = new BridgeRemoteService(() => f.page)
  try {
    assert.equal((await service.handleInput({ windowId: 'page', action: 'down', nx: 0.5, ny: 0.5 }, client)).ok, true)
    const ai = f.controller.run({}, async () => { f.events.push({ type: 'ai' }) })
    assert.equal((await service.handleInput({ windowId: 'page', action: 'move', nx: 0.75, ny: 0.5, buttons: 1 }, client)).ok, true)
    assert.equal((await service.handleInput({ windowId: 'page', action: 'up', nx: 0.75, ny: 0.5, buttons: 0 }, client)).ok, true)
    await ai
    assert.deepEqual(f.events.map(event => event.type), ['mousePressed', 'mouseMoved', 'mouseReleased', 'ai'])
    assert.equal(f.events[0]!.x, 100)
    assert.equal(f.events[2]!.x, 150)
    assert.equal(f.events[2]!.buttons, 0)
  } finally { service.dropClient(client); f.controller.dispose() }
})

test('remote disconnect releases only its owned press and a second client cannot join that gesture', async () => {
  const f = fixture(), first = {} as WsLiteSocket, other = {} as WsLiteSocket
  const service = new BridgeRemoteService(() => f.page)
  try {
    assert.equal((await service.handleInput({ windowId: 'page', action: 'down', nx: 0.5, ny: 0.5 }, first)).ok, true)
    const interference = await service.handleInput({ windowId: 'page', action: 'up', nx: 0.5, ny: 0.5 }, other)
    assert.equal(interference.error, 'remote_pointer_busy')
    service.dropClient(first)
    await f.controller.pause()
    assert.deepEqual(f.events.map(event => event.type), ['mousePressed', 'mouseReleased'])
    const blocked = await service.handleInput({ windowId: 'page', action: 'move', nx: 0.1, ny: 0.1 }, first)
    assert.equal(blocked.ok, false)
    assert.equal(f.events.length, 2)
  } finally { service.dropClient(first); service.dropClient(other); f.controller.dispose() }
})
