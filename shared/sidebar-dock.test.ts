import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moveDockPanels, normalizeDock, splitDockPanel } from './sidebar-dock'
const ids = ['chats', 'workspace', 'browser']

test('all three panels can share a group and split again without duplication', () => {
  let layout = normalizeDock(null, ids)
  const target = layout.groups[0]!.id
  layout = moveDockPanels(layout, ['workspace'], target, 'tab')
  layout = moveDockPanels(layout, ['browser'], target, 'tab')
  assert.equal(layout.groups.length, 1)
  assert.deepEqual(layout.groups[0]!.panels, ids)
  assert.equal(layout.groups[0]!.active, 'browser')
  layout = splitDockPanel(layout, 'workspace')
  assert.deepEqual(layout.groups.map(group => group.panels), [['chats', 'browser'], ['workspace']])
  layout = moveDockPanels(layout, ['workspace'], target, 'before')
  assert.deepEqual(layout.groups.map(group => group.panels), [['workspace'], ['chats', 'browser']])
  assert.deepEqual([...layout.groups.flatMap(group => group.panels)].sort(), [...ids].sort())
})

test('dormant panel layout survives unregistering and registering new panel types', () => {
  const raw = { groups: [{ id: 'custom', panels: ['future', 'chats'], active: 'future', weight: 500, collapsed: false }], hidden: ['future', 'workspace'] }
  const saved = normalizeDock(raw, ids)
  assert.deepEqual(saved.groups[0]!.panels, ['future', 'chats'])
  const restored = normalizeDock(JSON.parse(JSON.stringify(saved)), [...ids, 'future', 'terminal'])
  assert.equal(restored.groups[0]!.active, 'future')
  assert.ok(restored.hidden.includes('future'))
  assert.equal(restored.groups.filter(group => group.panels.includes('terminal')).length, 1)
})

test('invalid layouts normalize, hidden tabs recover on move and own-group drops are harmless', () => {
  let layout = normalizeDock({ groups: [{ id: 'same', panels: ['chats', 'chats', '../escape'], weight: Infinity }, { id: 'same', panels: ['workspace'] }], hidden: ['chats', 'bad'] }, ids)
  assert.equal(new Set(layout.groups.map(group => group.id)).size, 3)
  assert.deepEqual(layout.hidden, ['chats'])
  const self = moveDockPanels(layout, ['chats'], layout.groups[0]!.id, 'after')
  assert.deepEqual(self, layout)
  layout = moveDockPanels(layout, ['chats'], layout.groups[1]!.id, 'tab')
  assert.deepEqual(layout.hidden, [])
  assert.equal(layout.groups.find(group => group.panels.includes('chats'))!.active, 'chats')
})
