import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeRail} from './sidebar-rail'

test('old combined sidebars migrate to one registered entry and never restore grouping', () => {
  const registered = ['chats', 'workspace', 'browser']
  assert.deepEqual(normalizeRail({version:1,active:'combined',groups:[{id:'combined',panels:['removed','workspace','browser']}]},registered),{version:2,active:'workspace'})
  assert.deepEqual(normalizeRail({version:1,active:'',groups:[{id:'combined',panels:registered}]},registered),{version:2,active:''})
  assert.deepEqual(normalizeRail({version:2,active:'browser'},registered),{version:2,active:'browser'})
  assert.deepEqual(normalizeRail({version:2,active:'removed'},registered),{version:2,active:'chats'})
  for(const raw of [null,42,{groups:[null,{panels:42}]}]) assert.equal(normalizeRail(raw,registered).active,'chats')
  assert.equal(normalizeRail(null,[]).active,'')
})
