import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { createDefaultBrowserAutomation } from '../../shared/browser-automation'
import { getBrowserAutomationController, type BrowserAutomationOperation } from './browser-automation-controller'
import {setBrowserPageZoom} from './browser-page-zoom'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function mock(t: { after(fn: () => void): void }, native?: (enabled: boolean, protect: boolean) => Promise<void>) {
  const events = new EventEmitter()
  const calls: { enabled: boolean; protect: boolean }[] = []
  const configurations: Electron.AutomationOptions[] = []
  const nativeState = {
    isolateInput: false, blockRealPointer: false, blockRealKeyboard: false, keepRendering: false,
    virtualCursor: { enabled: false, frameRate: 0, hotspot: { x: 0, y: 0 }, customImage: false },
    rendering: { viewAvailable: true, keepAlive: false, requestedBackgroundThrottling: true, effectiveBackgroundThrottling: true },
    inputActive: false,
  }
  let resets = 0
  let destroyed = false
  const wc = Object.assign(events, {
    isDestroyed: () => destroyed,
    setAutomationOptions: async (options: Electron.AutomationOptions) => {
      assert.equal(options.blockRealPointer, options.blockRealKeyboard)
      const enabled = options.virtualCursor?.enabled ?? nativeState.virtualCursor.enabled
      const protect = options.blockRealPointer ?? nativeState.blockRealPointer
      configurations.push(options)
      calls.push({ enabled, protect })
      await native?.(enabled, protect)
      for (const field of ['isolateInput', 'blockRealPointer', 'blockRealKeyboard', 'keepRendering'] as const) {
        if (options[field] !== undefined) nativeState[field] = options[field]!
      }
      Object.assign(nativeState.virtualCursor, options.virtualCursor)
      nativeState.rendering.keepAlive = nativeState.keepRendering
      nativeState.rendering.effectiveBackgroundThrottling = !nativeState.keepRendering
    },
    getAutomationState: () => structuredClone(nativeState),
    resetAutomationOptions: async () => {
      resets++; calls.push({ enabled: false, protect: false })
      await native?.(false, false)
      Object.assign(nativeState, { isolateInput: false, blockRealPointer: false, blockRealKeyboard: false, keepRendering: false, inputActive: false })
      Object.assign(nativeState.virtualCursor, { enabled: false, frameRate: 0, hotspot: { x: 0, y: 0 }, customImage: false })
      Object.assign(nativeState.rendering, { keepAlive: false, effectiveBackgroundThrottling: true })
    },
    setVirtualCursorFrameRate: (fps: number) => { nativeState.virtualCursor.frameRate = fps },
    setVirtualCursorImage: (_image: import('electron').NativeImage | null) => {},
  })
  let manual = false
  const controller = getBrowserAutomationController(wc as unknown as WebContents, {
    getSettings: createDefaultBrowserAutomation, getManualControl: () => manual,
    setManualControl: value => { manual = value },
    getCursorImage: async () => ({ image: {} as import('electron').NativeImage, hotspot: { x: 4, y: 3 } }),
  })
  t.after(() => controller.dispose())
  return { controller, calls, configurations, nativeState, events, wc, get resets() { return resets }, destroy() { destroyed = true; events.emit('destroyed') } }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('menu zoom preserves a waiting AI lease and input protection while invalidating old coordinates',async t=>{
  const {controller,calls,wc}=mock(t)
  await controller.claimRun('zoom-lease')
  let zoom=1,layouts=0
  const page={webContents:Object.assign(wc,{getZoomFactor:()=>zoom,setZoomFactor:(value:number)=>{zoom=value}}) as unknown as WebContents,automation:controller,annotationSelecting:false,activeOperations:0}
  const before=controller.snapshot(),nativeCalls=calls.length
  setBrowserPageZoom(page,1.25,()=>layouts++)
  const after=controller.snapshot()
  assert.equal(zoom,1.25);assert.equal(layouts,1)
  assert.equal(after.owner,before.owner);assert.equal(after.leaseRunId,before.leaseRunId);assert.equal(after.inputProtected,true)
  assert.equal(calls.length,nativeCalls,'Zoom does not release or reacquire input protection')
  assert.ok(after.epoch>before.epoch);assert.equal(after.needsObservation,true)
  assert.throws(()=>setBrowserPageZoom(page,NaN,()=>layouts++),/invalid_zoom/)
  assert.throws(()=>setBrowserPageZoom(page,3.01,()=>layouts++),/invalid_zoom/)
  assert.equal(zoom,1.25);assert.equal(layouts,1)
})

test('menu zoom rejects submitted input without cancelling, taking control or changing geometry',async t=>{
  const {controller,calls,wc}=mock(t),entered=deferred(),held=deferred()
  let zoom=1,layouts=0
  const page={webContents:Object.assign(wc,{getZoomFactor:()=>zoom,setZoomFactor:(value:number)=>{zoom=value}}) as unknown as WebContents,automation:controller,annotationSelecting:false,activeOperations:0}
  const running=controller.run({runId:'zoom-busy'},async operation=>{entered.resolve();await held.promise;operation.assertCurrent()})
  await entered.promise
  const before=controller.snapshot(),nativeCalls=calls.length
  assert.throws(()=>setBrowserPageZoom(page,1.5,()=>layouts++),/browser_busy_wait_for_current_action/)
  assert.equal(zoom,1);assert.equal(layouts,0);assert.equal(controller.snapshot().epoch,before.epoch);assert.equal(calls.length,nativeCalls)
  held.resolve();await running
  assert.equal(controller.snapshot().owner,'ai');assert.equal(controller.snapshot().leaseRunId,'zoom-busy')
})

test('annotation manual reservation drains submitted input without cancelling it and restores the valid AI lease',async t=>{
  const {controller,calls}=mock(t),entered=deferred(),held=deferred()
  const running=controller.run({runId:'annotation-run'},async operation=>{entered.resolve();await held.promise;operation.assertCurrent()})
  await entered.promise
  let acquired=false
  const waiting=controller.acquireManualSession().then(token=>{acquired=true;return token})
  await tick();assert.equal(acquired,false);assert.equal(controller.snapshot().owner,'ai')
  await assert.rejects(controller.run({runId:'annotation-run'},async()=>{}),/browser_manual_control/)
  held.resolve();await running;const token=await waiting
  assert.equal(controller.snapshot().owner,'user');assert.equal(controller.snapshot().inputProtected,false)
  const result=await controller.releaseManualSession(token)
  assert.equal(result.restored,true);assert.equal(result.state.owner,'ai');assert.equal(result.state.leaseRunId,'annotation-run');assert.equal(result.state.inputProtected,true)
  assert.deepEqual(calls.map(value=>value.protect),[true,false,true])
})

test('annotation exit preserves existing user or paused control rather than granting AI control',async t=>{
  const {controller}=mock(t)
  for(const owner of ['user','paused'] as const){
    await (owner==='user'?controller.takeControl():controller.pause())
    const token=await controller.acquireManualSession(),result=await controller.releaseManualSession(token)
    assert.equal(result.restored,true);assert.equal(result.state.owner,owner);assert.equal(result.state.inputProtected,false)
  }
})

test('navigation, task completion, and explicit pause invalidate annotation automatic restore',async t=>{
  const {controller,events}=mock(t)
  await controller.run({runId:'first'},async()=>{})
  let token=await controller.acquireManualSession()
  events.emit('did-navigate-in-page')
  assert.equal((await controller.releaseManualSession(token)).restored,false)
  assert.equal(controller.snapshot().owner,'user');assert.equal(controller.snapshot().inputProtected,false)
  await controller.resume();await controller.finishRun('first');await controller.run({runId:'second'},async()=>{})
  token=await controller.acquireManualSession();await controller.finishRun('second')
  assert.equal((await controller.releaseManualSession(token)).restored,false)
  assert.equal(controller.snapshot().leaseRunId,undefined)
  await controller.resume();token=await controller.acquireManualSession();await controller.pause()
  assert.equal((await controller.releaseManualSession(token)).restored,false)
  assert.equal(controller.snapshot().owner,'paused')
})

test('document change during annotation native restore releases the newly enabled input guards',async t=>{
  let restoring=false
  const entered=deferred(),held=deferred()
  const {controller,events}=mock(t,async(_enabled,protect)=>{if(restoring&&protect){entered.resolve();await held.promise}})
  await controller.run({runId:'restore-race'},async()=>{})
  const token=await controller.acquireManualSession();restoring=true
  const releasing=controller.releaseManualSession(token);await entered.promise
  events.emit('did-navigate-in-page');held.resolve()
  assert.equal((await releasing).restored,false);assert.equal(controller.snapshot().owner,'user');assert.equal(controller.snapshot().inputProtected,false)
})

test('annotation handoff native failure remains paused and never claims successful manual control',async t=>{
  const {controller}=mock(t,async()=>{throw Error('native-fixture-failure')})
  await assert.rejects(controller.acquireManualSession(),/native-fixture-failure/)
  assert.equal(controller.snapshot().owner,'paused');assert.equal(controller.snapshot().nativeConfirmed,false)
})

test('idle notification waits for committed work and native barriers without changing ownership',async t=>{
  const barrier=deferred(),nativeEntered=deferred(),held=deferred(),entered=deferred()
  const {controller}=mock(t,async()=>{nativeEntered.resolve();await barrier.promise})
  let idle=0
  controller.bind({onIdle:()=>{assert.equal(controller.isBusy(),false);idle++}})
  const running=controller.run({runId:'layout-idle'},async operation=>{void operation.track(()=>held.promise);entered.resolve()})
  await nativeEntered.promise;await tick();assert.equal(idle,0)
  barrier.resolve();await entered.promise;await tick();assert.equal(idle,0)
  held.resolve();await running;await tick()
  assert.equal(idle,1);assert.equal(controller.snapshot().owner,'ai');assert.equal(controller.snapshot().leaseRunId,'layout-idle');assert.equal(controller.snapshot().inputProtected,true)
})

test('external pending work notifies idle on both resolve and reject and ignores ordinary state publications',async t=>{
  const {controller,events}=mock(t)
  let idle=0
  controller.bind({onIdle:()=>{idle++}})
  const first=deferred();controller.trackPending(first.promise)
  first.resolve();await first.promise;await tick();assert.equal(idle,1)
  const failure=Promise.reject(new Error('fixture navigation failure'));controller.trackPending(failure)
  await assert.rejects(failure);await tick();assert.equal(idle,2)
  events.emit('did-navigate-in-page');await tick();assert.equal(idle,2)
})

test('task ownership keeps native input guards during model waits and releases only for the matching task', async t => {
  const { controller, calls, events } = mock(t)
  await controller.run({ runId: 'run-A' }, async () => {})
  const epoch = controller.captureEpoch()
  for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'mouseDown', 'mouseWheel']) events.emit('before-mouse-event', {}, { type })
  events.emit('before-input-event', {}, { type: 'keyDown', key: 'a' })
  await tick()
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().owner, 'ai')
  assert.equal(controller.captureEpoch(), epoch)
  assert.deepEqual(calls, [{ enabled: false, protect: true }])
  assert.equal(controller.snapshot().leaseRunId, 'run-A')
  await controller.finishRun('old-run')
  await controller.finishRun()
  assert.equal(controller.snapshot().inputProtected, true)
  await controller.run({ runId: 'run-A' }, async () => {})
  await assert.rejects(controller.run({ runId: 'run-B' }, async () => {}), /browser_page_in_use/)
  await controller.finishRun('run-A')
  assert.equal(controller.snapshot().inputProtected, false)
  assert.equal(controller.snapshot().leaseRunId, undefined)
  assert.equal(controller.snapshot().cursorEnabled, false)
  await controller.run({ runId: 'run-B' }, async () => {})
  await controller.finishRun('run-A')
  assert.equal(controller.snapshot().leaseRunId, 'run-B')
  assert.equal(controller.snapshot().inputProtected, true)
})

