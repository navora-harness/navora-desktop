import type { WebContents } from 'electron'
import {
  generatePointerTrajectory,
  toPointerInputSequence,
  type PointerPosition,
  type PointerTrajectoryOptions,
  type PointerTrajectoryPoint,
} from '../../shared/pointer-trajectory'

export type PointerMotionSettings = Pick<PointerTrajectoryOptions,
  'durationMs' | 'speedMultiplier' | 'intervalMs' | 'sampleRateHz' | 'seed' |
  'timing' | 'curvature' | 'jitterPx' | 'targetWidthPx'> & {
  /** Click dwell time. Drag release follows the final movement in the same batch. */
  holdMs?: number
}

type Button = 'left' | 'middle' | 'right' | 'back' | 'forward'
type MotionOptions = {
  action: 'move' | 'click' | 'drag'
  to: PointerPosition
  from?: PointerPosition
  target?: Electron.AgentTarget
  motion?: PointerMotionSettings
  button?: Button
  clickCount?: number
  signal?: AbortSignal
  timeoutMs?: number
  /** Disable interpolation while preserving one closed native input batch. */
  immediate?: boolean
  /** Validate the owning page intent after this local queue, immediately before native submission. */
  beforeDispatch?: () => void
}
type MouseStep = PointerTrajectoryPoint & {
  kind: 'mouse'
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased'
  button: Button | 'none'
  buttons: number
  clickCount?: number
  target?: Electron.AgentTarget
}
type NativeResult = Record<string, unknown> & {
  status: string
  lastDispatchedIndex?: number | null
}
type SequenceApi = {
  dispatchInputSequence?: (
    steps: MouseStep[], options: { signal?: AbortSignal; timeoutMs: number },
  ) => Promise<NativeResult>
}
type MotionState = {
  tail: Promise<void>
  generation: number
  position?: { scope: string; point: PointerPosition }
}

const states = new WeakMap<WebContents, MotionState>()
const BUTTON_BITS: Record<Button, number> = { left: 1, right: 2, middle: 4, back: 8, forward: 16 }
const MAX_STEPS = 10_000
const MAX_TIME_MS = 60_000

function reset(state: MotionState): void {
  state.position = undefined
  state.generation++
}

function stateFor(wc: WebContents): MotionState {
  const existing = states.get(wc)
  if (existing) return existing
  const state: MotionState = { tail: Promise.resolve(), generation: 0 }
  states.set(wc, state)
  const clear = () => reset(state)
  // Reset even for subframe navigation: any cached coordinate conversion may be stale.
  wc.on('did-start-navigation', clear)
  wc.on('did-navigate-in-page', clear)
  wc.on('render-process-gone', clear)
  wc.once('destroyed', clear)
  return state
}

/** Clear a position after input performed through another entry point. Does not cancel a batch. */
export function invalidatePointerMotion(wc: WebContents): void {
  const state = states.get(wc)
  if (state) reset(state)
}

export function hasPointerMotion(wc: WebContents): boolean {
  return !wc.isDestroyed() && typeof (wc as unknown as SequenceApi).dispatchInputSequence === 'function'
}

function stopped(status: 'failed' | 'cancelled', reason: string): Record<string, unknown> {
  return { ok: false, status, reason, dispatchedCount: 0, lastDispatchedIndex: null, stoppedIndex: null }
}

function scopeFor(target?: Electron.AgentTarget): string {
  if (!target) return 'viewport'
  return `target:${target.webContentsId}:${target.processId}:${target.routingId}:${target.documentId}:${target.backendNodeId}`
}

function copyOptions(options: MotionOptions): MotionOptions {
  const motion = options.motion
  // Copy only supported settings, so a runtime caller cannot inject coordinate conversions or handles.
  const settings: PointerMotionSettings = {
    durationMs: motion?.durationMs, speedMultiplier: motion?.speedMultiplier,
    intervalMs: motion?.intervalMs, sampleRateHz: motion?.sampleRateHz,
    seed: motion?.seed, timing: motion?.timing, curvature: motion?.curvature,
    jitterPx: motion?.jitterPx, targetWidthPx: motion?.targetWidthPx, holdMs: motion?.holdMs,
  }
  return {
    ...options,
    from: options.from === undefined ? undefined : { x: options.from.x, y: options.from.y },
    to: { x: options.to.x, y: options.to.y },
    target: options.target === undefined ? undefined : { ...options.target },
    motion: settings,
  }
}

