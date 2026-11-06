import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../../shared/config'
import { PermissionGate } from './permission-gate'

test('remembered approval applies to ask, stays in its chat, and respects changed policy', async () => {
  const config = createDefaultConfig()
  config.permissions.preset = 'custom'
  config.permissions.modes['session.fetch'] = 'ask'
  let prompts = 0
  const gate = new PermissionGate(() => config, async () => { prompts++; return 'allow_chat' })
  assert.equal((await gate.check('a', 'session.fetch', 'first')).ok, true)
  assert.equal(gate.peek('a', 'session.fetch'), 'allow')
  await gate.check('a', 'session.fetch', 'second')
  assert.equal(prompts, 1)
  await gate.check('b', 'session.fetch', 'other chat')
  assert.equal(prompts, 2)
  config.permissions.modes['session.fetch'] = 'deny'
  assert.equal(gate.peek('a', 'session.fetch'), 'deny')
  assert.equal((await gate.check('a', 'session.fetch', 'denied')).ok, false)
  config.permissions.modes['session.fetch'] = 'ask'
  gate.clearChat('a')
  await gate.check('a', 'session.fetch', 'cleared')
  assert.equal(prompts, 3)
})

test('cancelled permission never becomes an approval', async () => {
  const config = createDefaultConfig()
  config.permissions.preset = 'custom'
  config.permissions.modes['session.fetch'] = 'ask_chat'
  const gate = new PermissionGate(() => config, () => new Promise(() => {}))
  const controller = new AbortController()
  const pending = gate.check('a', 'session.fetch', 'pending', controller.signal)
  controller.abort()
  assert.deepEqual(await pending, { ok: false, reason: 'aborted' })
  assert.equal(gate.peek('a', 'session.fetch'), 'ask')
})

test('shared-data confirmation always prompts despite remembered approval and never bypasses denial',async()=>{
  const config=createDefaultConfig();config.permissions.preset='custom';config.permissions.modes['session.cookies_read']='allow'
  let prompts=0
  const gate=new PermissionGate(()=>config,async()=>{prompts++;return 'always_allow'})
  await gate.check('a','session.cookies_read','regular')
  assert.equal(prompts,0)
  await gate.check('a','session.cookies_read','shared',undefined,{forcePrompt:true})
  await gate.check('a','session.cookies_read','shared again',undefined,{forcePrompt:true})
  assert.equal(prompts,2)
  config.permissions.modes['session.cookies_read']='deny'
  assert.equal((await gate.check('a','session.cookies_read','denied',undefined,{forcePrompt:true})).ok,false)
  assert.equal(prompts,2)
})
