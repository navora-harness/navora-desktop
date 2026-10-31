import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rebaseSettingsDraft } from './settings-draft'

test('reopening settings retains drafts and adopts unrelated changes made by the Agent', () => {
  const base = { app:{ title:true, max:16000 }, ai:{ models:['a'] } }
  const draft = { app:{ title:true, max:20000 }, ai:{ models:['a','b'] } }
  const saved = { app:{ title:false, max:16000 }, ai:{ models:['a'] } }
  assert.deepEqual(rebaseSettingsDraft(base,draft,saved), { app:{title:false,max:20000}, ai:{models:['a','b']} })
  assert.deepEqual(saved.app,{title:false,max:16000})
})

test('editing one provider preserves concurrent edits and additions in the other providers', () => {
  const base = [{id:'a',url:'old-a'},{id:'b',url:'old-b'}]
  const draft = [{id:'a',url:'old-a'},{id:'b',url:'new-b'}]
  const saved = [{id:'a',url:'new-a'},{id:'b',url:'old-b'},{id:'c',url:'added'}]
  assert.deepEqual(rebaseSettingsDraft(base,draft,saved),[{id:'a',url:'new-a'},{id:'b',url:'new-b'},{id:'c',url:'added'}])
})
