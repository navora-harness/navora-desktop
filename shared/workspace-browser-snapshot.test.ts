import test from 'node:test'
import assert from 'node:assert/strict'
import {applyWorkspaceBrowserSnapshot,workspaceBrowserPageTab} from './workspace-browser-snapshot'
import type {BrowserTreeWindow} from './types'
import {makeFileTab,type FileTab,type FileTabs} from './file-tabs'
const page=(id:string,order=0,pinned=false):BrowserTreeWindow=>({windowId:id,sessionId:'session-'+id,tabKey:'browser:'+id,title:id,url:'https://example.test/'+id,visible:true,loading:false,presentation:'embedded',order,pinned})
const tab=(id:string,owner:string,pin=false)=>workspaceBrowserPageTab(undefined,page(id,0,pin),owner)
const state=(tabs:FileTab[],active=tabs[0]?.key||''):FileTabs=>({tabs,active,open:true})
const keys=(state:FileTabs)=>state.tabs.map(tab=>tab.key)
test('a newer root snapshot cannot suppress a child empty snapshot or allow the child to resurrect later',()=>{
  const initial=state([tab('a','child-a'),tab('root','parent'),tab('b','child-b')])
  const root=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'parent',pages:[page('root')],revision:12})
  const closed=applyWorkspaceBrowserSnapshot(root.state,root.versions,{owner:'child-a',pages:[],revision:11})
  assert.equal(closed.accepted,true);assert.deepEqual(keys(closed.state),['browser:root','browser:b'])
  const late=applyWorkspaceBrowserSnapshot(closed.state,closed.versions,{owner:'child-a',pages:[page('a')],revision:10})
  assert.equal(late.accepted,false);assert.deepEqual(late.state,closed.state)
  assert.equal(closed.versions.get('parent'),12);assert.equal(closed.versions.get('child-a'),11)
})
test('root-only authority preserves foreign live and pending pinned tabs exactly once',()=>{
  const pending={...tab('pending','child',true),pageId:undefined},initial=state([pending,tab('root','parent',true),makeFileTab('parent','notes.md'),tab('live','child')])
  let result=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'parent',pages:[page('root',0,true)],revision:2})
  result=applyWorkspaceBrowserSnapshot(result.state,result.versions,{owner:'parent',pages:[page('root',0,true)],revision:3})
  assert.deepEqual(keys(result.state),keys(initial));assert.equal(new Set(keys(result.state)).size,result.state.tabs.length)
})
test('partial refresh preserves cross-owner pinned slots and only reorders the covered owner',()=>{
  const initial=state([tab('a1','a',true),tab('b1','b',true),tab('a2','a',true),makeFileTab('parent','notes.md')])
  const b=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'b',pages:[page('b1',0,true)],revision:20})
  assert.deepEqual(keys(b.state),keys(initial))
  const a=applyWorkspaceBrowserSnapshot(b.state,b.versions,{owner:'a',pages:[page('a2',0,true),page('a1',1,true)],revision:19})
  assert.deepEqual(keys(a.state),['browser:a2','browser:b1','browser:a1',makeFileTab('parent','notes.md').key])
})
test('pin changes retain foreign partitions and put newly pinned pages at the fixed section end',()=>{
  const file=makeFileTab('parent','notes.md'),initial=state([tab('b-pin','b',true),file,tab('a','a'),tab('b','b')])
  const result=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'a',pages:[page('a',0,true)],revision:4})
  assert.deepEqual(keys(result.state),['browser:b-pin','browser:a',file.key,'browser:b'])
  assert.deepEqual(result.state.tabs.map(item=>!!item.pinned),[true,true,false,false])
})
test('cancelled close keeps the live page, active identity and unrelated owner tabs',()=>{
  const initial=state([tab('a','a'),tab('b','b')],'browser:a')
  const cancelled=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'a',pages:[page('a')],revision:8})
  assert.deepEqual(keys(cancelled.state),keys(initial));assert.equal(cancelled.state.active,'browser:a');assert.equal(cancelled.state.open,true)
  const closed=applyWorkspaceBrowserSnapshot(cancelled.state,cancelled.versions,{owner:'a',pages:[],revision:9})
  assert.deepEqual(keys(closed.state),['browser:b']);assert.equal(closed.state.active,'browser:b')
})
test('confirmed detached pages remove only their owner while unresolved placeholders remain in place',()=>{
  const pending={...tab('pending','a'),pageId:undefined},file=makeFileTab('parent','notes.md'),initial=state([tab('a','a'),file,pending,tab('b','b')])
  const detached={...page('a'),presentation:'detached' as const}
  const result=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'a',pages:[],all:[detached],revision:5})
  assert.deepEqual(keys(result.state),[file.key,pending.key,'browser:b'])
})
test('existing duplicate pending metadata is repaired and viewer revision maps remain independent',()=>{
  const pending={...tab('pending','child',true),pageId:undefined},initial=state([pending,pending,makeFileTab('parent','notes.md')])
  const first=applyWorkspaceBrowserSnapshot(initial,new Map(),{owner:'parent',pages:[],revision:50})
  assert.equal(first.state.tabs.length,2)
  const otherViewer=applyWorkspaceBrowserSnapshot(state([]),new Map(),{owner:'parent',pages:[page('root')],revision:1})
  assert.equal(otherViewer.accepted,true);assert.deepEqual(keys(otherViewer.state),['browser:root'])
})