test('hover never pauses an idle page or invalidates a pending permission observation', async t => {
  const { controller, events } = mock(t)
  const epoch = controller.captureEpoch()
  controller.noteObservation(epoch, controller.captureDocumentEpoch())
  for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave']) events.emit('before-mouse-event', {}, { type })
  await tick()
  assert.equal(controller.snapshot().owner, 'ai')
  assert.equal(controller.captureEpoch(), epoch)
  assert.equal(controller.needsObservation(), false)
})

test('hidden cursor retains pointer and keyboard guards and setting changes do not release the task lease', async t => {
  const { controller, calls, wc } = mock(t)
  const images: { style: string; visible: boolean; scale: number | undefined }[] = []
  Object.assign(wc, { setVirtualCursorImage() {} })
  controller.bind({ getCursorImage: async (style, visible, scale) => {
    images.push({ style, visible, scale })
    return { image: {} as import('electron').NativeImage, hotspot: { x: 4, y: 3 } }
  } })
  await controller.run({ runId: 'run' }, async () => {})
  await controller.pointerInput(async () => ({status:'dispatched'}), result => result.status === 'dispatched')
  const epoch = controller.captureEpoch()
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false }, 1)
  assert.equal(controller.captureEpoch(), epoch, 'Hiding drawing does not abort the task')
  assert.equal(controller.snapshot().cursorEnabled, false)
  assert.equal(controller.snapshot().cursorVisible, false)
  assert.equal(controller.snapshot().inputProtected, true)
  assert.deepEqual(images.at(-1), { style: 'windows-glow', visible: true, scale: 1 }, 'Hiding uses enabled:false without manufacturing a transparent cursor')
  await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_style: 'precision-cross' }, 2)
  assert.equal(controller.snapshot().cursorStyle, 'precision-cross')
  assert.equal(controller.snapshot().inputProtected, true)
  assert.deepEqual(images.at(-1), { style: 'precision-cross', visible: true, scale: 1 })
  await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_style: 'precision-cross', cursor_scale: 1.5 }, 3)
  assert.deepEqual(images.at(-1), { style: 'precision-cross', visible: true, scale: 1.5 })
  assert.equal(controller.captureEpoch(), epoch, 'Resizing drawing does not invalidate task input')
  assert.equal(controller.snapshot().leaseRunId, 'run')
  assert.equal(controller.snapshot().inputProtected, true)
  const count = images.length
  await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_style: 'precision-cross', cursor_scale: 1.5, speed_multiplier: 0.8 }, 4)
  assert.equal(images.length, count, 'A motion-only update does not recreate the same image')
  await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_style:'precision-cross', cursor_scale:1.5 }, 5)
  assert.deepEqual(images.at(-1), { style: 'precision-cross', visible: true, scale: 1.5 })
  assert.ok(calls.every(call => call.protect), 'No native unprotect was issued between task actions')
  await controller.takeControl()
  assert.equal(controller.snapshot().owner, 'user')
  assert.equal(controller.snapshot().leaseRunId, undefined)
  assert.deepEqual(calls.at(-1), { enabled: false, protect: false })
})

