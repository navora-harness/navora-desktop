import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyFileTabs,openFileTab,openSubchatTab} from './file-tabs'
import {persistWorkspaces,restoreWorkspaces} from './workspace-tabs-persistence'
test('workspace v2 migration preserves legacy files and prefers versioned tabs',()=>{
  const legacy=[['parent',openFileTab(emptyFileTabs(),'child','report.md')]]
  assert.equal(restoreWorkspaces(null,legacy).get('parent')?.tabs[0]?.chatId,'child')
  const state=openSubchatTab(legacy[0]![1] as ReturnType<typeof emptyFileTabs>,'parent','child')
  const saved=persistWorkspaces(new Map([['parent',state]]))
  assert.deepEqual(restoreWorkspaces(saved,legacy).get('parent'),state)
  assert.equal(JSON.stringify(saved).includes('pageId'),false)
})
test('workspace restore rejects foreign hubs and invalid owner IDs',()=>{
  const foreign=openSubchatTab(emptyFileTabs(),'other','child')
  const restored=restoreWorkspaces({version:2,workspaces:[['parent',foreign],['../bad',foreign]]},null)
  assert.equal(restored.has('../bad'),false);assert.deepEqual(restored.get('parent'),emptyFileTabs())
})
