import test from 'node:test'
import assert from 'node:assert/strict'
import {appLinkMode,appLinkUrl} from './app-links'

test('user links default to an in-app window and retain explicit choices',()=>{
  assert.equal(appLinkMode(undefined),'window')
  assert.equal(appLinkMode('window'),'window')
  assert.equal(appLinkMode('tab'),'tab')
  assert.equal(appLinkMode('external'),'external')
  assert.equal(appLinkMode('invalid'),'window')
})

test('web link routing accepts only actual HTTP(S) URLs',()=>{
  assert.equal(appLinkUrl('https://example.com/a?q=one#part'),'https://example.com/a?q=one#part')
  for(const value of ['javascript:alert(1)','file:///C:/private','mailto:test@example.com','../notes.md','#section','https://example.com/\nnext',null])assert.throws(()=>appLinkUrl(value))
})