test('navigation-only task actions also reserve their explicitly targeted page', async t => {
  const { controller } = mock(t)
  await controller.run({ runId: 'run', readOnly: true, claimInput: true }, async () => {})
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().activity, 'waiting')
  await controller.finishRun('run')
  assert.equal(controller.snapshot().inputProtected, false)
  await controller.takeControl()
  await assert.rejects(controller.run({ runId: 'other-run', readOnly: true, claimInput: true }, async () => {}), /browser_manual_control/)
})

test('newly created pages acquire the task lease without waiting for their initial network load', async t => {
  const { controller } = mock(t)
  const network = deferred()
  controller.trackPending(network.promise)
  await controller.claimRun('new-page-task')
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().leaseRunId, 'new-page-task')
  let released = false
  const finish = controller.finishRun('new-page-task').then(() => { released = true })
  await tick()
  assert.equal(released, false)
  network.resolve()
  await finish
  assert.equal(controller.snapshot().inputProtected, false)
})

test('transferring an AI-owned page restores guards before returning while manual annotation remains usable', async t => {
  const { controller } = mock(t)
  let manual = false
  controller.bind({ getManualControl: () => manual })
  await controller.run({ runId: 'run' }, async () => {})
  await controller.withTransfer(() => {})
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().leaseRunId, 'run')
  await controller.withTransfer(() => { manual = true })
  assert.equal(controller.snapshot().inputProtected, false)
  assert.equal(controller.snapshot().owner, 'user')
  manual = false
  await controller.run({ runId: 'run' }, async () => {})
  assert.equal(controller.snapshot().inputProtected, true)
})

test('a hidden cursor does not need the legacy custom image methods to retain isolation', async t => {
  const { controller, wc, configurations } = mock(t)
  Reflect.deleteProperty(wc, 'setVirtualCursorImage')
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false }, 1)
  let acted = false
  await controller.run({ runId: 'run' }, async () => { acted = true })
  assert.equal(acted, true)
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().isolateInput, true)
  assert.equal(controller.snapshot().keepRendering, true)
  assert.equal(controller.snapshot().cursorEnabled, false)
  assert.equal(configurations.at(-1)?.virtualCursor?.image, undefined)
})

test('native protection confirmation precedes action; waiting retains it until full verification ends', async t => {
  const enabled = deferred()
  const verify = deferred()
  const { controller, calls } = mock(t, async (_enabled, protect) => { if (protect) await enabled.promise })
  let started = false
  const running = controller.run({}, async op => {
    started = true
    await op.setActivity('waiting')
    assert.equal(controller.snapshot().inputProtected, true)
    await verify.promise
    return { ok: true }
  })
  await tick()
  assert.equal(started, false)
  enabled.resolve()
  await tick()
  assert.equal(controller.snapshot().inputProtected, true)
  verify.resolve()
  await running
  assert.deepEqual(calls, [{ enabled: false, protect: true }, { enabled: false, protect: false }])
  assert.equal(controller.snapshot().activity, 'waiting')
})

test('whole semantic actions are serialized rather than just their individual native batches', async t => {
  const first = deferred()
  const { controller } = mock(t)
  const order: string[] = []
  const a = controller.run({}, async () => { order.push('locate A'); await first.promise; order.push('click A') })
  const b = controller.run({}, async () => { order.push('locate B'); order.push('click B') })
  await tick()
  assert.deepEqual(order, ['locate A'])
  first.resolve()
  await Promise.all([a, b])
  assert.deepEqual(order, ['locate A', 'click A', 'locate B', 'click B'])
})

test('takeover aborts only its page, invalidates queued work and waits for cleanup', async t => {
  const a = mock(t)
  const b = mock(t)
  let secondStarted = false
  const first = a.controller.run({}, async op => {
    await new Promise<void>(resolve => op.signal.addEventListener('abort', () => resolve(), { once: true }))
    op.assertCurrent()
  })
  const firstRejected = assert.rejects(first, /invalidated|manual_control|aborted/)
  const second = a.controller.run({}, async () => { secondStarted = true })
  const secondRejected = assert.rejects(second, /invalidated|manual_control/)
  await tick()
  const state = await a.controller.takeControl()
  await Promise.all([firstRejected, secondRejected])
  assert.equal(secondStarted, false)
  assert.equal(state.owner, 'user')
  assert.equal(state.nativeConfirmed, true)
  assert.equal(state.inputProtected, false)
  assert.equal(b.controller.snapshot().owner, 'ai')
})

test('takeover requests native reset immediately but waits for an uncancellable commit before granting ownership', async t => {
  const click = deferred<{ status: string }>()
  const { controller, calls } = mock(t)
  let committed = false
  const action = controller.run({}, async op => {
    committed = true
    await op.commit(() => click.promise)
  })
  const rejected = assert.rejects(action, /invalidated|manual_control/)
  await tick()
  assert.equal(committed, true)
  let handedOver = false
  const takeover = controller.takeControl().then(state => { handedOver = true; return state })
  await tick()
  assert.equal(handedOver, false)
  assert.equal(calls.length, 2, 'The native cancellation barrier precedes receipt settlement')
  assert.equal(controller.snapshot().activity, 'handoff')
  assert.equal(controller.snapshot().owner, 'ai', 'The compatibility manual flag cannot report a handoff before native input settles')
  assert.equal(controller.snapshot().inputProtected, false, 'Reset confirmation alone does not grant ownership')
  click.resolve({ status: 'dispatched' })
  await takeover
  await rejected
  assert.equal(calls.at(-1)!.enabled, false)
})

test('legacy input cleanup precedes release and failed cleanup prevents false ready state', async t => {
  for (const fail of [false, true]) {
    const order: string[] = []
  const { controller } = mock(t, async (_enabled, protect) => { if (protect || order.at(-1) !== 'unprotect') order.push(protect ? 'protect' : 'unprotect') })
    const action = controller.run({}, async op => {
      op.registerCleanup(async () => { order.push('release held button'); if (fail) throw Error('release failed') })
      order.push('press')
    })
    if (fail) await assert.rejects(action, /cleanup_unconfirmed/)
    else await action
    assert.deepEqual(order, ['protect', 'press', 'release held button', 'unprotect'])
    if (fail) {
      assert.equal(controller.snapshot().owner, 'paused')
      assert.equal(controller.snapshot().error, 'cleanup_unconfirmed')
      await assert.rejects(controller.resume(), { code: 'cleanup_unconfirmed' })
    }
  }
})

test('successful selector summary with unknown total count is allowed; nested partial delivery is unsafe', async t => {
  const good = mock(t)
  await good.controller.run({}, async () => ({ ok: true, status: 'completed', dispatchedCount: null, clickDispatch: { status: 'dispatched' } }))
  assert.equal(good.controller.snapshot().owner, 'ai')
  const bad = mock(t)
  await assert.rejects(bad.controller.run({}, async () => ({
    ok: false, failedResult: { clickDispatch: { status: 'failed', deliveryWarning: 'PARTIAL_CLICK_SEQUENCE' } },
  })), error => {
    assert.equal((error as {code:string}).code, 'cleanup_unconfirmed')
    assert.equal((error as {lastResult:{reason:string}}).lastResult.reason, 'PARTIAL_CLICK_SEQUENCE')
    return true
  })
  assert.equal(bad.controller.snapshot().error, 'cleanup_unconfirmed')
})

