import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { createDefaultBrowserAutomation } from '../../shared/browser-automation'
import { getBrowserAutomationController } from './browser-automation-controller'
import { withBrowserInputOperation } from './browser-input-context'
import { startOwnedHistoryNavigation, startOwnedNavigation } from './browser-navigation-control'

let nextId = 70000
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture(t: { after(fn: () => void): void }, onStop?: () => void) {
  const events = new EventEmitter()
  const protection: boolean[] = []
  let stops = 0
  let loading = false
  const wc = Object.assign(events, {
    id: nextId++,
    isDestroyed: () => false,
    isLoadingMainFrame: () => loading,
    stop: () => { stops++; onStop?.() },
    setVirtualCursorEnabled: async (_enabled: boolean, options: { blockRealPointer: boolean; blockRealKeyboard: boolean }) => {
      assert.equal(options.blockRealPointer, options.blockRealKeyboard)
      protection.push(options.blockRealPointer)
    },
    setVirtualCursorFrameRate: () => {},
  }) as unknown as WebContents
  const controller = getBrowserAutomationController(wc, { getSettings: createDefaultBrowserAutomation })
  t.after(() => controller.dispose())
  return { wc, controller, events, protection, setLoading(value: boolean) { loading = value }, get stops() { return stops } }
}

function lifecycleListeners(events: EventEmitter) {
  return Object.fromEntries(['did-start-navigation', 'did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-stop-loading', 'did-fail-load', 'did-fail-provisional-load', 'render-process-gone', 'destroyed']
    .map(event => [event, events.listenerCount(event)]))
}

test('takeover stops initial page navigation and waits for its native acknowledgement without an acquired input operation', async t => {
  const native = deferred()
  const f = fixture(t)
  let starts = 0
  const navigation = startOwnedNavigation(f.wc, undefined, () => { starts++; return native.promise })

  assert.equal(starts, 1)
  assert.equal(f.controller.snapshot().activeOperations, 0)
  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  assert.equal(f.stops, 1, 'Epoch invalidation stops the loader even without an active input operation')
  await tick()
  assert.equal(handedOver, false, 'Stopping the loader does not acknowledge its pending native navigation')

  native.resolve()
  await navigation
  assert.equal((await takeover).owner, 'user')
  assert.equal(f.stops, 1)
})

test('an old aborted signal cannot stop later user navigation after its native promise settles', async t => {
  const first = deferred()
  const second = deferred()
  const oldSignal = new AbortController()
  let currentNavigation = 'first'
  const stoppedNavigations: string[] = []
  const f = fixture(t, () => { stoppedNavigations.push(currentNavigation) })

  const initial = startOwnedNavigation(f.wc, oldSignal.signal, () => first.promise)
  first.resolve()
  await initial
  await f.controller.takeControl()
  currentNavigation = 'user'
  const userNavigation = second.promise
  oldSignal.abort()
  await tick()

  assert.deepEqual(stoppedNavigations, [], 'Settled navigation removes both its signal and epoch listeners')
  second.resolve()
  await userNavigation
})

test('an unsettled replaced navigation cannot stop its replacement through its old abort signal', async t => {
  const first = deferred()
  const replacement = deferred()
  const oldSignal = new AbortController()
  let currentNavigation = 'first'
  const stoppedNavigations: string[] = []
  const f = fixture(t, () => { stoppedNavigations.push(currentNavigation) })

  const initial = startOwnedNavigation(f.wc, oldSignal.signal, () => first.promise)
  currentNavigation = 'replacement'
  const next = startOwnedNavigation(f.wc, undefined, () => replacement.promise)
  oldSignal.abort()
  await tick()
  assert.deepEqual(stoppedNavigations, [], 'The old signal cannot stop a newer navigation while its own promise is still pending')

  first.resolve()
  await initial
  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.deepEqual(stoppedNavigations, ['replacement'], 'Settling the old navigation must preserve the replacement cancellation listener')
  assert.equal(handedOver, false)
  replacement.resolve()
  await next
  assert.equal((await takeover).owner, 'user')
})

