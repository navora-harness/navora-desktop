import test from 'node:test'
import assert from 'node:assert/strict'
import {BrowserHostSelection} from './browser-host-selection'

test('a state read already in flight cannot undo a newer tab choice',()=>{
  const selection=new BrowserHostSelection(),oldRead=selection.beginRefresh()
  selection.beginSelection('b')
  assert.equal(selection.acceptsRefresh(oldRead),false)
  const newRead=selection.beginRefresh()
  assert.equal(selection.acceptsRefresh(newRead),true)
  assert.equal(selection.activeId('a','b',['a','b'],['a','b']),'b','a pre-ack snapshot retains the user choice')
})

test('an older activation acknowledgement cannot release a later pending choice',()=>{
  const selection=new BrowserHostSelection(),first=selection.beginSelection('b'),latest=selection.beginSelection('c')
  assert.equal(selection.settleSelection(first),false)
  assert.equal(selection.activeId('b','c',['a','b','c'],['a','b','c']),'c')
  assert.equal(selection.settleSelection(latest),true)
  assert.equal(selection.activeId('c','c',['a','b','c'],['a','b','c']),'c')
})

test('delayed presentation invalidations converge to the latest native active tab without replaying old selection',()=>{
  const selection=new BrowserHostSelection(),intent=selection.beginSelection('b')
  selection.settleSelection(intent)
  const before=selection.beginRefresh(),after=selection.beginRefresh()
  assert.equal(selection.acceptsRefresh(before),false)
  assert.equal(selection.acceptsRefresh(after),true)
  // A delayed presentation event for a is allowed to request a read, never to
  // select a after that read confirmed b. Only the current host state is used.
  assert.equal(selection.activeId('b','b',['a','b'],['a','b']),'b')
})

test('removed pages and disposed hosts discard obsolete selection/read state',()=>{
  const selection=new BrowserHostSelection(),intent=selection.beginSelection('b'),read=selection.beginRefresh()
  assert.equal(selection.activeId('a','b',['a','b'],['a']),'a')
  selection.invalidate()
  assert.equal(selection.acceptsRefresh(read),false)
  assert.equal(selection.settleSelection(intent),false)
  assert.equal(selection.activeId(undefined,'b',['a','b'],[]),'')
})
