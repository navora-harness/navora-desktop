import type { BrowserRegistry } from './browser-registry'
import type { ToolExecContext } from './browser-tools'
import {
  BrowserAutomationError, getBrowserAutomationController,
  type BrowserAutomationOperation,
} from './browser-automation-controller'
import { browserActionLabel, isBrowserObservation, isBrowserPageInput, isBrowserWriteTool, requiresBrowserObservation } from '../../shared/browser-tool-policy'
import { invalidatePointerMotion } from './pointer-motion'
import { assertBrowserInputCurrent, withBrowserInputOperation } from './browser-input-context'
import { observePageBlocker } from './page-blocker-observer'
import type { PageBlockerSummaryV1 } from '../../shared/page-blocker'
import {DEFAULT_BROWSER_SESSION_ID} from '../../shared/browser-session'

export type BrowserIntentToken = { webContentsId: number; epoch: number; documentEpoch: number }
export type BrowserIntentEpochs = ReadonlyMap<string, BrowserIntentToken>

export function captureBrowserIntentEpochs(registry: BrowserRegistry, chatId: string): BrowserIntentEpochs {
  const tokens = new Map<string, BrowserIntentToken>()
  for (const session of registry.getTree(chatId)) for (const page of session.windows) {
    const rec = registry.getWindowRecord(page.windowId)
    if (!rec || rec.win.isDestroyed()) continue
    const controller = getBrowserAutomationController(rec.win.webContents)
    tokens.set(page.windowId, {
      webContentsId: rec.win.webContents.id,
      epoch: controller.captureEpoch(), documentEpoch: controller.captureDocumentEpoch(),
    })
  }
  return tokens
}

function affectedPages(name: string, args: Record<string, unknown>, ctx: ToolExecContext) {
  if (!name.startsWith('browser_')&&!['file_download','file_download_compose'].includes(name)) return []
  if (typeof args.windowId === 'string' && args.windowId) return [ctx.registry.assertWindowOwned(ctx.chatId, args.windowId)]
  if(name==='browser_session_fetch'&&!args.sessionId){
    return ctx.registry.getTree(ctx.chatId).filter(session=>session.sessionId===DEFAULT_BROWSER_SESSION_ID).flatMap(session=>session.windows.flatMap(page=>{const record=ctx.registry.getWindowRecord(page.windowId);return record?[record]:[]}))
  }
  if (typeof args.sessionId === 'string' && args.sessionId) {
    const session=ctx.registry.assertSessionUsable(ctx.chatId,args.sessionId)
    // Shared mutations acquire their own global barrier after authorization, outside a page action.
    if(ctx.registry.isPublicSession(args.sessionId)&&new Set(['browser_session_clear','browser_session_set_proxy','browser_session_set_ua','browser_cookies_set','browser_cookies_remove']).has(name))return[]
    return [...session.windows.values()].filter(record=>record.chatId===ctx.chatId).sort((a, b) => a.windowId.localeCompare(b.windowId))
  }
  return []
}

/** Page takeover also cancels permission waits that have not acquired a lease. */
export async function withBrowserIntentCancellation<T>(
  name: string, args: Record<string, unknown>, ctx: ToolExecContext,
  action: (context: ToolExecContext) => Promise<T>,
): Promise<T> {
  const plugin = ctx.plugins?.ownsToolForChat(ctx.pluginScopeChatId || ctx.chatId, name) === true
  if (!isBrowserWriteTool(name) && !plugin) return action(ctx)
  const abort = new AbortController()
  const unsubscribe: (() => void)[] = []
  const pages = affectedPages(plugin ? 'browser_plugin' : name, args, ctx)
  try {
    for (const rec of pages) {
      const controller = getBrowserAutomationController(rec.win.webContents)
      const token = ctx.browserIntentEpochs?.get(rec.windowId)
      if (token && token.webContentsId !== rec.win.webContents.id) throw new BrowserAutomationError('browser_operation_invalidated')
      unsubscribe.push(controller.watchEpoch(token?.epoch ?? controller.captureEpoch(), () => abort.abort()))
    }
    const signal = AbortSignal.any([ctx.signal, abort.signal])
    if (signal.aborted) throw new BrowserAutomationError('browser_operation_invalidated')
    return await action({ ...ctx, signal })
  } finally { for (const off of unsubscribe) off() }
}

