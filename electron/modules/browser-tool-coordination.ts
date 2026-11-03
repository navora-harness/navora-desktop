import type { BrowserRegistry } from './browser-registry'
import type { ToolExecContext } from './browser-tools'
import {
  BrowserAutomationError, getBrowserAutomationController,
  type BrowserAutomationOperation,
} from './browser-automation-controller'
import { browserActionLabel, isBrowserObservation, isBrowserPageInput, isBrowserWriteTool, requiresBrowserObservation } from '../../shared/browser-tool-policy'
import { invalidatePointerMotion } from './pointer-motion'
import { assertBrowserInputCurrent, withBrowserInputOperation } from './browser-input-context'

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
  if (!name.startsWith('browser_')) return []
  if (typeof args.windowId === 'string' && args.windowId) return [ctx.registry.assertWindowOwned(ctx.chatId, args.windowId)]
  if (typeof args.sessionId === 'string' && args.sessionId) {
    return [...ctx.registry.assertSessionOwned(ctx.chatId, args.sessionId).windows.values()].sort((a, b) => a.windowId.localeCompare(b.windowId))
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
    hint: error.code === 'browser_observation_required'
      ? '先重新读取此页面，再根据当前状态创建新操作。不要直接重试旧坐标或旧 Flow。'
      : error.code === 'browser_nested_scope_expansion'
        ? '不能在已持有页面的动作内再申请其他页面。请在独立的工具调用中执行多页面操作。'
        : '此页面的旧操作已经停止。等待用户恢复后重新读取页面，再创建新操作；不要重试旧点击或旧 Flow。',
    message: error.message,
    ...('lastResult' in error ? { partialResult: error.lastResult } : {}),
  }
}

/** Acquire pages in stable order; nested Flow calls reuse their existing lease. */
export async function coordinateBrowserTool<T>(
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
