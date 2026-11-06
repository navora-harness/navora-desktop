import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDefaultBrowserAutomation, normalizeBrowserAutomation, mergeBrowserAutomation,
  resolvePointerMotion, createBrowserAutomationState, BROWSER_CURSOR_STYLES,
} from './browser-automation'

test('legacy automation preferences receive fresh defaults without replacing explicit false', () => {
  const defaults = createDefaultBrowserAutomation()
  assert.deepEqual(normalizeBrowserAutomation(undefined), defaults)
  assert.deepEqual(normalizeBrowserAutomation({}), defaults)
  const flags = { show_virtual_cursor: false, show_control_feedback: false, protect_input: false, smooth_pointer: false }
  assert.deepEqual(normalizeBrowserAutomation(flags), { ...defaults, ...flags })
  defaults.show_virtual_cursor = false
  assert.equal(createDefaultBrowserAutomation().show_virtual_cursor, true)
})

test('retired auto-mute values are discarded while saved cursor and input preferences survive', () => {
  const preferences = { ...createDefaultBrowserAutomation(), show_virtual_cursor: false, cursor_style: 'precision-cross' as const, speed_multiplier: 1.25 }
  for (const auto_mute of [true, false, undefined, 'true', null]) {
    const saved = { ...preferences, auto_mute }
    assert.deepEqual(normalizeBrowserAutomation(saved), preferences)
    assert.deepEqual(mergeBrowserAutomation(saved, { protect_input: false }), { ...preferences, protect_input: false })
    assert.deepEqual(mergeBrowserAutomation(preferences, { auto_mute }), preferences)
    assert.equal(Object.hasOwn(saved, 'auto_mute'), true)
  }
  assert.equal(Object.hasOwn(createDefaultBrowserAutomation(), 'auto_mute'), false)
})

test('automation preferences reject invalid shapes, unknown fields, coercion and unsupported numeric values', () => {
  const invalid: unknown[] = [null, true, [], new Date(), { owner: 'user' }, { typo: undefined },
    ...['show_virtual_cursor', 'show_control_feedback', 'protect_input', 'smooth_pointer'].map(key => ({ [key]: 'false' })),
    { pointer_profile: 'human' }, { pointer_profile: null },
    { cursor_style: 'system' }, { cursor_style: null }, { cursor_style: { toString: () => 'navora-arrow' } },
    ...[0, -1, NaN, Infinity, '1'].map(speed_multiplier => ({ speed_multiplier })),
    ...[0, -1, NaN, Infinity, 60001, '8'].map(interval_ms => ({ interval_ms })),
    ...[-1, NaN, Infinity, 1001, 59.5, '60'].map(cursor_fps => ({ cursor_fps })),
    ...[0, 0.74, 2.01, NaN, Infinity, '1'].map(cursor_scale => ({ cursor_scale })),
  ]
  for (const value of invalid) assert.throws(() => normalizeBrowserAutomation(value))
  assert.equal(normalizeBrowserAutomation({ cursor_fps: 0 }).cursor_fps, 0)
  assert.equal(normalizeBrowserAutomation({ interval_ms: 0.125 }).interval_ms, 0.125)
})

test('custom cursor preference defaults to Windows blue glow and preserves existing style choices', () => {
  assert.equal(normalizeBrowserAutomation({}).cursor_style, createDefaultBrowserAutomation().cursor_style)
  assert.equal(normalizeBrowserAutomation({}).cursor_style, 'windows-glow')
  assert.equal(normalizeBrowserAutomation({ cursor_style: 'focus-ring' }).cursor_scale, 1)
  for (const cursor_style of BROWSER_CURSOR_STYLES) {
    assert.equal(mergeBrowserAutomation(createDefaultBrowserAutomation(), { cursor_style }).cursor_style, cursor_style)
  }
})

test('cursor size patches persist without changing movement or input protection preferences', () => {
  const before = createDefaultBrowserAutomation()
  for (const cursor_scale of [0.75, 1, 1.25, 1.5, 1.75, 2]) {
    assert.deepEqual(mergeBrowserAutomation(before, { cursor_scale }), { ...before, cursor_scale })
  }
  assert.equal(before.cursor_scale, 1)
})