test('close failure reports unconfirmed protection and retry never replays the action', async t => {
  let rejectClose = true
  const { controller, wc } = mock(t)
  let actions = 0
  await controller.run({}, async () => { actions++ })
  const reset = wc.resetAutomationOptions
  wc.resetAutomationOptions = async () => { if (rejectClose) throw Error('barrier timeout'); await reset() }
  const failed = await controller.takeControl()
  assert.equal(failed.error, 'release_unconfirmed')
  assert.equal(failed.nativeConfirmed, false)
  assert.equal(failed.owner, 'paused')
  rejectClose = false
  const retried = await controller.retryRelease()
  assert.equal(retried.nativeConfirmed, true)
  assert.equal(actions, 1)
})

test('resume invalidates old intents and requires a fresh matching observation without starting work', async t => {
  const { controller } = mock(t)
  const old = controller.captureEpoch()
  await controller.pause()
  const state = await controller.resume()
  assert.equal(state.owner, 'ai')
  assert.equal(controller.needsObservation(), true)
  await assert.rejects(controller.run({ expectedEpoch: old }, async () => {}), /invalidated/)
  controller.noteObservation(controller.captureEpoch(), controller.captureDocumentEpoch())
  assert.equal(controller.needsObservation(), false)
})

test('epoch watchers abort permission waits once and can be unsubscribed', async t => {
  const { controller } = mock(t)
  let notifications = 0
  const dispose = controller.watchEpoch(controller.captureEpoch(), () => { notifications++ })
  dispose()
  controller.watchEpoch(controller.captureEpoch(), () => { notifications++ })
  await controller.pause()
  await controller.resume()
  assert.equal(notifications, 1)
})

test('self-navigation can settle but pre-navigation queued actions are discarded', async t => {
  const { controller, events } = mock(t)
  const navigate = deferred()
  const first = controller.run({}, async op => {
    await navigate.promise
    events.emit('did-start-navigation', {}, 'https://example.test', false, true)
    assert.equal(op.signal.aborted, false)
    op.assertCurrent()
  })
  let queuedStarted = false
  const queued = controller.run({}, async () => { queuedStarted = true })
  const rejected = assert.rejects(queued, /document_changed/)
  await tick()
  navigate.resolve()
  await first
  await rejected
  assert.equal(queuedStarted, false)
})

test('settings shutdown drains current input and newer settings win without stale callbacks', async t => {
  const close = deferred()
  let delayClose = false
  const { controller } = mock(t, async enabled => { if (!enabled && delayClose) await close.promise })
  await controller.run({runId:'settings'}, async () => {})
  await controller.pointerInput(async () => true, result => result)
  delayClose = true
  const revision = (controller.snapshot().revision ?? 0) + 1
  const off = controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false }, revision)
  await tick()
  const on = controller.applySettings(createDefaultBrowserAutomation(), revision + 1)
  close.resolve()
  await Promise.all([off, on])
  assert.equal(controller.snapshot().revision, revision + 1)
  assert.equal(controller.snapshot().cursorEnabled, true)
  await controller.run({runId:'settings'}, async () => {})
})

test('hidden pages continue their existing action; destroying them invalidates late work', async t => {
  const active = deferred()
  const { controller, events, destroy } = mock(t)
  let signal!: AbortSignal
  const running = controller.run({}, async op => { signal = op.signal; await active.promise })
  const rejected = assert.rejects(running, /destroyed|invalidated/)
  await tick()
  events.emit('hide')
  assert.equal(signal.aborted, false)
  destroy()
  active.resolve()
  await rejected
  assert.equal(controller.snapshot().cursorEnabled, false)
})

test('explicit self-close completion is allowed without reopening a disposed page', async t => {
  const { controller, destroy } = mock(t)
  const result = await controller.run({ allowDisposedCompletion: true }, async () => { destroy(); return { ok: true } })
  assert.equal(result.ok, true)
  await assert.rejects(controller.run({}, async () => {}), /destroyed/)
})

test('read-only inspection can run while manually owned without acquiring input protection', async t => {
  const { controller, calls } = mock(t)
  await controller.takeControl()
  calls.length = 0
  assert.equal(await controller.run({ readOnly: true }, async () => 'snapshot'), 'snapshot')
  assert.equal(controller.snapshot().owner, 'user')
  assert.equal(calls.length, 0)
})

test('run completion hides cursor without changing permission or replaying input', async t => {
  const { controller } = mock(t)
  await controller.run({runId:'completion'}, async () => {})
  await controller.pointerInput(async () => true, result => result)
  assert.equal(controller.snapshot().cursorEnabled, true)
  await controller.finishRun('completion')
  assert.equal(controller.snapshot().cursorEnabled, false)
  assert.equal(controller.snapshot().activity, 'idle')
  assert.equal(controller.snapshot().owner, 'ai')
})

test('navigation, reads and keyboard receipts keep the first cursor hidden without weakening ownership', async t => {
  const {controller,calls}=mock(t)
  await controller.claimRun('first-position')
  await controller.run({runId:'first-position'}, async operation => {
    await operation.commit(async () => ({status:'completed',dispatchedCount:2,lastDispatchedIndex:1}))
  })
  assert.equal(controller.snapshot().cursorPositionValid,false)
  assert.equal(controller.snapshot().cursorEnabled,false)
  assert.ok(calls.every(call => call.protect && !call.enabled))
  await controller.pointerInput(async () => ({status:'failed'}), result => result.status === 'dispatched')
  assert.equal(controller.snapshot().cursorEnabled,false)
  await controller.pointerInput(async () => ({status:'dispatched'}), result => result.status === 'dispatched')
  assert.equal(controller.snapshot().cursorPositionValid,true)
  assert.equal(controller.snapshot().cursorEnabled,true)
  assert.equal(controller.snapshot().cursorVisible,undefined,'Configuration is not physical screen evidence')
  await controller.finishRun('first-position')
  await controller.claimRun('second-position')
  assert.equal(controller.snapshot().cursorPositionValid,false)
  assert.equal(controller.snapshot().cursorEnabled,false)
})

test('navigation and geometry hide a confirmed cursor and reject late pointer receipts', async t => {
  for (const kind of ['navigation','subframe','in-page','geometry'] as const) {
    const {controller,events}=mock(t)
    await controller.claimRun('position-lifecycle')
    await controller.pointerInput(async () => true, result => result)
    const held=deferred<boolean>()
    const old=controller.pointerInput(() => held.promise, result => result)
    if(kind==='geometry')controller.geometryChanged()
    else if(kind==='in-page')events.emit('did-navigate-in-page')
    else events.emit('did-start-navigation',{},'https://fixture.invalid',false,kind!=='subframe')
    held.resolve(true);await old;await tick()
    assert.equal(controller.snapshot().cursorPositionValid,false,kind)
    assert.equal(controller.snapshot().cursorEnabled,false,kind)
    assert.equal(controller.snapshot().inputProtected,true,kind)
    await controller.pointerInput(async () => true, result => result)
    assert.equal(controller.snapshot().cursorEnabled,true,kind)
  }
})

