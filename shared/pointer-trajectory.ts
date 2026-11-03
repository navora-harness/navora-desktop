/** Pure pointer planning. Coordinates are CSS pixels; atMs is elapsed time, not a delay. */
export interface PointerPosition {
  x: number
  y: number
}

export interface PointerTrajectoryPoint extends PointerPosition {
  /** Milliseconds relative to the beginning of the entire input sequence. */
  atMs: number
}

export interface PointerTrajectoryBounds extends PointerPosition {
  /** Inclusive continuous bounds: x..x + width, y..y + height. */
  width: number
  height: number
}

export interface PointerTrajectoryOptions {
  from: PointerPosition
  to: PointerPosition
  /** Base duration before speed scaling. Omit to estimate from distance and target width. Maximum 60 seconds. */
  durationMs?: number
  /** Positive speed scale. 1 is unchanged, 2 halves duration, 0.5 doubles it. Default 1. */
  speedMultiplier?: number
  /** Nominal sampling rate, 1..240 Hz. Default 120. Cannot be combined with intervalMs. */
  sampleRateHz?: number
  /** Explicit positive sampling interval in ms (fractions allowed). Mutually exclusive with sampleRateHz. */
  intervalMs?: number
  /** A seed reproduces coordinates and planned times, independently of the wall clock. */
  seed?: number | string
  timing?: 'minimum-jerk' | 'lognormal'
  /** Relative sideways bend, 0..1. Default 0.12; ignored when controlPoints are supplied. */
  curvature?: number
  /** Smooth spatial variation in pixels, 0..10. Default 0.35; fades at both endpoints. */
  jitterPx?: number
  /** Effective target width used only to estimate an omitted duration. Default 24 CSS px. */
  targetWidthPx?: number
  /** Optional cubic Bezier handles, in the same coordinate system as from/to. */
  controlPoints?: readonly [PointerPosition, PointerPosition]
  /** Endpoints and explicit handles must be inside these bounds; generated paths stay inside. */
  bounds?: PointerTrajectoryBounds
}

/** Structurally compatible with a mouse movement step in the new dispatchInputSequence API. */
export interface PointerInputSequenceStep extends PointerTrajectoryPoint {
  kind: 'mouse'
  type: 'mouseMoved'
}

const COORDINATE_LIMIT = 1_000_000
const MAX_DURATION_MS = 60_000
const MAX_POINTS = 10_000
const TIMING_SEGMENTS = 512
const TWO_PI = Math.PI * 2

type Random = () => number
type Limits = { minX: number; maxX: number; minY: number; maxY: number }

function finiteRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}`)
  }
  return value
}

function validatePosition(name: string, position: PointerPosition): void {
  if (!position || typeof position !== 'object') throw new TypeError(`${name} must be a point`)
  finiteRange(`${name}.x`, position.x, -COORDINATE_LIMIT, COORDINATE_LIMIT)
  finiteRange(`${name}.y`, position.y, -COORDINATE_LIMIT, COORDINATE_LIMIT)
}

function limitsFor(bounds?: PointerTrajectoryBounds): Limits {
  if (bounds === undefined) {
    return { minX: -COORDINATE_LIMIT, maxX: COORDINATE_LIMIT, minY: -COORDINATE_LIMIT, maxY: COORDINATE_LIMIT }
  }
  validatePosition('bounds', bounds)
  if (!Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height) || bounds.height <= 0) {
    throw new RangeError('bounds.width and bounds.height must be finite and positive')
  }
  return {
    minX: bounds.x,
    maxX: finiteRange('bounds right edge', bounds.x + bounds.width, -COORDINATE_LIMIT, COORDINATE_LIMIT),
    minY: bounds.y,
    maxY: finiteRange('bounds bottom edge', bounds.y + bounds.height, -COORDINATE_LIMIT, COORDINATE_LIMIT),
  }
}

function requireInside(name: string, position: PointerPosition, limits: Limits): void {
  if (position.x < limits.minX || position.x > limits.maxX || position.y < limits.minY || position.y > limits.maxY) {
    throw new RangeError(`${name} must be inside bounds`)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function bounded(position: PointerPosition, limits: Limits): PointerPosition {
  return { x: clamp(position.x, limits.minX, limits.maxX), y: clamp(position.y, limits.minY, limits.maxY) }
}

function seededRandom(seed?: number | string): Random {
  if (seed !== undefined && typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed))) {
    throw new TypeError('seed must be a finite number or a string')
  }
  const key = seed === undefined ? `random:${Math.random()}` : `${typeof seed}:${seed}`
  let state = 2166136261
  for (let i = 0; i < key.length; i++) state = Math.imul(state ^ key.charCodeAt(i), 16777619)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function lerp(a: PointerPosition, b: PointerPosition, t: number): PointerPosition {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function makePath(options: PointerTrajectoryOptions, limits: Limits, random: Random, distance: number) {
  const { from, to } = options
  const dx = (to.x - from.x) / distance
  const dy = (to.y - from.y) / distance
  const bend = Math.min(distance * (options.curvature ?? 0.12), 160) * (random() < 0.5 ? -1 : 1)
  const handle = (along: number, sideways: number) => bounded({
    x: from.x + dx * distance * along - dy * sideways,
    y: from.y + dy * distance * along + dx * sideways,
  }, limits)
  const controls = options.controlPoints ?? [
    handle(0.25 + random() * 0.12, bend * (0.5 + random() * 0.5)),
    handle(0.65 + random() * 0.12, bend * (0.5 + random() * 0.5)),
  ]
  const amplitude = Math.min(options.jitterPx ?? 0.35, distance * 0.01)
  const phase1 = random() * TWO_PI
  const phase2 = random() * TWO_PI
  const frequency1 = 1.2 + random() * 1.2
  const frequency2 = 2.8 + random() * 1.4
  return (t: number): PointerPosition => {
    if (t <= 0) return { x: from.x, y: from.y }
    if (t >= 1) return { x: to.x, y: to.y }
    // De Casteljau keeps the curve within the convex hull of its four handles.
    const a = lerp(from, controls[0], t)
    const b = lerp(controls[0], controls[1], t)
    const c = lerp(controls[1], to, t)
    const point = bounded(lerp(lerp(a, b, t), lerp(b, c, t), t), limits)
    const clearance = Math.max(0, Math.min(
      point.x - limits.minX, limits.maxX - point.x,
      point.y - limits.minY, limits.maxY - point.y,
    ))
    // A smooth endpoint envelope and a clearance limiter prevent jitter outside bounds.
    const envelope = 64 * t ** 3 * (1 - t) ** 3
    const variation = amplitude === 0 ? 0 : amplitude * envelope * clearance / (clearance + 2 * amplitude)
    const lateral = variation * (0.7 * Math.sin(TWO_PI * frequency1 * t + phase1) + 0.3 * Math.sin(TWO_PI * frequency2 * t + phase2))
    const longitudinal = variation * 0.15 * Math.sin(TWO_PI * frequency1 * t + phase2)
    return bounded({ x: point.x - dy * lateral + dx * longitudinal, y: point.y + dx * lateral + dy * longitudinal }, limits)
  }
}

function minimumJerk(t: number): number {
  return t * t * t * (10 + t * (-15 + 6 * t))
}

function makeTiming(timing: NonNullable<PointerTrajectoryOptions['timing']>, random: Random): (t: number) => number {
  if (timing === 'minimum-jerk') return minimumJerk
  // Bounded, endpoint-tapered lognormal velocity pulses. This is a practical timing
  // model, not a claim that arbitrary curved motion is a fitted Sigma-Lognormal model.
  const sigma = 0.35 + random() * 0.12
  const mu = Math.log(0.38 + random() * 0.08) + sigma * sigma
  const correctionStart = 0.52 + random() * 0.06
  const correctionWeight = 0.03 + random() * 0.04
  const pulse = (t: number, onset: number, mean: number, deviation: number) => {
    const elapsed = t - onset
    if (elapsed <= 0) return 0
    const z = (Math.log(elapsed) - mean) / deviation
    return Math.exp(-0.5 * z * z) / (elapsed * deviation)
  }
  const density = (t: number) => {
    if (t <= 0 || t >= 1) return 0
    return (pulse(t, 0, mu, sigma) + correctionWeight * pulse(t, correctionStart, Math.log(0.16), 0.3)) * t * t * (1 - t) ** 2
  }
  const cumulative = [0]
  let previous = 0
  let total = 0
  for (let i = 1; i <= TIMING_SEGMENTS; i++) {
    const current = density(i / TIMING_SEGMENTS)
    total += (previous + current) / (2 * TIMING_SEGMENTS)
    cumulative.push(total)
    previous = current
  }
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const index = t * TIMING_SEGMENTS
    const lower = Math.floor(index)
    return (cumulative[lower] + (cumulative[lower + 1] - cumulative[lower]) * (index - lower)) / total
  }
}

/**
 * Generate coordinates only: no Electron dependency, timers, DOM reads, clicks or dispatch.
 * All positions use one caller-chosen coordinate system; no frame/DPI conversion is done.
 * The path is sampled by arc length so handle placement does not dictate pointer speed.
 */
export function generatePointerTrajectory(options: PointerTrajectoryOptions): PointerTrajectoryPoint[] {
  if (!options || typeof options !== 'object') throw new TypeError('options are required')
  validatePosition('from', options.from)
  validatePosition('to', options.to)
  if (options.intervalMs !== undefined && options.sampleRateHz !== undefined) {
    throw new TypeError('intervalMs and sampleRateHz are mutually exclusive')
  }
  const sampleRate = finiteRange('sampleRateHz', options.sampleRateHz ?? 120, 1, 240)
  const interval = options.intervalMs === undefined ? 1000 / sampleRate : options.intervalMs
  if (!Number.isFinite(interval) || interval <= 0 || interval > MAX_DURATION_MS) {
    throw new RangeError(`intervalMs must be finite, positive and at most ${MAX_DURATION_MS}`)
  }
  const speed = options.speedMultiplier === undefined ? 1 : options.speedMultiplier
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('speedMultiplier must be finite and positive')
  finiteRange('curvature', options.curvature ?? 0.12, 0, 1)
  finiteRange('jitterPx', options.jitterPx ?? 0.35, 0, 10)
  const targetWidth = options.targetWidthPx ?? 24
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) throw new RangeError('targetWidthPx must be finite and positive')
  const timing = options.timing ?? 'lognormal'
  if (timing !== 'lognormal' && timing !== 'minimum-jerk') throw new TypeError('unsupported timing model')
  const limits = limitsFor(options.bounds)
  requireInside('from', options.from, limits)
  requireInside('to', options.to, limits)
  if (options.controlPoints !== undefined) {
    if (!Array.isArray(options.controlPoints) || options.controlPoints.length !== 2) throw new TypeError('controlPoints must contain exactly two points')
    for (let index = 0; index < 2; index++) {
      const point = options.controlPoints[index]
      validatePosition(`controlPoints[${index}]`, point)
      requireInside(`controlPoints[${index}]`, point, limits)
    }
  }
  const random = seededRandom(options.seed)
  const distance = Math.hypot(options.to.x - options.from.x, options.to.y - options.from.y)
  // Coefficients are initial tuning choices, not a measured user/device calibration.
  const baseDuration = options.durationMs ?? (distance === 0 ? 0 : clamp(
    (120 + 95 * Math.log2(1 + distance / targetWidth)) * (0.9 + random() * 0.2), 80, 1800,
  ))
  finiteRange('durationMs', baseDuration, 0, MAX_DURATION_MS)
  const duration = baseDuration / speed
  finiteRange('scaled durationMs', duration, 0, MAX_DURATION_MS)
  if (baseDuration > 0 && duration === 0) throw new RangeError('speedMultiplier makes duration too small to represent')
  if (distance === 0) {
    const start = { x: options.from.x, y: options.from.y, atMs: 0 }
    return duration === 0 ? [start] : [start, { ...start, atMs: duration }]
  }
  if (duration <= 0) throw new RangeError('durationMs must be positive for movement')
  let intervals = Math.max(1, Math.ceil(options.intervalMs === undefined ? duration * sampleRate / 1000 : duration / interval))
  // Multiplication can round a nominal interior sample onto the exact endpoint.
  if (options.intervalMs !== undefined && intervals > 1 && (intervals - 1) * interval >= duration) intervals--
  if (intervals + 1 > MAX_POINTS) throw new RangeError(`trajectory exceeds ${MAX_POINTS} points; increase intervalMs or speedMultiplier, or reduce sampleRateHz or durationMs`)
  const path = makePath(options, limits, random, distance)
  const progressAt = makeTiming(timing, random)
  const pathSegments = clamp(Math.ceil(distance / 2), 256, 2048)
  const arcLengths = [0]
  let last = path(0)
  let totalLength = 0
  for (let i = 1; i <= pathSegments; i++) {
    const point = path(i / pathSegments)
    totalLength += Math.hypot(point.x - last.x, point.y - last.y)
    arcLengths.push(totalLength)
    last = point
  }
  const result: PointerTrajectoryPoint[] = [{ x: options.from.x, y: options.from.y, atMs: 0 }]
  for (let i = 1; i < intervals; i++) {
    const atMs = options.intervalMs === undefined ? duration * (i / intervals) : i * interval
    const fraction = options.intervalMs === undefined ? i / intervals : atMs / duration
    const targetLength = clamp(progressAt(fraction), 0, 1) * totalLength
    let lower = 0
    let upper = pathSegments
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2)
      if (arcLengths[middle] < targetLength) lower = middle
      else upper = middle
    }
    const segmentLength = arcLengths[upper] - arcLengths[lower]
    const local = segmentLength > 0 ? (targetLength - arcLengths[lower]) / segmentLength : 0
    const point = path((lower + local) / pathSegments)
    result.push({ ...point, atMs })
  }
  result.push({ x: options.to.x, y: options.to.y, atMs: duration })
  return result
}

/**
 * Convert points to native sequence steps, without dispatching. Omitting button/buttons
 * lets Electron retain the button state of a surrounding press/move/release sequence.
 * Do not append different coordinate systems or separately-zeroed trajectories unchanged.
 */
export function toPointerInputSequence(points: readonly PointerTrajectoryPoint[]): PointerInputSequenceStep[] {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS) {
    throw new RangeError(`points must contain 1..${MAX_POINTS} entries`)
  }
  let previousTime = 0
  return Array.from(points, (point, index) => {
    validatePosition(`points[${index}]`, point)
    finiteRange(`points[${index}].atMs`, point.atMs, previousTime, MAX_DURATION_MS)
    previousTime = point.atMs
    return { kind: 'mouse', type: 'mouseMoved', x: point.x, y: point.y, atMs: point.atMs }
  })
}
