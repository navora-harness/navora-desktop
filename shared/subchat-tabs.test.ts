import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileTabs,openFileTab,openSubchatTab,restoreFileTabs,closeFileTab,makeSubchatTab} from './file-tabs'
test('one child hub per parent reuses identity while selecting different children',()=>{
  let state=openFileTab(emptyFileTabs(),'parent','report.md')
  state=openSubchatTab(state,'parent','child_a');state=openSubchatTab(state,'parent','child_b')
  assert.equal(state.tabs.length,2);assert.equal(state.tabs[1]!.kind,'subchats')
  assert.equal(state.tabs[1]!.path,undefined)
  assert.equal(state.tabs[1]!.kind==='subchats'&&state.tabs[1]!.selectedSubchatId,'child_b')
  const restored=restoreFileTabs(state);assert.deepEqual(restored,state)
  assert.equal(closeFileTab(restored,restored.active).tabs[0]!.path,'report.md')
})
test('restoration rejects a forged child hub owner and invalid IDs',()=>{
  const tab=makeSubchatTab('parent','child')
  assert.equal(restoreFileTabs({tabs:[{...tab,parentChatId:'other'}],active:tab.key,open:true}).tabs.length,0)
  assert.throws(()=>makeSubchatTab('../outside'))
})