test('lifecycle invalidation during asynchronous image creation wins over a display request', async t => {
  const {controller,events,calls}=mock(t),image=deferred(),entered=deferred()
  controller.bind({getCursorImage:async()=>{entered.resolve();await image.promise;return{image:{} as Electron.NativeImage,hotspot:{x:1,y:1}}}})
  await controller.claimRun('image-race')
  const input=controller.pointerInput(async()=>true,result=>result)
  await entered.promise
  events.emit('did-start-navigation',{},'https://fixture.invalid',false,true)
  image.resolve();await input
  assert.equal(controller.snapshot().cursorEnabled,false)
  assert.ok(calls.every(call=>!call.enabled))
})

test('a display failure preserves the acknowledged native pointer receipt without inviting replay', async t => {
  const {controller}=mock(t,async(enabled)=>{if(enabled)throw Error('image display failed')})
  await controller.claimRun('display-failure')
  const receipt={status:'dispatched'}
  assert.equal(await controller.pointerInput(async()=>receipt,()=>true),receipt)
  assert.equal(controller.snapshot().nativeConfirmed,false)
  assert.equal(controller.snapshot().inputProtected,true)
})

test('navigation during the native enable barrier hides its late result while keeping protection', async t => {
  const entered=deferred(),enable=deferred()
  const {controller,events,calls}=mock(t,async enabled=>{if(enabled){entered.resolve();await enable.promise}})
  await controller.claimRun('native-enable-race')
  const input=controller.pointerInput(async()=>true,result=>result)
  await entered.promise
  assert.equal(controller.snapshot().cursorEnabled,false,'The old readback is still disabled')
  events.emit('did-start-navigation',{},'https://fixture.invalid',false,true)
  enable.resolve();await input
  assert.equal(controller.snapshot().cursorEnabled,false)
  assert.equal(controller.snapshot().cursorPositionValid,false)
  assert.equal(controller.snapshot().inputProtected,true)
  assert.deepEqual(calls.slice(-2),[{enabled:true,protect:true},{enabled:false,protect:true}])
})

test('takeover cancels native input even while external navigation remains pending', async t => {
  const f=mock(t),navigation=deferred(),entered=deferred()
  await f.controller.claimRun('concurrent-navigation')
  f.controller.trackPending(navigation.promise)
  let rejectInput!:(error:Error)=>void
  const input=new Promise<void>((_resolve,reject)=>{rejectInput=reject})
  const reset=f.wc.resetAutomationOptions
  f.wc.resetAutomationOptions=async()=>{await reset();rejectInput(Error('AUTOMATION_RESET'))}
  const running=f.controller.run({runId:'concurrent-navigation'},async operation=>{entered.resolve();await operation.commit(()=>input)})
  const rejected=assert.rejects(running,/AUTOMATION_RESET/)
  await entered.promise
  let granted=false
  const takeover=f.controller.takeControl().then(state=>{granted=true;return state})
  await tick()
  assert.equal(f.resets,1,'Pending navigation must not block native cancellation')
  assert.equal(granted,false,'Navigation still drains before manual ownership is granted')
  navigation.resolve();await rejected
  const state=await takeover
  assert.equal(state.owner,'user');assert.equal(state.nativeConfirmed,true)
  assert.equal(state.error,undefined);assert.equal(state.leaseRunId,undefined)
})

test('takeover during transfer drain prevents transfer and cannot be undone by its finally', async t => {
  const close = deferred()
  let delayClose = false
  const { controller } = mock(t, async enabled => { if (!enabled && delayClose) await close.promise })
  await controller.run({}, async () => {})
  delayClose = true
  let moved = false
  const transfer = controller.withTransfer(() => { moved = true })
  const rejected = assert.rejects(transfer, /invalidated/)
  await tick()
  const takeover = controller.takeControl()
  close.resolve()
  await Promise.all([rejected, takeover])
  assert.equal(moved, false)
  assert.equal(controller.snapshot().owner, 'user')
})

test('submitted script tracked across a timeout settles before user handoff without false held-input errors', async t => {
  const script = deferred()
  const { controller, calls } = mock(t)
  const running = controller.run({}, async op => {
    void op.track(() => script.promise).catch(() => {})
    await new Promise<void>(resolve => op.signal.addEventListener('abort', () => resolve(), { once: true }))
  })
  const rejected = assert.rejects(running, /invalidated|manual_control/)
  await tick()
  let finished = false
  const takeover = controller.takeControl().then(state => { finished = true; return state })
  await tick()
  assert.equal(finished, false)
  assert.equal(calls.length, 1, 'A script receipt alone does not authorize early native input reset')
  script.resolve()
  const state = await takeover
  await rejected
  assert.equal(state.error, undefined)
  assert.equal(state.owner, 'user')
})

test('fresh observation explicitly advances an active operation document credential', async t => {
  const { controller, events } = mock(t)
  await controller.run({}, async op => {
    const old = op.documentEpoch
    events.emit('did-start-navigation', {}, 'https://example.test', false, true)
    assert.equal(op.documentEpoch, old)
    controller.noteObservation(op.epoch, controller.captureDocumentEpoch())
    assert.equal(op.documentEpoch, old + 1)
  })
})

test('legacy input preferences cannot weaken an Agent action or its following task', async t => {
  const { controller, calls } = mock(t)
  const baseRevision = controller.snapshot().revision ?? 0
  await controller.applySettings({ ...createDefaultBrowserAutomation(), protect_input: false }, baseRevision + 1)
  const finishA = deferred()
  const finishB = deferred()
  const a = controller.run({}, async () => { await finishA.promise })
  await tick()
  const applying = controller.applySettings(createDefaultBrowserAutomation(), baseRevision + 2)
  let bStarted = false
  const b = controller.run({}, async () => { bStarted = true; await finishB.promise })
  await tick()
  assert.equal(bStarted, false)
  finishA.resolve()
  await a
  await applying
  await tick()
  assert.equal(bStarted, true)
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(calls.at(-1)!.protect, true)
  finishB.resolve()
  await b
})

test('cursor FPS applies during a long operation without releasing input protection', async t => {
  const { controller, wc } = mock(t)
  const rates: number[] = []
  const setFrameRate = wc.setVirtualCursorFrameRate
  wc.setVirtualCursorFrameRate = fps => { rates.push(fps); setFrameRate(fps) }
  const finish = deferred()
  const running = controller.run({}, async () => { await finish.promise })
  await tick()
  await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_fps: 30 }, (controller.snapshot().revision ?? 0) + 1)
  assert.equal(rates.at(-1), 30)
  assert.equal(controller.snapshot().inputProtected, true)
  finish.resolve()
  await running
})

test('failed protection acquisition performs no action and preserves the native error', async t => {
  const { controller } = mock(t, async (_enabled, protect) => { if (protect) throw Error('NATIVE_COMPOSITION_IN_PROGRESS') })
  let started = false
  await assert.rejects(controller.run({}, async () => { started = true }), /NATIVE_COMPOSITION_IN_PROGRESS/)
  assert.equal(started, false)
  assert.equal(controller.snapshot().inputProtected, false)
})

test('a completed operation cannot submit late work through inherited asynchronous context', async t => {
  const { controller } = mock(t)
  let old!: BrowserAutomationOperation
  await controller.run({}, async op => { old = op })
  let dispatched = false
  await assert.rejects(old.commit(async () => { dispatched = true }), /invalidated/)
  await assert.rejects(old.track(async () => { dispatched = true }), /invalidated/)
  assert.throws(() => old.registerCleanup(async () => {}), /invalidated/)
  assert.equal(dispatched, false)
})