test('leaf patches preserve unrelated preferences and never mutate the previous settings', () => {
  const previous = { ...createDefaultBrowserAutomation(), show_virtual_cursor: false, speed_multiplier: 1.25 }
  const before = structuredClone(previous)
  assert.deepEqual(mergeBrowserAutomation(previous, { protect_input: false, speed_multiplier: undefined }), {
    ...previous, protect_input: false,
  })
  for (const patch of [{ speed_multiplier: 0 }, { show_virtual_cursor: 'true' }, { owner: undefined }, null]) {
    assert.throws(() => mergeBrowserAutomation(previous, patch))
    assert.deepEqual(previous, before)
  }
})

test('saved natural and precise profiles supply usable movement settings without injecting click dwell', () => {
  const defaults = createDefaultBrowserAutomation()
  assert.deepEqual(resolvePointerMotion(defaults), {
    timing: 'lognormal', curvature: 0.12, jitterPx: 0.35, speedMultiplier: 0.6, intervalMs: 1000 / 120,
  })
  const precise = resolvePointerMotion({ ...defaults, pointer_profile: 'precise', speed_multiplier: 1.1, interval_ms: 12 })
  assert.notEqual(precise, false)
  if (precise === false) return
  assert.equal(precise.timing, 'minimum-jerk')
  assert.equal(precise.jitterPx, 0)
  assert.ok(precise.curvature! < 0.12)
  assert.equal(precise.speedMultiplier, 1.1)
  assert.equal(precise.intervalMs, 12)
  assert.equal(Object.hasOwn(precise, 'holdMs'), false)
})

test('one-call motion overrides saved policy and disabled motion remains explicit', () => {
  const settings = { ...createDefaultBrowserAutomation(), smooth_pointer: false, speed_multiplier: 1.2 }
  assert.equal(resolvePointerMotion(settings), false)
  assert.equal(resolvePointerMotion(settings, false), false)
  assert.notEqual(resolvePointerMotion(settings, true), false)
  const result = resolvePointerMotion(settings, { speedMultiplier: 0.9, jitterPx: 0, holdMs: 0 })
  assert.ok(result && result.speedMultiplier === 0.9 && result.jitterPx === 0 && result.holdMs === 0)
  assert.equal(settings.speed_multiplier, 1.2)
})

test('sample-rate overrides remove inherited intervals, and conflicting single-call controls reject', () => {
  const settings = createDefaultBrowserAutomation()
  const byRate = resolvePointerMotion(settings, { sampleRateHz: 90 })
  assert.ok(byRate && byRate.sampleRateHz === 90)
  assert.equal(Object.hasOwn(byRate, 'intervalMs'), false)
  const byInterval = resolvePointerMotion(settings, { intervalMs: 7.5 })
  assert.ok(byInterval && byInterval.intervalMs === 7.5)
  assert.equal(Object.hasOwn(byInterval, 'sampleRateHz'), false)
  assert.throws(() => resolvePointerMotion(settings, { sampleRateHz: 90, intervalMs: 7.5 }), TypeError)
})

test('one-call motion cannot change ownership or input protection and rejects invalid values', () => {
  const settings = createDefaultBrowserAutomation()
  const before = structuredClone(settings)
  const invalid: unknown[] = [null, 'fast', [], { protect_input: false }, { owner: 'user' }, { bounds: {} },
    { speedMultiplier: 0 }, { intervalMs: Infinity }, { sampleRateHz: 241 }, { durationMs: -1 },
    { seed: NaN }, { timing: 'linear' }, { curvature: 2 }, { jitterPx: -1 }, { holdMs: 1001 },
  ]
  for (const value of invalid) assert.throws(() => resolvePointerMotion(settings, value))
  assert.deepEqual(settings, before)
})

test('shared idle state starts without claiming active native protection', () => {
  const first = createBrowserAutomationState()
  assert.equal(first.owner, 'ai')
  assert.equal(first.activity, 'idle')
  assert.equal(first.activeOperations, 0)
  assert.equal(first.cursorEnabled, false)
  assert.equal(first.inputProtected, false)
  first.owner = 'user'
  assert.equal(createBrowserAutomationState().owner, 'ai')
})

test('new defaults slow movement while existing explicit speeds remain intact and one-call overrides are bounded',()=>{
  assert.equal(normalizeBrowserAutomation({}).speed_multiplier,0.6)
  assert.equal(normalizeBrowserAutomation({speed_multiplier:1}).speed_multiplier,1)
  for(const speedMultiplier of [0.09,4.01])assert.throws(()=>resolvePointerMotion(createDefaultBrowserAutomation(),{speedMultiplier}))
  for(const speedMultiplier of [0.1,4])assert.ok(resolvePointerMotion(createDefaultBrowserAutomation(),{speedMultiplier}))
})
