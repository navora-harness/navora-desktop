import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { RemoteServer } from './remote-server'
import { createDefaultConfig } from '../../shared/config'
import { hashPassword } from '../../shared/crypto-util'
import type { BrowserRegistry } from './browser-registry'

async function reserve() {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { port: address.port, release: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

test('remote listener rebinds host on the same port and serializes concurrent syncs', async () => {
  const reserved = await reserve(), config = createDefaultConfig()
  await reserved.release()
  config.remote = { ...config.remote, enabled: true, host: '127.0.0.1', port: reserved.port, passwordHash: hashPassword('local-fixture') }
  const remote = new RemoteServer(() => config, {} as BrowserRegistry)
  try {
    await Promise.all([remote.syncFromConfig(), remote.syncFromConfig()])
    assert.equal(remote.status().running, true)
    config.remote.host = 'localhost'
    await Promise.all([remote.syncFromConfig(), remote.syncFromConfig()])
    assert.equal(remote.status().host, 'localhost')
    assert.equal(remote.status().port, reserved.port)
    assert.equal(remote.status().running, true)
    assert.equal((await fetch(`http://localhost:${reserved.port}/api/remote/status`)).status, 200)
  } finally { await remote.stop() }
})

test('failed bind reports stopped state and can start again without changing settings', async () => {
  const occupied = await reserve(), config = createDefaultConfig()
  config.remote = { ...config.remote, enabled: true, host: '127.0.0.1', port: occupied.port, passwordHash: hashPassword('local-fixture') }
  const remote = new RemoteServer(() => config, {} as BrowserRegistry)
  try {
    await assert.rejects(remote.syncFromConfig(), /EADDRINUSE/)
    assert.equal(remote.status().enabled, true)
    assert.equal(remote.status().running, false)
    assert.match(remote.status().error!, /EADDRINUSE/)
    await occupied.release()
    await remote.syncFromConfig()
    assert.equal(remote.status().running, true)
    assert.equal(remote.status().error, undefined)
  } finally { await remote.stop(); await occupied.release().catch(() => {}) }
})