test('failed held-input cleanup during transfer leaves a visible paused error and does not move the view', async t => {
  const { controller } = mock(t)
  const running = controller.run({}, async op => {
    op.registerCleanup(async () => { throw Error('release failed') })
    await new Promise<void>(resolve => op.signal.addEventListener('abort', () => resolve(), { once: true }))
  })
  const cancelled = assert.rejects(running, /invalidated|manual_control/)
  await tick()
  let moved = false
  await assert.rejects(controller.withTransfer(() => { moved = true }), /cleanup_unconfirmed/)
  await cancelled
  assert.equal(moved, false)
  assert.equal(controller.snapshot().owner, 'paused')
  assert.equal(controller.snapshot().activity, 'error')
  assert.equal(controller.snapshot().error, 'cleanup_unconfirmed')
})

test('a failed provisional reload cannot clear uncertain input cleanup', async t => {
  const { controller, events } = mock(t)
  await assert.rejects(controller.run({}, async op => {
    op.registerCleanup(async () => { throw Error('release failed') })
  }), /cleanup_unconfirmed/)
  events.emit('did-start-navigation', {}, 'https://example.test', false, true)
  events.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.test', true)
  await assert.rejects(controller.resume(), { code: 'cleanup_unconfirmed' })
  assert.equal(controller.snapshot().error, 'cleanup_unconfirmed')
  events.emit('did-start-navigation', {}, 'https://example.test', false, true)
  events.emit('did-navigate', {}, 'https://example.test', 200, 'OK')
  assert.equal(controller.snapshot().error, undefined)
  assert.equal(controller.snapshot().activity, 'idle')
  assert.equal((await controller.resume()).owner, 'ai')
  assert.equal(controller.needsObservation(), true)
})

test('successful nested summaries cannot replace evidence of partial delivery', async t => {
  const { controller } = mock(t)
  await assert.rejects(controller.run({}, async () => ({
    ok: false, status: 'failed', deliveryWarning: 'PARTIAL_CLICK_SEQUENCE',
    dispatch: { status: 'completed', dispatchedCount: 24 },
    clickDispatch: { status: 'dispatched' },
  })), error => {
    assert.equal((error as { lastResult: { reason: string } }).lastResult.reason, 'PARTIAL_CLICK_SEQUENCE')
    return true
  })
})

test('an older native handoff confirmation cannot publish over a newer control request', async t => {
  const close = deferred()
  let held = false
  const { controller } = mock(t, async enabled => { if (!enabled && held) await close.promise })
  await controller.run({}, async () => {})
  held = true
  const first = controller.takeControl()
  await tick()
  const second = controller.pause()
  const epoch = controller.captureEpoch()
  const published: { owner: string; activity: string }[] = []
  controller.bind({ onChanged: state => { published.push(state) } })
  close.resolve()
  await first
  // The earlier request may return the newer pending state; it cannot report
  // its obsolete user handoff as completed while the pause is still queued.
  assert.equal(published.some(state => state.owner === 'user' && state.activity === 'idle'), false)
  assert.equal(controller.captureEpoch(), epoch)
  await second
  assert.equal(controller.snapshot().owner, 'paused')
})

test('real input during idle invalidates a fresh observation and pending permission epoch', async t => {
  const { controller, events } = mock(t)
  const epoch = controller.captureEpoch()
  controller.noteObservation(epoch, controller.captureDocumentEpoch())
  let invalidated = false
  controller.watchEpoch(epoch, () => { invalidated = true })
  events.emit('before-input-event', {}, { type: 'keyDown', key: 'a' })
  assert.equal(invalidated, true)
  assert.equal(controller.needsObservation(), true)
  await tick()
  assert.equal(controller.snapshot().owner, 'paused')
})

test('control transitions wait for already submitted work outside an active action', async t => {
  for (const kind of ['takeover', 'transfer', 'settings', 'finish', 'resume']) {
    const { controller, calls } = mock(t)
    if (kind === 'resume') await controller.pause()
    else await controller.run({}, async () => {})
    const nativeWork = deferred()
    assert.equal(controller.trackPending(nativeWork.promise), nativeWork.promise)
    assert.equal(controller.isBusy(), true)
    const callCount = calls.length
    let moved = false
    const transition = kind === 'takeover' ? controller.takeControl()
      : kind === 'transfer' ? controller.withTransfer(() => { moved = true })
      : kind === 'settings' ? controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false }, (controller.snapshot().revision ?? 0) + 1)
      : kind === 'finish' ? controller.finishRun()
      : controller.resume()
    let done = false
    const result = transition.then(() => { done = true })
    await tick()
    assert.equal(done, false, kind)
    assert.equal(moved, false, kind)
    assert.equal(calls.length, callCount, kind)
    nativeWork.resolve()
    await result
    assert.equal(controller.isBusy(), false, kind)
    if (kind === 'transfer') assert.equal(moved, true)
  }
})

test('an unconfirmed external navigation stop blocks handoff readiness with its native reason', async t => {
  const { controller } = mock(t)
  const navigation = deferred()
  controller.trackPending(navigation.promise)
  const handoff = controller.takeControl()
  controller.markUncertain('navigation_stop_unconfirmed')
  navigation.resolve()
  const state = await handoff
  assert.equal(state.owner, 'paused')
  assert.equal(state.activity, 'error')
  assert.equal(state.error, 'cleanup_unconfirmed')
  assert.equal(state.lastResult?.reason, 'navigation_stop_unconfirmed')
  await assert.rejects(controller.resume(), { code: 'cleanup_unconfirmed' })
})

test('temporary annotation manual control does not turn its restored AI permission into a pause', async t => {
  const { controller, events } = mock(t)
  let annotationManual = false
  controller.bind({ getManualControl: () => annotationManual })
  await controller.withTransfer(() => { annotationManual = true })
  const epoch = controller.captureEpoch()
  events.emit('before-mouse-event', {}, { type: 'mouseDown' })
  assert.equal(controller.captureEpoch(), epoch)
  assert.equal(controller.snapshot().owner, 'user')
  annotationManual = false
  await controller.run({}, async () => {})
  assert.equal(controller.snapshot().owner, 'ai')
  assert.equal(controller.needsObservation(), true)
})

test('idle geometry invalidates queued coordinates and permissions without permanently pausing AI', async t => {
  const { controller } = mock(t)
  const epoch = controller.captureEpoch()
  let invalidated = false, ran = false
  controller.watchEpoch(epoch, () => { invalidated = true })
  const queued = controller.run({ expectedEpoch: epoch }, async () => { ran = true })
  controller.geometryChanged()
  await assert.rejects(queued, /invalidated/)
  assert.equal(invalidated, true)
  assert.equal(ran, false)
  assert.equal(controller.snapshot().owner, 'ai')
  assert.equal(controller.needsObservation(), true)
  await controller.run({}, async () => { ran = true })
  assert.equal(ran, true)
})

test('geometry preserves manual gates and a transfer can finish after changing its own geometry', async t => {
  const manual = mock(t)
  await manual.controller.takeControl()
  manual.controller.geometryChanged()
  assert.equal(manual.controller.snapshot().owner, 'user')
  await assert.rejects(manual.controller.run({}, async () => {}), /manual_control/)
  const ai = mock(t)
  await ai.controller.withTransfer(() => { ai.controller.geometryChanged() })
  assert.equal(ai.controller.snapshot().owner, 'ai')
  assert.equal(ai.controller.snapshot().activity, 'idle')
  await ai.controller.run({}, async () => {})
})

