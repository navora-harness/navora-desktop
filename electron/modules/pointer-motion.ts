import type { WebContents } from 'electron'
import { withBrowserPointerInput } from './browser-automation-controller'
import {
  generatePointerTrajectory,
  toPointerInputSequence,
  type PointerPosition,
  type PointerTrajectoryOptions,
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
type MouseStep = {
  atMs: number
  position?: PointerPosition
  offset?: PointerPosition
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
  /** Always main viewport logical CSS coordinates; never node/frame offsets. */
  position?: PointerPosition
  invalidationReason?: string
}

const states = new WeakMap<WebContents, MotionState>()
const BUTTON_BITS: Record<Button, number> = { left: 1, right: 2, middle: 4, back: 8, forward: 16 }
const MAX_STEPS = 10_000
const MAX_TIME_MS = 60_000

function reset(state: MotionState,reason='explicit_invalidation'): void {
  state.position = undefined
  state.invalidationReason=reason
  state.generation++
}

function stateFor(wc: WebContents): MotionState {
  const existing = states.get(wc)
  if (existing) return existing
  const state: MotionState = { tail: Promise.resolve(), generation: 0 }
  states.set(wc, state)
  const clear = () => reset(state,'navigation_or_renderer_lifecycle')
  // Reset even for subframe navigation: any cached coordinate conversion may be stale.
  wc.on('did-start-navigation', clear)
  wc.on('did-navigate-in-page', clear)
  wc.on('render-process-gone', clear)
  wc.once('destroyed', clear)
  return state
}

/** Clear a position after input performed through another entry point. Does not cancel a batch. */
export function invalidatePointerMotion(wc: WebContents,reason='external_input_or_geometry_change'): void {
  const state = states.get(wc)
  if (state) reset(state,reason)
}

export function hasPointerMotion(wc: WebContents): boolean {
  return !wc.isDestroyed() && typeof (wc as unknown as SequenceApi).dispatchInputSequence === 'function'
}

function stopped(status: 'failed' | 'cancelled', reason: string): Record<string, unknown> {
  return { ok: false, status, reason, dispatchedCount: 0, lastDispatchedIndex: null, stoppedIndex: null }
}

/** Public .7 does not expose the final main-viewport point of selector/target
 * input. Keep it unknown rather than treating local offsets as absolute. */
export function pointerMotionPosition(wc:WebContents) {
  const state=stateFor(wc)
  return{valid:!!state.position,generation:state.generation,coordinateSpace:'main_viewport_css' as const,...(state.position?{point:{...state.position}}:{}),...(state.invalidationReason?{invalidationReason:state.invalidationReason}:{})}
}

/** Only a trusted main-frame event receipt may confirm input from another API.
 * The generation is captured before that input; navigation/geometry/handoff
 * invalidation must win over an asynchronously arriving receipt. */
export function confirmPointerMotionReceipt(wc:WebContents,generation:number,point:PointerPosition):boolean {
  const state=stateFor(wc)
  if(wc.isDestroyed()||state.generation!==generation||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false
  state.position={x:point.x,y:point.y};state.invalidationReason=undefined
  return true
}

/** A submitted batch alone is not evidence of visible interpolated movement. */
export function pointerMotionWasInterpolated(result:Record<string,unknown>|null|undefined):boolean {
  return !!result&&result.ok===true&&Number(result.dispatchedCount)>1&&Number(result.movementSteps)>1&&Number(result.movementDurationMs)>0&&Number(result.movementDistancePx)>0
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

function plan(options: MotionOptions, from: PointerPosition,establish=false): { steps: MouseStep[]; durationMs: number; timeoutMs: number } {
  if (!['move', 'click', 'drag'].includes(options.action)) throw new TypeError('unsupported pointer motion action')
  const button = options.button ?? 'left'
  if (!Object.hasOwn(BUTTON_BITS, button)) throw new TypeError('unsupported pointer button')
  const clickCount = options.clickCount ?? 1
  if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) throw new RangeError('clickCount must be an integer from 1 to 3')
  const { holdMs = 50, ...settings } = options.motion ?? {}
  if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 1000) throw new RangeError('holdMs must be finite and between 0 and 1000')
  const validated = generatePointerTrajectory({ ...settings, from, to: options.to })
  const points = establish&&options.action!=='drag' ? [{...options.to,atMs:0}] : options.immediate
    ? [{ ...from, atMs: 0 }, { ...options.to, atMs: 0 }]
    : validated
  const movement = toPointerInputSequence(points)
  const steps: MouseStep[] = movement.map(({position,...step}) => ({
    ...step, button: 'none', buttons: 0,
    ...(options.target ? { target: options.target, offset: position } : {position}),
  }))
  let end = points[points.length - 1].atMs
  const pressed = (point: PointerPosition, atMs: number, type: 'mousePressed' | 'mouseReleased', count: number): MouseStep => ({
    kind: 'mouse', type, atMs, button,
    buttons: type === 'mousePressed' ? BUTTON_BITS[button] : 0, clickCount: count,
    ...(options.target ? { target: options.target, offset: {x:point.x,y:point.y} } : {position:{x:point.x,y:point.y}}),
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
    return stopped('cancelled', 'ABORTED')
  }
  let started = false
  let cancelQueued: (() => void) | undefined
  const queued = state.tail.then(async () => {
    started = true
    if (options.signal?.aborted) {
      return stopped('cancelled', 'ABORTED')
    }
    if (!hasPointerMotion(wc)) {
      reset(state)
      return stopped('failed', wc.isDestroyed() ? 'WEB_CONTENTS_DESTROYED' : 'INPUT_SEQUENCE_UNAVAILABLE')
    }
    if (state.generation !== admittedGeneration) return stopped('cancelled', 'POINTER_STATE_INVALIDATED')
    // A caller's `from` is a drag start request, not evidence of the current
    // virtual pointer. Unknown starts receive one real location event directly.
    const confirmed=options.target?undefined:state.position
    const from = options.action==='drag' ? options.from??confirmed??options.to : confirmed??options.to
    const establish=!confirmed
    const { steps, durationMs, timeoutMs } = plan(options, from,establish)
    // Reposition to an explicitly requested drag start using the confirmed
    // viewport position before pressing. This remains one closed native batch.
    if(options.action==='drag'&&confirmed&&options.from&&(confirmed.x!==from.x||confirmed.y!==from.y)){
      const approach=toPointerInputSequence(options.immediate
        ? [{...confirmed,atMs:0},{...from,atMs:0}]
        : generatePointerTrajectory({...options.motion,from:confirmed,to:from}))
      const offset=approach.at(-1)!.atMs
      for(const step of steps)step.atMs+=offset
      steps.unshift(...approach.map(point=>({...point,button:'none' as const,buttons:0})))
      if(steps.length>MAX_STEPS||steps.at(-1)!.atMs>MAX_TIME_MS||steps.at(-1)!.atMs>timeoutMs)throw new RangeError('drag approach exceeds sequence bounds')
    }
    const generation = state.generation
    try { options.beforeDispatch?.() }
    catch (error) { return stopped('cancelled', error instanceof Error ? error.message : 'POINTER_STATE_INVALIDATED') }
    try {
      const dispatch = (wc as unknown as SequenceApi).dispatchInputSequence!
      const result = await withBrowserPointerInput(wc,
        () => dispatch.call(wc, steps, { signal: options.signal, timeoutMs }),
        result => result.status === 'completed' && Number(result.dispatchedCount) > 0 && Number.isInteger(result.lastDispatchedIndex) && Number(result.lastDispatchedIndex) >= 0,
      )
      const ok = result?.status === 'completed'
      const index = result?.lastDispatchedIndex
      const last = Number.isInteger(index) && index !== null && index !== undefined && index >= 0 && index < steps.length
        ? steps[index] : undefined
      if(state.generation===generation&&!wc.isDestroyed()){
        if(last?.position&&!options.target){state.position={...last.position};state.invalidationReason=undefined}
        else if(options.target){state.position=undefined;state.invalidationReason='target_local_conversion_unavailable'}
        else if(result.dispatchedCount!==0){state.position=undefined;state.invalidationReason='native_last_point_unconfirmed'}
      }
      // Count only movement acknowledged by the native receipt. A round trip
      // can end at its start and still contain an actual interpolated path.
      const movement=last?steps.slice(0,Number(index)+1).filter(step=>step.type==='mouseMoved'):[]
      let movementDistancePx=0
      for(let index=1;index<movement.length;index++){
        const from=movement[index-1].position??movement[index-1].offset!
        const to=movement[index].position??movement[index].offset!
        movementDistancePx+=Math.hypot(to.x-from.x,to.y-from.y)
      }
      return {
        ...result, ok, plannedSteps: steps.length, durationMs:steps.at(-1)?.atMs??durationMs,
        movementSteps:movement.length,movementDurationMs:movement.at(-1)?.atMs??0,
        movementDistancePx,
        position: pointerMotionPosition(wc),dispatchGeneration:generation,effectiveMotion:{...options.motion},startPosition:confirmed?'confirmed':'unknown',
        ...(confirmed?{startPoint:{...confirmed}}:{}),
        ...(last && (last.offset || last.position) ? { lastDispatchedPoint: { ...(last.offset || last.position), atMs: last.atMs,coordinateSpace:options.target?'element_offset':'main_viewport_css' } } : {}),
      }
    } catch (error) {
      reset(state,'native_rejection_without_receipt')
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
