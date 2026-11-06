import type { WebContents } from 'electron'
import {randomUUID} from 'node:crypto'
import {
  createBrowserAutomationState, createDefaultBrowserAutomation, normalizeBrowserAutomation,
  type BrowserAutomationConfig, type BrowserAutomationState,
} from '../../shared/browser-automation'
import { invalidatePointerMotion } from './pointer-motion'
import { createBrowserCursorImage } from './browser-native-cursor'
import type { PageBlockerSummaryV1 } from '../../shared/page-blocker'

export type BrowserAutomationDiagnostic = {
  cause: 'control_changed' | 'document_changed' | 'geometry_changed' | 'run_cancelled' | 'page_destroyed' | 'renderer_gone' | 'native_cleanup_unconfirmed' | 'unknown'
  stage: 'before_dispatch' | 'after_dispatch' | 'cleanup'
  expectedEpoch?: number; actualEpoch?: number; expectedDocumentEpoch?: number; actualDocumentEpoch?: number
  dispatched?: boolean; requiresObservation: boolean
}

export class BrowserAutomationError extends Error {
  lastResult?: BrowserAutomationState['lastResult']
  pageBlocker?: PageBlockerSummaryV1
  readonly diagnostic: BrowserAutomationDiagnostic
  constructor(readonly code: string, message = code, diagnostic?: Partial<BrowserAutomationDiagnostic>) {
    super(message); this.name = 'BrowserAutomationError'
    const cause: BrowserAutomationDiagnostic['cause'] = code === 'browser_document_changed' ? 'document_changed' : code === 'browser_geometry_changed' ? 'geometry_changed' : code === 'browser_page_destroyed' ? 'page_destroyed' : code === 'renderer_gone' ? 'renderer_gone' : ['cleanup_unconfirmed','release_unconfirmed'].includes(code) ? 'native_cleanup_unconfirmed' : code === 'aborted' ? 'run_cancelled' : 'unknown'
    this.diagnostic = { cause, stage: cause === 'native_cleanup_unconfirmed' ? 'cleanup' : 'before_dispatch', requiresObservation: true, ...diagnostic }
  }
}
export type BrowserAutomationCleanupContext = {
  /** The same operation's native input was cleared by a successful reset and readback. */
  readonly nativeResetConfirmed: boolean
}
type BrowserAutomationCleanup = (context?: BrowserAutomationCleanupContext) => Promise<void>
export type BrowserAutomationOperation = {
  readonly signal: AbortSignal
  readonly epoch: number
  readonly documentEpoch: number
  assertCurrent(): void
  /** Track an already-submitted, possibly uncancellable native operation until it settles. */
  commit<T>(action: () => Promise<T>): Promise<T>
  /** Wait for submitted page work without interpreting a query/script failure as held input. */
  track<T>(action: () => Promise<T>): Promise<T>
  noteResult(result: unknown): void
  registerCleanup(cleanup: BrowserAutomationCleanup): () => void
  setActivity(activity: 'acting' | 'waiting', label?: string): Promise<void>
}
export type BrowserAutomationRunOptions = {
  /** Persistent page ownership belongs to a task, rather than one tool call. */
  runId?: string
  claimInput?: boolean
  signal?: AbortSignal
  label?: string
  expectedEpoch?: number
  expectedDocumentEpoch?: number
  readOnly?: boolean
  allowDisposedCompletion?: boolean
}
type ControllerOptions = {
  getSettings?: () => BrowserAutomationConfig
  onChanged?: (state: BrowserAutomationState) => void
  /** All action work, submitted external work and native barriers have drained. */
  onIdle?: () => void
  getManualControl?: () => boolean
  setManualControl?: (manual: boolean) => void
  getCursorImage?: typeof createBrowserCursorImage
  /** Waiting diagnostics do not time out or cancel submitted native input. */
  controlWaitWarningMs?: number
}
type CursorApi = {
  setAutomationOptions?: (options: Electron.AutomationOptions) => Promise<void>
  getAutomationState?: () => Electron.AutomationState
  resetAutomationOptions?: () => Promise<void>
  setVirtualCursorFrameRate?: (fps: number) => void
  setVirtualCursorImage?: (image: import('electron').NativeImage | null, options?: { hotspot: import('electron').Point }) => void
}
type Active = { abort: AbortController; commits: Set<Promise<unknown>>; nativeCommits: Set<Promise<unknown>>; cleanups: Set<BrowserAutomationCleanup>; nativeResetConfirmed: boolean; observedDocEpoch: number; accepting: boolean; cleaning?: boolean; submittedInput?: boolean }
export type BrowserManualSessionToken={id:string;generation:number;documentEpoch:number}
type ManualSession={token:BrowserManualSessionToken;owner:BrowserAutomationState['owner'];manual:boolean;gated:boolean;leaseRunId?:string;runEnded:boolean}
const controllers = new WeakMap<WebContents, BrowserAutomationController>()
const live = new Set<BrowserAutomationController>()
let settings = createDefaultBrowserAutomation()
let revision = 0

export function getBrowserAutomationSettings(): BrowserAutomationConfig { return { ...settings } }

/** Persisted preferences and per-page native application are deliberately separate results. */
export async function configureBrowserAutomation(next: BrowserAutomationConfig, nextRevision = revision + 1) {
  const normalized = normalizeBrowserAutomation(next)
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 0) throw new RangeError('Invalid automation revision')
  if (nextRevision <= revision) return { revision, pages: [...live].map(controller => controller.snapshot()) }
  settings = normalized
  revision = nextRevision
  const applied = await Promise.allSettled([...live].map(controller => controller.applySettings(normalized, nextRevision)))
  return { revision: nextRevision, pages: applied.map(result => result.status === 'fulfilled' ? result.value : { error: String(result.reason) }) }
}

export function getBrowserAutomationController(wc: WebContents, options?: ControllerOptions): BrowserAutomationController {
  let controller = controllers.get(wc)
  if (!controller) {
    controller = new BrowserAutomationController(wc, options)
    controllers.set(wc, controller)
  } else if (options) controller.bind(options)
  return controller
}

/** Observe only actual native pointer dispatches on an already-owned page. */
export function withBrowserPointerInput<T>(wc: WebContents, action: () => Promise<T>, confirmed: (result: T) => boolean): Promise<T> {
  return controllers.get(wc)?.pointerInput(action, confirmed) ?? action()
}

