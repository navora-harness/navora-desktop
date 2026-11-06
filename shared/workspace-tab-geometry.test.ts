import {test} from 'node:test'
import assert from 'node:assert/strict'
import {workspaceTabSlotWidth,workspaceTabStripWidth} from './workspace-tab-geometry'

test('ordinary tabs share the available width after fixed icons and gaps',()=>{
  assert.equal(workspaceTabSlotWidth(5,1,833),195.25)
  assert.equal(workspaceTabSlotWidth(5,1,769),179.25)
  assert.equal(workspaceTabSlotWidth(5,1,workspaceTabStripWidth(5,1)),220)
})
test('slot allocation preserves ideal, minimum and pinned-only layouts',()=>{
  assert.equal(workspaceTabSlotWidth(3,0,1800),220)
  assert.equal(workspaceTabSlotWidth(3,0,250),112)
  assert.equal(workspaceTabSlotWidth(1,1,36),220)
  assert.equal(workspaceTabStripWidth(2,2),76)
})
test('allocation normalizes invalid counts and unavailable widths',()=>{
  assert.equal(workspaceTabSlotWidth(0,0,0),220)
  assert.equal(workspaceTabSlotWidth(2.8,-1,404),200)
  assert.equal(workspaceTabSlotWidth(3,20,200),220)
  assert.equal(workspaceTabSlotWidth(2,0,Number.NaN),220)
  assert.equal(workspaceTabSlotWidth(2,0,-100),112)
})
