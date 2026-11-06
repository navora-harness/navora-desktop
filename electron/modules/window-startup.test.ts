import assert from 'node:assert/strict'
import test from 'node:test'
import { WindowStartup } from './window-startup'

test('startup lasts at least one second after both window visibility and splash paint', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = new WindowStartup()
  let released = false
  const ready = gate.rendererReady().then(value => { released = value })
  gate.splashPainted()
  t.mock.timers.tick(2000)
  await Promise.resolve()
  assert.equal(released, false, 'hidden construction time cannot consume the visible loading duration')
  gate.shown()
  t.mock.timers.tick(999)
  await Promise.resolve()
  assert.equal(released, false)
  gate.shown(); gate.splashPainted()
  t.mock.timers.tick(1)
  await ready
  assert.equal(released, true, 'duplicate notifications do not restart the clock')
})

test('a visible window cannot complete before its icon paints', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = new WindowStartup()
  let released = false
  const ready = gate.rendererReady().then(value => { released = value })
  gate.shown()
  t.mock.timers.tick(5000)
  await Promise.resolve()
  assert.equal(released, false)
  gate.splashPainted()
  t.mock.timers.tick(1000)
  await ready
  assert.equal(released, true)
})

test('slow application initialization holds startup beyond the minimum', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = new WindowStartup()
  let released = false
  void gate.ready.then(value => { released = value })
  gate.shown(); gate.splashPainted()
  t.mock.timers.tick(4000)
  await Promise.resolve()
  assert.equal(released, false)
  assert.equal(await gate.rendererReady(), true)
})

test('closing a loading window cancels the pending reveal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = new WindowStartup()
  gate.shown(); gate.splashPainted()
  const ready = gate.rendererReady()
  gate.dispose()
  t.mock.timers.tick(5000)
  assert.equal(await ready, false)
  assert.equal(await gate.rendererReady(), false)
})