export function browserControlFailure(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof BrowserAutomationError)) return null
  return {
    ok: false, error: error.code, status: 'cancelled', retryable: false,
    requiresObservation: true,
    hint: ['browser_page_blocked','browser_page_unverified','page_blocker_scope_required'].includes(error.code)
      ? error.message
      : error.code === 'browser_observation_required'
      ? '先重新读取此页面，再根据当前状态创建新操作。不要直接重试旧坐标或旧 Flow。'
      : error.code === 'browser_nested_scope_expansion'
        ? '不能在已持有页面的动作内再申请其他页面。请在独立的工具调用中执行多页面操作。'
        : '此页面的旧操作已经停止。等待用户恢复后重新读取页面，再创建新操作；不要重试旧点击或旧 Flow。',
    message: error.message,
    diagnostic: error.diagnostic,
    ...(error.pageBlocker?{pageBlocker:error.pageBlocker}:{}),
    ...('lastResult' in error ? { partialResult: error.lastResult } : {}),
  }
}

/** Acquire pages in stable order; nested Flow calls reuse their existing lease. */
async function coordinateBrowserToolCore<T>(
  name: string, args: Record<string, unknown>, ctx: ToolExecContext,
  body: (context: ToolExecContext) => Promise<T>,
): Promise<T> {
  const pages = affectedPages(name, args, ctx)
  const write = isBrowserWriteTool(name)
  if (!write) {
    const observed = pages.map(rec => ({
      controller: getBrowserAutomationController(rec.win.webContents),
      epoch: getBrowserAutomationController(rec.win.webContents).captureEpoch(),
      documentEpoch: getBrowserAutomationController(rec.win.webContents).captureDocumentEpoch(),
    }))
    const result = await body(ctx)
    const observationSucceeded = result && typeof result === 'object' && 'ok' in result && result.ok === true &&
      !('waitTimedOut' in result && result.waitTimedOut) && !('selectorFound' in result && result.selectorFound === false)
    if (isBrowserObservation(name, args) && observationSucceeded) {
      for (const item of observed) {
        if (item.controller.snapshot().owner === 'ai') item.controller.noteObservation(item.epoch, item.documentEpoch)
      }
    }
    return result
  }
  if (ctx.browserOperations?.size && pages.some(rec => !ctx.browserOperations?.has(rec.windowId))) {
    throw new BrowserAutomationError('browser_nested_scope_expansion')
  }
  // Check all affected pages before acquiring any to avoid holding one while a
  // different page is already owned by the user.
  for (const rec of pages) {
    const controller = getBrowserAutomationController(rec.win.webContents)
    const token = ctx.browserIntentEpochs?.get(rec.windowId)
    if (token && token.webContentsId !== rec.win.webContents.id) throw new BrowserAutomationError('browser_operation_invalidated')
    controller.assertEpoch(token?.epoch ?? controller.captureEpoch())
  }
  const enter = async (index: number, current: ToolExecContext): Promise<T> => {
    const rec = pages[index]
    if (!rec) return body(current)
    const controller = getBrowserAutomationController(rec.win.webContents)
    const nested = current.browserOperations?.get(rec.windowId)
    if (nested) {
      nested.assertCurrent()
      return enter(index + 1, current)
    }
    const token = current.browserIntentEpochs?.get(rec.windowId)
    let entered = false
    return controller.run({
      runId: current.browserRunId, claimInput: !!current.browserRunId,
      signal: current.signal, label: browserActionLabel(name, args),
      expectedEpoch: token?.epoch, expectedDocumentEpoch: token?.documentEpoch,
      readOnly: !isBrowserPageInput(name),
      allowDisposedCompletion: name === 'browser_window_close' || name === 'browser_session_close',
    }, async (operation: BrowserAutomationOperation) => {
      if (requiresBrowserObservation(name) && controller.needsObservation()) {
        throw new BrowserAutomationError('browser_observation_required')
      }
      const operations = new Map(current.browserOperations)
      operations.set(rec.windowId, operation)
      entered = true
      rec.win.activeOperations++
      const result = await withBrowserInputOperation(rec.win.webContents, operation, () => enter(index + 1, { ...current, signal: operation.signal, browserOperations: operations }))
      operation.noteResult(result)
      return result
    }).finally(() => {
      if (entered) {
        rec.win.activeOperations--
        rec.win.manager.flushLayout(rec.win)
      }
    })
  }
  return enter(0, ctx)
}

