/**
 * In-process plugin zip (plugin_pack). Mirrors navora-plugin CLI pack
 * without spawning Node / the SDK — required for packaged desktop.
 */
import { assertPlatformPackage, type PlatformPackage } from '../../shared/plugin-platform'
import { assertRuntimeFiles } from './plugin-package'
import { PLUGIN_PACKAGE_MAX_ENTRIES, PLUGIN_PACKAGE_MAX_EXPANDED_BYTES } from '../../shared/plugin-package-limits'
import { parse } from '@babel/parser'
import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import AdmZip from 'adm-zip'
import { PLUGIN_ZIP_MAX_BYTES, type PluginSuiteManifest } from '../../shared/plugins'
import { normalizeStoreSuite } from '../../shared/store'

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const root = path.resolve(parent)
  const full = path.resolve(child)
  if (full === root) return true
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  return full.startsWith(rootWithSep)
}

type ProjectEntry = {
  id: string
  name?: string
  description?: string
  version?: string
  entry: string
  defaultEnabled?: boolean
  bundled?: boolean
  main?: string
  suite?: string
}

type ProjectManifest = {
  id: string
  name: string
  version: string
  description: string
  main: string
  defaultEnabled?: boolean
  bundled?: boolean
  suite?: string
  entries: ProjectEntry[]
  packFiles?: string[]
}

export type PluginPackZip = {
  kind: 'plugin' | 'suite'
  packageId: string
  path: string
  size: number
}

export type PluginPackResult =
  | {
      ok: true
      zips: PluginPackZip[]
      projectId: string
      projectDir: string
      note: string
    }
  | {
      ok: false
      error: string
      hint?: string
    }

function assertSafeRelPath(rel: string, label = 'path'): string {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error(`invalid_${label}`)
  const trimmed = rel.trim().replace(/\\/g, '/')
  if (trimmed.includes('..') || path.isAbsolute(trimmed)) throw new Error(`invalid_${label}`)
  return trimmed
}

function safeZipNamePart(v: string): string {
  return String(v || '0').replace(/[^\w.-]+/g, '-')
}

function listPluginProjectIds(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).filter((name) => {
    const dir = path.join(root, name)
    try {
      if (!fs.statSync(dir).isDirectory()) return false
    } catch {
      return false
    }
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') return false
    return fs.existsSync(path.join(dir, 'plugin.json'))
  })
}

