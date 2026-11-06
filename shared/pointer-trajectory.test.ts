import test from 'node:test'
import assert from 'node:assert/strict'
import { generatePointerTrajectory, toPointerInputSequence } from './pointer-trajectory'

type Options = Parameters<typeof generatePointerTrajectory>[0]
type Point = ReturnType<typeof generatePointerTrajectory>[number]

const base: Options = {
  from: { x: 25.25, y: 45.5 },
  to: { x: 625.75, y: 345.125 },
  durationMs: 800,
  sampleRateHz: 120,
  seed: 'pointer-tests',
}

function assertMovement(points: Point[], from: Options['from'], to: Options['to'], duration: number) {
  assert.ok(points.length >= 2 && points.length <= 10000)
  assert.deepEqual(points[0], { ...from, atMs: 0 })
  assert.deepEqual(points.at(-1), { ...to, atMs: duration })
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    assert.deepEqual(Object.keys(point).sort(), ['atMs', 'x', 'y'])
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.atMs))
    assert.ok(Math.abs(point.x) <= 1000000 && Math.abs(point.y) <= 1000000)
    if (index > 0) assert.ok(point.atMs > points[index - 1]!.atMs)
  }
}

test('moving trajectories preserve fractional endpoints and the complete relative timeline', () => {
  for (const timing of ['minimum-jerk', 'lognormal'] as const) {
    const points = generatePointerTrajectory({ ...base, timing, durationMs: 813.625 })
    assertMovement(points, base.from, base.to, 813.625)
    assert.ok(points.some(({ x, y, atMs }) => !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(atMs)))
  }
})

test('a seed reproduces geometry and timestamps while distinct seeds vary a natural movement', () => {
  const first = generatePointerTrajectory(base)
  assert.deepEqual(generatePointerTrajectory(base), first)
  assert.notDeepEqual(generatePointerTrajectory({ ...base, seed: 'another-profile' }), first)
  assert.deepEqual(
    generatePointerTrajectory({ ...base, seed: 0 }),
    generatePointerTrajectory({ ...base, seed: 0 }),
  )
})

test('straight undisturbed movement accelerates then slows near the destination', () => {
  for (const timing of ['minimum-jerk', 'lognormal'] as const) {
    const points = generatePointerTrajectory({
      from: { x: 0, y: 0 }, to: { x: 600, y: 0 },
      durationMs: 1000, sampleRateHz: 120, curvature: 0, jitterPx: 0,
      timing, seed: 'speed',
    })
    const speeds = points.slice(1).map((point, index) => {
      const previous = points[index]!
      return Math.hypot(point.x - previous.x, point.y - previous.y) / (point.atMs - previous.atMs)
    })
    const peak = Math.max(...speeds)
    assert.ok(peak > speeds[0]! * 2, `${timing}: beginning should be slower than peak`)
    assert.ok(peak > speeds.at(-1)! * 2, `${timing}: ending should be slower than peak`)
    assert.ok(speeds.indexOf(peak) > 0 && speeds.indexOf(peak) < speeds.length - 1)
    for (let index = 1; index < points.length; index++) {
      assert.ok(points[index]!.x >= points[index - 1]!.x)
      assert.ok(Math.abs(points[index]!.y) < 1e-9)
    }
  }
})

test('vertical, reversed, negative, and subpixel movements retain direction and endpoints', () => {
  const pairs = [
    [{ x: 30, y: 500 }, { x: 30, y: -200 }],
    [{ x: 800, y: 20 }, { x: -100, y: 20 }],
    [{ x: -0.25, y: -0.75 }, { x: -0.2499, y: -0.7499 }],
  ] as const
  for (const [from, to] of pairs) {
    const points = generatePointerTrajectory({ ...base, from, to, curvature: 0, jitterPx: 0 })
    assertMovement(points, from, to, 800)
    for (const point of points) {
      assert.ok(point.x >= Math.min(from.x, to.x) - 1e-9 && point.x <= Math.max(from.x, to.x) + 1e-9)
      assert.ok(point.y >= Math.min(from.y, to.y) - 1e-9 && point.y <= Math.max(from.y, to.y) + 1e-9)
    }
  }
})

test('a shorter duration than the sample interval still includes both exact endpoints', () => {
  const points = generatePointerTrajectory({ ...base, durationMs: 0.125, sampleRateHz: 1 })
  assertMovement(points, base.from, base.to, 0.125)
})

