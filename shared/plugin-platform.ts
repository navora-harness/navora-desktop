/** Package format v2. Keep SDK's generated lib/platform.mjs in sync via scripts/sync-platform.mjs. */
export type PluginTarget = { kind: 'portable' } | {
  kind: 'platform'; os: 'win32' | 'darwin' | 'linux'; arch: 'x64' | 'arm64';
  linkage?: 'static' | 'dynamic'; libc?: 'glibc' | 'musl';
  minOsVersion?: string; minKernelVersion?: string; minLibcVersion?: string;
}
export type PluginRuntime = { kind: 'electron-main' } | {
  kind: 'executable-sidecar'; executable: string; binaryVersion: string;
  invocation: 'oneshot'; adapter: 'fcurl-cli-v0.2'; protocolVersion: '1';
}
export type PlatformHost = {
  os: string; arch: string; osVersion?: string; kernelVersion?: string;
  libc?: string; libcVersion?: string; hostVersion: string;
}
export type PlatformPackage = {
  packageFormatVersion?: number; artifactId?: string; target?: PluginTarget;
  runtime?: PluginRuntime; minHostVersion?: string;
}
export function safeRuntimePath(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && !/[\\:\x00-\x1f]/.test(raw)
    && !raw.startsWith('/') && raw.split('/').every(p => p !== '.' && p !== '..' && !!p)
}
export function compareNumericVersions(a: string, b: string): number {
  const x = a.replace(/^v/, '').split(/[.-]/).map(Number)
  const y = b.replace(/^v/, '').split(/[.-]/).map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return Math.sign(d)
  }
  return 0
}
export function assertPlatformPackage(raw: PlatformPackage): void {
  if (raw.packageFormatVersion == null || raw.packageFormatVersion === 1) {
    if (raw.target || raw.runtime || raw.artifactId) throw new Error('package_format_required')
    return
  }
  if (raw.packageFormatVersion !== 2) throw new Error('unsupported_package_format')
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(raw.artifactId || '')) throw new Error('invalid_artifact_id')
  const t = raw.target
  if (!t || !['portable', 'platform'].includes(t.kind)) throw new Error('invalid_target')
  if (t.kind === 'platform') {
    if (!['win32', 'darwin', 'linux'].includes(t.os) || !['x64', 'arm64'].includes(t.arch)) throw new Error('invalid_target')
    if (t.linkage && !['static', 'dynamic'].includes(t.linkage)) throw new Error('invalid_target')
    if (t.libc && !['glibc', 'musl'].includes(t.libc)) throw new Error('invalid_target')
    if ((t.libc || t.minLibcVersion || t.minKernelVersion) && t.os !== 'linux') throw new Error('invalid_target')
    if (t.linkage === 'static' && (t.libc || t.minLibcVersion)) throw new Error('invalid_target')
    if (t.os === 'linux' && t.linkage !== 'static' && !t.libc) throw new Error('libc_required')
    for (const v of [t.minOsVersion, t.minKernelVersion, t.minLibcVersion]) {
      if (v !== undefined && !/^\d+(\.\d+){0,3}$/.test(v)) throw new Error('invalid_target_version')
    }
  }
  const r = raw.runtime
  if (!r || !['electron-main', 'executable-sidecar'].includes(r.kind)) throw new Error('invalid_runtime')
  if (r.kind === 'executable-sidecar') {
    if (t.kind !== 'platform' || !safeRuntimePath(r.executable) || r.invocation !== 'oneshot'
      || r.adapter !== 'fcurl-cli-v0.2' || r.protocolVersion !== '1'
      || !/^\d+\.\d+\.\d+$/.test(r.binaryVersion)) throw new Error('invalid_runtime')
  }
  if (raw.minHostVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(raw.minHostVersion)) throw new Error('invalid_host_version')
}
export function packageCompatibility(pkg: PlatformPackage, host: PlatformHost): string | null {
  assertPlatformPackage(pkg)
  if (pkg.minHostVersion && compareNumericVersions(host.hostVersion, pkg.minHostVersion) < 0) return 'host_too_old'
  const t = pkg.target
  if (!t || t.kind === 'portable') return null
  if (t.os !== host.os) return 'unsupported_platform'
  if (t.arch !== host.arch) return 'unsupported_arch'
  if (t.libc && !host.libc) return 'platform_detection_failed'
  if (t.libc && t.libc !== host.libc) return 'unsupported_libc'
  for (const [need, have, error] of [
    [t.minOsVersion, host.osVersion, 'os_version_too_low'],
    [t.minKernelVersion, host.kernelVersion, 'kernel_version_too_low'],
    [t.minLibcVersion, host.libcVersion, 'libc_version_too_low'],
  ]) {
    if (need && !have) return 'platform_detection_failed'
    if (need && have && compareNumericVersions(have, need) < 0) return error!
  }
  return null
}
export function selectPlatformArtifact<T extends PlatformPackage>(artifacts: T[], host: PlatformHost): T | null {
  const seen = new Set<string>()
  for (const a of artifacts) {
    assertPlatformPackage(a)
    if (!a.artifactId || seen.has(a.artifactId)) throw new Error('duplicate_artifact')
    seen.add(a.artifactId)
  }
  const score = (a: T) => a.target?.kind === 'platform' ? 10 + (a.target.libc ? 1 : 0) : 0
  const matches = artifacts.filter(a => !packageCompatibility(a, host)).sort((a, b) => score(b) - score(a))
  if (matches.length > 1 && score(matches[0]!) === score(matches[1]!)) throw new Error('ambiguous_artifact')
  return matches[0] || null
}
