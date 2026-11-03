import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from './config'
import { prepareSettingsPatch, sanitizeConfigForAgent } from './settings-tools'

test('Agent automation updates remain changed-leaf patches and preserve explicit false', () => {
  const patch = { browser: { automation: { show_virtual_cursor: false, speed_multiplier: 1.05 }, default_width: 1200 } }
  assert.deepEqual(prepareSettingsPatch(patch), { ok: true, patch })
})

test('Agent settings reject malformed automation before any configuration is changed', () => {
  for (const automation of [null, [], { protect_input: 'false' }, { interval_ms: 0 }, { speed_multiplier: Infinity }, { cursor_fps: 0.5 }, { owner: 'user' }]) {
    const result = prepareSettingsPatch({ browser: { automation }, app: { language: 'en' } })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'invalid_browser_automation')
  }
})

test('Agent settings expose automation preferences without exposing permissions or password hashes', () => {
  const config = createDefaultConfig()
  const safe = sanitizeConfigForAgent(config)
  assert.deepEqual((safe.browser as Record<string, unknown>).automation, config.browser.automation)
  assert.equal(Object.hasOwn(safe, 'permissions'), false)
  assert.equal(Object.hasOwn(safe.remote as object, 'passwordHash'), false)
  assert.equal(prepareSettingsPatch({ permissions: {} }).ok, false)
})