function readProjectManifest(dir: string): ProjectManifest {
  const p = path.join(dir, 'plugin.json')
  if (!fs.existsSync(p)) throw new Error('plugin_json_missing')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
  } catch (e) {
    throw new Error(`invalid_plugin_json:${e instanceof Error ? e.message : String(e)}`)
  }
  if (!raw || typeof raw !== 'object') throw new Error('invalid_manifest')
  for (const key of ['id', 'name', 'version', 'description'] as const) {
    if (typeof raw[key] !== 'string' || !String(raw[key]).trim()) {
      throw new Error(`manifest_missing_field:${key}`)
    }
  }
  const mainRel =
    typeof raw.main === 'string' && raw.main.trim()
      ? assertSafeRelPath(raw.main.trim(), 'main_path')
      : 'main.cjs'
  const ext = path.extname(mainRel).toLowerCase()
  if (ext !== '.cjs' && ext !== '.js') throw new Error('invalid_main_ext')

  const entries: ProjectEntry[] = []
  if (raw.entries != null) {
    if (!Array.isArray(raw.entries)) throw new Error('invalid_entries')
    for (const item of raw.entries) {
      if (!item || typeof item !== 'object') throw new Error('invalid_entry')
      const e = item as Record<string, unknown>
      if (typeof e.id !== 'string' || !e.id.trim()) throw new Error('entry_missing_id')
      if (!/^[a-z][a-z0-9-]*$/.test(e.id.trim())) {
        throw new Error(`entry_id_must_be_kebab_case:${e.id}`)
      }
      entries.push({
        id: e.id.trim(),
        name: typeof e.name === 'string' ? e.name : undefined,
        description: typeof e.description === 'string' ? e.description : undefined,
        version: typeof e.version === 'string' ? e.version : undefined,
        entry: assertSafeRelPath(String(e.entry), 'entry_path'),
        defaultEnabled: typeof e.defaultEnabled === 'boolean' ? e.defaultEnabled : undefined,
        bundled: typeof e.bundled === 'boolean' ? e.bundled : undefined,
        main: typeof e.main === 'string' ? assertSafeRelPath(e.main, 'entry_main') : undefined,
        suite:
          typeof e.suite === 'string'
            ? e.suite.trim()
            : typeof e.exclusivityGroup === 'string'
              ? e.exclusivityGroup.trim()
              : undefined,
      })
    }
    const ids = new Set<string>()
    for (const e of entries) {
      if (ids.has(e.id)) throw new Error(`duplicate_entry_id:${e.id}`)
      ids.add(e.id)
    }
  }

  let packFiles: string[] | undefined
  if (raw.packFiles != null) {
    if (!Array.isArray(raw.packFiles)) throw new Error('invalid_packFiles')
    packFiles = raw.packFiles.map((f) => assertSafeRelPath(String(f), 'packFiles'))
  }

  return {
    id: String(raw.id).trim(),
    name: String(raw.name).trim(),
    version: String(raw.version).trim(),
    description: String(raw.description).trim(),
    main: mainRel,
    defaultEnabled: typeof raw.defaultEnabled === 'boolean' ? raw.defaultEnabled : undefined,
    bundled: typeof raw.bundled === 'boolean' ? raw.bundled : undefined,
    suite: normalizeStoreSuite(raw.suite ?? raw.exclusivityGroup),
    entries,
    packFiles,
  }
}

function listPackageIds(manifest: ProjectManifest, entryFilter?: string): string[] {
  const ids = manifest.entries.length ? manifest.entries.map((e) => e.id) : [manifest.id]
  if (!entryFilter) return ids
  if (!ids.includes(entryFilter)) {
    throw new Error(`entry_not_found:${entryFilter} (known: ${ids.join(', ') || 'none'})`)
  }
  return [entryFilter]
}

function packageOutDir(projectDir: string, packageId: string, target?: string): string {
  return path.join(projectDir, 'dist', packageId, ...(target ? [target] : []))
}

function shouldSkipZipName(name: string): boolean {
  if (name.endsWith('.map')) return true
  if (name.endsWith('.zip')) return true
  return false
}

function addDirToZip(
  zip: AdmZip,
  base: string,
  prefix: string,
  preserveAll = false,
): void {
  for (const name of fs.readdirSync(base)) {
    if (!preserveAll && shouldSkipZipName(name)) continue
    const full = path.join(base, name)
    const st = fs.lstatSync(full)
    if (st.isSymbolicLink()) continue
    const entryPrefix = prefix ? `${prefix}/${name}` : name
    if (st.isDirectory()) addDirToZip(zip, full, entryPrefix, preserveAll)
    else zip.addLocalFile(full, prefix || undefined, name)
  }
}