/** One gate shared by native tools, Flow children and browser plugin host calls. */
export async function coordinateBrowserTool<T>(
  name: string, args: Record<string, unknown>, ctx: ToolExecContext,
  body: (context: ToolExecContext) => Promise<T>,
): Promise<T> {
  const scopedWindow=name==='file_download'&&typeof args.windowId==='string'&&!!args.windowId.trim()
  const scopedSession=typeof args.sessionId==='string'&&!!args.sessionId.trim()
  if(['browser_session_fetch','file_download','file_download_compose'].includes(name)&&!scopedWindow&&!scopedSession){
    for(const session of ctx.registry.getTree(ctx.chatId))for(const page of session.windows){
      const rec=ctx.registry.getWindowRecord(page.windowId)
      if(!rec||rec.win.isDestroyed())continue
      const blocker=getBrowserAutomationController(rec.win.webContents).snapshot().pageBlocker
      if(blocker&&(blocker.requiresUser||blocker.previouslyBlockedAt&&blocker.state!=='not_observed')){
        const error=new BrowserAutomationError('page_blocker_scope_required',name!=='file_download'?'当前任务有等待本人处理的页面。会话请求及分段下载必须指定可用的 sessionId；网址或不受支持的 windowId 不能替代会话范围。':'当前任务有等待本人处理的页面。请明确指定不受阻页面的 windowId 或可用的 sessionId；不能省略页面范围改用请求或下载。',{dispatched:false})
        error.pageBlocker=blocker;throw error
      }
    }
  }
  const pages=affectedPages(name,args,ctx)
  // Title/URL can remain cached after a renderer exits. They are not a
  // successful page read, including when the process dies during the read.
  const readFailure=()=>{
    if(name!=='browser_get')return undefined
    for(const rec of pages){
      const wc=rec.win.webContents
      const destroyed=wc.isDestroyed()
      if(destroyed||typeof wc.isCrashed==='function'&&wc.isCrashed())return{
        ok:false,dataRead:false,windowId:rec.windowId,
        error:destroyed?'webcontents_destroyed':'render_process_gone',
      }
    }
    return undefined
  }
  const initialReadFailure=readFailure()
  if(initialReadFailure)return initialReadFailure as T
  const detectable=pages.filter(rec=>typeof rec.win.webContents.executeJavaScriptInIsolatedWorld==='function')
  const observe=async(rec:typeof pages[number], nativeSnapshot?:unknown, afterDispatch=false):Promise<PageBlockerSummaryV1>=>{
    const wc=rec.win.webContents,controller=getBrowserAutomationController(wc)
    const documentEpoch=controller.captureDocumentEpoch(),controlEpoch=controller.captureEpoch()
    const summary=await observePageBlocker(wc,{chatId:ctx.chatId,windowId:rec.windowId,documentEpoch,controlEpoch,nativeSnapshot})
    if(!controller.setPageBlocker(summary,()=>observe(rec))){
      const documentChanged=documentEpoch!==controller.captureDocumentEpoch()
      throw new BrowserAutomationError(documentChanged?'browser_document_changed':'browser_operation_invalidated','页面已变化，请重新观察。',{cause:documentChanged?'document_changed':'control_changed',stage:afterDispatch?'after_dispatch':'before_dispatch',expectedEpoch:controlEpoch,actualEpoch:controller.captureEpoch(),expectedDocumentEpoch:documentEpoch,actualDocumentEpoch:controller.captureDocumentEpoch(),...(afterDispatch?{}:{dispatched:false})})
    }
    return summary
  }
  const fail=(summary:PageBlockerSummaryV1):never=>{
    const blocked=summary.state==='confirmed'
    const error=new BrowserAutomationError(blocked?'browser_page_blocked':'browser_page_unverified',blocked?'此页面需要本人处理，已暂停。请接管页面，完成后点击重新检查；不要刷新、重试验证或改用请求绕过。':'尚未确认此前景页面可操作；只允许重新观察，不要重放旧输入。',{dispatched:false})
    error.pageBlocker=summary;throw error
  }
  const input=isBrowserPageInput(name)||requiresBrowserObservation(name)||['browser_session_fetch','browser_navigate','browser_reload','browser_back','browser_forward','browser_load_url_with_response','file_download','file_download_compose'].includes(name)
  if(input){
    for(const rec of detectable){
      // Known handoffs are checked before queueing. Every new action is checked again after its lease is acquired.
      if(!getBrowserAutomationController(rec.win.webContents).snapshot().pageBlocker?.requiresUser)continue
      const summary=await observe(rec)
      if(summary.state!=='not_observed'&&!(summary.state==='confirmed'&&!summary.requiresUser)){
        if(summary.requiresUser&&!ctx.browserOperations?.has(rec.windowId)&&getBrowserAutomationController(rec.win.webContents).snapshot().owner==='ai')await getBrowserAutomationController(rec.win.webContents).pause()
        fail(summary)
      }
    }
  }else if(name==='browser_get'){
    for(const rec of detectable){
      if(getBrowserAutomationController(rec.win.webContents).snapshot().pageBlocker?.requiresUser){
        const summary=await observe(rec)
        if(summary.requiresUser)fail(summary)
      }
    }
  }
  let result:T
  try{result=await coordinateBrowserToolCore(name,args,ctx,async current=>{
    if(input)for(const rec of detectable){
      const summary=await observe(rec)
      if(summary.state!=='not_observed'&&!(summary.state==='confirmed'&&!summary.requiresUser))fail(summary)
    }
    for(const operation of current.browserOperations?.values()||[])operation.assertCurrent()
    return body(current)
  })}catch(error){
    const failure=readFailure()
    if(failure)return failure as T
    if(!ctx.browserOperations?.size)for(const rec of detectable){
      const controller=getBrowserAutomationController(rec.win.webContents)
      if(controller.snapshot().pageBlocker?.requiresUser&&controller.snapshot().owner==='ai')await controller.pause()
    }
    throw error
  }
  const finalReadFailure=readFailure()
  if(finalReadFailure)return finalReadFailure as T
  if(['browser_get','browser_evaluate','browser_screenshot','browser_wait'].includes(name)&&detectable.length){
    const object=result&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:undefined
    const summary=await observe(detectable[0]!,name==='browser_get'?object?.value:undefined,name==='browser_evaluate')
    const observedReadFailure=readFailure()
    if(observedReadFailure)return observedReadFailure as T
    // The read itself has settled before requesting handoff, avoiding a lease/cleanup deadlock.
    const controller=getBrowserAutomationController(detectable[0]!.win.webContents)
    if(summary.requiresUser&&!ctx.browserOperations?.has(detectable[0]!.windowId)&&controller.snapshot().owner==='ai')await controller.pause()
    return {...object,pageBlocker:summary,...(name==='browser_evaluate'?{scriptCompleted:object?.ok===true}:name==='browser_get'?{dataRead:object?.ok===true}:{})} as T
  }
  return result
}

