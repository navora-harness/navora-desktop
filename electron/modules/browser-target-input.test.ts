import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import { getBrowserAutomationController, BrowserAutomationError } from './browser-automation-controller'
import { withBrowserInputOperation } from './browser-input-context'
import { dispatchOwnedTargetMouse, dispatchOwnedTargetTouch } from './browser-target-input'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
let nextId = 500
function fixture() {
  const events: Record<string, unknown>[] = []
  const wc = Object.assign(new EventEmitter(), {
    id: nextId++, isDestroyed: () => false,
    setVirtualCursorEnabled: async () => {}, setVirtualCursorFrameRate: () => {},
    dispatchMouseEvent: async (event: Record<string, unknown>) => { events.push(event); return { status: 'dispatched', stage: 'event-dispatch' } },
    dispatchTouchEvent: async (event: Record<string, unknown>) => { events.push(event); return { status: 'dispatched', stage: 'event-dispatch' } },
  }) as unknown as WebContents
  const target = { webContentsId: wc.id, processId: 1, routingId: 2, documentId: 3, backendNodeId: 4 }
  return { wc, target, events, controller: getBrowserAutomationController(wc) }
}

test('legacy target press has an owned release before the action unlocks', async () => {
  const { wc, target, controller, events } = fixture()
  await controller.run({}, operation => withBrowserInputOperation(wc, operation, async () => {
    await dispatchOwnedTargetMouse(wc, { target, type: 'mousePressed', button: 'back', buttons: 8, x: 5, y: 6 })
    return { ok: true }
  }))
  assert.deepEqual(events.map(event => [event.type, event.buttons]), [['mousePressed', 8], ['mouseReleased', 0]])
  assert.deepEqual(events[1]!.target, target)
  assert.equal(controller.snapshot().inputProtected, false)
})

test('a successful explicit target release is never replayed by cleanup', async () => {
  const { wc, target, controller, events } = fixture()
  await controller.run({}, operation => withBrowserInputOperation(wc, operation, async () => {
    await dispatchOwnedTargetMouse(wc, { target, type: 'mousePressed', button: 'left', buttons: 1, x: 5, y: 6 })
    await dispatchOwnedTargetMouse(wc, { target, type: 'mouseReleased', button: 'left', buttons: 0, x: 9, y: 10 })
  }))
  assert.equal(events.filter(event => event.type === 'mouseReleased').length, 1)
})

test('takeover waits for target release acknowledgement before advertising manual control', async () => {
  const { wc, target, controller } = fixture()
  const pressed = deferred(), cleaning = deferred(), released = deferred()
  wc.dispatchMouseEvent = (async (event: Record<string, unknown>) => {
    if (event.type === 'mouseReleased') { cleaning.resolve(); await released.promise }
    return { status: 'dispatched', stage: 'event-dispatch' }
  }) as unknown as typeof wc.dispatchMouseEvent
  const action = controller.run({}, operation => withBrowserInputOperation(wc, operation, async () => {
    await dispatchOwnedTargetMouse(wc, { target, type: 'mousePressed', button: 'left', buttons: 1, x: 5, y: 6 })
    pressed.resolve()
    await new Promise<void>(resolve => operation.signal.addEventListener('abort', () => resolve(), { once: true }))
  })).catch(error => error)
  await pressed.promise
  const handoff = controller.takeControl()
  await cleaning.promise
  assert.notEqual(controller.snapshot().owner, 'user')
  released.resolve(); await action; await handoff
  assert.equal(controller.snapshot().owner, 'user')
})

test('replacement document never receives a stale target release', async () => {
  const { wc, target, controller, events } = fixture()
  await assert.rejects(controller.run({}, operation => withBrowserInputOperation(wc, operation, async () => {
    await dispatchOwnedTargetMouse(wc, { target, type: 'mousePressed', button: 'left', buttons: 1, x: 5, y: 6 })
    ;(wc as unknown as EventEmitter).emit('did-start-navigation', {}, 'same-url', false, true)
  })), error => error instanceof BrowserAutomationError && error.code === 'cleanup_unconfirmed')
  assert.equal(events.filter(event => event.type === 'mouseReleased').length, 0)
  assert.equal(controller.snapshot().owner, 'paused')
})

test('a legacy touch start is cancelled at the action boundary without another touch start', async () => {
  const { wc, target, controller, events } = fixture()
  await controller.run({}, operation => withBrowserInputOperation(wc, operation, async () => {
    await dispatchOwnedTargetTouch(wc, { target, type: 'touchStart', touchPoints: [{ id: 1, x: 5, y: 6 }] })
  }))
  assert.deepEqual(events.map(event => event.type), ['touchStart', 'touchCancel'])
  assert.deepEqual(events[1]!.touchPoints, [])
})
