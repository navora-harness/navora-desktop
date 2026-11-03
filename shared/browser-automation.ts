import type { PointerTrajectoryOptions } from './pointer-trajectory'

export type BrowserAutomationConfig = {
  auto_mute: boolean
  show_virtual_cursor: boolean
  show_control_feedback: boolean
  protect_input: boolean
  smooth_pointer: boolean
  pointer_profile: 'natural' | 'precise'
  speed_multiplier: number
  interval_ms: number
  cursor_fps: number
  cursor_style: 'navora-arrow' | 'focus-ring' | 'precision-cross'
}

export function createDefaultBrowserAutomation(): BrowserAutomationConfig {
  return {
    auto_mute: true,
    show_virtual_cursor: true, show_control_feedback: true, protect_input: true, smooth_pointer: true,
    pointer_profile: 'natural', speed_multiplier: 1, interval_ms: 1000 / 120, cursor_fps: 60, cursor_style: 'navora-arrow',
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function finite(value: unknown, name: string, min: number, max: number, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value <= 0)) {
    throw new RangeError(`${name} must be a finite number ${positive ? 'greater than zero and ' : ''}between ${min} and ${max}`)
  }
  return value
}

/** Missing legacy fields receive defaults. Invalid supplied values are never coerced. */
export function normalizeBrowserAutomation(value: unknown): BrowserAutomationConfig {
  const defaults = createDefaultBrowserAutomation()
  if (value === undefined) return defaults
  const source = record(value, 'browser.automation')
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown browser.automation setting: ${key}`)
  }
  const result = { ...defaults }
  for (const key of ['auto_mute', 'show_virtual_cursor', 'show_control_feedback', 'protect_input', 'smooth_pointer'] as const) {
    if (source[key] === undefined) continue
    if (typeof source[key] !== 'boolean') throw new TypeError(`browser.automation.${key} must be a boolean`)
    result[key] = source[key]
  }
  if (source.pointer_profile !== undefined) {
    if (source.pointer_profile !== 'natural' && source.pointer_profile !== 'precise') throw new TypeError('Invalid browser.automation.pointer_profile')
    result.pointer_profile = source.pointer_profile
  }
  if (source.cursor_style !== undefined) {
    if (typeof source.cursor_style !== 'string' || !['navora-arrow', 'focus-ring', 'precision-cross'].includes(source.cursor_style)) throw new TypeError('Invalid browser.automation.cursor_style')
    result.cursor_style = source.cursor_style as BrowserAutomationConfig['cursor_style']
  }
  if (source.speed_multiplier !== undefined) result.speed_multiplier = finite(source.speed_multiplier, 'speed_multiplier', 0, Number.MAX_VALUE, true)
  if (source.interval_ms !== undefined) result.interval_ms = finite(source.interval_ms, 'interval_ms', 0, 60000, true)
  if (source.cursor_fps !== undefined) {
    result.cursor_fps = finite(source.cursor_fps, 'cursor_fps', 0, 1000)
    if (!Number.isInteger(result.cursor_fps)) throw new RangeError('cursor_fps must be an integer')
  }
  return result
}

/** Apply only changed leaves; undefined means absent, and false remains an explicit value. */
export function mergeBrowserAutomation(previous: BrowserAutomationConfig, patch: unknown): BrowserAutomationConfig {
  const current = normalizeBrowserAutomation(previous)
  const changed = record(patch, 'browser.automation patch')
  normalizeBrowserAutomation(changed)
  const supplied = Object.fromEntries(Object.entries(changed).filter(([, value]) => value !== undefined))
  return normalizeBrowserAutomation({ ...current, ...supplied })
}

export type BrowserPointerMotion = Pick<PointerTrajectoryOptions,
  'durationMs' | 'speedMultiplier' | 'intervalMs' | 'sampleRateHz' | 'seed' |
  'timing' | 'curvature' | 'jitterPx' | 'targetWidthPx'> & { holdMs?: number }

const motionFields = new Set([
  'durationMs', 'speedMultiplier', 'intervalMs', 'sampleRateHz', 'seed', 'timing',
  'curvature', 'jitterPx', 'targetWidthPx', 'holdMs',
])

function motionPatch(value: unknown): BrowserPointerMotion {
  const source = record(value, 'motion')
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(source)) {
    if (!motionFields.has(key)) throw new TypeError(`Unknown pointer motion setting: ${key}`)
    if (field === undefined) continue
    if (key === 'seed') {
      if (typeof field !== 'string' && (typeof field !== 'number' || !Number.isFinite(field))) throw new TypeError('motion.seed must be a string or finite number')
    } else if (key === 'timing') {
      if (field !== 'minimum-jerk' && field !== 'lognormal') throw new TypeError('Invalid motion.timing')
    } else {
      const range: Record<string, readonly [number, number, boolean]> = {
        durationMs: [0, 60000, false], speedMultiplier: [0, Number.MAX_VALUE, true],
        intervalMs: [0, 60000, true], sampleRateHz: [1, 240, false],
        curvature: [0, 1, false], jitterPx: [0, 10, false],
        targetWidthPx: [0, Number.MAX_VALUE, true], holdMs: [0, 1000, false],
      }
      const [min, max, positive] = range[key]!
      finite(field, `motion.${key}`, min, max, positive)
    }
    out[key] = field
  }
  if (out.intervalMs !== undefined && out.sampleRateHz !== undefined) throw new TypeError('motion.intervalMs and motion.sampleRateHz are mutually exclusive')
  return out as BrowserPointerMotion
}

/** Policy precedence: defaults, saved preferences, then one-call motion; never changes ownership or input protection. */
export function resolvePointerMotion(config: BrowserAutomationConfig, override?: unknown): false | BrowserPointerMotion {
  const settings = normalizeBrowserAutomation(config)
  if (override === false || (override === undefined && !settings.smooth_pointer)) return false
  if (override !== undefined && override !== true && (!override || typeof override !== 'object')) throw new TypeError('motion must be an object or boolean')
  const patch = override === undefined || override === true ? {} : motionPatch(override)
  const precise = settings.pointer_profile === 'precise'
  const result: BrowserPointerMotion = {
    timing: precise ? 'minimum-jerk' : 'lognormal', curvature: precise ? 0.025 : 0.12,
    jitterPx: precise ? 0 : 0.35, speedMultiplier: settings.speed_multiplier,
    intervalMs: settings.interval_ms, ...patch,
  }
  if (patch.sampleRateHz !== undefined) delete result.intervalMs
  return result
}

export type BrowserAutomationOwner = 'ai' | 'paused' | 'user'
export type BrowserAutomationActivity = 'idle' | 'acting' | 'waiting' | 'handoff' | 'error'
export type BrowserAutomationState = {
  owner: BrowserAutomationOwner
  activity: BrowserAutomationActivity
  epoch: number
  activeOperations: number
  cursorEnabled: boolean
  inputProtected: boolean
  nativeConfirmed: boolean
  nativePending: boolean
  handoffTarget?: 'paused' | 'user'
  label?: string
  error?: string
  revision?: number
  stateRevision?: number
  documentEpoch?: number
  needsObservation?: boolean
  cursorAvailable?: boolean
  cursorImageAvailable?: boolean
  cursorVisible?: boolean
  cursorStyle?: BrowserAutomationConfig['cursor_style']
  /** Only the current owner may release a task's page input lease. */
  leaseRunId?: string
  lastResult?: {
    status?: string
    reason?: string
    dispatchedCount?: number | null
    cleanup?: { dispatched: number; failed: number }
  }
}

export function createBrowserAutomationState(): BrowserAutomationState {
  return {
    owner: 'ai', activity: 'idle', epoch: 0, activeOperations: 0,
    cursorEnabled: false, inputProtected: false, nativeConfirmed: true, nativePending: false,
  }
}
