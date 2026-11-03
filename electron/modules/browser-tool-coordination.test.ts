import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import type { ToolExecContext } from './browser-tools'
import { getBrowserAutomationController, BrowserAutomationError } from './browser-automation-controller'
import { captureBrowserIntentEpochs, coordinateBrowserTool, trackBrowserSideEffect, withBrowserIntentCancellation } from './browser-tool-coordination'
import { attachBrowserNativeRefs, resolveBrowserNativeRef } from './browser-native-refs'
import { normalizeBrowserToolCall } from '../../shared/browser-tool-policy'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
let id = 100
function fixture(count = 1) {
  const pages = Array.from({ length: count }, (_, index) => {
    const wc = Object.assign(new EventEmitter(), {
      id: id++, isDestroyed: () => false,
      setVirtualCursorEnabled: async () => {}, setVirtualCursorFrameRate: () => {},
    }) as unknown as WebContents
    const win = { webContents: wc, activeOperations: 0, manager: { flushLayout() {} }, isDestroyed: () => false }
    return { windowId: `w${index}`, chatId: 'chat', win, sessionId: 'session' }
  })
  const registry = {
    getTree: () => [{ sessionId: 'session', windows: pages.map(page => ({ windowId: page.windowId })) }],
    getWindowRecord: (windowId: string) => pages.find(page => page.windowId === windowId),
    assertWindowOwned: (_chat: string, windowId: string) => {
      const page = pages.find(item => item.windowId === windowId)
      if (!page) throw new Error('window_not_found')
      return page
    },
    assertSessionOwned: () => ({ windows: new Map(pages.map(page => [page.windowId, page])) }),
  }
  const ctx = { chatId: 'chat', signal: new AbortController().signal, registry } as unknown as ToolExecContext
  ctx.browserIntentEpochs = captureBrowserIntentEpochs(ctx.registry, ctx.chatId)
  return { ctx, pages, controller: getBrowserAutomationController(pages[0]!.win.webContents) }
}

test('permission approved after takeover cannot acquire or dispatch the old action', async () => {
  const { ctx, controller } = fixture()
  const permission = deferred()
  let dispatched = false
  const pending = withBrowserIntentCancellation('browser_click', { windowId: 'w0' }, ctx, async waiting => {
    await permission.promise
    return coordinateBrowserTool('browser_click', { windowId: 'w0' }, waiting, async () => { dispatched = true; return { ok: true } })
  })
  await controller.takeControl()
  permission.resolve()
  await assert.rejects(pending, error => error instanceof BrowserAutomationError)
  assert.equal(dispatched, false)
})

test('resume invalidates the entire captured model round instead of reviving remaining calls', async () => {
  const { ctx, controller } = fixture()
  await controller.pause(); await controller.resume()
  await assert.rejects(coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true })),
    error => error instanceof BrowserAutomationError && error.code === 'browser_operation_invalidated')
})

test('same URL navigation discards a queued coordinate action', async () => {
  const { ctx, controller, pages } = fixture()
  const entered = deferred(), release = deferred()
  const first = controller.run({ readOnly: true }, async () => { entered.resolve(); await release.promise })
  await entered.promise
  let dispatched = false
  const second = coordinateBrowserTool('browser_mouse', { windowId: 'w0' }, ctx, async () => { dispatched = true; return { ok: true } })
  ;(pages[0]!.win.webContents as unknown as EventEmitter).emit('did-start-navigation', {}, 'same-url', false, true)
  release.resolve(); await first
  await assert.rejects(second, error => error instanceof BrowserAutomationError && error.code === 'browser_document_changed')
  assert.equal(dispatched, false)
})

test('Flow child action reuses the parent lease and cannot deadlock behind itself', async () => {
  const { ctx, pages } = fixture()
  const order: string[] = []
  const result = await coordinateBrowserTool('browser_flow', { windowId: 'w0' }, ctx, async parent => {
    order.push('locate')
    await coordinateBrowserTool('browser_click', { windowId: 'w0' }, parent, async child => {
      assert.equal(child.browserOperations?.get('w0'), parent.browserOperations?.get('w0'))
      order.push('move', 'click'); return { ok: true }
    })
    order.push('verify'); return { ok: true }
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(order, ['locate', 'move', 'click', 'verify'])
  assert.equal(pages[0]!.win.activeOperations, 0)
})

test('multi-page session mutation rejects a user-owned page before starting any work', async () => {
  const { ctx, pages } = fixture(2)
  await getBrowserAutomationController(pages[1]!.win.webContents).takeControl()
  let changed = false
  await assert.rejects(coordinateBrowserTool('browser_session_clear', { sessionId: 'session' }, ctx, async () => { changed = true }),
    error => error instanceof BrowserAutomationError)
  assert.equal(changed, false)
  assert.equal(pages[0]!.win.activeOperations, 0)
})

test('an unprotected gap requires fresh observation before the next write', async () => {
  const { ctx } = fixture()
  await coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true }))
  await assert.rejects(coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true })),
    error => error instanceof BrowserAutomationError && error.code === 'browser_observation_required')
  await coordinateBrowserTool('browser_get', { windowId: 'w0', what: 'text' }, ctx, async () => ({ ok: true, value: 'current page' }))
  assert.deepEqual(await coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true })), { ok: true })
})