export class BrowserAutomationController {
  private state = createBrowserAutomationState()
  private options: ControllerOptions
  private config: BrowserAutomationConfig
  private tail: Promise<void> = Promise.resolve()
  private controls: Promise<void> = Promise.resolve()
  private nativeTail: Promise<void> = Promise.resolve()
  private admission: Promise<void> = Promise.resolve()
  private externalPending = new Set<Promise<unknown>>()
  private active?: Active
  private controlGeneration = 0
  private nativeCancellationGeneration?: number
  private nativeCancellationBarrier?: { generation: number; settled: Promise<void> }
  private gated = false
  private disposed = false
  private documentEpoch = 0
  private observationRequired = false
  private leaseRunId?: string
  private cancelledRun?: { id: string; settled: Promise<void> }
  private cursorImageKey?: string
  private cursorGeneration = 0
  private cursorPositionValid = false
  private unsafeCleanup = false
  private stateRevision = 0
  private wasBusy = false
  private controlWaitStartedAt?: number
  private controlWaitTimer?: ReturnType<typeof setTimeout>
  private manualSession?:ManualSession
  private epochWatchers = new Set<() => void>()
  private listeners: { event: string; fn: (...args: any[]) => void }[] = []
  private recheckPageBlocker?: () => Promise<PageBlockerSummaryV1>
  private blockerRecheck?: Promise<PageBlockerSummaryV1>

