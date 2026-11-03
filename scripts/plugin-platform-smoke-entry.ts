import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import AdmZip from 'adm-zip'
import { PluginStore } from '../electron/modules/plugin-store'
import { packPluginProject } from '../electron/modules/plugin-pack'
import { writeRuntimeInventory } from '../electron/modules/plugin-package'
import { MarketplaceClient } from '../electron/modules/marketplace-client'
import type { ConfigService } from '../electron/modules/config-service'
import type { SkillStore } from '../electron/modules/skill-store'
import type { ToolExecContext } from '../electron/modules/browser-tools'

const root = process.env.NAVORA_SMOKE_ROOT!
const project = process.env.NAVORA_SMOKE_PROJECT!
app.setPath('userData', path.join(root, 'electron'))
app.getVersion = () => '0.3.33'
app.commandLine.appendSwitch('disable-gpu')
void app.whenReady().then(async () => {
console.log('plugin-platform smoke: Electron ready')
let store: PluginStore | undefined
let server: http.Server | undefined
try {
  store = new PluginStore(path.join(root, 'data'))
  const target = `${process.platform}-${process.arch}`
  const zip = path.join(project, '../dist', `fastls-0.1.0-${target}-plugin.zip`)
  assert.equal(store.parseFromPath(zip).id, 'fastls')
  const catalog = new MarketplaceClient(path.join(root, 'data'), { get: () => ({ store: { base_url: process.env.NAVORA_SMOKE_CATALOG } }) } as unknown as ConfigService,
    store, { list: () => [] } as unknown as SkillStore)
  const preview = await catalog.previewInstall({ kind: 'plugin', packageId: 'fastls' })
  assert.equal(preview.ok, true, preview.error)
  assert.equal(preview.artifactId, target)
  assert.equal((await catalog.install({ kind: 'plugin', packageId: 'fastls', installPlanKey: 'changed' })).error, 'install_plan_changed')
  const imported = await catalog.install({ kind: 'plugin', packageId: 'fastls', installPlanKey: preview.installPlanKey })
  assert.equal(imported.ok, true, imported.error)
  assert.equal(store.get('fastls')?.tools.length, 3)
  const ctx = { chatId: 'smoke', signal: new AbortController().signal, registry: { getTree: () => [] },
    getConfig: () => ({ browser: { url_allowlist: [] } }), gate: { check: async () => ({ ok: true }) } } as unknown as ToolExecContext
  assert.equal((await store.execute('fastls_status', {}, ctx) as any).ok, true)
  server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"installed":true}') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`
  assert.equal((await store.execute('fastls_request', { url, responseMode: 'json' }, ctx) as any).body.installed, true)
  // Wrong-target packages are rejected before activation, preserving the installed package.
  const wrong = target === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64'
  const rejected = await store.importFromPath(path.join(project, '../dist', `fastls-0.1.0-${wrong}-plugin.zip`), { overwrite: true })
  assert.equal(rejected.ok, false); assert.equal((await store.execute('fastls_status', {}, ctx) as any).ok, true)
  const bad = path.join(root, 'invalid')
  fs.cpSync(path.join(project, 'dist/fastls', target), bad, { recursive: true })
  fs.writeFileSync(path.join(bad, 'main.cjs'), 'module.exports = {}')
  writeRuntimeInventory(bad)
  const archive = new AdmZip(); archive.addLocalFolder(bad); archive.writeZip(path.join(root, 'bad.zip'))
  const failed = await store.importFromPath(path.join(root, 'bad.zip'), { overwrite: true })
  assert.equal(failed.ok, false); assert.equal((await store.execute('fastls_status', {}, ctx) as any).ok, true)
  // Desktop's in-process packer must understand the same platform output and inventory.
  const packed = packPluginProject({ workspaceRoot: path.resolve(project, '..'), id: 'fastls', target, out: 'dist/fastls-desktop-smoke.zip' })
  assert.equal(packed.ok, true, !packed.ok ? packed.error : '')
  if (packed.ok) {
    assert.equal(store.parseFromPath(packed.zips[0]!.path).id, 'fastls')
    fs.unlinkSync(packed.zips[0]!.path)
  }
  assert.equal(store.remove('fastls').ok, true)
  console.log('plugin-platform smoke: v2 catalog, automatic selection, preview guard, install, runtime request, wrong platform, failed replacement, desktop pack and uninstall passed')
} catch (e) { console.error(e); process.exitCode = 1 }
finally { store?.dispose(); server?.closeAllConnections(); server?.close(); app.exit(Number(process.exitCode) || 0) }
})
