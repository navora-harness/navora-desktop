import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { assertPlatformPackage, packageCompatibility, safeRuntimePath, type PlatformHost, type PlatformPackage } from '../../shared/plugin-platform'
import { PLUGIN_PACKAGE_MAX_ENTRIES } from '../../shared/plugin-package-limits'

type PlatformProbe = { os: string; arch: string; release: string; productVersion?: string; glibc?: string; sharedObjects?: string[] }
/** Pure interpretation: Darwin kernel releases are never macOS product versions. */
export function platformHostFromProbe(hostVersion: string, probe: PlatformProbe): PlatformHost {
  const numeric = (s: string | undefined) => s && /^\d+(?:\.\d+){0,3}$/.test(s) ? s : undefined
  const glibc = probe.os === 'linux' ? numeric(probe.glibc) : undefined
  const musl = probe.os === 'linux' && probe.sharedObjects?.some(file => /(?:^|\/)ld-musl-[^/]+\.so\.1$/.test(file))
  return { os: probe.os, arch: probe.arch, hostVersion, osVersion: probe.os === 'darwin' ? numeric(probe.productVersion) : probe.release,
    kernelVersion: probe.release, libc: glibc ? 'glibc' : musl ? 'musl' : undefined, libcVersion: glibc }
}
export function platformHost(hostVersion: string): PlatformHost {
  let glibc: string | undefined, sharedObjects: string[] | undefined, productVersion: string | undefined
  if (process.platform === 'linux') {
    try {
      const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
      glibc = report?.header?.glibcVersionRuntime; sharedObjects = report?.sharedObjects
    } catch { /* Unknown libc stays unknown; compatibility rejects required conditions. */ }
  } else if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { windowsHide: true, shell: false, encoding: 'utf8', timeout: 1500, maxBuffer: 4096,
      env: { PATH: '/usr/bin:/bin' } })
    if (!result.error && result.status === 0) productVersion = result.stdout.trim()
  }
  return platformHostFromProbe(hostVersion, { os: process.platform, arch: process.arch, release: os.release(), productVersion, glibc, sharedObjects })
}
export function assertPackageCompatible(manifest: PlatformPackage, hostVersion: string): void {
  const error = packageCompatibility(manifest, platformHost(hostVersion))
  if (error) throw new Error(error)
}
export type RuntimeFile = { path: string; size: number; sha256: string; executable?: boolean }
/** Build/pack operation only: produce a fresh inventory after intentional authoring changes. */
export function writeRuntimeInventory(dir: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as PlatformPackage
  if (manifest.packageFormatVersion !== 2) return
  assertPlatformPackage(manifest)
  const files: RuntimeFile[] = []
  const executable = manifest.runtime?.kind === 'executable-sidecar' ? manifest.runtime.executable : null
  const walk = (base: string) => {
    for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name
      if (!safeRuntimePath(rel) || e.isSymbolicLink()) throw new Error('invalid_runtime_path')
      if (e.isDirectory()) walk(rel)
      else if (rel !== 'runtime-files.json') {
        const data = fs.readFileSync(path.join(dir, rel))
        files.push({ path: rel, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), ...(rel === executable ? { executable: true } : {}) })
      }
    }
  }
  walk(''); files.sort((a, b) => a.path.localeCompare(b.path))
  fs.writeFileSync(path.join(dir, 'runtime-files.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n')
}
export function checkRuntimeVersion(dir: string, manifest: PlatformPackage): void {
  const r = manifest.runtime
  if (r?.kind !== 'executable-sidecar') return
  const checked = spawnSync(path.join(dir, r.executable), ['--version'], { windowsHide: true, shell: false,
    timeout: 10_000, maxBuffer: 256 * 1024, encoding: 'utf8', cwd: dir,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } })
  if (checked.error || checked.status !== 0 || !checked.stdout.startsWith(`fcurl ${r.binaryVersion} `)) throw new Error('runtime_version_mismatch')
}
export function assertRuntimeFiles(dir: string, manifest: PlatformPackage, restoreMode = false): void {
  assertPlatformPackage(manifest)
  if (manifest.packageFormatVersion !== 2) return
  const listPath = path.join(dir, 'runtime-files.json')
  if (!fs.existsSync(listPath)) throw new Error('runtime_manifest_missing')
  if (fs.statSync(listPath).size > 2 * 1024 * 1024) throw new Error('runtime_manifest_too_large')
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8')) as { version: number; files: RuntimeFile[] }
  if (list.version !== 1 || !Array.isArray(list.files) || list.files.length > PLUGIN_PACKAGE_MAX_ENTRIES) throw new Error('invalid_runtime_manifest')
  const seen = new Set<string>()
  for (const f of list.files) {
    if (!safeRuntimePath(f.path) || f.path === 'runtime-files.json' || seen.has(f.path.toLowerCase())
      || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('invalid_runtime_manifest')
    seen.add(f.path.toLowerCase())
    const full = path.join(dir, f.path)
    let stat: fs.Stats
    try { stat = fs.lstatSync(full) } catch { throw new Error(`runtime_file_missing:${f.path}`) }
    // Reject symlinks in every parent component, including development links.
    let current = dir
    for (const part of f.path.split('/')) {
      current = path.join(current, part)
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('runtime_symlink')
    }
    if (!stat.isFile() || stat.size !== f.size) throw new Error(`runtime_file_size:${f.path}`)
    const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    if (hash !== f.sha256) throw new Error(`runtime_hash_mismatch:${f.path}`)
    if (restoreMode && f.executable && process.platform !== 'win32') fs.chmodSync(full, 0o755)
  }
  const walk = (base: string) => {
    for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isSymbolicLink()) throw new Error('runtime_symlink')
      if (e.isDirectory()) walk(rel)
      else if (rel !== 'runtime-files.json' && !seen.has(rel.toLowerCase())) throw new Error(`runtime_file_unlisted:${rel}`)
    }
  }
  walk('')
  const r = manifest.runtime
  if (r?.kind === 'executable-sidecar') {
    const f = list.files.find(f => f.path === r.executable)
    if (!f?.executable) throw new Error('runtime_executable_missing')
    const b = fs.readFileSync(path.join(dir, r.executable))
    const t = manifest.target
    if (t?.kind !== 'platform') throw new Error('invalid_target')
    if (t.os === 'win32') {
      if (b.length < 64 || b.toString('ascii', 0, 2) !== 'MZ') throw new Error('invalid_binary')
      const pe = b.readUInt32LE(60)
      if (pe + 6 > b.length || b.readUInt32LE(pe) !== 0x4550 || b.readUInt16LE(pe + 4) !== (t.arch === 'x64' ? 0x8664 : 0xaa64)) throw new Error('binary_arch_mismatch')
    } else if (t.os === 'linux') {
      if (b.length < 64 || b.readUInt32BE(0) !== 0x7f454c46 || b[4] !== 2 || b[5] !== 1
        || b.readUInt16LE(18) !== (t.arch === 'x64' ? 62 : 183)) throw new Error('binary_arch_mismatch')
      if (t.linkage === 'static') {
        const offset = Number(b.readBigUInt64LE(32)), size = b.readUInt16LE(54), count = b.readUInt16LE(56)
        if (size < 56 || !Number.isSafeInteger(offset) || offset + size * count > b.length) throw new Error('invalid_binary')
        for (let i = 0; i < count; i++) if ([2, 3].includes(b.readUInt32LE(offset + i * size))) throw new Error('binary_not_static')
      }
    } else if (b.length < 8 || b.readUInt32LE(0) !== 0xfeedfacf
      || b.readUInt32LE(4) !== (t.arch === 'x64' ? 0x01000007 : 0x0100000c)) throw new Error('binary_arch_mismatch')
  }
}