  constructor(private wc: WebContents, options: ControllerOptions = {}) {
    this.options = options
    this.config = normalizeBrowserAutomation(options.getSettings?.() ?? settings)
    this.state.revision = revision
    const api = wc as unknown as CursorApi
    this.state.cursorAvailable = !!(api.setAutomationOptions && api.getAutomationState && api.resetAutomationOptions)
    this.state.cursorImageAvailable = typeof api.setVirtualCursorImage === 'function'
    live.add(this)
    this.listen('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      this.invalidateCursorPosition()
      if (mainFrame === false || inPlace) return
      this.documentEpoch++
      this.expirePageBlocker('DOCUMENT_CHANGED')
      // The current action may itself navigate; its native result must still settle.
      if (!this.active) this.observationRequired = true
      invalidatePointerMotion(wc)
      this.publish()
    })
    // A provisional navigation can fail or be stopped with the old document
    // still alive. Only a committed replacement clears uncertain held input.
    this.listen('did-navigate', () => {
      this.unsafeCleanup = false
      if (this.state.error === 'cleanup_unconfirmed' && this.state.nativeConfirmed && !this.state.inputProtected) {
        this.state.error = undefined
        if (!this.active && !this.state.nativePending && this.state.activity !== 'handoff') {
          this.state.activity = 'idle'; this.state.handoffTarget = undefined
        }
      }
      this.publish()
    })
    this.listen('did-navigate-in-page', () => { this.invalidateCursorPosition(); this.documentEpoch++; this.expirePageBlocker('DOCUMENT_CHANGED'); invalidatePointerMotion(wc); this.publish() })
    this.listen('render-process-gone', () => {
      this.documentEpoch++; this.unsafeCleanup = false
      this.expirePageBlocker('RENDERER_GONE')
      this.invalidate('renderer_gone'); this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'renderer_gone'
      this.publish()
    })
    this.listen('destroyed', () => this.dispose())
    // Hover is never a handoff request. Real guest input is blocked by native
    // pointer/keyboard flags for the complete task lease, including model waits.
    const intervention = (_event: unknown, input?: { type?: string }) => {
      if (input?.type && /^(mouseMove[d]?|mouseEnter[ed]*|mouseLeave|mouseExit[ed]*|pointerMove[d]?|pointerEnter[ed]*|pointerLeave)$/i.test(input.type)) return
      if (this.disposed || this.active || this.options.getManualControl?.() || this.state.inputProtected || this.state.owner !== 'ai' || !['idle', 'waiting'].includes(this.state.activity)) return
      void this.pause().catch(() => {})
    }
    this.listen('before-mouse-event', intervention)
    this.listen('before-input-event', intervention)
  }

  bind(options: ControllerOptions): void { this.options = { ...this.options, ...options } }
  private listen(event: string, fn: (...args: any[]) => void) {
    this.listeners.push({ event, fn }); this.wc.on(event as any, fn)
  }
  private publish() {
    const waiting=!this.disposed&&(this.state.activity==='handoff'||this.state.nativePending)
    if(waiting&&this.controlWaitStartedAt===undefined){
      this.controlWaitStartedAt=Date.now()
      this.controlWaitTimer=setTimeout(()=>{this.controlWaitTimer=undefined;if(!this.disposed&&this.controlWaitStartedAt!==undefined)this.publish()},this.options.controlWaitWarningMs??15000)
      this.controlWaitTimer.unref?.()
    }else if(!waiting){
      if(this.controlWaitTimer)clearTimeout(this.controlWaitTimer)
      this.controlWaitTimer=undefined;this.controlWaitStartedAt=undefined
    }
    const busy=this.isBusy(),becameIdle=this.wasBusy&&!busy
    this.wasBusy=busy
    this.stateRevision++; this.options.onChanged?.(this.snapshot())
    if(becameIdle&&!this.disposed)queueMicrotask(()=>{if(!this.disposed&&!this.isBusy())this.options.onIdle?.()})
  }
  snapshot(): BrowserAutomationState {
    return {
      ...structuredClone(this.state), epoch: this.state.epoch, documentEpoch: this.documentEpoch,
      stateRevision: this.stateRevision,
      needsObservation: this.observationRequired,
      leaseRunId: this.leaseRunId,
      cursorRequested: this.config.show_virtual_cursor,
      cursorPositionValid: this.cursorPositionValid,
      ...(this.controlWaitStartedAt===undefined?{}:{controlWait:{
        stage:this.state.nativePending?'native' as const:this.active?.commits.size?'submitted-input' as const:this.active?.cleaning?'cleanup' as const:this.active?'operation' as const:this.externalPending.size?'navigation' as const:'queued' as const,
        startedAt:this.controlWaitStartedAt,elapsedMs:Math.max(0,Date.now()-this.controlWaitStartedAt),
        overdue:Date.now()-this.controlWaitStartedAt>=(this.options.controlWaitWarningMs??15000),
        committedInputs:this.active?.commits.size??0,pendingNavigation:this.externalPending.size,
      }}),
      ...(this.options.getManualControl?.() && this.state.owner === 'ai' && this.state.activity !== 'handoff'
        && this.state.nativeConfirmed && !this.state.nativePending && !this.state.inputProtected ? { owner: 'user' as const } : {}),
    }
  }
  captureEpoch(): number { return this.state.epoch }
  captureDocumentEpoch(): number { return this.documentEpoch }
  setPageBlocker(summary: PageBlockerSummaryV1, recheck: () => Promise<PageBlockerSummaryV1>): boolean {
    if(this.disposed || summary.webContentsId !== this.wc.id || summary.documentEpoch !== this.documentEpoch || summary.controlEpoch !== this.state.epoch)return false
    this.state.pageBlocker=summary;this.recheckPageBlocker=recheck;this.publish();return true
  }
  private expirePageBlocker(reason: string): void {
    if(!this.state.pageBlocker)return
    this.state.pageBlocker={...this.state.pageBlocker,...(this.state.pageBlocker.requiresUser?{previouslyBlockedAt:this.state.pageBlocker.observedAt}:{}),state:'unknown',requiresUser:false,blocksInteraction:'unknown',coverage:'unavailable',reasonCodes:[reason],documentEpoch:this.documentEpoch,controlEpoch:this.state.epoch,followup:'none',evidence:[]}
  }
  /** A user completion statement requests a fresh observation, never proof or replay. */
  async recheckBlocker(): Promise<PageBlockerSummaryV1 | undefined> {
    if(!this.recheckPageBlocker)return this.state.pageBlocker
    if(!this.blockerRecheck)this.blockerRecheck=this.recheckPageBlocker().finally(()=>{this.blockerRecheck=undefined})
    return this.blockerRecheck
  }
  /** Actual viewport/zoom changes invalidate coordinates without granting control. */
  geometryChanged(): void {
    if (this.disposed) return
    this.invalidateCursorPosition()
    this.advanceEpoch(); this.observationRequired = true
    this.expirePageBlocker('GEOMETRY_CHANGED')
    this.active?.abort.abort(new BrowserAutomationError('browser_geometry_changed'))
    invalidatePointerMotion(this.wc); this.publish()
  }
  watchEpoch(epoch: number, onInvalidated: () => void): () => void {
    if (epoch !== this.state.epoch || this.disposed) { onInvalidated(); return () => {} }
    this.epochWatchers.add(onInvalidated)
    return () => { this.epochWatchers.delete(onInvalidated) }
  }
  needsObservation(): boolean { return this.observationRequired }
  noteObservation(epoch: number, documentEpoch: number): void {
    this.assertEpoch(epoch)
    if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError('browser_document_changed')
    if (this.active) this.active.observedDocEpoch = documentEpoch
    this.observationRequired = false; this.publish()
  }
  assertEpoch(epoch: number, options?: { readOnly?: boolean }): void {
    if (this.disposed || this.wc.isDestroyed()) throw new BrowserAutomationError('browser_page_destroyed')
    if (epoch !== this.state.epoch) throw new BrowserAutomationError('browser_operation_invalidated','browser_operation_invalidated',{expectedEpoch:epoch,actualEpoch:this.state.epoch,actualDocumentEpoch:this.documentEpoch,dispatched:false})
    if (!options?.readOnly && (this.gated || this.state.owner !== 'ai' || this.options.getManualControl?.())) throw new BrowserAutomationError('browser_manual_control')
  }
  isBusy(): boolean { return !!this.active || this.externalPending.size > 0 || this.state.nativePending }
  /** A just-created Agent page has no previous document credential to reuse. */
  claimRun(runId: string): Promise<BrowserAutomationState> {
    if(this.manualSession)return Promise.reject(new BrowserAutomationError('browser_manual_control'))
    if (!runId) return Promise.reject(new TypeError('A browser task id is required'))
    const epoch = this.captureEpoch()
    const pending = this.tail
    const applied = this.serializeControl(async () => {
      await pending
      this.assertEpoch(epoch)
      if (this.leaseRunId && this.leaseRunId !== runId) throw new BrowserAutomationError('browser_page_in_use')
      this.leaseRunId = runId; this.state.activity = 'acting'; this.publish()
      try { await this.syncNative(this.config.show_virtual_cursor, true) }
      catch (error) {
        if (this.state.epoch === epoch) {
          try { await this.syncNative(false, false); this.leaseRunId = undefined; this.state.activity = 'error'; this.state.error = error instanceof Error ? error.message : String(error) }
          catch { this.invalidate('release_unconfirmed'); this.state.owner='paused'; this.state.activity='error'; this.state.error='release_unconfirmed' }
          this.publish()
        }
        throw error
      }
      this.assertEpoch(epoch)
      this.state.activity = 'waiting'; this.publish()
      return this.snapshot()
    })
    this.admission = applied.then(() => {}, () => {})
    return applied
  }
  /** Register work already submitted outside an action, such as initial navigation. */
  trackPending<T>(pending: Promise<T>): Promise<T> {
    this.externalPending.add(pending); this.publish()
    const settled = () => { this.externalPending.delete(pending); this.publish() }
    void pending.then(settled, settled)
    return pending
  }
  /** A native stop/cleanup could not be confirmed; fresh reads alone cannot unlock it. */
  markUncertain(reason: string): void {
    this.noteResult({ status: 'failed', reason, dispatchedCount: null })
    if (!this.gated) void this.pause().catch(() => {})
    else { this.state.owner = 'paused'; this.state.activity = 'error'; this.publish() }
  }
  private async drain(pending: Promise<void>): Promise<void> {
    await pending
    while (this.externalPending.size) await Promise.allSettled([...this.externalPending])
  }
  private advanceEpoch() {
    this.state.epoch++
    const watchers = [...this.epochWatchers]; this.epochWatchers.clear()
    for (const notify of watchers) { try { notify() } catch { /* One observer cannot keep old intents alive. */ } }
  }
  private invalidate(reason: string) {
    this.invalidateCursorPosition(false)
    this.gated = true; this.controlGeneration++; this.advanceEpoch(); this.observationRequired = true
    this.active?.abort.abort(new BrowserAutomationError(reason))
    invalidatePointerMotion(this.wc)
  }
  private serializeControl<T>(action: () => Promise<T>): Promise<T> {
    const result = this.controls.then(action)
    this.controls = result.then(() => {}, () => {})
    return result
  }
  private invalidateCursorPosition(hide = true): void {
    this.cursorGeneration++; this.cursorPositionValid = false
    if (hide && !this.disposed && this.state.cursorEnabled && this.state.inputProtected) {
      // Only drawing changes. Navigation and layout invalidation must keep the
      // task's isolation, rendering and real-input guards intact.
      void this.syncNative(false, true).catch(() => {
        if (!this.disposed) { this.state.nativeConfirmed = false; this.state.error = 'cursor_configuration_failed'; this.publish() }
      })
    }
  }
  /** A native mouse receipt establishes the compositor's converted position.
   * Never infer one from a keyboard result, planned endpoint or DOM bounds.
   * The first closed batch stays hidden until its receipt; it is not split or replayed. */
  async pointerInput<T>(action: () => Promise<T>, confirmed: (result: T) => boolean): Promise<T> {
    const generation = this.cursorGeneration
    const result = await action()
    if (confirmed(result) && generation === this.cursorGeneration && !this.disposed
      && !this.gated && this.state.owner === 'ai' && !this.options.getManualControl?.() && this.state.inputProtected) {
      this.cursorPositionValid = true
      if (this.config.show_virtual_cursor && !this.state.cursorEnabled) {
        try { await this.syncNative(true, true, this.controlGeneration) }
        catch {
          // A display failure cannot turn acknowledged input into an unknown
          // delivery (or invite replay). Preserve the actual native receipt.
          if (generation === this.cursorGeneration && !this.disposed) {
            this.state.nativeConfirmed = false; this.state.error = 'cursor_configuration_failed'
          }
        }
      }
      this.publish()
    }
    return result
  }
  private readNative(api: CursorApi): Electron.AutomationState {
    if (!api.getAutomationState) throw new BrowserAutomationError('automation_api_unavailable')
    const actual = api.getAutomationState.call(this.wc)
    const rendering = actual.rendering as BrowserAutomationState['rendering']
    this.state.isolateInput = actual.isolateInput
    this.state.keepRendering = actual.keepRendering
    this.state.inputProtected = actual.blockRealPointer === true && actual.blockRealKeyboard === true
    this.state.cursorEnabled = actual.virtualCursor?.enabled === true
    // enabled is a configuration receipt, not proof of pixels on the display.
    this.state.cursorVisible = this.state.cursorEnabled ? undefined : false
    this.state.rendering = rendering ? { ...rendering } : undefined
    return actual
  }
  private confirmNative(api: CursorApi, enabled: boolean, protect: boolean, reset = false): void {
    const actual = this.readNative(api)
    if (actual.isolateInput !== protect || actual.blockRealPointer !== protect || actual.blockRealKeyboard !== protect
      || actual.keepRendering !== protect || actual.virtualCursor?.enabled !== enabled
      || (reset && actual.inputActive !== false)) {
      throw new BrowserAutomationError('automation_configuration_unconfirmed')
    }
    if (protect && (!this.state.rendering?.viewAvailable || !this.state.rendering.keepAlive
      || this.state.rendering.effectiveBackgroundThrottling !== false)) {
      throw new BrowserAutomationError('automation_rendering_unavailable')
    }
    this.state.nativeConfirmed = true
  }
  private syncNative(enabled: boolean, protect: boolean, expectedGeneration?: number): Promise<void> {
    const operation = this.nativeTail.then(async () => {
      enabled = enabled && this.config.show_virtual_cursor && protect && this.cursorPositionValid
      if (this.disposed || this.wc.isDestroyed()) throw new BrowserAutomationError('browser_page_destroyed')
      if (expectedGeneration !== undefined && expectedGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
      const api = this.wc as unknown as CursorApi
      this.state.nativePending = true; this.publish()
      try {
        if (!api.setAutomationOptions || !api.getAutomationState || !api.resetAutomationOptions) {
          throw new BrowserAutomationError('automation_api_unavailable')
        }
        if (!protect) {
          this.invalidateCursorPosition(false)
          invalidatePointerMotion(this.wc, 'native_automation_reset')
          // Callers drain submitted work before this full release. Reset clears
          // focus, held input and long-lived rendering independently of drawing.
          await api.resetAutomationOptions.call(this.wc)
          this.cursorImageKey = undefined
          this.confirmNative(api, false, false, true)
        }
        if (protect || enabled) {
          const virtualCursor: Electron.AutomationVirtualCursorOptions = { enabled, frameRate: this.config.cursor_fps }
          const imageKey = `${this.config.cursor_style}:${this.config.cursor_scale}`
          if (enabled && api.setVirtualCursorImage && imageKey !== this.cursorImageKey) {
            const cursor = await (this.options.getCursorImage ?? createBrowserCursorImage)(this.config.cursor_style, true, this.config.cursor_scale)
            virtualCursor.image = cursor.image; virtualCursor.hotspot = cursor.hotspot
          }
          // Image creation is asynchronous; lifecycle invalidation wins even
          // if it arrived after this native job began.
          enabled = enabled && this.config.show_virtual_cursor && this.cursorPositionValid
          virtualCursor.enabled = enabled
          // An Agent lease always keeps focus, real input and rendering isolated;
          // saved drawing and legacy input preferences cannot weaken ownership.
          await api.setAutomationOptions.call(this.wc, {
            isolateInput: protect, blockRealPointer: protect, blockRealKeyboard: protect,
            keepRendering: protect, virtualCursor,
          })
          // The native configuration barrier can outlive a navigation/layout
          // change. At that moment the last readback may still say disabled,
          // so the invalidation listener could not have scheduled a hide.
          if (enabled && (!this.cursorPositionValid || !this.config.show_virtual_cursor)) {
            enabled = false
            await api.setAutomationOptions.call(this.wc, {
              isolateInput: protect, blockRealPointer: protect, blockRealKeyboard: protect,
              keepRendering: protect, virtualCursor: {enabled:false, frameRate:this.config.cursor_fps},
            })
          }
          this.confirmNative(api, enabled, protect)
          if (enabled) this.cursorImageKey = imageKey
        }
        if (this.disposed) return
        this.state.cursorStyle = this.config.cursor_style
      } catch (error) {
        if (!this.disposed) {
          // A failed reset may have changed only part of the native state. Read
          // what remains, but keep release unconfirmed even if flags look clear.
          try { this.readNative(api) } catch { /* Preserve the last known state. */ }
          this.state.nativeConfirmed = false
        }
        throw error
      } finally {
        if (!this.disposed) { this.state.nativePending = false; this.publish() }
      }
    })
    this.nativeTail = operation.then(() => {}, () => {})
    return operation
  }
  private noteResult(result: unknown, seen = new Set<object>(), depth = 0) {
    if (!result || typeof result !== 'object' || seen.has(result) || depth > 6 || seen.size > 1000) return
    seen.add(result)
    if (Array.isArray(result)) { for (const item of result) this.noteResult(item, seen, depth + 1); return }
    const value = result as Record<string, unknown>
    const cleanup = value.cleanup as { dispatched?: number; failed?: number } | undefined
    const warning = typeof value.deliveryWarning === 'string' ? value.deliveryWarning : ''
    const reason = typeof value.reason === 'string' ? value.reason : typeof value.error === 'string' ? value.error : warning || undefined
    const failed = value.ok === false || value.status === 'failed' || value.status === 'cancelled'
    const expectedResetCancellation = reason === 'AUTOMATION_RESET' && this.nativeCancellationGeneration === this.controlGeneration
    const unsafe = (cleanup?.failed ?? 0) > 0 || !!reason?.includes('PARTIAL_CLICK_SEQUENCE') || !!warning || (failed && value.dispatchedCount === null && !expectedResetCancellation)
    // A later successful child/cleanup must not hide an earlier partial delivery.
    if ((unsafe || !this.unsafeCleanup) && (typeof value.status === 'string' || reason || cleanup)) {
      this.state.lastResult = {
        ...(typeof value.status === 'string' ? { status: value.status } : {}), ...(reason ? { reason } : {}),
        ...(typeof value.dispatchedCount === 'number' || value.dispatchedCount === null ? { dispatchedCount: value.dispatchedCount } : {}),
        ...(cleanup && typeof cleanup.dispatched === 'number' && typeof cleanup.failed === 'number' ? { cleanup: { dispatched: cleanup.dispatched, failed: cleanup.failed } } : {}),
      }
    }
    if (unsafe) {
      this.unsafeCleanup = true; this.observationRequired = true
      this.state.error = 'cleanup_unconfirmed'
    }
    for (const key of ['dispatch', 'clickDispatch', 'steps', 'failedResult', 'result', 'results']) this.noteResult(value[key], seen, depth + 1)
    this.publish()
  }

  run<T>(options: BrowserAutomationRunOptions, action: (operation: BrowserAutomationOperation) => Promise<T>): Promise<T> {
    if(this.manualSession)return Promise.reject(new BrowserAutomationError('browser_manual_control'))
    const guardsInput = !options.readOnly || options.claimInput === true
    const permissionOptions = { readOnly: !guardsInput }
    const epoch = options.expectedEpoch ?? this.captureEpoch()
    const documentEpoch = options.expectedDocumentEpoch ?? this.documentEpoch
    const admission = this.admission
    try { this.assertEpoch(epoch, permissionOptions) } catch (error) { return Promise.reject(error) }
    const queued = this.tail.then(async () => {
      await admission
      this.assertEpoch(epoch, permissionOptions)
      if (guardsInput && this.leaseRunId && this.leaseRunId !== options.runId) throw new BrowserAutomationError('browser_page_in_use')
      if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError('browser_document_changed','browser_document_changed',{expectedDocumentEpoch:documentEpoch,actualDocumentEpoch:this.documentEpoch,expectedEpoch:epoch,actualEpoch:this.state.epoch,dispatched:false})
      if (options.signal?.aborted) throw new BrowserAutomationError('aborted')
      const abort = new AbortController()
      const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
      const active: Active = { abort, commits: new Set(), nativeCommits: new Set(), cleanups: new Set(), nativeResetConfirmed: false, observedDocEpoch: documentEpoch, accepting: true }
      this.active = active; this.state.activeOperations = 1
      const previousActivity = this.state.activity
      const previousError = this.state.error
      this.state.label = options.label
      if (guardsInput) { this.state.error = undefined; this.state.lastResult = undefined; this.state.activity = 'acting' }
      this.publish()
      const assertCurrent = () => {
        if (!active.accepting || this.active !== active) throw new BrowserAutomationError('browser_operation_invalidated')
        this.assertEpoch(epoch, permissionOptions)
        if (signal.aborted) throw new BrowserAutomationError('aborted')
      }
      const operation: BrowserAutomationOperation = {
        signal, epoch, get documentEpoch() { return active.observedDocEpoch }, assertCurrent,
        noteResult: result => { if (this.active === active) this.noteResult(result) },
        registerCleanup: cleanup => { assertCurrent(); active.cleanups.add(cleanup); return () => { active.cleanups.delete(cleanup) } },
        track: async submitted => {
          assertCurrent()
          const pending = submitted()
          active.commits.add(pending)
          try { return await pending } finally { active.commits.delete(pending) }
        },
        commit: async native => {
          assertCurrent()
          active.submittedInput=true
          const pending = native()
          active.commits.add(pending)
          active.nativeCommits.add(pending)
          try { const result = await pending; this.noteResult(result); return result }
          catch (error) {
            this.noteResult({ status: 'failed', dispatchedCount: null, reason: error instanceof Error ? error.message : String(error) })
            throw error
          }
          finally { active.commits.delete(pending); active.nativeCommits.delete(pending) }
        },
        setActivity: async (activity, label) => {
          assertCurrent()
          // Waiting for an action's necessary verification is still part of its
          // exclusive input scope; release protection only after the full run settles.
          this.state.activity = activity; if (label) this.state.label = label
          this.publish()
        },
      }
      let result!: T
      let failure: unknown
      let nativeAcquired = false
      try {
        if (guardsInput) {
          if (options.runId) this.leaseRunId = options.runId
          await this.syncNative(this.config.show_virtual_cursor, true)
          nativeAcquired = true
        }
        assertCurrent()
        if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError('browser_document_changed')
        result = await action(operation)
        this.noteResult(result)
        if (!(options.allowDisposedCompletion && this.disposed && this.wc.isDestroyed() && this.state.epoch === epoch + 1)) assertCurrent()
      } catch (error) { failure = error }
      finally {
        active.accepting = false
        // A caller timing out must not release protection while an uncancellable
        // native click it already committed is still queued or executing.
        await Promise.allSettled([...active.commits])
        const cancellation = this.nativeCancellationBarrier
        if (cancellation && cancellation.generation === this.controlGeneration) await cancellation.settled
        active.cleaning=true;this.publish()
        for (const cleanup of [...active.cleanups]) {
          try { await cleanup({ nativeResetConfirmed: active.nativeResetConfirmed }) }
          catch { this.unsafeCleanup = true; this.state.error = 'cleanup_unconfirmed'; this.observationRequired = true }
        }
        active.cleanups.clear()
        active.cleaning=false
        this.active = undefined; this.state.activeOperations = 0
        if (!this.disposed && this.state.epoch === epoch && (!this.gated || !guardsInput)) {
          try {
            if (guardsInput && !nativeAcquired) {
              await this.syncNative(false, false)
              this.leaseRunId = undefined
            } else if (guardsInput && !this.leaseRunId) {
              await this.syncNative(this.config.show_virtual_cursor, false)
              this.observationRequired = true; invalidatePointerMotion(this.wc)
            }
            if (this.state.epoch !== epoch || (this.gated && guardsInput)) {
              // A handoff/settings operation now owns the state transition.
            } else if (this.unsafeCleanup) {
              if (this.leaseRunId) { await this.syncNative(false, false); this.leaseRunId = undefined }
              this.invalidate('cleanup_unconfirmed'); this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'cleanup_unconfirmed'
              failure = new BrowserAutomationError('cleanup_unconfirmed')
            } else {
              this.state.activity = !guardsInput ? previousActivity : failure ? 'error' : 'waiting'
              this.state.error = !guardsInput ? previousError : failure instanceof Error ? failure.message : failure ? String(failure) : undefined
            }
          } catch (error) {
            this.invalidate('release_unconfirmed'); this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'release_unconfirmed'
            failure = new BrowserAutomationError('release_unconfirmed', String(error))
          }
        }
        this.publish()
      }
      if (failure) {
        if (failure instanceof BrowserAutomationError) {
          Object.assign(failure.diagnostic,{expectedEpoch:epoch,actualEpoch:this.state.epoch,expectedDocumentEpoch:documentEpoch,actualDocumentEpoch:this.documentEpoch,...(failure.diagnostic.stage==='cleanup'?{}:{stage:active.submittedInput?'after_dispatch':'before_dispatch'}),...(active.submittedInput?{}:{dispatched:false})})
          if(this.state.lastResult){failure.lastResult=structuredClone(this.state.lastResult);if((this.state.lastResult.dispatchedCount??0)>0||this.state.lastResult.status==='dispatched')failure.diagnostic.dispatched=true}
        }
        throw failure
      }
      return result
    })
    this.tail = queued.then(() => {}, () => {})
    return queued
  }

  private handoff(owner: 'paused' | 'user'): Promise<BrowserAutomationState> {
    this.invalidate('browser_operation_invalidated')
    this.options.setManualControl?.(true)
    this.state.activity = 'handoff'; this.state.handoffTarget = owner; this.state.label = '等待当前输入与清理完成'; this.publish()
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    this.nativeCancellationGeneration = controlGeneration
    // Explicit stop/takeover must be able to cancel a submitted native queue
    // even while another control job is waiting for that operation to settle.
    // Native serialization and generation checks prevent a stale reset from
    // reaching the next owner. The handoff still waits for all receipts/cleanup.
    let nativeInputActive = false
    try { nativeInputActive = (this.wc as unknown as CursorApi).getAutomationState?.call(this.wc).inputActive === true } catch { /* The release path reports unavailable state. */ }
    const cancelNativeInput = !!this.active?.nativeCommits.size || nativeInputActive
    const cancelledActive = this.active
    const releasing = cancelNativeInput ? this.syncNative(false, false, controlGeneration).then(
      () => {
        // Keep local cleanup callbacks so adapters can forget their held-state
        // ledgers, while avoiding a second native release after reset did it.
        if (cancelledActive) cancelledActive.nativeResetConfirmed = true
        return { ok: true as const }
      }, error => ({ ok: false as const, error }),
    ) : undefined
    if (releasing) this.nativeCancellationBarrier = { generation: controlGeneration, settled: releasing.then(() => {}) }
    return this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed || this.controlGeneration !== controlGeneration) return this.snapshot()
      try {
        if (releasing) {
          const released = await releasing
          if (!released.ok) throw released.error
        } else await this.syncNative(false, false, controlGeneration)
        // Legacy cleanup callbacks may have submitted releases after reset;
        // verify their final native state before granting manual ownership.
        this.confirmNative(this.wc as unknown as CursorApi, false, false, true)
        if (this.controlGeneration !== controlGeneration) return this.snapshot()
        this.state.owner = this.unsafeCleanup ? 'paused' : owner; this.state.activity = this.unsafeCleanup ? 'error' : 'idle'
        this.leaseRunId = undefined
        this.state.error = this.unsafeCleanup ? 'cleanup_unconfirmed' : undefined
      } catch {
        if (this.controlGeneration !== controlGeneration) return this.snapshot()
        this.state.nativeConfirmed = false
        this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'release_unconfirmed'
      }
      if (!this.state.error) this.state.handoffTarget = undefined
      this.state.label = undefined; this.publish()
      return this.snapshot()
    })
  }
  takeControl(): Promise<BrowserAutomationState> { return this.handoff('user') }
  pause(): Promise<BrowserAutomationState> { return this.handoff('paused') }
  retryRelease(): Promise<BrowserAutomationState> { return this.handoff(this.state.handoffTarget ?? (this.state.owner === 'user' ? 'user' : 'paused')) }
  /** Explicit Agent cancellation affects only the matching task's page lease. */
  cancelRun(runId: string): Promise<void> {
    if (!runId) return Promise.resolve()
    if (this.cancelledRun?.id === runId) return this.cancelledRun.settled
    if (this.manualSession?.leaseRunId === runId) {
      this.manualSession.runEnded = true
      this.publish()
      return Promise.resolve()
    }
    if (this.leaseRunId !== runId) return Promise.resolve()
    const settled = this.pause().then(state => {
      if (!state.nativeConfirmed || state.inputProtected || state.isolateInput || state.keepRendering || state.error || state.activity === 'handoff') {
        throw new BrowserAutomationError(state.error || 'release_unconfirmed')
      }
    })
    // stop() and the run's finally share one cancellation barrier. A failed
    // reset is retried only through explicit control recovery, never by finally.
    this.cancelledRun = { id: runId, settled }
    return settled
  }
  finishRun(runId?: string): Promise<void> {
    if(this.manualSession&&(!this.manualSession.leaseRunId||this.manualSession.leaseRunId===runId))this.manualSession.runEnded=true
    if (this.leaseRunId && this.leaseRunId !== runId) return Promise.resolve()
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    return this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed || this.controlGeneration !== controlGeneration || this.tail !== pending || this.active || this.gated || this.state.owner !== 'ai' || (this.leaseRunId && this.leaseRunId !== runId)) return
      if (!this.state.nativeConfirmed || this.unsafeCleanup) return
      try {
        await this.syncNative(false, false)
        if (this.controlGeneration !== controlGeneration || this.tail !== pending || this.active || this.gated) return
        if (this.state.activity !== 'error') this.state.activity = 'idle'
        this.leaseRunId = undefined
        this.state.label = undefined
      } catch { this.gated = true; this.state.activity = 'error'; this.state.error = 'release_unconfirmed' }
      this.publish()
    })
  }
  async resume(): Promise<BrowserAutomationState> {
    if(this.state.pageBlocker && this.state.pageBlocker.state !== 'not_observed' && !(this.state.pageBlocker.state==='confirmed'&&!this.state.pageBlocker.requiresUser)) {
      const blocker=await this.recheckBlocker()
      if(blocker?.state !== 'not_observed' && !(blocker?.state==='confirmed'&&!blocker.requiresUser))throw new BrowserAutomationError(blocker?.state==='confirmed'?'browser_page_blocked':'browser_page_unverified',blocker?.state==='confirmed'?'页面仍需本人处理，请完成后重新检查。':'尚未确认页面可以继续操作，请重新检查。')
    }
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    return this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed) throw new BrowserAutomationError('browser_page_destroyed')
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
      if (this.unsafeCleanup) throw new BrowserAutomationError('cleanup_unconfirmed', 'Input cleanup was not confirmed; reload and observe the page before resuming.')
      try { await this.syncNative(false, false) }
      catch { this.state.activity = 'error'; this.state.error = 'release_unconfirmed'; this.publish(); throw new BrowserAutomationError('release_unconfirmed') }
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
      this.controlGeneration++; this.advanceEpoch(); this.gated = false; this.observationRequired = true
      this.options.setManualControl?.(false)
      this.state.owner = 'ai'; this.state.activity = 'idle'; this.state.error = undefined; this.publish()
      return this.snapshot()
    })
  }
  /** Reserve only future actions; submitted input drains without being aborted. */
  acquireManualSession():Promise<BrowserManualSessionToken>{
    if(this.manualSession)return Promise.reject(new BrowserAutomationError('browser_manual_control'))
    const token={id:randomUUID(),generation:this.controlGeneration,documentEpoch:this.documentEpoch}
    const session:ManualSession={token,owner:this.state.owner,manual:!!this.options.getManualControl?.(),gated:this.gated,leaseRunId:this.leaseRunId,runEnded:false}
    this.manualSession=session
    const pending=this.tail
    return this.serializeControl(async()=>{
      try{
        await this.drain(pending)
        if(this.disposed||this.manualSession!==session||token.generation!==this.controlGeneration||token.documentEpoch!==this.documentEpoch)throw new BrowserAutomationError('browser_operation_invalidated')
        if(this.unsafeCleanup)throw new BrowserAutomationError('cleanup_unconfirmed')
        session.owner=this.state.owner;session.manual=!!this.options.getManualControl?.();session.gated=this.gated;session.leaseRunId=this.leaseRunId
        await this.syncNative(false,false)
        if(token.generation!==this.controlGeneration||token.documentEpoch!==this.documentEpoch)throw new BrowserAutomationError('browser_operation_invalidated')
        token.generation=++this.controlGeneration;this.advanceEpoch();this.observationRequired=true
        this.gated=true;this.options.setManualControl?.(true);this.state.owner='user';this.state.activity='idle';this.state.label='网页批注';this.publish()
        return {...token}
      }catch(error){if(this.manualSession===session)this.manualSession=undefined;if(!this.disposed&&!this.state.nativeConfirmed){this.gated=true;this.state.owner='paused';this.state.activity='error';this.state.error='release_unconfirmed';this.publish()}throw error}
    })
  }
  releaseManualSession(token:BrowserManualSessionToken):Promise<{restored:boolean;state:BrowserAutomationState}>{
    return this.serializeControl(async()=>{
      const session=this.manualSession
      if(!session||session.token.id!==token.id)return {restored:false,state:this.snapshot()}
      const valid=!this.disposed&&token.generation===this.controlGeneration&&token.documentEpoch===this.documentEpoch&&!session.runEnded&&!this.unsafeCleanup&&this.state.nativeConfirmed
      if(!valid){
        this.manualSession=undefined
        if(!this.disposed&&token.generation===this.controlGeneration){this.gated=true;this.options.setManualControl?.(true);this.state.owner='user';this.state.activity='idle';this.state.label=undefined;if(session.runEnded)this.leaseRunId=undefined;this.advanceEpoch();this.observationRequired=true;this.publish()}
        return {restored:false,state:this.snapshot()}
      }
      try{
        const protect=session.owner==='ai'&&!session.manual&&!!session.leaseRunId
        await this.syncNative(protect&&this.config.show_virtual_cursor,protect)
        if(token.generation!==this.controlGeneration||token.documentEpoch!==this.documentEpoch){
          await this.syncNative(false,false)
          this.manualSession=undefined
          if(token.generation===this.controlGeneration){this.gated=true;this.options.setManualControl?.(true);this.state.owner='user';this.state.activity='idle';this.state.label=undefined;this.publish()}
          return {restored:false,state:this.snapshot()}
        }
        this.manualSession=undefined;this.controlGeneration++;this.advanceEpoch();this.observationRequired=true
        this.gated=session.gated;this.options.setManualControl?.(session.manual);this.leaseRunId=session.leaseRunId;this.state.owner=session.owner;this.state.activity=protect?'waiting':'idle';this.state.label=undefined;this.state.error=undefined;this.publish()
        return {restored:true,state:this.snapshot()}
      }catch(error){this.manualSession=undefined;this.gated=true;this.state.owner='paused';this.state.activity='error';this.state.error='release_unconfirmed';this.publish();throw error}
    })
  }
  async drainForTransfer(): Promise<number> {
    this.invalidate('browser_geometry_changed')
    this.state.activity = 'handoff'; this.state.label = '正在等待页面操作结束'; this.publish()
    const controlGeneration = this.controlGeneration
    await this.drain(this.tail)
    if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
    try { await this.syncNative(false, false) }
    catch { this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'release_unconfirmed'; this.publish(); throw new BrowserAutomationError('release_unconfirmed') }
    if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
    if (this.unsafeCleanup) {
      this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'cleanup_unconfirmed'; this.publish()
      throw new BrowserAutomationError('cleanup_unconfirmed')
    }
    return this.state.epoch
  }
  async finishTransfer(): Promise<void> {
    if (this.disposed) return
    const generation = this.controlGeneration
    this.documentEpoch++; this.observationRequired = true
    if (this.leaseRunId && this.state.owner === 'ai' && !this.options.getManualControl?.() && !this.unsafeCleanup) {
      try { await this.syncNative(this.config.show_virtual_cursor, true) }
      catch { this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'protection_unconfirmed'; this.publish(); throw new BrowserAutomationError('protection_unconfirmed') }
      if (generation !== this.controlGeneration) return
    }
    if (this.state.owner === 'ai' && !this.unsafeCleanup) this.gated = false
    this.state.activity = this.leaseRunId && !this.options.getManualControl?.() ? 'waiting' : 'idle'
    this.state.label = undefined; invalidatePointerMotion(this.wc); this.publish()
  }
  async withTransfer<T>(action: () => T | Promise<T>): Promise<T> {
    this.invalidate('browser_geometry_changed')
    this.state.activity = 'handoff'; this.state.label = '正在等待页面操作结束'; this.publish()
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    return this.serializeControl(async () => {
      await this.drain(pending)
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
      try { await this.syncNative(false, false) }
      catch { this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'release_unconfirmed'; this.publish(); throw new BrowserAutomationError('release_unconfirmed') }
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError('browser_operation_invalidated')
      if (this.unsafeCleanup) {
        this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'cleanup_unconfirmed'; this.publish()
        throw new BrowserAutomationError('cleanup_unconfirmed')
      }
      try {
        return await action()
      } finally {
        if (controlGeneration === this.controlGeneration) await this.finishTransfer()
      }
    })
  }
  applySettings(next: BrowserAutomationConfig, nextRevision: number): Promise<BrowserAutomationState> {
    if (nextRevision <= (this.state.revision ?? -1)) return Promise.resolve(this.snapshot())
    const previous = this.config
    this.config = normalizeBrowserAutomation(next); this.state.revision = nextRevision
    const modeChanged = previous.show_virtual_cursor !== next.show_virtual_cursor || previous.cursor_style !== next.cursor_style || previous.cursor_scale !== next.cursor_scale
    const nativeChanged = modeChanged || previous.cursor_fps !== next.cursor_fps
    if (!nativeChanged) { this.publish(); return Promise.resolve(this.snapshot()) }
    if (!modeChanged) {
      // Drawing-rate updates do not mutate input guards or wait behind a long gesture.
      try {
        const api = this.wc as unknown as CursorApi
        if (!api.setVirtualCursorFrameRate) throw new BrowserAutomationError('automation_api_unavailable')
        api.setVirtualCursorFrameRate.call(this.wc, next.cursor_fps)
        const actual = this.readNative(api)
        if (actual.virtualCursor.frameRate !== next.cursor_fps) throw new BrowserAutomationError('automation_configuration_unconfirmed')
      }
      catch (error) { this.state.nativeConfirmed = false; this.state.error = 'cursor_configuration_failed'; this.publish(); return Promise.reject(error) }
      this.publish(); return Promise.resolve(this.snapshot())
    }
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    const applied = this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed || nextRevision !== this.state.revision) return this.snapshot()
      try {
        const ownsInput = this.state.owner === 'ai' && !this.options.getManualControl?.() && (!!this.leaseRunId || this.state.activity !== 'idle')
        await this.syncNative(ownsInput && this.config.show_virtual_cursor, !!this.leaseRunId && ownsInput)
        if (nextRevision !== this.state.revision || this.controlGeneration !== controlGeneration) return this.snapshot()
        if (this.state.owner === 'ai' && !this.unsafeCleanup) this.gated = false
        this.state.activity = this.unsafeCleanup ? 'error' : this.state.owner === 'ai' ? 'waiting' : 'idle'
        this.state.error = this.unsafeCleanup ? 'cleanup_unconfirmed' : undefined
      } catch {
        if (nextRevision !== this.state.revision || this.controlGeneration !== controlGeneration) return this.snapshot()
        this.gated = true; this.state.activity = 'error'; this.state.error = 'release_unconfirmed'
      }
      this.publish(); return this.snapshot()
    })
    // New actions admitted after this change wait for native application. The
    // configuration job only waits for the earlier tail, avoiding a queue cycle.
    this.admission = applied.then(() => {}, () => {})
    return applied
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.invalidate('browser_page_destroyed'); live.delete(this)
    for (const { event, fn } of this.listeners) this.wc.removeListener(event as any, fn)
    this.listeners = []; this.state.owner = 'paused'; this.state.activity = 'error'; this.state.error = 'browser_page_destroyed'
    this.leaseRunId = undefined
    this.state.cursorVisible = false
    this.state.cursorEnabled = false; this.state.inputProtected = false; this.state.isolateInput = false; this.state.keepRendering = false
    this.state.rendering = { viewAvailable: false, keepAlive: false, requestedBackgroundThrottling: true, effectiveBackgroundThrottling: true }
    this.state.nativePending = false; this.state.nativeConfirmed = true
    this.publish()
  }
}