test('sample density can change without changing the requested duration or destination', () => {
  const sparse = generatePointerTrajectory({ ...base, sampleRateHz: 30 })
  const dense = generatePointerTrajectory({ ...base, sampleRateHz: 240 })
  assert.ok(dense.length > sparse.length)
  assert.deepEqual(dense[0], sparse[0])
  assert.deepEqual(dense.at(-1), sparse.at(-1))
})

test('speed multiplier scales requested and adaptive duration while preserving default behavior', () => {
  const original = generatePointerTrajectory(base)
  assert.deepEqual(generatePointerTrajectory({ ...base, speedMultiplier: 1 }), original)
  assertMovement(generatePointerTrajectory({ ...base, speedMultiplier: 2 }), base.from, base.to, 400)
  assertMovement(generatePointerTrajectory({ ...base, speedMultiplier: 0.5 }), base.from, base.to, 1600)
  const adaptive = { from: base.from, to: base.to, seed: base.seed }
  const adaptiveDuration = generatePointerTrajectory(adaptive).at(-1)!.atMs
  assert.equal(generatePointerTrajectory({ ...adaptive, speedMultiplier: 2 }).at(-1)!.atMs, adaptiveDuration / 2)
  assert.equal(generatePointerTrajectory({ ...adaptive, speedMultiplier: 0.5 }).at(-1)!.atMs, adaptiveDuration * 2)
})

test('speed changes retain seeded coordinates at the same normalized times', () => {
  for (const timing of ['minimum-jerk', 'lognormal'] as const) {
    const normal = generatePointerTrajectory({ ...base, timing })
    const fast = generatePointerTrajectory({ ...base, timing, speedMultiplier: 2, sampleRateHz: 240 })
    const slow = generatePointerTrajectory({ ...base, timing, speedMultiplier: 0.5, sampleRateHz: 60 })
    assert.equal(fast.length, normal.length)
    assert.equal(slow.length, normal.length)
    for (let index = 0; index < normal.length; index++) {
      const expected = normal[index]!
      for (const [points, timeScale] of [[fast, 0.5], [slow, 2]] as const) {
        const actual = points[index]!
        assert.ok(Math.abs(actual.x - expected.x) < 1e-8)
        assert.ok(Math.abs(actual.y - expected.y) < 1e-8)
        assert.equal(actual.atMs, expected.atMs * timeScale)
      }
    }
  }
})

test('explicit fractional intervals retain each scheduled time and append a shorter final gap', () => {
  const options = { ...base, sampleRateHz: undefined, durationMs: 10, intervalMs: 2.5 }
  const divisible = generatePointerTrajectory(options)
  assert.deepEqual(divisible.map(({ atMs }) => atMs), [0, 2.5, 5, 7.5, 10])
  const nondivisible = generatePointerTrajectory({ ...options, durationMs: 10.75 })
  assert.deepEqual(nondivisible.map(({ atMs }) => atMs), [0, 2.5, 5, 7.5, 10, 10.75])
  assertMovement(nondivisible, base.from, base.to, 10.75)
})

test('decimal interval rounding never duplicates the final endpoint timestamp', () => {
  const durationMs = 0.30000000000000004
  const points = generatePointerTrajectory({ ...base, sampleRateHz: undefined, durationMs, intervalMs: 0.1 })
  assert.deepEqual(points.map(({ atMs }) => atMs), [0, 0.1, 0.2, durationMs])
  assertMovement(points, base.from, base.to, durationMs)
})

test('an interval exceeding movement duration still includes both exact endpoints', () => {
  const points = generatePointerTrajectory({ ...base, sampleRateHz: undefined, durationMs: 0.125, intervalMs: 1000 })
  assert.deepEqual(points, [
    { ...base.from, atMs: 0 }, { ...base.to, atMs: 0.125 },
  ])
})

test('speed and explicit interval combine on the effective elapsed timeline', () => {
  const options = { ...base, sampleRateHz: undefined, durationMs: 41, intervalMs: 8, speedMultiplier: 2 }
  const points = generatePointerTrajectory(options)
  assert.deepEqual(points.map(({ atMs }) => atMs), [0, 8, 16, 20.5])
  assertMovement(points, base.from, base.to, 20.5)
  const unscaled = generatePointerTrajectory({ ...options, durationMs: 20.5, speedMultiplier: 1 })
  assert.deepEqual(points, unscaled)
})

