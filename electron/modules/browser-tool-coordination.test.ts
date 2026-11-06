import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import type { ToolExecContext } from './browser-tools'
import { getBrowserAutomationController, BrowserAutomationError } from './browser-automation-controller'
import { browserControlFailure, captureBrowserIntentEpochs, coordinateBrowserTool, trackBrowserSideEffect, withBrowserIntentCancellation } from './browser-tool-coordination'
import { attachBrowserNativeRefs, resolveBrowserNativeRef } from './browser-native-refs'
import { normalizeBrowserToolCall } from '../../shared/browser-tool-policy'
import { automationTestApi } from './browser-automation-test-api'

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
      ...automationTestApi(),
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
    assertSessionUsable: () => ({ windows: new Map(pages.map(page => [page.windowId, page])) }),
    isPublicSession:()=>false,
  }
  const ctx = { chatId: 'chat', signal: new AbortController().signal, registry } as unknown as ToolExecContext
  ctx.browserIntentEpochs = captureBrowserIntentEpochs(ctx.registry, ctx.chatId)
  return { ctx, pages, controller: getBrowserAutomationController(pages[0]!.win.webContents) }
}

function blockerFixture(){
  const f=fixture(2)
  const mainFrame={processId:1,routingId:1,framesInSubtree:[]}
  const sample={probes:[{verificationText:true,challengeControl:true,suspectedFrame:false,blockingContainer:true,foreground:true,visible:true,kind:'human_verification',partial:false}],frames:[],partial:false,layout:'1000x800'}
  Object.assign(f.pages[0]!.win.webContents,{mainFrame,executeJavaScriptInIsolatedWorld:async()=>sample})
  return {...f,sample}
}

test('cached title and URL are not successful reads after renderer exit',async()=>{
  const {ctx,pages}=fixture()
  Object.assign(pages[0]!.win.webContents,{isCrashed:()=>true})
  for(const what of ['title','url','agent_snapshot','agent_find']){
    let reads=0
    const result=await coordinateBrowserTool('browser_get',{windowId:'w0',what},ctx,async()=>{
      reads++;return{ok:true,value:'cached title'}
    }) as Record<string,unknown>
    assert.equal(reads,0)
    assert.deepEqual(result,{ok:false,dataRead:false,windowId:'w0',error:'render_process_gone'})
  }
})

test('renderer exit during a native read cannot return successful data',async()=>{
  for(const rejects of [false,true]){
    const {ctx,pages}=fixture()
    let crashed=false
    Object.assign(pages[0]!.win.webContents,{isCrashed:()=>crashed})
    const result=await coordinateBrowserTool('browser_get',{windowId:'w0',what:'agent_snapshot'},ctx,async()=>{
      crashed=true
      if(rejects)throw new Error('RENDER_PROCESS_GONE')
      return{ok:true,value:{complete:false,frames:[{reason:'RENDER_PROCESS_GONE'}],elements:[]}}
    }) as Record<string,unknown>
    assert.deepEqual(result,{ok:false,dataRead:false,windowId:'w0',error:'render_process_gone'})
  }
})

test('host detection retains readable DOM, pauses only blocked page and denies inputs/evaluate/session fetch',async()=>{
  const {ctx,pages,controller}=blockerFixture()
  const result=await coordinateBrowserTool('browser_get',{windowId:'w0',what:'text'},ctx,async()=>({ok:true,value:'Underlying products remain readable'})) as Record<string,unknown>
  assert.equal(result.ok,true);assert.equal((result.pageBlocker as {state:string}).state,'confirmed')
  assert.equal(controller.snapshot().owner,'paused')
  let dispatched=0
  for(const name of ['browser_click','browser_evaluate','browser_session_fetch','browser_navigate','browser_reload','browser_find','file_download','file_download_compose']){
    await assert.rejects(coordinateBrowserTool(name,['browser_session_fetch','file_download_compose'].includes(name)?{sessionId:'session'}:{windowId:'w0'},ctx,async()=>{dispatched++;return {ok:true}}),error=>error instanceof BrowserAutomationError&&error.code==='browser_page_blocked')
  }
  assert.equal(dispatched,0)
  for(const name of ['browser_session_fetch','file_download','file_download_compose'])await assert.rejects(coordinateBrowserTool(name,{url:'https://fixture.invalid/'},ctx,async()=>{dispatched++;return {ok:true}}),{code:'page_blocker_scope_required'})
  await assert.rejects(coordinateBrowserTool('file_download_compose',{windowId:'w1',dest:'fixture.txt',parts:[{url:'https://fixture.invalid/'}]},ctx,async()=>{dispatched++;return {ok:true}}),{code:'page_blocker_scope_required'})
  await assert.rejects(coordinateBrowserTool('browser_session_fetch',{windowId:'w1',url:'https://fixture.invalid/'},ctx,async()=>{dispatched++;return {ok:true}}),{code:'page_blocker_scope_required'})
  assert.equal(dispatched,0)
  assert.equal(getBrowserAutomationController(pages[1]!.win.webContents).snapshot().owner,'ai')
  await coordinateBrowserTool('browser_click',{windowId:'w1'},ctx,async()=>{dispatched++;return {ok:true}})
  assert.equal(dispatched,1)
})

