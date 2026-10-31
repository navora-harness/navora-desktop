import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mergeRail,normalizeRail,splitRail} from './sidebar-rail'
test('rail groups form a partition and merging selects the one combined entry',()=>{
  let rail=normalizeRail(null,['chats','workspace','browser'])
  rail={...rail,active:'rail-chats'}
  rail=mergeRail(rail,'rail-workspace','rail-chats')
  assert.deepEqual(rail.groups,[{id:'rail-chats',panels:['chats','workspace']},{id:'rail-browser',panels:['browser']}])
  assert.equal(rail.active,'rail-chats')
  rail=mergeRail(rail,'rail-browser',rail.active)
  assert.equal(rail.groups.length,1)
  assert.deepEqual(rail.groups[0]!.panels,['chats','workspace','browser'])
  assert.deepEqual(mergeRail(rail,rail.active,rail.active),rail)
  rail=splitRail(rail,'workspace')
  assert.deepEqual(rail.groups.map(group=>group.panels),[['chats','browser'],['workspace']])
  assert.deepEqual(normalizeRail(JSON.parse(JSON.stringify(rail)),['chats','workspace','browser']),rail)
})
test('rail recovers invalid storage without duplicate members and retains dormant extensions',()=>{
  const rail=normalizeRail({active:'missing',groups:[null,{id:'same',panels:['chats','chats','../bad','future']},{id:'same',panels:['workspace']}]},['chats','workspace','browser'])
  assert.equal(rail.active,'')
  assert.equal(new Set(rail.groups.map(group=>group.id)).size,3)
  assert.deepEqual(rail.groups.flatMap(group=>group.panels),['chats','future','workspace','browser'])
})