function plan(options: MotionOptions, from: PointerPosition): { steps: MouseStep[]; durationMs: number; timeoutMs: number } {
  if (!['move', 'click', 'drag'].includes(options.action)) throw new TypeError('unsupported pointer motion action')
  const button = options.button ?? 'left'
  if (!Object.hasOwn(BUTTON_BITS, button)) throw new TypeError('unsupported pointer button')
  const clickCount = options.clickCount ?? 1
  if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) throw new RangeError('clickCount must be an integer from 1 to 3')
  const { holdMs = 50, ...settings } = options.motion ?? {}
  if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 1000) throw new RangeError('holdMs must be finite and between 0 and 1000')
  const validated = generatePointerTrajectory({ ...settings, from, to: options.to })
  const points = options.immediate
    ? [{ ...from, atMs: 0 }, { ...options.to, atMs: 0 }]
    : validated
  const movement = toPointerInputSequence(points)
  const steps: MouseStep[] = movement.map((point) => ({
    ...point, button: 'none', buttons: 0,
    ...(options.target ? { target: options.target } : {}),
  }))
  let end = points[points.length - 1].atMs
  const pressed = (point: PointerPosition, atMs: number, type: 'mousePressed' | 'mouseReleased', count: number): MouseStep => ({
    kind: 'mouse', type, x: point.x, y: point.y, atMs, button,
    buttons: type === 'mousePressed' ? BUTTON_BITS[button] : 0, clickCount: count,
    ...(options.target ? { target: options.target } : {}),
  })
  if (options.action === 'click') {
    for (let count = 1; count <= clickCount; count++) {
      steps.push(pressed(options.to, end, 'mousePressed', count))
      end += holdMs
      steps.push(pressed(options.to, end, 'mouseReleased', count))
      if (count < clickCount) end += 80
    }
  } else if (options.action === 'drag') {
    for (let index = 1; index < steps.length; index++) steps[index].buttons = BUTTON_BITS[button]
    steps.splice(1, 0, pressed(from, 0, 'mousePressed', 1))
    steps.push(pressed(options.to, end, 'mouseReleased', 1))
  }
  if (steps.length > MAX_STEPS) throw new RangeError(`pointer motion exceeds ${MAX_STEPS} steps including button events`)
  if (!Number.isFinite(end) || end > MAX_TIME_MS) throw new RangeError(`pointer motion exceeds ${MAX_TIME_MS} ms including click dwell and gaps`)
  const timeoutMs = options.timeoutMs ?? Math.max(30_000, end + 5000)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 || timeoutMs < end) {
    throw new RangeError('timeoutMs must be finite, between 1 and 120000, and at least the final atMs')
  }
  return { steps, durationMs: end, timeoutMs }
}

/** Plan once and submit one closed native batch. A failed or cancelled operation is never replayed. */
export async function dispatchPointerMotion(wc: WebContents, input: MotionOptions): Promise<Record<string, unknown>> {
  if (!hasPointerMotion(wc)) {
    invalidatePointerMotion(wc)
    return stopped('failed', wc.isDestroyed() ? 'WEB_CONTENTS_DESTROYED' : 'INPUT_SEQUENCE_UNAVAILABLE')
  }
  const options = copyOptions(input)
  const state = stateFor(wc)
  const admittedGeneration = state.generation
  if (options.signal?.aborted) {
    reset(state)
    return stopped('cancelled', 'ABORTED')
  }
  let started = false
  let cancelQueued: (() => void) | undefined
  const queued = state.tail.then(async () => {
    started = true
    if (options.signal?.aborted) {
      reset(state)
      return stopped('cancelled', 'ABORTED')
    }
    if (!hasPointerMotion(wc)) {
      reset(state)
      return stopped('failed', wc.isDestroyed() ? 'WEB_CONTENTS_DESTROYED' : 'INPUT_SEQUENCE_UNAVAILABLE')
    }
    if (state.generation !== admittedGeneration) return stopped('cancelled', 'POINTER_STATE_INVALIDATED')
    const scope = scopeFor(options.target)
    const from = options.from ?? (state.position?.scope === scope ? state.position.point : undefined)
      ?? (options.target ? options.to : { x: 0, y: 0 })
    const { steps, durationMs, timeoutMs } = plan(options, from)
    const generation = state.generation
    try { options.beforeDispatch?.() }
    catch (error) { return stopped('cancelled', error instanceof Error ? error.message : 'POINTER_STATE_INVALIDATED') }
    try {
      const dispatch = (wc as unknown as SequenceApi).dispatchInputSequence!
      const result = await dispatch.call(wc, steps, { signal: options.signal, timeoutMs })
      const ok = result?.status === 'completed'
      if (ok && state.generation === generation && !wc.isDestroyed()) {
        state.position = { scope, point: { ...options.to } }
      } else {
        reset(state)
      }
      const index = result?.lastDispatchedIndex
      const last = Number.isInteger(index) && index !== null && index !== undefined && index >= 0 && index < steps.length
        ? steps[index] : undefined
      return {
        ...result, ok, plannedSteps: steps.length, durationMs,
        ...(last ? { lastDispatchedPoint: { x: last.x, y: last.y, atMs: last.atMs } } : {}),
      }
    } catch (error) {
      reset(state)
      // An unexpected native rejection gives no reliable partial-dispatch count.
      return {
        ok: false, status: options.signal?.aborted ? 'cancelled' : 'failed', reason: 'INPUT_SEQUENCE_REJECTED',
        error: error instanceof Error ? error.message : String(error),
        dispatchedCount: null, lastDispatchedIndex: null, plannedSteps: steps.length, durationMs,
      }
    }
  })
  state.tail = queued.then(() => {}, () => {})
  if (!options.signal) return queued
  const cancelled = new Promise<Record<string, unknown>>((resolve) => {
    cancelQueued = () => {
      if (!started) {
        reset(state)
        resolve(stopped('cancelled', 'ABORTED'))
      }
    }
    options.signal!.addEventListener('abort', cancelQueued, { once: true })
  })
  try {
    return await Promise.race([queued, cancelled])
  } finally {
    if (cancelQueued) options.signal.removeEventListener('abort', cancelQueued)
  }
}