test('user completion must pass host recheck, never launches/replays finished work, and old intents remain invalid',async()=>{
  const {ctx,controller,sample,pages}=blockerFixture()
  await coordinateBrowserTool('browser_get',{windowId:'w0'},ctx,async()=>({ok:true,value:'data'}))
  await controller.takeControl()
  await assert.rejects(controller.resume(),{code:'browser_page_blocked'})
  assert.equal(controller.snapshot().owner,'user')
  ;(pages[0]!.win.webContents as unknown as EventEmitter).emit('did-navigate-in-page')
  assert.equal(controller.snapshot().pageBlocker?.state,'unknown')
  assert.ok(controller.snapshot().pageBlocker?.previouslyBlockedAt)
  await assert.rejects(coordinateBrowserTool('browser_session_fetch',{url:'https://fixture.invalid/'},ctx,async()=>({ok:true})),{code:'page_blocker_scope_required'})
  sample.probes=[]
  await controller.resume()
  assert.equal(controller.snapshot().owner,'ai');assert.equal(controller.snapshot().needsObservation,true)
  let dispatched=0
  await assert.rejects(coordinateBrowserTool('browser_click',{windowId:'w0'},ctx,async()=>{dispatched++;return {ok:true}}),{code:'browser_operation_invalidated'})
  assert.equal(dispatched,0)
  assert.equal(controller.snapshot().pageBlocker?.state,'not_observed')
  assert.ok(controller.snapshot().pageBlocker?.clearedAt)
})

test('a background read cannot take manual ownership away, and stale probe cannot lock a changed document',async()=>{
  const {ctx,controller,pages}=blockerFixture()
  await controller.takeControl()
  await coordinateBrowserTool('browser_get',{windowId:'w0'},ctx,async()=>({ok:true}))
  assert.equal(controller.snapshot().owner,'user')
  const wc=pages[0]!.win.webContents
  Object.assign(wc,{executeJavaScriptInIsolatedWorld:async()=>{(wc as unknown as EventEmitter).emit('did-navigate-in-page');return {probes:[],frames:[],partial:false,layout:'1000x800'}}})
  await assert.rejects(coordinateBrowserTool('browser_get',{windowId:'w0'},ctx,async()=>({ok:true})),{code:'browser_document_changed'})
  assert.equal(controller.snapshot().pageBlocker?.state,'unknown')
})

test('operation diagnostics distinguish known document invalidation without guessing unknown takeover',()=>{
  const unknown=browserControlFailure(new BrowserAutomationError('browser_operation_invalidated'))
  assert.equal((unknown?.diagnostic as {cause:string}).cause,'unknown')
  const document=browserControlFailure(new BrowserAutomationError('browser_document_changed','changed',{expectedDocumentEpoch:1,actualDocumentEpoch:2,dispatched:false}))
  assert.equal((document?.diagnostic as {cause:string}).cause,'document_changed')
  assert.equal((document?.diagnostic as {dispatched:boolean}).dispatched,false)
})

test('a verification appearing while an action waits in the page queue is checked after acquiring its lease',async()=>{
  const {ctx,controller,sample}=blockerFixture()
  const blocked=sample.probes;sample.probes=[]
  const started=deferred(),release=deferred()
  const first=controller.run({readOnly:true},async()=>{started.resolve();await release.promise})
  await started.promise
  let dispatched=0
  const queued=coordinateBrowserTool('browser_click',{windowId:'w0'},ctx,async()=>{dispatched++;return {ok:true}})
  sample.probes=blocked;release.resolve();await first
  await assert.rejects(queued,{code:'browser_page_blocked'})
  assert.equal(dispatched,0);assert.equal(controller.snapshot().owner,'paused')
})

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
