import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPlatformPackage, packageCompatibility, selectPlatformArtifact, type PlatformPackage } from './plugin-platform'
const host = { os: 'linux', arch: 'x64', libc: 'glibc', libcVersion: '2.35', hostVersion: '0.3.33' }
const pkg = (artifactId: string, target: PlatformPackage['target']): PlatformPackage => ({ packageFormatVersion: 2, artifactId, target, runtime: { kind: 'electron-main' } })
test('legacy, portable, static and libc-specific packages remain distinct', () => {
  assert.equal(packageCompatibility({}, host), null)
  const portable = pkg('portable', { kind: 'portable' })
  const staticPkg = pkg('linux-x64', { kind: 'platform', os: 'linux', arch: 'x64', linkage: 'static' })
  const dynamic = pkg('linux-x64-glibc', { kind: 'platform', os: 'linux', arch: 'x64', linkage: 'dynamic', libc: 'glibc', minLibcVersion: '2.31' })
  assert.equal(selectPlatformArtifact([portable, staticPkg, dynamic], host), dynamic)
  assert.equal(selectPlatformArtifact([portable, staticPkg, dynamic], { ...host, libc: undefined }), staticPkg)
  assert.equal(packageCompatibility(staticPkg, { ...host, arch: 'arm64' }), 'unsupported_arch')
  assert.equal(packageCompatibility(dynamic, { ...host, libcVersion: '2.17' }), 'libc_version_too_low')
})
test('invalid or ambiguous target metadata cannot silently select a package', () => {
  assert.throws(() => assertPlatformPackage({ target: { kind: 'portable' } }), /package_format_required/)
  assert.throws(() => assertPlatformPackage(pkg('bad', { kind: 'platform', os: 'linux', arch: 'x64' })), /libc_required/)
  assert.throws(() => selectPlatformArtifact([pkg('a', { kind: 'portable' }), pkg('b', { kind: 'portable' })], host), /ambiguous/)
  assert.equal(packageCompatibility({ minHostVersion: '0.3.34' }, host), 'host_too_old')
})
