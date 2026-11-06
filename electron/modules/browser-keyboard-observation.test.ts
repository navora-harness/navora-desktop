import test from 'node:test'
import assert from 'node:assert/strict'
import {keyboardEffect} from './browser-keyboard-observation'
const before={epoch:1,documentEpoch:2,sample:{documentId:'doc',focusId:1,focused:true,editable:true,length:10,start:10,end:10}}
test('Tab focus is confirmed only from linked before/after samples in the same control/document',()=>{
  assert.equal(keyboardEffect('Tab',before,{...before,sample:{...before.sample,focusId:2}},true).state,'confirmed')
  assert.equal(keyboardEffect('Tab',before,before,true).state,'contradicted')
  assert.equal(keyboardEffect('Tab',before,{...before,epoch:2,sample:{...before.sample,focusId:2}},true).state,'unavailable')
  assert.equal(keyboardEffect('Tab',{epoch:1,documentEpoch:2},before,true).state,'unavailable')
})
test('select all requires a changed full selection on the same field, not just an executed script',()=>{
  const after={...before,sample:{...before.sample,start:0,end:10}}
  assert.equal(keyboardEffect('Ctrl+A',before,after,true).state,'confirmed')
  assert.equal(keyboardEffect('Ctrl+A',after,after,true).state,'not_observed')
  assert.equal(keyboardEffect('Ctrl+A',before,{...after,sample:{...after.sample,focusId:2}},true).state,'unavailable')
  assert.equal(keyboardEffect('Enter',before,after,true).state,'not_observed')
})
