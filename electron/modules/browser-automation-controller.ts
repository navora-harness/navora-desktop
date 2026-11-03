import type { WebContents } from 'electron'
import {randomUUID} from 'node:crypto'
import {
  createBrowserAutomationState, createDefaultBrowserAutomation, normalizeBrowserAutomation,
  type BrowserAutomationConfig, type BrowserAutomationState,
} from '../../shared/browser-automation'
import { invalidatePointerMotion } from './pointer-motion'
import { createBrowserCursorImage } from './browser-native-cursor'

export class BrowserAutomationError extends Error {
  lastResult?: BrowserAutomationState['lastResult']
  constructor(readonly code: string, message = code) { super(message); this.name = 'BrowserAutomationError' }
}
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
  registerCleanup(cleanup: () => Promise<void>): () => void
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
}
type CursorApi = {
  setVirtualCursorEnabled?: (enabled: boolean, options?: { blockRealPointer: boolean; blockRealKeyboard: boolean }) => Promise<void>
  setVirtualCursorFrameRate?: (fps: number) => void
  setVirtualCursorImage?: (image: import('electron').NativeImage | null, options?: { hotspot: import('electron').Point }) => void
}
type Active = { abort: AbortController; commits: Set<Promise<unknown>>; cleanups: Set<() => Promise<void>>; observedDocEpoch: number; accepting: boolean }
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
  private gated = false
  private disposed = false
  private documentEpoch = 0
  private observationRequired = false
  private leaseRunId?: string
  private cursorImageKey?: string
  private unsafeCleanup = false
  private stateRevision = 0
  private wasBusy = false
  private manualSession?:ManualSession
  private epochWatchers = new Set<() => void>()
  private listeners: { event: string; fn: (...args: any[]) => void }[] = []

  constructor(private wc: WebContents, options: ControllerOptions = {}) {
    this.options = options
    this.config = normalizeBrowserAutomation(options.getSettings?.() ?? settings)
    this.state.revision = revision
    this.state.cursorAvailable = typeof (wc as unknown as CursorApi).setVirtualCursorEnabled === 'function'
    this.state.cursorImageAvailable = typeof (wc as unknown as CursorApi).setVirtualCursorImage === 'function'
    live.add(this)
    this.listen('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame === false || inPlace) return
      this.documentEpoch++
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
    this.listen('did-navigate-in-page', () => { this.documentEpoch++; invalidatePointerMotion(wc); this.publish() })
    this.listen('render-process-gone', () => {
      this.documentEpoch++; this.unsafeCleanup = false
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
      ...(this.options.getManualControl?.() && this.state.owner === 'ai' && this.state.activity !== 'handoff'
        && this.state.nativeConfirmed && !this.state.nativePending && !this.state.inputProtected ? { owner: 'user' as const } : {}),
    }
  }
  captureEpoch(): number { return this.state.epoch }
  captureDocumentEpoch(): number { return this.documentEpoch }
  /** Actual viewport/zoom changes invalidate coordinates without granting control. */
  geometryChanged(): void {
    if (this.disposed) return
    this.advanceEpoch(); this.observationRequired = true
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
    if (epoch !== this.state.epoch) throw new BrowserAutomationError('browser_operation_invalidated')
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
      try { await this.syncNative(this.config.show_virtual_cursor, this.config.protect_input) }
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
    this.gated = true; this.controlGeneration++; this.advanceEpoch(); this.observationRequired = true
    this.active?.abort.abort(new BrowserAutomationError(reason))
    invalidatePointerMotion(this.wc)
  }
  private serializeControl<T>(action: () => Promise<T>): Promise<T> {
    const result = this.controls.then(action)
    this.controls = result.then(() => {}, () => {})
    return result
  }
  private syncNative(enabled: boolean, protect: boolean): Promise<void> {
    const operation = this.nativeTail.then(async () => {
      if (this.disposed || this.wc.isDestroyed()) throw new BrowserAutomationError('browser_page_destroyed')
      const api = this.wc as unknown as CursorApi
      const nativeEnabled = enabled || protect
      if (!api.setVirtualCursorEnabled) {
        if (nativeEnabled) throw new BrowserAutomationError('virtual_cursor_unavailable')
        this.state.cursorEnabled = false; this.state.inputProtected = false; this.state.nativeConfirmed = true
        return
      }
      this.state.nativePending = true; this.publish()
      try {
        if (nativeEnabled) {
          const imageKey = `${this.config.cursor_style}:${enabled}`
          if (api.setVirtualCursorImage && (imageKey !== this.cursorImageKey || !this.state.cursorEnabled)) {
            const cursor = await (this.options.getCursorImage ?? createBrowserCursorImage)(this.config.cursor_style, enabled)
            api.setVirtualCursorImage.call(this.wc, cursor.image, { hotspot: cursor.hotspot })
            this.cursorImageKey = imageKey
          } else if (!api.setVirtualCursorImage && protect && !enabled) {
            throw new BrowserAutomationError('virtual_cursor_image_unavailable')
          }
        }
        api.setVirtualCursorFrameRate?.call(this.wc, this.config.cursor_fps)
        // Always supply both flags: omission preserves the previous native mode.
        await api.setVirtualCursorEnabled.call(this.wc, nativeEnabled, { blockRealPointer: protect, blockRealKeyboard: protect })
        if (this.disposed) return
        this.state.cursorEnabled = nativeEnabled; this.state.cursorVisible = enabled; this.state.cursorStyle = this.config.cursor_style
        this.state.inputProtected = protect; this.state.nativeConfirmed = true
      } catch (error) {
        if (!this.disposed) this.state.nativeConfirmed = false
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
    const unsafe = (cleanup?.failed ?? 0) > 0 || !!reason?.includes('PARTIAL_CLICK_SEQUENCE') || !!warning || (failed && value.dispatchedCount === null)
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
      if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError('browser_document_changed')
      if (options.signal?.aborted) throw new BrowserAutomationError('aborted')
      const abort = new AbortController()
      const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
      const active: Active = { abort, commits: new Set(), cleanups: new Set(), observedDocEpoch: documentEpoch, accepting: true }
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
          const pending = native()
          active.commits.add(pending)
          try { const result = await pending; this.noteResult(result); return result }
          catch (error) {
            this.noteResult({ status: 'failed', dispatchedCount: null, reason: error instanceof Error ? error.message : String(error) })
            throw error
          }
          finally { active.commits.delete(pending) }
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
          await this.syncNative(this.config.show_virtual_cursor, this.config.protect_input)
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
        for (const cleanup of [...active.cleanups]) {
          try { await cleanup() }
          catch { this.unsafeCleanup = true; this.state.error = 'cleanup_unconfirmed'; this.observationRequired = true }
        }
        active.cleanups.clear()
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
        if (failure instanceof BrowserAutomationError && this.state.lastResult) failure.lastResult = structuredClone(this.state.lastResult)
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
    return this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed || this.controlGeneration !== controlGeneration) return this.snapshot()
      try {
        await this.syncNative(false, false)
        if (this.controlGeneration !== controlGeneration) return this.snapshot()
        this.state.owner = this.unsafeCleanup ? 'paused' : owner; this.state.activity = this.unsafeCleanup ? 'error' : 'idle'
        this.leaseRunId = undefined
        this.state.error = this.unsafeCleanup ? 'cleanup_unconfirmed' : undefined
      } catch {
        if (this.controlGeneration !== controlGeneration) return this.snapshot()
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
  resume(): Promise<BrowserAutomationState> {
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
        await this.syncNative(protect&&this.config.show_virtual_cursor,protect&&this.config.protect_input)
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
      try { await this.syncNative(this.config.show_virtual_cursor, this.config.protect_input) }
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
    const modeChanged = previous.show_virtual_cursor !== next.show_virtual_cursor || previous.protect_input !== next.protect_input || previous.cursor_style !== next.cursor_style
    const nativeChanged = modeChanged || previous.cursor_fps !== next.cursor_fps
    if (!nativeChanged) { this.publish(); return Promise.resolve(this.snapshot()) }
    if (!modeChanged) {
      // Drawing-rate updates do not mutate input guards or wait behind a long gesture.
      try { (this.wc as unknown as CursorApi).setVirtualCursorFrameRate?.call(this.wc, next.cursor_fps) }
      catch (error) { this.state.error = 'cursor_configuration_failed'; this.publish(); return Promise.reject(error) }
      this.publish(); return Promise.resolve(this.snapshot())
    }
    const closing = previous.protect_input && !next.protect_input
    if (closing) { this.invalidate('browser_settings_changed'); this.state.activity = 'handoff'; this.publish() }
    const controlGeneration = this.controlGeneration
    const pending = this.tail
    const applied = this.serializeControl(async () => {
      await this.drain(pending)
      if (this.disposed || nextRevision !== this.state.revision) return this.snapshot()
      try {
        const ownsInput = this.state.owner === 'ai' && !this.options.getManualControl?.() && (!!this.leaseRunId || this.state.activity !== 'idle')
        await this.syncNative(ownsInput && this.config.show_virtual_cursor, !!this.leaseRunId && ownsInput && this.config.protect_input)
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
    this.state.cursorEnabled = false; this.state.inputProtected = false; this.state.nativePending = false; this.state.nativeConfirmed = true
    this.publish()
  }
}
