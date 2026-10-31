import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileTabs,openFileTab,closeFileTab,restoreFileTabs,makeFileTab,workspaceLinkPath,removeFileOwner} from './file-tabs'
test('file tabs reuse paths, distinguish resource owners and close to a neighbouring tab',()=>{
  let state=openFileTab(emptyFileTabs(),'a','folder/report.md')
  state=openFileTab(state,'a','./folder\\report.md');assert.equal(state.tabs.length,1)
  state=openFileTab(state,'b','folder/report.md');assert.equal(state.tabs.length,2)
  const otherKey=state.active
  state=openFileTab(state,'a','image.png');assert.equal(state.tabs.length,3)
  state=closeFileTab(state,otherKey);assert.equal(state.tabs.length,2);assert.equal(state.active,state.tabs[1]!.key)
  state=closeFileTab(state,state.active);assert.equal(state.active,state.tabs[0]!.key)
  state=closeFileTab(state,state.active);assert.deepEqual(state,emptyFileTabs())
})
test('restoration stores metadata only and rejects unsafe paths',()=>{
  const valid=makeFileTab('owner','report.md')
  const state=restoreFileTabs({open:true,active:'missing',tabs:[valid,valid,{chatId:'owner',path:'../outside'},{chatId:'owner',path:'C:\\secret'}]})
  assert.deepEqual(state,{tabs:[valid],active:valid.key,open:true})
  assert.throws(()=>makeFileTab('owner','../private'))
})
test('workspace Markdown links decode local names and never accept traversal or protocols',()=>{
  assert.equal(workspaceLinkPath('./folder/report%20one.md#section'),'folder/report one.md')
  for(const href of ['https://example.com/a.md','//example.com/a','file:///private','%2e%2e/private','C:/private','#section','/absolute'])assert.equal(workspaceLinkPath(href),null)
})


test('document links resolve relative to their file and never escape the workspace',()=>{
  assert.equal(workspaceLinkPath('./note.txt','folder/guide.md'),'folder/note.txt')
  assert.equal(workspaceLinkPath('../preview.md','folder/guide.md'),'preview.md')
  assert.equal(workspaceLinkPath('assets/../note%20one.txt','folder/guide.md'),'folder/note one.txt')
  for(const link of ['../../outside','%2f%2fserver/private','%5c%5cserver/private','%00file'])assert.equal(workspaceLinkPath(link,'folder/guide.md'),null)
  assert.equal(makeFileTab('owner','folder//./note.txt').key,makeFileTab('owner','folder/note.txt').key)
})
test('full tab lists reuse canonical paths and owner deletion removes only affected resources',()=>{
  let state=emptyFileTabs()
  for(let i=0;i<32;i++)state=openFileTab(state,i<2?'foreign':'owner',`folder/${i}.txt`)
  assert.equal(openFileTab(state,'owner','./folder//31.txt').tabs.length,32)
  assert.throws(()=>openFileTab(state,'owner','another.txt'),/上限/)
  const next=removeFileOwner(state,'foreign')
  assert.equal(next.tabs.length,30);assert.equal(next.active,state.active)
  assert.equal(removeFileOwner(next,'owner').open,false)
})
