import test from 'node:test'
import assert from 'node:assert/strict'
import { browserSessionLabel, normalizeBrowserSessionUpdate } from './browser-session'

test('session metadata keeps a stable numeric fallback and trims user labels', () => {
  assert.equal(browserSessionLabel({ sessionIndex: 7 }), '会话 7')
  assert.equal(browserSessionLabel({ sessionIndex: 7, name: ' 资料浏览 ' }), '资料浏览')
  assert.deepEqual(normalizeBrowserSessionUpdate({ name: ' 资料浏览 ', isDefault: true }), { name: '资料浏览', isDefault: true })
  assert.deepEqual(normalizeBrowserSessionUpdate({ name: ' ' }), { name: '' })
})

test('session metadata rejects storage changes and malformed supplied values', () => {
  for (const value of [null, [], 'name', { persist: true }, { name: null }, { name: 'a\nlabel' }, { name: 'a'.repeat(81) }, { isDefault: 'true' }]) {
    assert.throws(() => normalizeBrowserSessionUpdate(value))
  }
})
