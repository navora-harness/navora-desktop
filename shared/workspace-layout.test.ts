import test from 'node:test'
import assert from 'node:assert/strict'
import {workspaceLayoutDecision as decide,workspacePreferredWidth,WORKSPACE_SPLIT_MIN} from './workspace-layout'
const base={available:1200,visible:true,mobile:false,manualExpanded:false,automatic:null}
test('hidden workspace never creates an automatic expanded view',()=>{
  assert.deepEqual(decide({...base,available:700,visible:false}),{expanded:false,automatic:null,canSplit:false})
})
test('automatic viewport expansion has a recovery gap and preserves manual expansion',()=>{
  assert.equal(decide({...base,available:WORKSPACE_SPLIT_MIN-1}).automatic,'viewport')
  assert.equal(decide({...base,available:WORKSPACE_SPLIT_MIN+60,automatic:'viewport'}).expanded,true)
  assert.equal(decide({...base,available:WORKSPACE_SPLIT_MIN+80,automatic:'viewport'}).expanded,false)
  assert.equal(decide({...base,available:2000,manualExpanded:true}).expanded,true)
})
test('divider expansion waits for its requested budget and preferred width stays bounded',()=>{
  assert.equal(decide({...base,automatic:'divider',dividerBudget:1300,available:1350}).expanded,true)
  assert.equal(decide({...base,automatic:'divider',dividerBudget:1300,available:1380}).expanded,false)
  assert.equal(workspacePreferredWidth(1000,900),519)
  assert.equal(workspacePreferredWidth(1600,300),400)
})