/** Parse only. The parser is bundled into main; no SDK, compiler binary or entry executes. */
function assertDistDependencies(outDir: string, mainFile: string): void {
  const root = path.resolve(outDir), visited = new Set<string>()
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
  function visit(file: string) {
    if (!isPathInsideOrEqual(root, file)) throw new Error('runtime_dependency_outside_package')
    let current = root
    for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('runtime_symlink')
    }
    if (!fs.statSync(file).isFile()) throw new Error('runtime_dependency_not_file')
    if (visited.has(file)) return
    visited.add(file)
    const ext = path.extname(file)
    if (ext === '.node') throw new Error('native_runtime_unsupported')
    const text = fs.readFileSync(file, 'utf8')
    if (ext === '.json') { JSON.parse(text); return }
    if (!['.js', '.cjs', '.mjs', ''].includes(ext)) throw new Error('runtime_dependency_unverifiable')
    const resolver = createRequire(file)
    const dependency = (source: unknown) => {
      const literal = source as { type?: string; value?: unknown } | undefined
      if (literal?.type !== 'StringLiteral' || typeof literal.value !== 'string') throw new Error('runtime_dependency_dynamic')
      const name = literal.value
      if (name === 'electron' || builtins.has(name)) return
      let resolved: string
      try { resolved = resolver.resolve(name) } catch { throw new Error(`runtime_dependency_missing:${name}`) }
      visit(resolved)
    }
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { for (const item of value) walk(item); return }
      const node = value as Record<string, unknown>
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(node.type)) && node.source) dependency(node.source)
      if (node.type === 'ImportExpression') dependency(node.source)
      if (node.type === 'CallExpression') {
        const callee = node.callee as { type?: string; name?: string; object?: { name?: string }; property?: { name?: string } } | undefined
        if (callee?.type === 'Identifier' && callee.name === 'require'
          || callee?.type === 'MemberExpression' && callee.object?.name === 'require' && callee.property?.name === 'resolve') {
          const args = node.arguments as unknown[]
          if (args.length !== 1) throw new Error('runtime_dependency_dynamic')
          dependency(args[0])
        }
      }
      for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) walk(child)
    }
    walk(parse(text, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, createImportExpressions: true }))
  }
  visit(path.resolve(mainFile))
}

function assertPackageLimits(outDir: string): void {
  let count = 0, expanded = 0
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error('runtime_symlink')
      if (++count > PLUGIN_PACKAGE_MAX_ENTRIES) throw new Error('zip_too_many_entries')
      if (entry.isDirectory()) walk(full)
      else {
        if (!entry.isFile()) throw new Error('runtime_file_type')
        const size = fs.statSync(full).size
        if (size > PLUGIN_ZIP_MAX_BYTES) throw new Error('zip_entry_too_large')
        expanded += size
        if (expanded > PLUGIN_PACKAGE_MAX_EXPANDED_BYTES) throw new Error('zip_unpacked_too_large')
      }
    }
  }
  walk(outDir)
}

function readDistManifest(outDir: string): { main: string; id: string; name: string; version: string; description: string; defaultEnabled?: boolean } {
  const p = path.join(outDir, 'plugin.json')
  if (!fs.existsSync(p)) throw new Error('plugin_json_missing')
  const raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.version !== 'string') {
    throw new Error('invalid_manifest')
  }
  const mainRel =
    typeof raw.main === 'string' && raw.main.trim()
      ? assertSafeRelPath(raw.main.trim(), 'main_path')
      : 'main.cjs'
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    version: String(raw.version).trim(),
    description: typeof raw.description === 'string' ? raw.description : '',
    main: mainRel,
    defaultEnabled: typeof raw.defaultEnabled === 'boolean' ? raw.defaultEnabled : undefined,
  }
}

function assertDistPackage(outDir: string, packageId: string, expected: Record<string, unknown> = {}): ReturnType<typeof readDistManifest> {
  if (!fs.existsSync(outDir)) {
    throw new Error(`dist_missing:dist/${packageId}`)
  }
  assertPackageLimits(outDir)
  const manifest = readDistManifest(outDir)
  const raw = JSON.parse(fs.readFileSync(path.join(outDir, 'plugin.json'), 'utf8'))
  for (const [field, value] of Object.entries({ id: packageId, ...expected })) {
    if (value !== undefined && !isDeepStrictEqual(raw[field], value)) throw new Error(`built_manifest_mismatch:${field}`)
  }
  assertRuntimeFiles(outDir, raw)
  const mainFile = path.join(outDir, manifest.main)
  if (!fs.existsSync(mainFile) || !fs.statSync(mainFile).isFile()) {
    throw new Error(`main_missing:dist/${packageId}/${manifest.main}`)
  }
  assertDistDependencies(outDir, mainFile)
  return manifest
}

