import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileManagerSelection,moveFileManagerSelection,reconcileFileManagerSelection,selectFileManagerItem} from './file-manager-selection'
const order=['folder','a.md','b.png','completed.zip','pending.zip']
test('plain selection, toggle and range remain distinct from activation',()=>{
  let state=selectFileManagerItem(order,emptyFileManagerSelection(),'a.md')
  assert.deepEqual(state.paths,['a.md']);state=selectFileManagerItem(order,state,'completed.zip',{toggle:true})
  assert.deepEqual(state.paths,['a.md','completed.zip']);state=selectFileManagerItem(order,state,'completed.zip',{toggle:true})
  assert.deepEqual(state.paths,['a.md']);assert.equal(state.current,'completed.zip')
  state=selectFileManagerItem(order,state,'folder',{range:true});assert.deepEqual(state.paths,['folder','a.md','b.png','completed.zip'])
})
test('Shift navigation grows and contracts from its original anchor in visible sorted order',()=>{
  let state=selectFileManagerItem(order,emptyFileManagerSelection(),'a.md')
  state=moveFileManagerSelection(order,state,2,{range:true});assert.deepEqual(state.paths,['a.md','b.png','completed.zip'])
  state=moveFileManagerSelection(order,state,-1,{range:true});assert.deepEqual(state.paths,['a.md','b.png']);assert.equal(state.anchor,'a.md')
  assert.deepEqual(selectFileManagerItem([...order].reverse(),state,'pending.zip',{range:true}).paths,['pending.zip','completed.zip','b.png','a.md'])
})
test('Ctrl navigation moves focus without silently selecting or opening another row',()=>{
  const initial=selectFileManagerItem(order,emptyFileManagerSelection(),'a.md'),moved=moveFileManagerSelection(order,initial,1,{toggle:true})
  assert.deepEqual(moved.paths,['a.md']);assert.equal(moved.current,'b.png')
  assert.deepEqual(selectFileManagerItem(order,moved,'b.png',{toggle:true}).paths,['a.md','b.png'])
})
test('filtering and removal discard stale identities and empty navigation never revives them',()=>{
  const selected=selectFileManagerItem(order,emptyFileManagerSelection(),'a.md')
  assert.deepEqual(reconcileFileManagerSelection(['b.png'],selected),emptyFileManagerSelection())
  assert.deepEqual(moveFileManagerSelection([],selected,'first'),emptyFileManagerSelection())
  assert.deepEqual(selectFileManagerItem(order,selected,'deleted.txt'),selected)
})
test('Home End and grid-sized moves clamp within the displayed list',()=>{
  let state=moveFileManagerSelection(order,emptyFileManagerSelection(),'last');assert.equal(state.current,'pending.zip')
  state=moveFileManagerSelection(order,state,-3);assert.equal(state.current,'a.md')
  state=moveFileManagerSelection(order,state,100);assert.equal(state.current,'pending.zip')
  state=moveFileManagerSelection(order,state,'first');assert.equal(state.current,'folder')
})