test('stationary hold duration scales without adding movement or extra sampling points', () => {
  const location = { x: 7.25, y: 8.5 }
  const options = { from: location, to: location, intervalMs: 1, durationMs: 100, seed: 3 }
  assert.deepEqual(generatePointerTrajectory({ ...options, speedMultiplier: 2 }), [
    { ...location, atMs: 0 }, { ...location, atMs: 50 },
  ])
  assert.deepEqual(generatePointerTrajectory({ ...options, speedMultiplier: 0.5 }), [
    { ...location, atMs: 0 }, { ...location, atMs: 200 },
  ])
  assert.deepEqual(generatePointerTrajectory({ ...options, durationMs: 0, speedMultiplier: 2 }), [
    { ...location, atMs: 0 },
  ])
})

test('speed and interval parameters reject invalid values and conflicting sampling controls', () => {
  const invalid: unknown[] = [
    ...[0, -1, NaN, Infinity, '2'].map((speedMultiplier) => ({ ...base, speedMultiplier })),
    ...[0, -1, NaN, Infinity, 60000.01, '8'].map((intervalMs) => ({ ...base, sampleRateHz: undefined, intervalMs })),
  ]
  for (const options of invalid) assert.throws(() => generatePointerTrajectory(options as Options))
  assert.throws(() => generatePointerTrajectory({ ...base, intervalMs: 8 }), TypeError)
  assert.throws(() => generatePointerTrajectory({ ...base, intervalMs: 8, sampleRateHz: 120 }), TypeError)
})

test('speed scaling rejects native time overflow, invalid base durations, and positive-duration underflow', () => {
  const invalid = [
    { ...base, durationMs: 60000, speedMultiplier: 0.5 },
    { ...base, durationMs: 60000.01, speedMultiplier: 2 },
    { ...base, durationMs: Number.MIN_VALUE, speedMultiplier: 2 },
    { ...base, durationMs: 1, speedMultiplier: Number.MIN_VALUE },
  ]
  for (const options of invalid) assert.throws(() => generatePointerTrajectory(options), RangeError)
  const limit = generatePointerTrajectory({ ...base, durationMs: 30000, speedMultiplier: 0.5, sampleRateHz: 1 })
  assertMovement(limit, base.from, base.to, 60000)
})

test('interval cardinality uses effective duration and retains the exact native point-count limit', () => {
  const options = { ...base, sampleRateHz: undefined, intervalMs: 1 }
  const full = generatePointerTrajectory({ ...options, durationMs: 9999 })
  assert.equal(full.length, 10000)
  assert.equal(full.at(-1)!.atMs, 9999)
  assert.throws(() => generatePointerTrajectory({ ...options, durationMs: 10000 }), RangeError)
  assert.throws(() => generatePointerTrajectory({ ...options, durationMs: 5000, speedMultiplier: 0.5 }), RangeError)
  const fast = generatePointerTrajectory({ ...options, durationMs: 10000, speedMultiplier: 2 })
  assert.equal(fast.length, 5001)
  assertMovement(fast, base.from, base.to, 5000)
  assert.throws(() => generatePointerTrajectory({ ...options, durationMs: 1, intervalMs: Number.MIN_VALUE }), RangeError)
})

test('adaptive timing stays in native limits and grows with distance at fixed target width', () => {
  const options = { from: { x: 0, y: 0 }, targetWidthPx: 20, seed: 'adaptive', jitterPx: 0 }
  const near = generatePointerTrajectory({ ...options, to: { x: 80, y: 0 } })
  const far = generatePointerTrajectory({ ...options, to: { x: 800, y: 0 } })
  const largeTarget = generatePointerTrajectory({ ...options, to: { x: 800, y: 0 }, targetWidthPx: 120 })
  assert.ok(near.at(-1)!.atMs > 0)
  assert.ok(far.at(-1)!.atMs > near.at(-1)!.atMs)
  assert.ok(far.at(-1)!.atMs <= 60000)
  assert.ok(largeTarget.at(-1)!.atMs < far.at(-1)!.atMs)
})

test('stationary movement uses one instant point or an explicit two-point hold', () => {
  const location = { x: 42.125, y: -3.25 }
  const options = { from: location, to: location, seed: 1 }
  assert.deepEqual(generatePointerTrajectory(options), [{ ...location, atMs: 0 }])
  assert.deepEqual(generatePointerTrajectory({ ...options, durationMs: 0 }), [{ ...location, atMs: 0 }])
  assert.deepEqual(generatePointerTrajectory({ ...options, durationMs: 250.5 }), [
    { ...location, atMs: 0 }, { ...location, atMs: 250.5 },
  ])
})

