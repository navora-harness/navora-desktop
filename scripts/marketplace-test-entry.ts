import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { MarketplaceClient } from '../electron/modules/marketplace-client'
import type { ConfigService } from '../electron/modules/config-service'
import type { PluginStore } from '../electron/modules/plugin-store'
import type { SkillStore } from '../electron/modules/skill-store'

// Load the actual store from its package; no test code executes real plugin entrypoints.
const store = await import(pathToFileURL(path.resolve('..', 'navora-store/src/index.js')).href)

async function fixture(t: TestContext) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-marketplace-fixture-'))
  t.after(() => {
    const rel = path.relative(os.tmpdir(), temp)
    assert.ok(rel.startsWith('navora-marketplace-fixture-') && !rel.includes(path.sep))
    fs.rmSync(temp, { recursive: true, force: true })
  })
  const root = path.join(temp, 'store')
  const pack = (id: string, version = '1.0.0', extra: Record<string, unknown> = {}) => {
    const zip = new AdmZip()
    const files = { 'plugin.json': JSON.stringify({ id, version, name: id, ...extra }), 'main.cjs': 'module.exports = {}' }
    for (const [name, value] of Object.entries(files)) zip.addFile(name, Buffer.from(value))
    if (extra.packageFormatVersion === 2) zip.addFile('runtime-files.json', Buffer.from(JSON.stringify({ version: 1, files: Object.entries(files).map(([name, value]) => ({ path: name, size: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') })) })))
    const file = path.join(temp, `${id}-${version}.zip`); zip.writeZip(file)
    return store.publishPath(file, { root })
  }
  pack('demo')
  const server = store.serveCatalog({ root, port: 0, quiet: true })
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())) })
  const state = { store: { base_url: `http://127.0.0.1:${server.address().port}` } }
  let imports = 0
  const plugins = {
    list: () => [{ id: 'demo', version: '0.9.0' }], get: () => undefined,
    parseFromPath: (file: string) => JSON.parse(new AdmZip(file).readAsText('plugin.json')),
    importFromPath: async () => { imports++; return { ok: true, plugin: { id: 'demo' } } },
  }
  const client = new MarketplaceClient(path.join(temp, 'desktop'), { get: () => state } as unknown as ConfigService, plugins as unknown as PluginStore, { list: () => [] } as unknown as SkillStore)
  return { client, root, temp, pack, state, imports: () => imports }
}

test('current desktop falls back from v2 to the real v1 server and downloads verified bytes', async t => {
  const f = await fixture(t)
  const list = await f.client.list()
  assert.equal(list.ok, true)
  assert.equal(list.products?.[0].productId, 'demo')
  const installed = await f.client.install({ kind: 'plugin', packageId: 'demo' })
  assert.equal(installed.ok, true)
  assert.equal(f.imports(), 1)
})

test('a yank after a cached preview blocks install, including when the ZIP is already cached', async t => {
  const f = await fixture(t)
  assert.equal((await f.client.install({ kind: 'plugin', packageId: 'demo' })).ok, true)
  store.setVersionStatus('plugin', 'demo', '1.0.0', 'yanked', { root: f.root })
  const installed = await f.client.install({ kind: 'plugin', packageId: 'demo', version: '1.0.0' })
  assert.equal(installed.ok, false)
  assert.equal(installed.error, 'version_yanked')
  assert.equal(f.imports(), 1)
  assert.deepEqual((await f.client.checkUpdates()).updates, [])
})

test('updates choose the newest stable compatible host version', async t => {
  const f = await fixture(t)
  f.pack('demo', '1.4.0')
  f.pack('demo', '2.0.0', { minHostVersion: '2.0.0' })
  f.pack('demo', '3.0.0-beta.1')
  const updates = await f.client.checkUpdates()
  assert.equal(updates.updates?.[0].storeVersion, '1.4.0')
  const preview = await f.client.previewInstall({ kind: 'plugin', packageId: 'demo' })
  assert.equal(preview.version, '1.4.0')
  assert.equal(preview.ok, true)
})

test('switching catalog sources immediately drops the old cached catalog and ETag', async t => {
  const f = await fixture(t)
  assert.equal((await f.client.list()).products?.[0].productId, 'demo')
  const other = path.join(f.temp, 'other-catalog'); fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'index.json'), JSON.stringify({ schemaVersion: 1, products: [] }))
  f.state.store.base_url = other
  assert.deepEqual((await f.client.list()).products, [])
})

test('a corrupt package fails SHA-256 verification before calling the importer', async t => {
  const f = await fixture(t)
  const file = path.join(f.root, 'catalog/plugins/demo/1.0.0/package.zip')
  const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes)
  const installed = await f.client.install({ kind: 'plugin', packageId: 'demo' })
  assert.equal(installed.ok, false)
  assert.equal(installed.error, 'checksum_mismatch')
  assert.equal(f.imports(), 0)
})

test('platform catalog downloads pass the same read-only server and yank protections', async t => {
  const f = await fixture(t)
  f.pack('demo', '2.0.0', { packageFormatVersion: 2, artifactId: 'portable', target: { kind: 'portable' }, runtime: { kind: 'electron-main' } })
  const preview = await f.client.previewInstall({ kind: 'plugin', packageId: 'demo' })
  assert.equal(preview.version, '2.0.0')
  assert.match(preview.downloadPath || '', /artifacts\/portable\/package.zip$/)
  assert.equal((await f.client.install({ kind: 'plugin', packageId: 'demo' })).ok, true)
  store.setVersionStatus('plugin', 'demo', '2.0.0', 'yanked', { root: f.root })
  assert.equal((await f.client.install({ kind: 'plugin', packageId: 'demo', version: '2.0.0' })).error, 'version_yanked')
})