test('caller timeout does not release navigation ownership before the native promise settles', async t => {
  const native = deferred()
  const started = deferred()
  const timeout = deferred()
  const f = fixture(t)
  let callerReturned = false
  let runSettled = false
  const running = f.controller.run({}, operation => withBrowserInputOperation(f.wc, operation, async () => {
    const navigation = startOwnedNavigation(f.wc, operation.signal, () => { started.resolve(); return native.promise })
    await Promise.race([navigation, timeout.promise])
    callerReturned = true
  })).finally(() => { runSettled = true })

  await started.promise
  timeout.resolve()
  await tick()
  assert.equal(callerReturned, true)
  assert.equal(runSettled, false)
  assert.equal(f.controller.isBusy(), true)
  assert.equal(f.controller.snapshot().inputProtected, true)
  assert.deepEqual(f.protection, [true])

  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.equal(f.stops, 1)
  assert.equal(handedOver, false)
  assert.equal(runSettled, false)
  assert.deepEqual(f.protection, [true], 'Input remains protected while the stopped loader still has pending native work')

  native.resolve()
  await running
  assert.equal((await takeover).owner, 'user')
  assert.equal(f.controller.isBusy(), false)
  assert.equal(f.controller.snapshot().inputProtected, false)
  assert.deepEqual(f.protection, [true, false])
  assert.equal(f.stops, 1)
})

test('navigation inherits the current operation signal when its explicit signal is undefined', async t => {
  const native = deferred()
  const started = deferred()
  const abort = new AbortController()
  const f = fixture(t)
  let runSettled = false
  const running = f.controller.run({ signal: abort.signal }, operation => withBrowserInputOperation(f.wc, operation, () =>
    startOwnedNavigation(f.wc, undefined, () => { started.resolve(); return native.promise }),
  )).finally(() => { runSettled = true })
  const rejected = assert.rejects(running, /aborted|invalidated/)

  await started.promise
  abort.abort()
  await tick()
  assert.equal(f.stops, 1, 'The ALS operation signal stops navigation before any epoch change')
  assert.equal(runSettled, false)
  assert.equal(f.controller.snapshot().inputProtected, true)
  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.equal(handedOver, false)
  assert.equal(f.stops, 1)

  native.resolve()
  await rejected
  assert.equal((await takeover).owner, 'user')
  assert.equal(f.controller.snapshot().inputProtected, false)
})

test('history navigation observes synchronous main-frame load events emitted during start', async t => {
  for (const completion of ['did-finish-load', 'did-stop-loading']) {
    const f = fixture(t)
    const baseline = lifecycleListeners(f.events)
    const result = await startOwnedHistoryNavigation(f.wc, undefined, () => {
      f.setLoading(true)
      f.events.emit('did-start-navigation', {}, 'https://history.test/previous', false, true)
      f.events.emit('did-navigate', {}, 'https://history.test/previous', 200, 'OK')
      f.setLoading(false)
      f.events.emit(completion)
    }, 250)

    assert.deepEqual(result, { timedOut: false })
    assert.equal(f.stops, 0)
    assert.deepEqual(lifecycleListeners(f.events), baseline)
  }
})

test('history ignores old load completion after start until its own in-page navigation or document commit', async t => {
  for (const completion of ['in-page', 'document-load']) {
    const f = fixture(t)
    const baseline = lifecycleListeners(f.events)
    let settled = false
    const navigation = startOwnedHistoryNavigation(f.wc, undefined, () => {
      f.setLoading(true)
    }, 250)
    void navigation.then(() => { settled = true }, () => { settled = true })

    f.events.emit('did-navigate-in-page', {}, 'https://history.test/current#old-push-state', true, 10, 20)
    await tick()
    assert.equal(settled, false, 'A queued in-page event from earlier work cannot finish navigation that has not started')
    f.events.emit('did-start-navigation', {}, 'https://history.test/previous', false, true)
    f.setLoading(false)
    f.events.emit('did-stop-loading')
    f.events.emit('did-finish-load')
    await tick()
    assert.equal(settled, false, 'A prior load terminal event cannot complete navigation that has only started')
    assert.equal(f.stops, 0)

    if (completion === 'in-page') {
      f.events.emit('did-navigate-in-page', {}, 'https://history.test/previous#one', true, 10, 20)
    } else {
      f.events.emit('did-navigate', {}, 'https://history.test/previous', 200, 'OK')
      await tick()
      assert.equal(settled, false, 'A document commit still waits for its load completion')
      f.events.emit('did-finish-load')
    }
    assert.deepEqual(await navigation, { timedOut: false })
    assert.deepEqual(lifecycleListeners(f.events), baseline)
  }
})