test('caller control points determine the curve and caller inputs remain unchanged', () => {
  const from = Object.freeze({ x: 0, y: 0 })
  const to = Object.freeze({ x: 100, y: 0 })
  const controlPoints = Object.freeze([
    Object.freeze({ x: 10, y: 80 }), Object.freeze({ x: 90, y: 80 }),
  ] as const)
  const options = Object.freeze({ ...base, from, to, controlPoints, jitterPx: 0 })
  const before = JSON.stringify(options)
  const points = generatePointerTrajectory(options)
  assertMovement(points, from, to, 800)
  assert.ok(Math.max(...points.map(({ y }) => y)) > 30)
  assert.ok(points.every(({ y }) => y >= 0 && y <= 80))
  assert.equal(JSON.stringify(options), before)
  points[0]!.x = 999
  assert.equal(from.x, 0)
})

test('arc-length timing keeps collinear progress stable across uneven control-point spacing', () => {
  const options = {
    from: { x: 0, y: 0 }, to: { x: 600, y: 0 },
    durationMs: 1000, sampleRateHz: 120, timing: 'minimum-jerk' as const,
    jitterPx: 0, seed: 'arc-length',
  }
  const uniform = generatePointerTrajectory({
    ...options, controlPoints: [{ x: 200, y: 0 }, { x: 400, y: 0 }],
  })
  const uneven = generatePointerTrajectory({
    ...options, controlPoints: [{ x: 1, y: 0 }, { x: 10, y: 0 }],
  })
  assert.equal(uneven.length, uniform.length)
  for (let index = 0; index < uniform.length; index++) {
    assert.equal(uneven[index]!.atMs, uniform[index]!.atMs)
    assert.ok(Math.abs(uneven[index]!.x - uniform[index]!.x) < 1,
      `control spacing changed progress at ${uniform[index]!.atMs} ms`)
    assert.equal(uneven[index]!.y, 0)
  }
})

test('sparse control-point tuples reject missing handles instead of producing an invalid curve', () => {
  for (const populatedIndex of [0, 1]) {
    const controlPoints = new Array<{ x: number; y: number }>(2)
    controlPoints[populatedIndex] = { x: 100, y: 100 }
    assert.throws(() => generatePointerTrajectory({
      ...base,
      controlPoints: controlPoints as unknown as Options['controlPoints'],
    }))
  }
})

test('bounds contain every generated point including high jitter near viewport edges', () => {
  const bounds = { x: -5, y: -10, width: 100, height: 60 }
  const from = { x: bounds.x, y: bounds.y }
  const to = { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  for (let seed = 0; seed < 16; seed++) {
    const points = generatePointerTrajectory({ ...base, from, to, bounds, jitterPx: 10, curvature: 1, seed })
    assertMovement(points, from, to, 800)
    for (const { x, y } of points) {
      assert.ok(x >= bounds.x && x <= bounds.x + bounds.width)
      assert.ok(y >= bounds.y && y <= bounds.y + bounds.height)
    }
  }
})

test('extreme valid coordinates remain within the native coordinate range without explicit bounds', () => {
  const from = { x: -1000000, y: 1000000 }
  const to = { x: 1000000, y: -1000000 }
  const points = generatePointerTrajectory({ ...base, from, to, jitterPx: 10, curvature: 1 })
  assertMovement(points, from, to, 800)
})

test('generator rejects invalid coordinates, durations, sampling, shape, timing, and seed values', () => {
  const invalid: unknown[] = [
    { ...base, from: { x: NaN, y: 0 } },
    { ...base, to: { x: 0, y: Infinity } },
    { ...base, to: { x: 1000000.001, y: 0 } },
    { ...base, from: { x: -1000000.001, y: 0 } },
    { ...base, from: { x: '5', y: 0 } },
    ...[0, -1, 60000.001, NaN, Infinity].map((durationMs) => ({ ...base, durationMs })),
    ...[0, -1, 240.001, NaN, Infinity].map((sampleRateHz) => ({ ...base, sampleRateHz })),
    ...[-0.001, 1.001, NaN].map((curvature) => ({ ...base, curvature })),
    ...[-0.001, 10.001, NaN].map((jitterPx) => ({ ...base, jitterPx })),
    ...[0, -1, NaN, Infinity].map((targetWidthPx) => ({ ...base, targetWidthPx })),
    { ...base, seed: NaN }, { ...base, seed: Infinity },
    { ...base, seed: {} }, { ...base, timing: 'linear' },
    { ...base, controlPoints: [{ x: 0, y: 0 }] },
    { ...base, controlPoints: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] },
  ]
  for (const options of invalid) assert.throws(() => generatePointerTrajectory(options as Options))
})

