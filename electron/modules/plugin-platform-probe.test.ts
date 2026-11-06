import test from 'node:test'
import assert from 'node:assert/strict'
import { platformHostFromProbe } from './plugin-package'
import { packageCompatibility } from '../../shared/plugin-platform'

test('macOS product requirements use the product version instead of Darwin kernel release', () => {
  const probe = { os: 'darwin', arch: 'arm64', release: '25.0.0' }
  const pkg = { packageFormatVersion: 2, artifactId: 'mac-arm64', target: { kind: 'platform' as const, os: 'darwin' as const, arch: 'arm64' as const, minOsVersion: '15.0' }, runtime: { kind: 'electron-main' as const } }
  assert.equal(packageCompatibility(pkg, platformHostFromProbe('0.4.12', probe)), 'platform_detection_failed')
  const host = platformHostFromProbe('0.4.12', { ...probe, productVersion: '14.7.1' })
  assert.equal(host.kernelVersion, '25.0.0'); assert.equal(host.osVersion, '14.7.1')
  assert.equal(packageCompatibility(pkg, host), 'os_version_too_low')
})

test('Linux glibc, evidenced musl and unknown remain distinct without inventing a musl version', () => {
  const base = { os: 'linux', arch: 'x64', release: '6.1.0' }
  assert.equal(platformHostFromProbe('0.4.12', { ...base, glibc: '2.36' }).libc, 'glibc')
  const musl = platformHostFromProbe('0.4.12', { ...base, sharedObjects: ['/lib/ld-musl-x86_64.so.1'] })
  assert.equal(musl.libc, 'musl'); assert.equal(musl.libcVersion, undefined)
  assert.equal(platformHostFromProbe('0.4.12', { ...base, sharedObjects: ['/lib/libc.so.6'] }).libc, undefined)
  assert.equal(platformHostFromProbe('0.4.12', { ...base, glibc: 'garbage' }).libc, undefined)
})
