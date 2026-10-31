import assert from 'node:assert/strict'
import { test } from 'node:test'
import { invokeForRemote, NavoraRpcRegistry } from './remote-rpc'

test('remote draft editing does not grant local plugin installation or trial execution', async () => {
  const registry = new NavoraRpcRegistry()
  let executions = 0
  for (const channel of ['navora:creators.install','navora:creators.trial','navora:creators.export']) {
    registry.register(channel, () => { executions++; return { ok:true } })
    assert.deepEqual(await invokeForRemote(registry, channel, []), { ok:false, error:'remote_forbidden' })
  }
  assert.equal(executions, 0)
  registry.register('navora:creators.list', () => ({ ok:true, projects:[] }))
  assert.deepEqual(await invokeForRemote(registry, 'navora:creators.list', []), { ok:true, projects:[] })
})