test('bounds reject invalid dimensions, endpoints outside, and explicit controls outside', () => {
  const from = { x: 1, y: 1 }
  const to = { x: 9, y: 9 }
  const bounds = { x: 0, y: 0, width: 10, height: 10 }
  const options = { ...base, from, to, bounds }
  const invalid: unknown[] = [
    { ...options, bounds: { ...bounds, width: 0 } },
    { ...options, bounds: { ...bounds, height: -1 } },
    { ...options, bounds: { ...bounds, x: NaN } },
    { ...options, bounds: { ...bounds, height: Infinity } },
    { ...options, from: { x: -0.01, y: 1 } },
    { ...options, to: { x: 9, y: 10.01 } },
    { ...options, controlPoints: [{ x: 5, y: -0.01 }, { x: 5, y: 5 }] },
  ]
  for (const value of invalid) assert.throws(() => generatePointerTrajectory(value as Options))
})

test('oversized plans fail before output while a valid 60-second sparse plan is accepted', () => {
  assert.throws(() => generatePointerTrajectory({ ...base, durationMs: 60000, sampleRateHz: 240 }), RangeError)
  const points = generatePointerTrajectory({ ...base, durationMs: 60000, sampleRateHz: 1 })
  assertMovement(points, base.from, base.to, 60000)
})

test('native sequence adapter preserves fractional coordinates, offsets, and same-time ordering', () => {
  const points = [
    { x: -0.125, y: 3.75, atMs: 0.25 },
    { x: 5.625, y: 6.875, atMs: 0.25 },
    { x: 9.5, y: 10.25, atMs: 17.125 },
  ]
  const before = JSON.stringify(points)
  const sequence = toPointerInputSequence(points)
  assert.deepEqual(sequence, points.map((point) => ({ kind: 'mouse', type: 'mouseMoved', position: {x:point.x,y:point.y}, atMs:point.atMs })))
  for (const step of sequence) {
    assert.deepEqual(Object.keys(step).sort(), ['atMs', 'kind', 'position', 'type'])
  }
  assert.equal(JSON.stringify(points), before)
  assert.notEqual(sequence[0], points[0])
})

test('native sequence adapter accepts both native coordinate and timeline limits', () => {
  assert.deepEqual(toPointerInputSequence([
    { x: -1000000, y: 1000000, atMs: 0 },
    { x: 1000000, y: -1000000, atMs: 60000 },
  ]).at(-1), { kind: 'mouse', type: 'mouseMoved', position: {x: 1000000, y: -1000000}, atMs: 60000 })
  const full = Array.from({ length: 10000 }, (_, atMs) => ({ x: 0, y: 0, atMs }))
  assert.equal(toPointerInputSequence(full).length, 10000)
})

test('native sequence adapter rejects invalid batches, coordinates, and timelines', () => {
  const point = { x: 1, y: 2, atMs: 0 }
  const invalid: unknown[] = [
    [], null, {}, [null],
    [{ ...point, x: NaN }], [{ ...point, y: Infinity }],
    [{ ...point, x: -1000000.01 }], [{ ...point, y: 1000000.01 }],
    [{ ...point, x: '1' }],
    ...[-1, NaN, Infinity, 60000.01].map((atMs) => [{ ...point, atMs }]),
    [{ ...point, atMs: 2 }, { ...point, atMs: 1 }],
    Array.from({ length: 10001 }, () => ({ ...point })),
  ]
  for (const points of invalid) {
    assert.throws(() => toPointerInputSequence(points as Parameters<typeof toPointerInputSequence>[0]))
  }
})

test('sparse coordinate batches reject holes instead of forwarding sparse native input steps', () => {
  const empty = new Array<Point>(2)
  const missingFirst = new Array<Point>(2)
  missingFirst[1] = { x: 20, y: 30, atMs: 10 }
  const missingLast = new Array<Point>(2)
  missingLast[0] = { x: 10, y: 20, atMs: 0 }
  const missingMiddle = new Array<Point>(3)
  missingMiddle[0] = { x: 10, y: 20, atMs: 0 }
  missingMiddle[2] = { x: 20, y: 30, atMs: 10 }
  for (const points of [empty, missingFirst, missingLast, missingMiddle]) {
    assert.throws(() => toPointerInputSequence(points))
  }
})

test('generated trajectories adapt without changing their timeline or mutating the plan', () => {
  const points = generatePointerTrajectory(base)
  const before = JSON.stringify(points)
  const steps = toPointerInputSequence(points)
  assert.equal(steps.length, points.length)
  assert.deepEqual(steps.map(({ position, atMs }) => ({ ...position, atMs })), points)
  assert.equal(JSON.stringify(points), before)
})