test('geometry invalidation cannot strand a pending settings transition behind a permanent gate', async t => {
  const { controller } = mock(t)
  const config = { ...createDefaultBrowserAutomation(), show_virtual_cursor: false }
  const applying = controller.applySettings(config, (controller.snapshot().revision ?? 0) + 1)
  controller.geometryChanged()
  await applying
  assert.equal(controller.snapshot().owner, 'ai')
  assert.equal(controller.snapshot().cursorEnabled, false)
  await controller.run({}, async () => {})
})

test('a previous chat finishing cannot release protection acquired by a newer action', async t => {
  const { controller } = mock(t)
  await controller.run({}, async () => {})
  const finishing = controller.finishRun()
  const release = deferred()
  const running = controller.run({}, async () => { await release.promise })
  await finishing
  await tick()
  assert.equal(controller.snapshot().activeOperations, 1)
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().activity, 'acting')
  release.resolve()
  await running
})

test('overdue handoff reports submitted input and waits for real completion before unlocking',async t=>{
  const {controller}=mock(t),entered=deferred(),held=deferred()
  controller.bind({controlWaitWarningMs:5})
  const running=controller.run({runId:'delayed-input'},async operation=>{entered.resolve();await operation.commit(()=>held.promise);operation.assertCurrent()})
  const observedFailure=running.catch(()=>{})
  await entered.promise
  let released=false
  const taking=controller.takeControl().then(state=>{released=true;return state})
  await new Promise(resolve=>setTimeout(resolve,15))
  const waiting=controller.snapshot()
  assert.equal(waiting.controlWait?.stage,'submitted-input');assert.equal(waiting.controlWait?.overdue,true)
  assert.equal(waiting.controlWait?.committedInputs,1);assert.equal(waiting.inputProtected,false)
  assert.equal(waiting.owner,'ai');assert.equal(released,false)
  held.resolve();await observedFailure
  const finished=await taking
  assert.equal(finished.owner,'user');assert.equal(finished.inputProtected,false);assert.equal(finished.controlWait,undefined)
})

test('late native release remains unconfirmed without faking a timeout unlock',async t=>{
  const held=deferred(),entered=deferred()
  const {controller}=mock(t,async(_enabled,protect)=>{if(!protect){entered.resolve();await held.promise}})
  controller.bind({controlWaitWarningMs:5})
  await controller.claimRun('native-wait')
  const taking=controller.takeControl()
  await entered.promise;await new Promise(resolve=>setTimeout(resolve,15))
  const waiting=controller.snapshot()
  assert.equal(waiting.controlWait?.stage,'native');assert.equal(waiting.controlWait?.overdue,true)
  assert.equal(waiting.nativePending,true);assert.equal(waiting.inputProtected,true);assert.equal(waiting.owner,'ai')
  held.resolve();await taking
  assert.equal(controller.snapshot().owner,'user');assert.equal(controller.snapshot().controlWait,undefined)
})

test('a full Agent lease isolates focus and rendering through waits despite disabled legacy preferences and hidden drawing', async t => {
  const fixture = mock(t)
  const { controller, configurations } = fixture
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false, protect_input: false }, 1)
  const before = fixture.resets
  await controller.claimRun('isolated-task')
  await controller.run({ runId: 'isolated-task' }, async operation => {
    await operation.setActivity('waiting', '等待网页')
    const state = controller.snapshot()
    assert.equal(state.isolateInput, true); assert.equal(state.keepRendering, true)
    assert.equal(state.inputProtected, true); assert.equal(state.cursorEnabled, false)
    assert.deepEqual(state.rendering, { viewAvailable: true, keepAlive: true, requestedBackgroundThrottling: true, effectiveBackgroundThrottling: false })
  })
  await tick()
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false, protect_input: false, cursor_fps: 30 }, 2)
  await controller.run({ runId: 'isolated-task' }, async () => {})
  assert.equal(fixture.resets, before, 'No reset may occur between tools or while the model waits')
  assert.ok(configurations.every(options => options.isolateInput && options.blockRealPointer && options.blockRealKeyboard && options.keepRendering))
  await controller.finishRun('isolated-task')
  assert.equal(fixture.resets, before + 1)
  const released = controller.snapshot()
  assert.equal(released.isolateInput, false); assert.equal(released.keepRendering, false)
  assert.equal(released.inputProtected, false); assert.equal(released.nativeConfirmed, true)
})

test('a successful native configuration Promise cannot authorize input when the readback disagrees', async t => {
  for (const cause of ['isolation', 'rendering'] as const) {
    const { controller, wc, nativeState } = mock(t)
    const configure = wc.setAutomationOptions
    wc.setAutomationOptions = async options => {
      await configure(options)
      if (options.isolateInput) {
        if (cause === 'isolation') nativeState.isolateInput = false
        else nativeState.rendering.keepAlive = false
      }
    }
    let acted = false
    await assert.rejects(controller.run({ runId: cause }, async () => { acted = true }),
      cause === 'isolation' ? /automation_configuration_unconfirmed/ : /automation_rendering_unavailable/)
    assert.equal(acted, false)
    assert.equal(controller.snapshot().leaseRunId, undefined, 'A failed acquisition releases only after an explicit reset')
    assert.equal(controller.snapshot().nativeConfirmed, true)
  }
})

test('reset rejection never confirms a safe handoff even if its readback already looks released', async t => {
  const { controller, wc } = mock(t)
  await controller.claimRun('reset-reject')
  const reset = wc.resetAutomationOptions
  wc.resetAutomationOptions = async () => { await reset(); throw Error('cleanup acknowledgement failed') }
  const failed = await controller.takeControl()
  assert.equal(failed.owner, 'paused'); assert.equal(failed.error, 'release_unconfirmed')
  assert.equal(failed.inputProtected, false); assert.equal(failed.nativeConfirmed, false)
  assert.equal(failed.leaseRunId, 'reset-reject', 'An unconfirmed release keeps the task credential until recovery')
  wc.resetAutomationOptions = reset
  const recovered = await controller.retryRelease()
  assert.equal(recovered.owner, 'user'); assert.equal(recovered.nativeConfirmed, true)
  assert.equal(recovered.leaseRunId, undefined)
})

test('reset completion is checked for residual native input before granting manual control', async t => {
  const { controller, wc, nativeState } = mock(t)
  await controller.claimRun('held-input')
  const reset = wc.resetAutomationOptions
  wc.resetAutomationOptions = async () => { await reset(); nativeState.inputActive = true }
  const state = await controller.takeControl()
  assert.equal(state.owner, 'paused'); assert.equal(state.nativeConfirmed, false)
  assert.equal(state.error, 'release_unconfirmed')
})

test('annotation reservation releases all native modes and restores the full lease independently of drawing', async t => {
  const { controller, nativeState } = mock(t)
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false, protect_input: false }, 1)
  await controller.claimRun('annotation-isolation')
  const token = await controller.acquireManualSession()
  for (const field of ['isolateInput', 'blockRealPointer', 'blockRealKeyboard', 'keepRendering'] as const) assert.equal(nativeState[field], false)
  assert.equal(controller.snapshot().owner, 'user')
  const restored = await controller.releaseManualSession(token)
  assert.equal(restored.restored, true)
  for (const field of ['isolateInput', 'blockRealPointer', 'blockRealKeyboard', 'keepRendering'] as const) assert.equal(nativeState[field], true)
  assert.equal(nativeState.virtualCursor.enabled, false)
})

