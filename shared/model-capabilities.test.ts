import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudbypassModelSettings, normalizeModelCapabilities, renameReasoningLevel, removeReasoningLevel } from './model-capabilities'

test('renaming/removing default tiers preserves an intentional valid selection', () => {
  const model = cloudbypassModelSettings()['qwen38-turbo-q6']!
  const r = model.reasoning
  assert.equal(renameReasoningLevel(r, 1, 'quick'), true)
  assert.equal(normalizeModelCapabilities(model).reasoning.default, 'quick')
  assert.equal(renameReasoningLevel(r, 1, 'high'), false)
  assert.equal(r.default, 'quick')
  removeReasoningLevel(r, 1)
  assert.equal(r.default, 'medium')
  assert.equal(r.levels.find(l => l.id === 'high')?.value, 'xhigh')
})
