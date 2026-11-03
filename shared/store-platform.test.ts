import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogForPlatform, latestPackageVersion, type StoreCatalogIndex } from './store'
test('catalog selects compatible artifacts and never suggests unsupported or yanked updates', () => {
  const a = { packageFormatVersion: 2, artifactId: 'win32-x64', target: { kind: 'platform', os: 'win32', arch: 'x64' }, runtime: { kind: 'electron-main' }, sha256: 'a'.repeat(64), size: 10, downloadPath: 'plugins/demo/1.0.0/artifacts/win32-x64/package.zip' }
  const raw = { schemaVersion: 2, products: [{ kind: 'plugin', packages: [{ id: 'demo', versions: [{ version: '1.0.0', artifacts: [a] }] }] }] } as unknown as StoreCatalogIndex
  const win = catalogForPlatform(raw, { os: 'win32', arch: 'x64', hostVersion: '0.3.33' })
  assert.equal(latestPackageVersion(win.products[0]!.packages[0])?.artifactId, 'win32-x64')
  const mac = catalogForPlatform(raw, { os: 'darwin', arch: 'arm64', hostVersion: '0.3.33' })
  assert.equal(latestPackageVersion(mac.products[0]!.packages[0]), null)
  assert.ok(!raw.products[0]!.packages[0]!.versions[0]!.artifactId, 'resolution must not contaminate the server catalog')
})
