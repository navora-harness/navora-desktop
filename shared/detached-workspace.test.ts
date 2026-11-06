import {test} from 'node:test'
import assert from 'node:assert/strict'
import {detachedBrowserTabKey,detachedFileTabKey,detachedWorkspaceOrder} from './detached-workspace'
test('browser and file identities cannot collide even when their source key matches',()=>{
  assert.notEqual(detachedBrowserTabKey('same'),detachedFileTabKey('same'))
})
test('mixed order keeps surviving cross-kind positions and appends fresh identities once',()=>{
  assert.deepEqual(detachedWorkspaceOrder(['browser:a','file:b','browser:c','missing'],['file:b','browser:a','file:new','browser:c','file:new']),['browser:a','file:b','browser:c','file:new'])
})
test('pinned browser references keep a stable leading partition without regrouping ordinary files',()=>{
  assert.deepEqual(detachedWorkspaceOrder(['file:a','browser:b','file:c','browser:d'],['file:a','browser:b','file:c','browser:d'],new Set(['browser:d'])),['browser:d','file:a','browser:b','file:c'])
})