test('same-document history completes from a synchronous main-frame in-page navigation', async t => {
  const f = fixture(t)
  const baseline = lifecycleListeners(f.events)
  const result = await startOwnedHistoryNavigation(f.wc, undefined, () => {
    f.events.emit('did-start-navigation', {}, 'https://history.test/#previous', true, true)
    f.events.emit('did-navigate-in-page', {}, 'https://history.test/#previous', true, 10, 20)
  }, 250)

  assert.deepEqual(result, { timedOut: false })
  assert.equal(f.stops, 0)
  assert.deepEqual(lifecycleListeners(f.events), baseline)
})

test('history ignores child-frame failures and waits for stop before rejecting a main-frame failure', async t => {
  const f = fixture(t)
  const baseline = lifecycleListeners(f.events)
  let settled = false
  const navigation = startOwnedHistoryNavigation(f.wc, undefined, () => {
    f.setLoading(true)
    f.events.emit('did-start-navigation', {}, 'https://history.test/previous', false, true)
  }, 250)
  void navigation.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(navigation, error => error instanceof Error)

  f.events.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://child.test/', false, 10, 30)
  await tick()
  assert.equal(settled, false, 'A child-frame failure cannot finish the main-frame history operation')
  f.events.emit('did-fail-load', {}, -101, 'ERR_CONNECTION_RESET', 'https://history.test/previous', true, 10, 20)
  await tick()
  assert.equal(settled, false, 'A main-frame failure does not acknowledge the still-loading navigation')

  f.setLoading(false)
  f.events.emit('did-stop-loading')
  await rejected
  assert.equal(f.stops, 0)
  assert.deepEqual(lifecycleListeners(f.events), baseline)
})

test('history cancellation stops once and retains ownership until the stop acknowledgement', async t => {
  const f = fixture(t)
  const baseline = lifecycleListeners(f.events)
  const abort = new AbortController()
  let settled = false
  const navigation = startOwnedHistoryNavigation(f.wc, abort.signal, () => {
    f.setLoading(true)
    f.events.emit('did-start-navigation', {}, 'https://history.test/previous', false, true)
  }, 250)
  void navigation.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(navigation, /aborted|invalidated/)

  abort.abort()
  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.equal(f.stops, 1, 'Signal and epoch invalidation stop the same loader only once')
  assert.equal(settled, false)
  assert.equal(handedOver, false)
  f.setLoading(false)
  f.events.emit('did-stop-loading')
  await rejected
  assert.equal((await takeover).owner, 'user')
  assert.equal(f.stops, 1)
  assert.deepEqual(lifecycleListeners(f.events), baseline)
})

test('history timeout stops the loader, handles a synchronous acknowledgement and removes listeners', async t => {
  let acknowledgeStop!: () => void
  const f = fixture(t, () => acknowledgeStop())
  acknowledgeStop = () => { f.setLoading(false); f.events.emit('did-stop-loading') }
  const baseline = lifecycleListeners(f.events)
  const abort = new AbortController()
  const result = await startOwnedHistoryNavigation(f.wc, abort.signal, () => {
    f.setLoading(true)
    f.events.emit('did-start-navigation', {}, 'https://history.test/previous', false, true)
  }, 10)

  assert.deepEqual(result, { timedOut: true })
  assert.equal(f.stops, 1)
  assert.deepEqual(lifecycleListeners(f.events), baseline)
  abort.abort()
  await f.controller.takeControl()
  assert.equal(f.stops, 1, 'A settled timeout removes both signal and epoch cancellation listeners')
})

test('history stop without a terminal event or native loading confirmation prevents a successful handoff', async t => {
  const stopRequested = deferred()
  const f = fixture(t, () => stopRequested.resolve())
  const baseline = lifecycleListeners(f.events)
  let settled = false
  const navigation = startOwnedHistoryNavigation(f.wc, undefined, () => {
    f.setLoading(true)
    f.events.emit('did-start-navigation', {}, 'https://history.test/still-loading', false, true)
  }, 10)
  void navigation.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(navigation, /navigation_stop_unconfirmed/)

  await stopRequested.promise
  assert.equal(f.stops, 1)
  assert.equal(settled, false)
  let handedOver = false
  const takeover = f.controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.equal(handedOver, false, 'The stop request must not be mistaken for native confirmation')

  await rejected
  const state = await takeover
  assert.equal(state.owner, 'paused')
  assert.equal(state.activity, 'error')
  assert.equal(state.error, 'cleanup_unconfirmed')
  assert.equal(f.stops, 1)
  assert.deepEqual(lifecycleListeners(f.events), baseline)
})
