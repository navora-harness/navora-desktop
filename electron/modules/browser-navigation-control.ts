import type { WebContents } from 'electron'
import { BrowserAutomationError, getBrowserAutomationController } from './browser-automation-controller'
import { currentBrowserInputOperation } from './browser-input-context'

const navigationOwners = new WeakMap<WebContents, object>()
type NavigationControl = { stop(): boolean; onStop(listener: () => void): () => void }

/** Navigation cannot be cancelled by abandoning its JS promise. Stop its loader
 * on takeover and keep submitted work owned until the actual promise settles. */
export function startOwnedNavigation<T>(wc: WebContents, signal: AbortSignal | undefined, start: () => Promise<T>): Promise<T> {
  return ownNavigation(wc, signal, () => start())
}

function ownNavigation<T>(wc: WebContents, signal: AbortSignal | undefined, start: (control: NavigationControl) => Promise<T>): Promise<T> {
  const controller = getBrowserAutomationController(wc)
  const operation = currentBrowserInputOperation(wc)
  const epoch = operation?.epoch ?? controller.captureEpoch()
  controller.assertEpoch(epoch)
  const effectiveSignal = signal && operation?.signal && signal !== operation.signal
    ? AbortSignal.any([signal, operation.signal]) : signal ?? operation?.signal
  if (effectiveSignal?.aborted) return Promise.reject(new BrowserAutomationError('browser_operation_invalidated'))
  const owner = {}
  navigationOwners.set(wc, owner)
  let stopped = false
  const stopListeners = new Set<() => void>()
  const stop = () => {
    // A superseded request must never stop a later user/Agent navigation.
    if (navigationOwners.get(wc) !== owner) return false
    if (stopped) return true
    stopped = true
    for (const listener of stopListeners) listener()
    if (!wc.isDestroyed()) {
      try { wc.stop() }
      catch { controller.markUncertain('navigation_stop_unconfirmed') }
    }
    return true
  }
  const off = controller.watchEpoch(epoch, stop)
  effectiveSignal?.addEventListener('abort', stop, { once: true })
  const cleanup = () => {
    off(); effectiveSignal?.removeEventListener('abort', stop); stopListeners.clear()
    if (navigationOwners.get(wc) === owner) navigationOwners.delete(wc)
  }
  const submit = () => start({ stop, onStop: listener => { stopListeners.add(listener); return () => { stopListeners.delete(listener) } } })
  try { return (operation ? operation.track(submit) : controller.trackPending(submit())).finally(cleanup) }
  catch (error) { cleanup(); throw error }
}

/** goBack/goForward/reload return void. Own their actual main-frame lifecycle,
 * including same-document history, rather than treating submission as completion. */
export function startOwnedHistoryNavigation(
  wc: WebContents, signal: AbortSignal | undefined, start: () => void, timeoutMs: number,
): Promise<{ timedOut: boolean }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new RangeError('Invalid navigation timeout')
  return ownNavigation(wc, signal, control => new Promise((resolve, reject) => {
    let started = false, committed = false, settled = false, stopped = false, timedOut = false
    let failure: Error | undefined
    let stopDeadline: ReturnType<typeof setTimeout> | undefined
    const controller = getBrowserAutomationController(wc)
    const listeners: { event: string; listener: (...args: any[]) => void }[] = []
    const listen = (event: string, listener: (...args: any[]) => void) => {
      listeners.push({ event, listener }); wc.on(event as any, listener)
    }
    const clean = () => {
      clearTimeout(deadline); clearTimeout(stopDeadline); offStop()
      for (const { event, listener } of listeners) wc.removeListener(event as any, listener)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clean()
      if (error) reject(error)
      else if (stopped && !timedOut) reject(new BrowserAutomationError('browser_operation_invalidated'))
      else if (failure && !timedOut) reject(failure)
      else resolve({ timedOut })
    }
    const offStop = control.onStop(() => {
      stopped = true
      // Most stop requests acknowledge with did-stop-loading. Blank/no-op pages
      // may have no loading event, so also confirm the native loading state.
      stopDeadline = setTimeout(() => {
        if (wc.isDestroyed()) return finish(new BrowserAutomationError('browser_page_destroyed'))
        if (!wc.isLoadingMainFrame()) return finish()
        controller.markUncertain('navigation_stop_unconfirmed')
        finish(new BrowserAutomationError('navigation_stop_unconfirmed'))
      }, 1000)
    })
    const deadline = setTimeout(() => {
      timedOut = true
      if (!control.stop()) finish(new BrowserAutomationError('browser_operation_invalidated'))
    }, timeoutMs)
    listen('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame !== false) started = true })
    listen('did-navigate', () => { if (started) committed = true })
    listen('did-navigate-in-page', (_event, _url, isMainFrame) => { if (started && isMainFrame !== false) finish() })
    // A previous request can emit a final stop/finish after this submission.
    // A successful full navigation must have committed its own main document;
    // same-document history is acknowledged by did-navigate-in-page instead.
    listen('did-finish-load', () => { if (started && committed) { failure = undefined; finish() } })
    listen('did-stop-loading', () => { if (stopped || (started && (committed || failure))) finish() })
    const onFailure = (_event: unknown, _code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame !== false && started) failure = new Error(`navigation_failed:${description}`)
    }
    listen('did-fail-load', onFailure)
    listen('did-fail-provisional-load', onFailure)
    listen('destroyed', () => finish(new BrowserAutomationError('browser_page_destroyed')))
    listen('render-process-gone', () => finish(new BrowserAutomationError('renderer_gone')))
    try { start() } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  }))
}
