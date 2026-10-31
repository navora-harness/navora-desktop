import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileTabs,openFileTab,closeFileTab,restoreFileTabs,makeFileTab,workspaceLinkPath} from './file-tabs'
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