test('Agent task protection spans tools and does not lock unrelated pages', async () => {
  const { ctx, controller, pages } = fixture(2)
  ctx.browserRunId = 'agent-task'
  await coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true }))
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().leaseRunId, 'agent-task')
  assert.equal(controller.needsObservation(), false, 'A protected tool interval does not invalidate its own observation')
  assert.equal(getBrowserAutomationController(pages[1]!.win.webContents).snapshot().inputProtected, false)
  await coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async () => ({ ok: true }))
  await controller.finishRun('agent-task')
  assert.equal(controller.snapshot().inputProtected, false)
})

test('native short refs are page-scoped and invalidated by control or document change', async () => {
  const { controller, pages } = fixture(2)
  const wc = pages[0]!.win.webContents
  const target = { webContentsId: wc.id, processId: 1, routingId: 2, documentId: 3, backendNodeId: 4 }
  const observed = attachBrowserNativeRefs(wc, { elements: [{ target }] } as Electron.AgentSnapshot)
  const ref = observed.elements[0]!.ref
  assert.deepEqual(resolveBrowserNativeRef(wc, ref), target)
  assert.equal(resolveBrowserNativeRef(pages[1]!.win.webContents, ref), null)
  await controller.takeControl(); await controller.resume()
  assert.equal(resolveBrowserNativeRef(wc, ref), null)
})

test('aliases normalize their actual page and tool before permission/page classification', () => {
  assert.deepEqual(normalizeBrowserToolCall('tool', { name: 'computer_use', arguments: { action: 'click', windowId: 'w0', ref: 'n1e2' } }),
    { name: 'browser_click', args: { windowId: 'w0', ref: 'n1e2' } })
})

test('opposite page plugin scopes reject nested expansion instead of deadlocking', async () => {
  const { ctx, pages } = fixture(2)
  const bothEntered = deferred()
  let entries = 0
  const run = (windowId: string) => coordinateBrowserTool('browser_custom', { windowId }, ctx, async parent => {
    if (++entries === 2) bothEntered.resolve()
    await bothEntered.promise
    return coordinateBrowserTool('browser_session_clear', { sessionId: 'session' }, parent, async () => ({ ok: true }))
  })
  const results = await Promise.allSettled([run('w0'), run('w1')])
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'browser_nested_scope_expansion'))
  assert.equal(pages[0]!.win.activeOperations, 0)
  assert.equal(pages[1]!.win.activeOperations, 0)
})

test('native geometry stays locked until submitted cleanup actually settles', async () => {
  const { ctx, pages } = fixture()
  const cleaning = deferred(), acknowledgement = deferred()
  let layouts = 0
  pages[0]!.win.manager.flushLayout = () => { layouts++ }
  const pending = coordinateBrowserTool('browser_click', { windowId: 'w0' }, ctx, async parent => {
    parent.browserOperations!.get('w0')!.registerCleanup(async () => { cleaning.resolve(); await acknowledgement.promise })
    return { ok: true }
  })
  await cleaning.promise
  assert.equal(pages[0]!.win.activeOperations, 1)
  assert.equal(layouts, 0)
  acknowledgement.resolve(); await pending
  assert.equal(pages[0]!.win.activeOperations, 0)
  assert.equal(layouts, 1)
})

test('a timed out session side effect remains owned until its actual request settles', async () => {
  const { ctx, controller } = fixture(2)
  const submitted = deferred(), response = deferred()
  const request = coordinateBrowserTool('browser_session_fetch', { sessionId: 'session' }, ctx, async parent => {
    void trackBrowserSideEffect(parent, () => response.promise).catch(() => {})
    submitted.resolve()
    throw new Error('timeout:fetch')
  }).catch(error => error)
  await submitted.promise
  let manual = false
  const handoff = controller.takeControl().then(() => { manual = true })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(manual, false)
  response.resolve(); await request; await handoff
  assert.equal(manual, true)
})