test('finishing an old task cannot reset a newly acquired lease', async t => {
  const fixture = mock(t)
  await fixture.controller.claimRun('first')
  await fixture.controller.finishRun('first')
  await fixture.controller.claimRun('second')
  const resets = fixture.resets
  await fixture.controller.finishRun('first')
  await fixture.controller.finishRun()
  assert.equal(fixture.resets, resets)
  assert.equal(fixture.controller.snapshot().leaseRunId, 'second')
  assert.equal(fixture.controller.snapshot().isolateInput, true)
  assert.equal(fixture.controller.snapshot().keepRendering, true)
})

test('explicit takeover resets a submitted native queue before waiting and retains its cancellation receipt', async t => {
  const fixture = mock(t)
  const order: string[] = []
  let cancelNative!: () => void
  const native = new Promise<void>((_resolve, reject) => { cancelNative = () => reject(Error('AUTOMATION_RESET')) })
  const entered = deferred()
  const reset = fixture.wc.resetAutomationOptions
  fixture.wc.resetAutomationOptions = async () => { order.push('reset'); await reset(); cancelNative() }
  const running = fixture.controller.run({ runId: 'cancel-native' }, async operation => {
    operation.registerCleanup(async () => { order.push('cleanup') })
    entered.resolve()
    await operation.commit(() => native)
  })
  const rejected = assert.rejects(running, /AUTOMATION_RESET/)
  await entered.promise
  const state = await fixture.controller.takeControl()
  await rejected
  assert.deepEqual(order, ['reset', 'cleanup'])
  assert.equal(state.owner, 'user'); assert.equal(state.nativeConfirmed, true)
  assert.equal(state.error, undefined)
  assert.equal(state.lastResult?.reason, 'AUTOMATION_RESET')
  assert.equal(state.lastResult?.dispatchedCount, null, 'The unknown partial count remains available to callers')
})

test('ordinary task completion settles submitted native work before resetting its channel', async t => {
  const fixture = mock(t)
  const entered = deferred(), native = deferred()
  const running = fixture.controller.run({ runId: 'complete-native' }, async operation => {
    entered.resolve()
    await operation.commit(() => native.promise)
  })
  await entered.promise
  const resets = fixture.resets
  let finished = false
  const finishing = fixture.controller.finishRun('complete-native').then(() => { finished = true })
  await tick()
  assert.equal(fixture.resets, resets)
  assert.equal(finished, false)
  assert.equal(fixture.controller.snapshot().inputProtected, true)
  native.resolve()
  await running; await finishing
  assert.equal(fixture.resets, resets + 1)
  assert.equal(fixture.controller.snapshot().leaseRunId, undefined)
})

test('legacy release callbacks wait for a native cancellation reset to finish before submitting input', async t => {
  const fixture = mock(t), entered = deferred(), resetGate = deferred()
  let cancelNative!: () => void
  const native = new Promise<void>((_resolve, reject) => { cancelNative = () => reject(Error('AUTOMATION_RESET')) })
  let resetting = false, cleaned = false
  const reset = fixture.wc.resetAutomationOptions
  fixture.wc.resetAutomationOptions = async () => {
    resetting = true; cancelNative(); await resetGate.promise; await reset(); resetting = false
  }
  const running = fixture.controller.run({ runId: 'cleanup-barrier' }, async operation => {
    operation.registerCleanup(async context => {
      if (resetting) throw Error('AUTOMATION_RESET_IN_PROGRESS')
      assert.equal(context?.nativeResetConfirmed, true)
      cleaned = true
    })
    entered.resolve(); await operation.commit(() => native)
  })
  const rejected = assert.rejects(running, /AUTOMATION_RESET/)
  await entered.promise
  const takeover = fixture.controller.takeControl()
  await tick()
  assert.equal(resetting, true); assert.equal(cleaned, false)
  resetGate.resolve()
  const state = await takeover; await rejected
  assert.equal(cleaned, true); assert.equal(state.owner, 'user'); assert.equal(state.error, undefined)
})

test('Agent stop cancels only its matching lease and shares one failed reset with finally', async t => {
  const fixture = mock(t)
  await fixture.controller.claimRun('current')
  const epoch = fixture.controller.captureEpoch(), resets = fixture.resets
  await fixture.controller.cancelRun('old')
  assert.equal(fixture.controller.captureEpoch(), epoch)
  assert.equal(fixture.resets, resets)
  fixture.wc.resetAutomationOptions = async () => { throw Error('reset failed') }
  const first = fixture.controller.cancelRun('current')
  const duplicate = fixture.controller.cancelRun('current')
  assert.equal(first, duplicate)
  await assert.rejects(first, /release_unconfirmed/)
  assert.equal(fixture.controller.snapshot().leaseRunId, 'current')
  assert.equal(fixture.controller.snapshot().nativeConfirmed, false)
  assert.equal(fixture.controller.cancelRun('current'), first, 'finally cannot silently retry an unconfirmed reset')
})

test('stopping the Agent during an annotation reservation leaves manual input usable and prevents lease restoration', async t => {
  const fixture = mock(t)
  await fixture.controller.claimRun('annotated-task')
  const token = await fixture.controller.acquireManualSession()
  const resets = fixture.resets, epoch = fixture.controller.captureEpoch()
  await fixture.controller.cancelRun('annotated-task')
  assert.equal(fixture.resets, resets)
  assert.equal(fixture.controller.captureEpoch(), epoch)
  assert.equal(fixture.controller.snapshot().owner, 'user')
  const released = await fixture.controller.releaseManualSession(token)
  assert.equal(released.restored, false)
  assert.equal(released.state.owner, 'user'); assert.equal(released.state.leaseRunId, undefined)
  assert.equal(released.state.isolateInput, false)
})

test('cleanup can forget held input only after reset and native readback both confirm it was cleared', async t => {
  for (const mode of ['confirmed', 'rejected', 'residual-input'] as const) {
    const fixture = mock(t), entered = deferred()
    let cancelNative!: () => void
    const native = new Promise<void>((_resolve, reject) => { cancelNative = () => reject(Error('AUTOMATION_RESET')) })
    const confirmations: boolean[] = []
    const reset = fixture.wc.resetAutomationOptions
    fixture.wc.resetAutomationOptions = async () => {
      cancelNative(); await reset()
      if (mode === 'rejected') throw Error('reset acknowledgement failed')
      if (mode === 'residual-input') fixture.nativeState.inputActive = true
    }
    const running = fixture.controller.run({ runId: mode }, async operation => {
      operation.registerCleanup(async context => { confirmations.push(context?.nativeResetConfirmed === true) })
      entered.resolve(); await operation.commit(() => native)
    })
    const rejected = assert.rejects(running, /AUTOMATION_RESET/)
    await entered.promise
    const state = await fixture.controller.takeControl(); await rejected
    assert.deepEqual(confirmations, [mode === 'confirmed'])
    assert.equal(state.owner, mode === 'confirmed' ? 'user' : 'paused')
    assert.equal(state.nativeConfirmed, mode === 'confirmed')
  }
  const fixture = mock(t)
  let ordinaryConfirmation: boolean | undefined
  await fixture.controller.run({}, async operation => {
    operation.registerCleanup(async context => { ordinaryConfirmation = context?.nativeResetConfirmed })
  })
  assert.equal(ordinaryConfirmation, false, 'Ordinary completion still releases its own input before reset')
})
