import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestPackageVersion, minimumHostVersion, type StoreCatalogPackage, type StoreCatalogVersion } from './store'

const version = (value: string, extra: Partial<StoreCatalogVersion> = {}): StoreCatalogVersion => ({ version: value, size: 1, sha256: 'a'.repeat(64), downloadPath: `plugins/demo/${value}/package.zip`, publishedAt: '2026-11-01', ...extra })
const pkg = (versions: StoreCatalogVersion[]): StoreCatalogPackage => ({ id: 'demo', name: 'Demo', description: '', versions })

test('an entirely yanked package has no default version', () => {
  const entry = pkg([version('1.0.0', { status: 'yanked' })])
  assert.equal(latestPackageVersion(entry), null)
  assert.equal(latestPackageVersion(entry, { includeYanked: true })?.version, '1.0.0')
})

test('stable update selection skips prereleases and incompatible host versions', () => {
  const entry = pkg([version('3.0.0-beta.1'), version('2.0.0', { minHostVersion: '2.0.0' }), version('1.5.0'), version('1.0.0')])
  assert.equal(latestPackageVersion(entry, { hostVersion: '1.5.0' })?.version, '1.5.0')
  assert.equal(latestPackageVersion(entry)?.version, '2.0.0')
  assert.equal(latestPackageVersion(entry, { includePrerelease: true })?.version, '3.0.0-beta.1')
  const unsupported = pkg([version('2.0.0', { compatibilityError: 'unsupported_platform' }), version('1.0.0')])
  assert.equal(latestPackageVersion(unsupported, { hostVersion: '1.5.0' })?.version, '1.0.0')
})

test('newest-version host metadata does not accidentally block an older version', () => {
  const old = version('1.0.0')
  const entry = { ...pkg([version('2.0.0', { minHostVersion: '2.0.0' }), old]), minHostVersion: '2.0.0' }
  assert.equal(minimumHostVersion(entry, old), undefined)
  assert.equal(latestPackageVersion(entry, { hostVersion: '1.0.0' })?.version, '1.0.0')
  const legacy = { ...pkg([old]), minHostVersion: '2.0.0' }
  assert.equal(latestPackageVersion(legacy, { hostVersion: '1.0.0' }), null)
})
