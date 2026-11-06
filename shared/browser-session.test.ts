import test from 'node:test'
import assert from 'node:assert/strict'
import { browserSessionLabel, browserSessionScope, normalizeBrowserSessionUpdate, publicBrowserSession } from './browser-session'

test('public default selection is explicit, idempotent and distinct from legacy persistence flags',()=>{
  assert.equal(browserSessionScope(),'default')
  assert.equal(browserSessionScope({persist:false}),'temporary')
  assert.equal(browserSessionScope({persist:true}),'persistent')
  assert.equal(browserSessionScope({scope:'temporary'}),'temporary')
  assert.equal(browserSessionScope({ua:'Custom/1'}),'temporary')
  assert.throws(()=>browserSessionScope({scope:'default',persist:true}),/conflict/)
  assert.throws(()=>browserSessionScope({scope:'temporary',persist:true}),/conflict/)
  assert.throws(()=>browserSessionScope({scope:'default',ua:'Custom/1'}),/requires_management/)
  assert.deepEqual(publicBrowserSession(),publicBrowserSession())
  assert.equal(publicBrowserSession().initialized,false)
  assert.equal(publicBrowserSession().chatId,'')
  assert.equal(publicBrowserSession().windows.length,0)
})

test('session metadata keeps a stable numeric fallback and trims user labels', () => {
  assert.equal(browserSessionLabel({ sessionIndex: 7 }), '独立会话 07')
  assert.equal(browserSessionLabel({ sessionIndex: 7, name: ' 资料浏览 ' }), '资料浏览')
  assert.deepEqual(normalizeBrowserSessionUpdate({ name: ' 资料浏览 ', isDefault: true }), { name: '资料浏览', isDefault: true })
  assert.deepEqual(normalizeBrowserSessionUpdate({ name: ' ' }), { name: '' })
})

test('browser session labels distinguish storage identities without rewriting user names',()=>{
  assert.equal(browserSessionLabel({...publicBrowserSession(),name:'默认会话'}),'默认浏览会话')
  assert.equal(browserSessionLabel({sessionIndex:1,displayIndex:12,sessionId:'sess_one'}),'独立会话 12')
  assert.notEqual(browserSessionLabel({sessionIndex:1,sessionId:'sess_123456'}),browserSessionLabel({sessionIndex:1,sessionId:'sess_abcdef'}))
  assert.equal(browserSessionLabel({sessionIndex:1,displayIndex:12,name:'会话 1'}),'会话 1','An old stored name may be user-supplied; preserve it')
})

test('session metadata rejects storage changes and malformed supplied values', () => {
  for (const value of [null, [], 'name', { persist: true }, { name: null }, { name: 'a\nlabel' }, { name: 'a'.repeat(81) }, { isDefault: 'true' }]) {
    assert.throws(() => normalizeBrowserSessionUpdate(value))
  }
})