function writeZipFile(zip: AdmZip, dest: string, workspaceRoot: string): { path: string; size: number } {
  const abs = path.resolve(dest)
  if (!isPathInsideOrEqual(workspaceRoot, abs)) {
    throw new Error('out_outside_workspace')
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const entries = zip.getEntries()
  if (entries.length > PLUGIN_PACKAGE_MAX_ENTRIES) throw new Error('zip_too_many_entries')
  let expanded = 0
  for (const entry of entries) {
    if (entry.header.size > PLUGIN_ZIP_MAX_BYTES) throw new Error('zip_entry_too_large')
    expanded += entry.header.size
    if (expanded > PLUGIN_PACKAGE_MAX_EXPANDED_BYTES) throw new Error('zip_unpacked_too_large')
  }
  zip.writeZip(abs)
  const size = fs.statSync(abs).size
  if (size > PLUGIN_ZIP_MAX_BYTES) {
    try {
      fs.unlinkSync(abs)
    } catch {
      /* ignore */
    }
    throw new Error(`plugin_too_large:${size}`)
  }
  return { path: abs, size }
}

function packPackageDir(opts: {
  outDir: string
  packageId: string
  dest: string
  workspaceRoot: string
  includeNodeModules: boolean
  projectDir: string
}): PluginPackZip {
  const dist = assertDistPackage(opts.outDir, opts.packageId)
  const zip = new AdmZip()
  const v2 = JSON.parse(fs.readFileSync(path.join(opts.outDir, 'plugin.json'), 'utf8')).packageFormatVersion === 2
  if (v2 && opts.includeNodeModules) throw new Error('platform_node_modules_not_supported')
  addDirToZip(zip, opts.outDir, '', v2)
  const written = writeZipFile(zip, opts.dest, opts.workspaceRoot)
  return { kind: 'plugin', packageId: dist.id || opts.packageId, path: written.path, size: written.size }
}

function packSuiteBundle(opts: {
  projectId: string
  projectDir: string
  manifest: ProjectManifest
  packageIds: string[]
  target?: string
  dest: string
  workspaceRoot: string
  includeNodeModules: boolean
}): PluginPackZip {
  const suiteId = opts.manifest.suite || opts.projectId
  const zip = new AdmZip()
  const suitePackages: PluginSuiteManifest['packages'] = []

  for (const packageId of opts.packageIds) {
    const outDir = packageOutDir(opts.projectDir, packageId, opts.target)
    const outManifest = assertDistPackage(outDir, packageId)
    const prefix = `packages/${packageId}`
    const v2 = JSON.parse(fs.readFileSync(path.join(outDir, 'plugin.json'), 'utf8')).packageFormatVersion === 2
    if (v2 && opts.includeNodeModules) throw new Error('platform_node_modules_not_supported')
    addDirToZip(zip, outDir, prefix, v2)
    suitePackages.push({
      id: packageId,
      name: outManifest.name || packageId,
      description: outManifest.description || '',
      version: outManifest.version,
      path: `packages/${packageId}`,
      ...(outManifest.defaultEnabled !== undefined
        ? { defaultEnabled: outManifest.defaultEnabled }
        : {}),
    })
  }

  const suiteJson: PluginSuiteManifest = {
    schemaVersion: 1,
    kind: 'plugin-suite',
    id: suiteId,
    name: opts.manifest.name || suiteId,
    version: opts.manifest.version,
    description: opts.manifest.description || '',
    suite: opts.manifest.suite || suiteId,
    packages: suitePackages,
  }
  zip.addFile('suite.json', Buffer.from(`${JSON.stringify(suiteJson, null, 2)}\n`, 'utf8'))
  const written = writeZipFile(zip, opts.dest, opts.workspaceRoot)
  return { kind: 'suite', packageId: suiteId, path: written.path, size: written.size }
}

function resolvePackTarget(workspaceRoot: string, rootRel?: string): string {
  let target = path.resolve(workspaceRoot)
  if (rootRel?.trim()) {
    target = path.isAbsolute(rootRel)
      ? path.resolve(rootRel)
      : path.resolve(workspaceRoot, rootRel.trim())
    if (!isPathInsideOrEqual(workspaceRoot, target)) {
      throw new Error('root_outside_workspace')
    }
  }
  return target
}

function resolveProjectDir(
  target: string,
  idArg?: string,
): { projectDir: string; projectId: string; outputRoot: string } {
  const isSingle = fs.existsSync(path.join(target, 'plugin.json'))
  if (isSingle) {
    const manifest = readProjectManifest(target)
    const projectId = manifest.id || path.basename(target)
    return { projectDir: target, projectId, outputRoot: target }
  }

  const id = idArg?.trim()
  if (!id) {
    const known = listPluginProjectIds(target)
    const err = new Error('pack_id_required') as Error & { hint?: string }
    err.hint = known.length
      ? `多插件根目录请传 id（已知：${known.join(', ')}）。`
      : 'pack 需要 id，或工作区根目录需有含 id 的 plugin.json。'
    throw err
  }
  const projectDir = path.join(target, id)
  if (!isPathInsideOrEqual(target, projectDir) || !fs.existsSync(path.join(projectDir, 'plugin.json'))) {
    const known = listPluginProjectIds(target)
    throw new Error(`plugin_not_found:${id} (known: ${known.join(', ') || 'none'})`)
  }
  return { projectDir, projectId: id, outputRoot: target }
}

function resolveOutPath(
  workspaceRoot: string,
  outputRoot: string,
  outRel: string | undefined,
  fallbackRel: string,
): string {
  if (outRel?.trim()) {
    const abs = path.isAbsolute(outRel) ? path.resolve(outRel) : path.resolve(workspaceRoot, outRel.trim())
    if (!isPathInsideOrEqual(workspaceRoot, abs)) throw new Error('out_outside_workspace')
    return abs
  }
  const dest = path.resolve(outputRoot, fallbackRel)
  if (!isPathInsideOrEqual(workspaceRoot, dest)) throw new Error('out_outside_workspace')
  return dest
}

/** Pack built dist/<packageId> into workspace zip(s). Output never leaves the Chat workspace. */
export function packPluginProject(opts: {
  workspaceRoot: string
  target?: string
  id?: string
  entry?: string
  root?: string
  out?: string
  includeNodeModules?: boolean
}): PluginPackResult {
  const workspaceRoot = path.resolve(opts.workspaceRoot)
  try {
    const target = resolvePackTarget(workspaceRoot, opts.root)
    const { projectDir, projectId, outputRoot } = resolveProjectDir(target, opts.id)
    const manifest = readProjectManifest(projectDir)
    const author = JSON.parse(fs.readFileSync(path.join(projectDir, 'plugin.json'), 'utf8'))
    const targets = author.build?.targets as PlatformPackage[] | undefined
    const artifactId = targets ? (opts.target || `${process.platform}-${process.arch}`) : undefined
    const selectedTarget = targets?.find(t => t.artifactId === artifactId)
    if (artifactId && !selectedTarget) throw new Error('target_not_found')
    if (selectedTarget) assertPlatformPackage({ packageFormatVersion: 2, ...selectedTarget })

    const entryFilter = opts.entry?.trim() || undefined
    const packageIds = listPackageIds(manifest, entryFilter)
    const isMulti = manifest.entries.length > 0
    const packingAll = isMulti && !entryFilter
    const includeNodeModules = Boolean(opts.includeNodeModules)

    for (const packageId of packageIds) {
      const outDir = packageOutDir(projectDir, packageId, artifactId)
      if (!fs.existsSync(outDir)) {
        return {
          ok: false,
          error: `dist_missing:dist/${packageId}`,
          hint: `请先 plugin_build${opts.id ? `（id=${opts.id}）` : ''} 生成 dist/${packageId}/。`,
        }
      }
      const entry = manifest.entries.find(item => item.id === packageId)
      // Read-only verification: pack must never re-sign modified bytes or refresh assets.
      assertDistPackage(outDir, packageId, { version: entry?.version || manifest.version,
        ...(selectedTarget ? { artifactId: selectedTarget.artifactId, target: selectedTarget.target, runtime: selectedTarget.runtime } : {}) })
      if (includeNodeModules && selectedTarget) throw new Error('platform_node_modules_not_supported')
      if (includeNodeModules && fs.existsSync(path.join(projectDir, 'node_modules')) && !fs.existsSync(path.join(outDir, 'node_modules'))) throw new Error('runtime_dependencies_not_staged')
    }

    const zips: PluginPackZip[] = []

    if (opts.out?.trim() && packingAll) {
      const dest = resolveOutPath(workspaceRoot, outputRoot, opts.out, '')
      zips.push(
        packSuiteBundle({
          projectId,
          projectDir,
          manifest,
          target: artifactId,
          packageIds,
          dest,
          workspaceRoot,
          includeNodeModules,
        }),
      )
      return {
        ok: true,
        zips,
        projectId,
        projectDir,
        note: '已打套件总包（指定 out 时多入口只输出 suite zip）。',
      }
    }

    if (opts.out?.trim() && packageIds.length > 1) {
      return {
        ok: false,
        error: 'pack_out_requires_single_entry',
        hint: '多入口请传 entry=<packageId> 再指定 out，或不传 entry 打套件总包。',
      }
    }

    for (const packageId of packageIds) {
      const distMan = readDistManifest(packageOutDir(projectDir, packageId, artifactId))
      const fileName = `${packageId}-${safeZipNamePart(distMan.version)}${artifactId ? `-${artifactId}` : ''}-plugin.zip`
      const fallbackRel = isMulti
        ? path.join('dist', projectId, fileName)
        : path.join('dist', fileName)
      const dest = resolveOutPath(
        workspaceRoot,
        outputRoot,
        packageIds.length === 1 ? opts.out : undefined,
        fallbackRel,
      )
      zips.push(
        packPackageDir({
          outDir: packageOutDir(projectDir, packageId, artifactId),
          packageId,
          dest,
          workspaceRoot,
          includeNodeModules,
          projectDir,
        }),
      )
    }

    if (packingAll) {
      const suiteId = manifest.suite || projectId
      const dest = resolveOutPath(
        workspaceRoot,
        outputRoot,
        undefined,
        path.join('dist', `${suiteId}-${safeZipNamePart(manifest.version)}-suite.zip`),
      )
      zips.push(
        packSuiteBundle({
          projectId,
          projectDir,
          manifest,
          target: artifactId,
          packageIds,
          dest,
          workspaceRoot,
          includeNodeModules,
        }),
      )
    }

    const suiteCount = zips.filter((z) => z.kind === 'suite').length
    const pluginCount = zips.filter((z) => z.kind === 'plugin').length
    return {
      ok: true,
      zips,
      projectId,
      projectDir,
      note:
        suiteCount > 0
          ? `已打包 ${pluginCount} 个变体 + ${suiteCount} 个套件总包；路径均在工作区内。`
          : `已打包 ${pluginCount} 个插件 zip；路径均在工作区内。`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const hint =
      e && typeof e === 'object' && 'hint' in e && typeof (e as { hint?: unknown }).hint === 'string'
        ? (e as { hint: string }).hint
        : error === 'root_outside_workspace'
          ? 'root 必须位于当前 Chat 工作区内。'
          : error === 'out_outside_workspace'
            ? 'out 必须位于当前 Chat 工作区内。'
            : error.startsWith('dist_missing:')
              ? '请先 plugin_build 生成 dist/<packageId>/。'
              : undefined
    return { ok: false, error, ...(hint ? { hint } : {}) }
  }
}