export function currentBrowserOperation(ctx: ToolExecContext, windowId: string) {
  const operation = ctx.browserOperations?.get(windowId)
  operation?.assertCurrent()
  if (ctx.signal.aborted) throw new BrowserAutomationError('browser_operation_invalidated')
  return operation
}

export async function commitBrowserInput<T>(ctx: ToolExecContext, windowId: string, action: () => Promise<T>): Promise<T> {
  const operation = currentBrowserOperation(ctx, windowId)
  const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
  assertBrowserInputCurrent(rec.win.webContents)
  const result = operation ? await operation.commit(action) : await action()
  operation?.noteResult(result)
  return result
}

/** Session requests can affect every page's cookies; all acquired owners wait
 * for the actual request even if the caller has stopped waiting for its result. */
export function trackBrowserSideEffect<T>(ctx: ToolExecContext, start: () => Promise<T>): Promise<T> {
  const operations = [...(ctx.browserOperations?.values() ?? [])]
  const track = (index: number): Promise<T> => operations[index]
    ? operations[index]!.track(() => track(index + 1)) : start()
  return track(0)
}

export function invalidateBrowserPointer(ctx: ToolExecContext, windowId: string): void {
  const rec = ctx.registry.getWindowRecord(windowId)
  if (rec && !rec.win.isDestroyed()) invalidatePointerMotion(rec.win.webContents)
}
