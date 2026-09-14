import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app } from 'electron'
import AdmZip from 'adm-zip'
import type { ChatCompletionTool } from '../../shared/openai-types'
import {
  emptyPluginsIndex,
  PLUGIN_ZIP_MAX_BYTES,
  type NavoraPluginModule,
  type PluginImportOptions,
  type PluginImportPreview,
  type PluginInstallKind,
  type PluginManifest,
  type PluginParseOptions,
  type PluginRecord,
  type PluginSuiteManifest,
  type PluginSuitePackagePreview,
  type PluginsIndex,
  type PluginsIndexEntry,
} from '../../shared/plugins'
import { isSafeZipEntryName, normalizeStoreSuite } from '../../shared/store'
import { ensureDir } from '../data-root'
import { createPluginHostApi } from './plugin-host'
import type { ToolExecContext } from './browser-tools'

type ZipEntry = ReturnType<AdmZip['getEntries']>[number]

type LoadedPlugin = {
  dirName: string
  dirPath: string
  manifest: PluginManifest
  mod: NavoraPluginModule | null
  loadError?: string
  kind: PluginInstallKind
}

const requireFromHere = createRequire(import.meta.url)

function readJsonFile(file: string): unknown {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(raw)
}

/** Preferred plugin docs filenames (first match wins). */
const PLUGIN_README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'DOCS.md', 'docs.md']

export function findPluginReadmePath(dirPath: string): string | null {
  if (!dirPath) return null
  for (const name of PLUGIN_README_NAMES) {
    const full = path.join(dirPath, name)
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    } catch {
      /* ignore */
    }
  }
  try {
    for (const name of fs.readdirSync(dirPath)) {
      if (!/^(readme|docs)\.md$/i.test(name)) continue
      const full = path.join(dirPath, name)
      if (fs.statSync(full).isFile()) return full
    }
  } catch {
    /* ignore */
  }
  return null
}

function isManifest(v: unknown): v is PluginManifest {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.version === 'string'
}

/** kebab-case suite id; invalid/empty → undefined. Accepts legacy exclusivityGroup. */
export function normalizeSuite(v: unknown): string | undefined {
  return normalizeStoreSuite(v)
}

function suiteOf(manifest: PluginManifest | undefined): string | undefined {
  const m = manifest as (PluginManifest & { exclusivityGroup?: string }) | undefined
  return normalizeSuite(m?.suite ?? m?.exclusivityGroup)
}

function resolveModule(raw: unknown): NavoraPluginModule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const nested = o.default
  const candidate = (
    nested && typeof nested === 'object' ? nested : o
  ) as NavoraPluginModule
  if (
    !Array.isArray(candidate.tools) ||
    typeof candidate.execute !== 'function' ||
    typeof candidate.planPermissions !== 'function'
  ) {
    return null
  }
  return candidate
}

function copyDirSync(src: string, dst: string): void {
  ensureDir(dst)
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dst, name)
    const st = fs.lstatSync(from)
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) copyDirSync(from, to)
    else fs.copyFileSync(from, to)
  }
}

function sanitizePluginDirName(id: string): string {
  return id.replace(/[^\w.-]+/g, '-') || 'plugin'
}

function isZipPath(p: string): boolean {
  return path.extname(p).toLowerCase() === '.zip'
}

/** Resolve plugin.json + main inside a directory; throw Error with code message. */
function validatePluginDir(dir: string): {
  manifest: PluginManifest
  mainRel: string
  mainFile: string
} {
  const manifestPath = path.join(dir, 'plugin.json')
  if (!fs.existsSync(manifestPath)) throw new Error('plugin_json_missing')
  let raw: unknown
  try {
    raw = readJsonFile(manifestPath)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e))
  }
  if (!isManifest(raw)) throw new Error('invalid_manifest')
  const mainRel = raw.main || 'main.cjs'
  if (mainRel.includes('..') || path.isAbsolute(mainRel)) throw new Error('invalid_main_path')
  const ext = path.extname(mainRel).toLowerCase()
  if (ext !== '.cjs' && ext !== '.js') throw new Error('invalid_main_ext')
  const mainFile = path.join(dir, mainRel)
  if (!fs.existsSync(mainFile) || !fs.statSync(mainFile).isFile()) {
    throw new Error(`main_missing:${mainRel}`)
  }
  return { manifest: raw, mainRel, mainFile }
}

function zipEntryName(e: ZipEntry): string {
  return e.entryName.replace(/\\/g, '/')
}

function assertZipEntriesSafe(entries: ZipEntry[]): void {
  for (const e of entries) {
    if (!isSafeZipEntryName(zipEntryName(e))) throw new Error('zip_unsafe_path')
  }
}

function findZipEntry(entries: ZipEntry[], relPath: string): ZipEntry | undefined {
  const want = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return entries.find((e) => !e.isDirectory && zipEntryName(e) === want)
}

function parseJsonEntry(entry: ZipEntry): unknown {
  return JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/, ''))
}

function isSuiteManifest(v: unknown): v is PluginSuiteManifest {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.schemaVersion === 1 &&
    o.kind === 'plugin-suite' &&
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.version === 'string' &&
    Array.isArray(o.packages) &&
    o.packages.length > 0
  )
}

function normalizePackageRelPath(raw: string): string {
  const p = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (!p || p.includes('..') || path.isAbsolute(p)) throw new Error('zip_unsafe_path')
  return p
}

/** Locate suite.json at zip root or under a single top-level folder. */
function findSuiteManifestEntry(entries: ZipEntry[]): { entry: ZipEntry; rootPrefix: string } | null {
  const root = findZipEntry(entries, 'suite.json')
  if (root) return { entry: root, rootPrefix: '' }
  const candidates = entries.filter(
    (e) => !e.isDirectory && /(?:^|\/)suite\.json$/i.test(zipEntryName(e)),
  )
  if (candidates.length !== 1) return null
  const name = zipEntryName(candidates[0])
  return { entry: candidates[0], rootPrefix: name.slice(0, -'suite.json'.length) }
}

function pickDefaultSuitePackageId(
  packages: PluginSuitePackagePreview[],
  preferred?: string,
): string {
  const pref = String(preferred || '').trim()
  if (pref && packages.some((p) => p.id === pref)) return pref
  const universal = packages.find((p) => p.id.endsWith('-universal'))
  if (universal) return universal.id
  const enabled = packages.find((p) => p.defaultEnabled !== false)
  return enabled?.id || packages[0]!.id
}

type PeekedSingleZip = {
  kind: 'single'
  manifest: PluginManifest
  mainRel: string
  sizeBytes: number
  /** Prefix of plugin.json inside zip ('' or 'folder/'). */
  rootPrefix: string
}

type PeekedSuiteZip = {
  kind: 'suite'
  suite: PluginSuiteManifest
  packages: PluginSuitePackagePreview[]
  selected: {
    packageId: string
    manifest: PluginManifest
    mainRel: string
    /** Absolute path prefix inside zip ending with '/', e.g. 'packages/foo/'. */
    packagePrefix: string
  }
  sizeBytes: number
  rootPrefix: string
}

type PeekedZip = PeekedSingleZip | PeekedSuiteZip

function peekZip(zipPath: string, opts?: { packageId?: string }): PeekedZip {
  const st = fs.statSync(zipPath)
  if (!st.isFile()) throw new Error('path_not_found')
  if (st.size > PLUGIN_ZIP_MAX_BYTES) throw new Error('plugin_too_large')
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  if (!entries.length) throw new Error('zip_empty')
  assertZipEntriesSafe(entries)

  const suiteHit = findSuiteManifestEntry(entries)
  if (suiteHit) {
    let suiteRaw: unknown
    try {
      suiteRaw = parseJsonEntry(suiteHit.entry)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
    if (!isSuiteManifest(suiteRaw)) throw new Error('invalid_suite_manifest')

    const packages: PluginSuitePackagePreview[] = []
    const packagePrefixes = new Map<string, string>()
    for (const item of suiteRaw.packages) {
      if (!item || typeof item !== 'object') throw new Error('invalid_suite_manifest')
      const id = String(item.id || '').trim()
      const version = String(item.version || '').trim()
      if (!id || !version) throw new Error('invalid_suite_manifest')
      const rel = normalizePackageRelPath(String(item.path || `packages/${id}`))
      const pkgPrefix = `${suiteHit.rootPrefix}${rel}/`.replace(/\/+/g, '/')
      const pluginJson = findZipEntry(entries, `${pkgPrefix}plugin.json`)
      if (!pluginJson) throw new Error(`plugin_json_missing:${id}`)
      let pkgManifest: unknown
      try {
        pkgManifest = parseJsonEntry(pluginJson)
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e))
      }
      if (!isManifest(pkgManifest) || pkgManifest.id !== id) {
        throw new Error(`invalid_manifest:${id}`)
      }
      const mainRel = pkgManifest.main || 'main.cjs'
      if (mainRel.includes('..') || path.isAbsolute(mainRel)) throw new Error('invalid_main_path')
      const ext = path.extname(mainRel).toLowerCase()
      if (ext !== '.cjs' && ext !== '.js') throw new Error('invalid_main_ext')
      if (!findZipEntry(entries, `${pkgPrefix}${mainRel}`)) {
        throw new Error(`main_missing:${id}:${mainRel}`)
      }
      packages.push({
        id,
        name: String(item.name || pkgManifest.name || id),
        description: String(item.description || pkgManifest.description || ''),
        version: String(item.version || pkgManifest.version),
        ...(item.defaultEnabled !== undefined
          ? { defaultEnabled: Boolean(item.defaultEnabled) }
          : pkgManifest.defaultEnabled !== undefined
            ? { defaultEnabled: Boolean(pkgManifest.defaultEnabled) }
            : {}),
      })
      packagePrefixes.set(id, pkgPrefix)
    }
    if (!packages.length) throw new Error('suite_packages_empty')

    const packageId = pickDefaultSuitePackageId(packages, opts?.packageId)
    const packagePrefix = packagePrefixes.get(packageId)
    if (!packagePrefix) throw new Error(`package_not_found:${packageId}`)
    const pluginJson = findZipEntry(entries, `${packagePrefix}plugin.json`)!
    const manifest = parseJsonEntry(pluginJson) as PluginManifest
    if (!isManifest(manifest)) throw new Error(`invalid_manifest:${packageId}`)
    const mainRel = manifest.main || 'main.cjs'

    return {
      kind: 'suite',
      suite: suiteRaw,
      packages,
      selected: { packageId, manifest, mainRel, packagePrefix },
      sizeBytes: st.size,
      rootPrefix: suiteHit.rootPrefix,
    }
  }

  let manifestEntry = findZipEntry(entries, 'plugin.json')
  if (!manifestEntry) {
    const candidates = entries.filter(
      (e) => !e.isDirectory && /(?:^|\/)plugin\.json$/i.test(zipEntryName(e)),
    )
    if (candidates.length === 1) manifestEntry = candidates[0]
  }
  if (!manifestEntry) throw new Error('plugin_json_missing')

  const manifestName = zipEntryName(manifestEntry)
  const rootPrefix = manifestName === 'plugin.json' ? '' : manifestName.slice(0, -'plugin.json'.length)

  let raw: unknown
  try {
    raw = parseJsonEntry(manifestEntry)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e))
  }
  if (!isManifest(raw)) throw new Error('invalid_manifest')
  const mainRel = raw.main || 'main.cjs'
  if (mainRel.includes('..') || path.isAbsolute(mainRel)) throw new Error('invalid_main_path')
  const ext = path.extname(mainRel).toLowerCase()
  if (ext !== '.cjs' && ext !== '.js') throw new Error('invalid_main_ext')
  const mainEntryName = `${rootPrefix}${mainRel}`.replace(/\\/g, '/')
  if (!findZipEntry(entries, mainEntryName)) throw new Error(`main_missing:${mainRel}`)

  return { kind: 'single', manifest: raw, mainRel, sizeBytes: st.size, rootPrefix }
}

function writeZipEntrySafe(destDir: string, rel: string, data: Buffer): void {
  if (!rel || rel.endsWith('/') || rel.includes('..')) throw new Error('zip_unsafe_path')
  const out = path.join(destDir, rel)
  const outDir = path.dirname(out)
  ensureDir(outDir)
  const realRoot = fs.realpathSync(destDir)
  const realOutDir = fs.realpathSync(outDir)
  const relToRoot = path.relative(realRoot, realOutDir)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error('zip_unsafe_path')
  }
  fs.writeFileSync(out, data)
}

/** Extract a single-plugin zip (plugin.json at root or one top folder). */
function extractSingleZipToDir(zipPath: string, destDir: string, rootPrefix: string): void {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  ensureDir(destDir)
  for (const e of entries) {
    const name = zipEntryName(e)
    if (!isSafeZipEntryName(name)) throw new Error('zip_unsafe_path')
    if (e.isDirectory) continue
    let rel = name
    if (rootPrefix) {
      if (!name.startsWith(rootPrefix)) continue
      rel = name.slice(rootPrefix.length)
    }
    if (!rel || rel.endsWith('/')) continue
    writeZipEntrySafe(destDir, rel, e.getData())
  }
}

/** Extract one package folder from a suite zip into destDir (flat plugin root). */
function extractSuitePackageToDir(zipPath: string, packagePrefix: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  ensureDir(destDir)
  let wrote = 0
  for (const e of entries) {
    const name = zipEntryName(e)
    if (!isSafeZipEntryName(name)) throw new Error('zip_unsafe_path')
    if (e.isDirectory) continue
    if (!name.startsWith(packagePrefix)) continue
    const rel = name.slice(packagePrefix.length)
    if (!rel || rel.endsWith('/')) continue
    writeZipEntrySafe(destDir, rel, e.getData())
    wrote += 1
  }
  if (!wrote) throw new Error('zip_empty')
}

function bundledPluginsRoot(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'bundled-plugins'),
    path.join(app.getAppPath(), 'dist-electron', 'bundled-plugins'),
    path.join(app.getAppPath(), 'bundled-plugins'),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return candidates[1]
}

/**
 * Loadable plugin store: scans dataRoot/plugins + linked external folders, then require(main).
 */
export class PluginStore {
  private root: string
  private indexPath: string
  private index: PluginsIndex = emptyPluginsIndex()
  private loaded = new Map<string, LoadedPlugin>()
  private toolOwner = new Map<string, string>()
  /** Session-scoped (plugin-dev) loads: scopeChatId → pluginId → loaded */
  private sessionLoaded = new Map<string, Map<string, LoadedPlugin>>()
  /** scopeChatId → toolName → pluginId */
  private sessionToolOwner = new Map<string, Map<string, string>>()
  private changeListener: (() => void) | null = null
  private changeScheduled = false

  constructor(dataRoot: string) {
    this.root = path.join(dataRoot, 'plugins')
    this.indexPath = path.join(this.root, 'index.json')
    ensureDir(this.root)
    this.reload()
  }

  onChanged(listener: (() => void) | null): void {
    this.changeListener = listener
  }

  getRoot(): string {
    return this.root
  }

  reload(): PluginsIndex {
    ensureDir(this.root)
    this.syncBundledPlugins()
    this.loadIndexFile()
    this.scanAndLoad()
    this.reconcileIndex()
    this.rebuildToolIndex()
    this.persistIndex()
    return this.index
  }

  private syncBundledPlugins(): void {
    const seedRoot = bundledPluginsRoot()
    if (!fs.existsSync(seedRoot)) return
    for (const name of fs.readdirSync(seedRoot)) {
      const src = path.join(seedRoot, name)
      if (!fs.statSync(src).isDirectory()) continue
      const manifestPath = path.join(src, 'plugin.json')
      if (!fs.existsSync(manifestPath)) continue
      let manifest: PluginManifest
      try {
        const raw = readJsonFile(manifestPath)
        if (!isManifest(raw)) continue
        manifest = raw
      } catch {
        continue
      }
      const dest = path.join(this.root, name)
      const destManifest = path.join(dest, 'plugin.json')
      let shouldCopy = !fs.existsSync(destManifest)
      if (!shouldCopy) {
        try {
          const existing = readJsonFile(destManifest)
          if (isManifest(existing) && existing.version !== manifest.version) {
            shouldCopy = true
          }
        } catch {
          shouldCopy = true
        }
      }
      // Do not overwrite a linked plugin of the same id via folder name collision;
      // bundled sync only manages installed dirs under root.
      if (shouldCopy) {
        try {
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
          copyDirSync(src, dest)
        } catch (e) {
          console.warn('[plugins] sync bundled failed', name, e)
        }
      }
    }
  }

  private loadIndexFile(): void {
    if (!fs.existsSync(this.indexPath)) {
      this.index = emptyPluginsIndex()
      return
    }
    try {
      const parsed = readJsonFile(this.indexPath) as PluginsIndex
      if (parsed && Array.isArray(parsed.plugins)) {
        this.index = {
          version: 1,
          plugins: parsed.plugins
            .filter((p) => p && p.id)
            .map((p) => {
              const entry: PluginsIndexEntry = {
                id: String(p.id),
                enabled: Boolean(p.enabled),
              }
              const link = typeof p.linkPath === 'string' ? path.resolve(p.linkPath) : ''
              if (link) entry.linkPath = link
              if (typeof p.sourceArchive === 'string' && p.sourceArchive.trim()) {
                entry.sourceArchive = p.sourceArchive.trim()
              }
              return entry
            }),
        }
        return
      }
    } catch (e) {
      console.warn('[plugins] index load failed', e)
    }
    this.index = emptyPluginsIndex()
  }

  private bustRequire(mainFile: string): void {
    try {
      delete requireFromHere.cache[requireFromHere.resolve(mainFile)]
    } catch {
      /* ignore */
    }
  }

  private loadOne(dirPath: string, dirName: string, kind: PluginInstallKind): LoadedPlugin {
    try {
      const { manifest, mainRel, mainFile } = validatePluginDir(dirPath)
      this.bustRequire(mainFile)
      const raw = requireFromHere(mainFile)
      const mod = resolveModule(raw)
      if (!mod) {
        return {
          dirName,
          dirPath,
          manifest,
          mod: null,
          loadError: 'invalid_module_exports',
          kind: manifest.bundled ? 'bundled' : kind,
        }
      }
      return {
        dirName,
        dirPath,
        manifest,
        mod,
        kind: manifest.bundled ? 'bundled' : kind,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      let manifest: PluginManifest = {
        id: dirName,
        name: dirName,
        version: '0',
        description: 'load error',
      }
      try {
        const raw = readJsonFile(path.join(dirPath, 'plugin.json'))
        if (isManifest(raw)) manifest = raw
      } catch {
        /* ignore */
      }
      return {
        dirName,
        dirPath,
        manifest,
        mod: null,
        loadError: msg,
        kind: manifest.bundled ? 'bundled' : kind,
      }
    }
  }

  private scanAndLoad(): void {
    for (const prev of this.loaded.values()) {
      const mainFile = path.join(prev.dirPath, prev.manifest.main || 'main.cjs')
      this.bustRequire(mainFile)
    }
    this.loaded.clear()

    const linkedById = new Map<string, string>()
    for (const e of this.index.plugins) {
      if (e.linkPath) linkedById.set(e.id, e.linkPath)
    }

    // Drop leftover installed dirs when id is linked (dev mode wins).
    for (const id of linkedById.keys()) {
      try {
        this.removeInstalledDirForId(id)
      } catch (e) {
        console.warn('[plugins] cleanup installed under link failed', id, e)
      }
    }

    // 1) Installed / bundled under dataRoot/plugins (skip ids that are linked)
    if (fs.existsSync(this.root)) {
      for (const dirName of fs.readdirSync(this.root)) {
        if (dirName === 'index.json') continue
        const dirPath = path.join(this.root, dirName)
        let st: fs.Stats
        try {
          st = fs.statSync(dirPath)
        } catch {
          continue
        }
        if (!st.isDirectory()) continue
        if (!fs.existsSync(path.join(dirPath, 'plugin.json'))) continue

        // Peek id to skip if linked
        let peekId = dirName
        try {
          const raw = readJsonFile(path.join(dirPath, 'plugin.json'))
          if (isManifest(raw)) peekId = raw.id
        } catch {
          /* use dirName */
        }
        if (linkedById.has(peekId)) continue

        const loaded = this.loadOne(dirPath, dirName, 'installed')
        this.loaded.set(loaded.manifest.id, loaded)
      }
    }

    // 2) Linked external folders
    for (const [id, linkPath] of linkedById) {
      if (!fs.existsSync(linkPath)) {
        this.loaded.set(id, {
          dirName: path.basename(linkPath),
          dirPath: linkPath,
          manifest: {
            id,
            name: id,
            version: '0',
            description: 'linked path missing',
          },
          mod: null,
          loadError: 'link_path_missing',
          kind: 'linked',
        })
        continue
      }
      const loaded = this.loadOne(linkPath, path.basename(linkPath), 'linked')
      // Force kind linked even if somehow marked bundled in json
      loaded.kind = 'linked'
      loaded.manifest = { ...loaded.manifest, bundled: false }
      this.loaded.set(loaded.manifest.id || id, loaded)
    }
  }

  private reconcileIndex(): void {
    const byId = new Map(this.index.plugins.map((p) => [p.id, p]))
    const next: PluginsIndex = { version: 1, plugins: [] }
    for (const [id, loaded] of this.loaded) {
      const prev = byId.get(id)
      const def = loaded.manifest.defaultEnabled !== false
      const entry: PluginsIndexEntry = {
        id,
        enabled: prev ? Boolean(prev.enabled) : def,
      }
      if (loaded.kind === 'linked') {
        entry.linkPath = loaded.dirPath
      } else if (prev?.sourceArchive) {
        entry.sourceArchive = prev.sourceArchive
      }
      next.plugins.push(entry)
    }
    this.index = next
  }

  private rebuildToolIndex(): void {
    this.toolOwner.clear()
    const enabled = new Set(this.index.plugins.filter((p) => p.enabled).map((p) => p.id))
    for (const [id, loaded] of this.loaded) {
      if (!enabled.has(id) || !loaded.mod) continue
      for (const t of loaded.mod.tools) {
        const name = t.function?.name
        if (!name) continue
        if (this.toolOwner.has(name)) {
          console.warn(
            `[plugins] tool name conflict: ${name} already owned by ${this.toolOwner.get(name)}, ignoring ${id}`,
          )
          continue
        }
        this.toolOwner.set(name, id)
      }
    }
  }

  private persistIndex(): void {
    ensureDir(this.root)
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf8')
    this.scheduleChanged()
  }

  private scheduleChanged(): void {
    if (!this.changeListener || this.changeScheduled) return
    this.changeScheduled = true
    queueMicrotask(() => {
      this.changeScheduled = false
      try {
        this.changeListener?.()
      } catch (e) {
        console.warn('[plugins] onChanged listener failed', e)
      }
    })
  }

  private enabledIds(): Set<string> {
    return new Set(this.index.plugins.filter((p) => p.enabled).map((p) => p.id))
  }

  private setLinkPath(id: string, linkPath: string | undefined): void {
    let entry = this.index.plugins.find((p) => p.id === id)
    if (!entry) {
      entry = { id, enabled: true }
      this.index.plugins.push(entry)
    }
    if (linkPath) {
      entry.linkPath = path.resolve(linkPath)
      delete entry.sourceArchive
    } else delete entry.linkPath
  }

  private sourceFields(loaded: LoadedPlugin): { source: string; sourceDetail?: string } {
    const indexEntry = this.index.plugins.find((p) => p.id === loaded.manifest.id)
    if (loaded.kind === 'bundled') {
      return { source: '随附', sourceDetail: '应用内置' }
    }
    if (loaded.kind === 'linked') {
      return { source: '开发外链', sourceDetail: loaded.dirPath }
    }
    if (indexEntry?.sourceArchive) {
      return { source: '压缩包安装', sourceDetail: indexEntry.sourceArchive }
    }
    return { source: '本地安装', sourceDetail: loaded.dirPath }
  }

  private removeInstalledDirForId(id: string): void {
    const destName = sanitizePluginDirName(id)
    const dest = path.join(this.root, destName)
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
    // Also remove any dir whose manifest id matches
    if (!fs.existsSync(this.root)) return
    for (const name of fs.readdirSync(this.root)) {
      if (name === 'index.json' || name === destName) continue
      const dir = path.join(this.root, name)
      try {
        if (!fs.statSync(dir).isDirectory()) continue
        const raw = readJsonFile(path.join(dir, 'plugin.json'))
        if (isManifest(raw) && raw.id === id) {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
    }
  }

  list(): PluginRecord[] {
    const enabled = this.enabledIds()
    const out: PluginRecord[] = []
    for (const [id, loaded] of this.loaded) {
      const src = this.sourceFields(loaded)
      out.push({
        id,
        dirName: loaded.dirName,
        name: loaded.manifest.name,
        description: loaded.manifest.description || '',
        version: loaded.manifest.version,
        enabled: enabled.has(id),
        bundled: loaded.kind === 'bundled',
        kind: loaded.kind,
        path: loaded.dirPath,
        source: src.source,
        ...(src.sourceDetail ? { sourceDetail: src.sourceDetail } : {}),
        tools: (loaded.mod?.tools.map((t) => t.function.name).filter(Boolean) as string[]) || [],
        hasReadme: Boolean(findPluginReadmePath(loaded.dirPath)),
        ...(suiteOf(loaded.manifest) ? { suite: suiteOf(loaded.manifest) } : {}),
        ...(loaded.loadError ? { error: loaded.loadError } : {}),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  get(id: string): PluginRecord | null {
    return this.list().find((p) => p.id === id) || null
  }

  /** Other installed/linked packages sharing the same suite. */
  findSuiteConflicts(suite: string | undefined, exceptId: string): PluginRecord[] {
    const g = normalizeSuite(suite)
    if (!g) return []
    return this.list().filter((p) => p.id !== exceptId && normalizeSuite(p.suite) === g)
  }

  private suiteConflictError(conflicts: PluginRecord[]): {
    ok: false
    error: string
    suiteConflicts: PluginImportPreview['suiteConflicts']
  } {
    const bundled = conflicts.some((c) => c.bundled || c.kind === 'bundled')
    return {
      ok: false,
      error: bundled ? 'plugin_suite_bundled_conflict' : 'plugin_suite_conflict',
      suiteConflicts: conflicts.map((c) => ({
        id: c.id,
        name: c.name,
        version: c.version,
        kind: c.kind,
        source: c.source,
        enabled: c.enabled,
        bundled: c.bundled,
      })),
    }
  }

  /** Remove non-bundled suite conflicts; fails if any conflict is bundled. */
  private removeSuiteConflicts(conflicts: PluginRecord[]): { ok: boolean; error?: string } {
    if (conflicts.some((c) => c.bundled || c.kind === 'bundled')) {
      return { ok: false, error: 'plugin_suite_bundled_conflict' }
    }
    for (const c of conflicts) {
      const res = this.remove(c.id)
      if (!res.ok) return { ok: false, error: res.error || 'plugin_suite_conflict' }
    }
    return { ok: true }
  }

  /** Read plugin README.md / docs.md for Settings docs viewer. */
  readReadme(id: string): { ok: boolean; markdown?: string; fileName?: string; error?: string } {
    const loaded = this.loaded.get(String(id || '').trim())
    if (!loaded) return { ok: false, error: 'plugin_not_found' }
    const file = findPluginReadmePath(loaded.dirPath)
    if (!file) return { ok: false, error: 'readme_not_found' }
    try {
      const markdown = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      return { ok: true, markdown, fileName: path.basename(file) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  setEnabled(
    id: string,
    enabled: boolean,
  ): {
    ok: boolean
    plugin?: PluginRecord
    error?: string
    disabledConflicts?: Array<{ id: string; name: string }>
  } {
    if (!this.loaded.has(id)) return { ok: false, error: 'plugin_not_found' }
    const entry = this.index.plugins.find((p) => p.id === id)
    if (!entry) return { ok: false, error: 'plugin_not_found' }

    const disabledConflicts: Array<{ id: string; name: string }> = []
    if (enabled) {
      const group = suiteOf(this.loaded.get(id)?.manifest)
      if (group) {
        for (const other of this.index.plugins) {
          if (other.id === id || !other.enabled) continue
          const otherLoaded = this.loaded.get(other.id)
          if (suiteOf(otherLoaded?.manifest) !== group) continue
          other.enabled = false
          disabledConflicts.push({
            id: other.id,
            name: otherLoaded?.manifest.name || other.id,
          })
        }
      }
    }

    entry.enabled = Boolean(enabled)
    this.rebuildToolIndex()
    this.persistIndex()
    const plugin = this.get(id)
    if (!plugin) return { ok: false, error: 'plugin_not_found' }
    return {
      ok: true,
      plugin,
      ...(disabledConflicts.length ? { disabledConflicts } : {}),
    }
  }

  /** Unlink or delete a non-bundled plugin. Linked: index only; installed: remove dir. */
  remove(id: string): { ok: boolean; error?: string } {
    const loaded = this.loaded.get(id)
    if (!loaded) return { ok: false, error: 'plugin_not_found' }
    if (loaded.kind === 'bundled' || loaded.manifest.bundled) {
      return { ok: false, error: 'plugin_bundled_cannot_remove' }
    }
    try {
      if (loaded.kind === 'installed') {
        fs.rmSync(loaded.dirPath, { recursive: true, force: true })
      }
      this.index.plugins = this.index.plugins.filter((p) => p.id !== id)
      this.persistIndex()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.reload()
    return { ok: true }
  }

  removeMany(ids: string[]): { removed: string[]; failed: string[] } {
    const removed: string[] = []
    const failed: string[] = []
    const seen = new Set<string>()
    let dirty = false
    for (const raw of ids) {
      const id = String(raw || '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const loaded = this.loaded.get(id)
      if (!loaded || loaded.kind === 'bundled' || loaded.manifest.bundled) {
        failed.push(id)
        continue
      }
      try {
        if (loaded.kind === 'installed') {
          fs.rmSync(loaded.dirPath, { recursive: true, force: true })
        }
        this.index.plugins = this.index.plugins.filter((p) => p.id !== id)
        this.loaded.delete(id)
        dirty = true
        removed.push(id)
      } catch {
        failed.push(id)
      }
    }
    if (dirty) {
      this.persistIndex()
      this.reload()
    }
    return { removed, failed }
  }

  /** Preview folder (link) or .zip (install) before import. */
  parseFromPath(absPath: string, opts?: PluginParseOptions): PluginImportPreview {
    const src = path.resolve(String(absPath || ''))
    if (!src || !fs.existsSync(src)) throw new Error('path_not_found')
    const st = fs.statSync(src)

    const withSuite = (
      base: Omit<PluginImportPreview, 'suite' | 'suiteConflicts'>,
      manifest: PluginManifest,
    ): PluginImportPreview => {
      const suite = suiteOf(manifest)
      const conflicts = this.findSuiteConflicts(suite, manifest.id)
      return {
        ...base,
        ...(suite ? { suite } : {}),
        ...(conflicts.length
          ? {
              suiteConflicts: conflicts.map((c) => ({
                id: c.id,
                name: c.name,
                version: c.version,
                kind: c.kind,
                source: c.source,
                enabled: c.enabled,
                bundled: c.bundled,
              })),
            }
          : {}),
      }
    }

    if (st.isFile()) {
      if (!isZipPath(src)) throw new Error('plugin_path_must_be_dir_or_zip')
      const peeked = peekZip(src, { packageId: opts?.packageId })
      if (peeked.kind === 'suite') {
        const manifest = peeked.selected.manifest
        const existing = this.get(manifest.id)
        const suiteId = normalizeSuite(peeked.suite.suite) || normalizeSuite(peeked.suite.id)
        return withSuite(
          {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description || '',
            version: manifest.version,
            main: peeked.selected.mainRel,
            sourcePath: src,
            sourceLabel: path.basename(src),
            mode: 'zip',
            source: '压缩包安装',
            sizeBytes: peeked.sizeBytes,
            displayMode: 'suite',
            productId: peeked.suite.id,
            productName: peeked.suite.name,
            productDescription: peeked.suite.description || '',
            packages: peeked.packages,
            ...(existing
              ? {
                  existing: {
                    id: existing.id,
                    name: existing.name,
                    version: existing.version,
                    kind: existing.kind,
                    source: existing.source,
                  },
                }
              : {}),
          },
          {
            ...manifest,
            ...(suiteId ? { suite: suiteId } : {}),
          },
        )
      }

      const { manifest, mainRel, sizeBytes } = peeked
      const existing = this.get(manifest.id)
      return withSuite(
        {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description || '',
          version: manifest.version,
          main: mainRel,
          sourcePath: src,
          sourceLabel: path.basename(src),
          mode: 'zip',
          source: '压缩包安装',
          sizeBytes,
          displayMode: 'single',
          ...(existing
            ? {
                existing: {
                  id: existing.id,
                  name: existing.name,
                  version: existing.version,
                  kind: existing.kind,
                  source: existing.source,
                },
              }
            : {}),
        },
        manifest,
      )
    }

    if (!st.isDirectory()) throw new Error('plugin_path_must_be_dir_or_zip')

    const { manifest, mainRel } = validatePluginDir(src)
    const existing = this.get(manifest.id)
    return withSuite(
      {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description || '',
        version: manifest.version,
        main: mainRel,
        sourcePath: src,
        sourceLabel: path.basename(src),
        mode: 'link',
        source: '开发外链',
        displayMode: 'single',
        ...(existing
          ? {
              existing: {
                id: existing.id,
                name: existing.name,
                version: existing.version,
                kind: existing.kind,
                source: existing.source,
              },
            }
          : {}),
      },
      manifest,
    )
  }

  /**
   * Import: folder → link (dev, no copy); .zip → install under dataRoot/plugins (≤200MB).
   */
  async importFromPath(
    absPath: string,
    opts?: PluginImportOptions,
  ): Promise<{
    ok: boolean
    plugin?: PluginRecord
    error?: string
    suiteConflicts?: PluginImportPreview['suiteConflicts']
  }> {
    const src = path.resolve(String(absPath || ''))
    if (!src || !fs.existsSync(src)) return { ok: false, error: 'path_not_found' }

    try {
      const st = fs.statSync(src)
      if (st.isFile()) {
        if (!isZipPath(src)) return { ok: false, error: 'plugin_path_must_be_dir_or_zip' }
        return this.installFromZip(src, opts)
      }
      if (!st.isDirectory()) return { ok: false, error: 'plugin_path_must_be_dir_or_zip' }
      return this.linkFromFolder(src, opts)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private linkFromFolder(
    dir: string,
    opts?: PluginImportOptions & { replaceExclusivity?: boolean },
  ): {
    ok: boolean
    plugin?: PluginRecord
    error?: string
    suiteConflicts?: PluginImportPreview['suiteConflicts']
  } {
    let manifest: PluginManifest
    try {
      ;({ manifest } = validatePluginDir(dir))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    const existing = this.get(manifest.id)
    if (existing && !opts?.overwrite) {
      return { ok: false, error: 'plugin_exists' }
    }
    if (existing?.bundled || existing?.kind === 'bundled') {
      return { ok: false, error: 'plugin_bundled_cannot_overwrite' }
    }

    const conflicts = this.findSuiteConflicts(suiteOf(manifest), manifest.id)
    if (conflicts.length) {
      const replace = opts?.replaceSuite ?? opts?.replaceExclusivity
      if (!replace) return this.suiteConflictError(conflicts)
      opts?.onProgress?.({ phase: 'replace_suite', label: '卸载同套件包' })
      const cleared = this.removeSuiteConflicts(conflicts)
      if (!cleared.ok) return { ok: false, error: cleared.error }
    }

    try {
      opts?.onProgress?.({ phase: 'verify', label: '校验清单' })
      // Drop installed copy if any; link replaces install
      this.removeInstalledDirForId(manifest.id)
      this.setLinkPath(manifest.id, dir)
      // Preserve enabled if overwriting
      const entry = this.index.plugins.find((p) => p.id === manifest.id)!
      if (existing) entry.enabled = existing.enabled
      else entry.enabled = manifest.defaultEnabled !== false
      this.persistIndex()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    opts?.onProgress?.({ phase: 'import', label: '加载插件模块' })
    this.reload()
    const plugin = this.get(manifest.id)
    if (!plugin) return { ok: false, error: 'import_load_failed' }
    if (plugin.error) return { ok: false, error: plugin.error, plugin }
    return { ok: true, plugin }
  }

  private installFromZip(
    zipPath: string,
    opts?: PluginImportOptions & { replaceExclusivity?: boolean },
  ): {
    ok: boolean
    plugin?: PluginRecord
    error?: string
    suiteConflicts?: PluginImportPreview['suiteConflicts']
  } {
    let peeked: PeekedZip
    try {
      peeked = peekZip(zipPath, { packageId: opts?.packageId })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    const manifest = peeked.kind === 'suite' ? peeked.selected.manifest : peeked.manifest
    const mainRel = peeked.kind === 'suite' ? peeked.selected.mainRel : peeked.mainRel
    void mainRel

    if (peeked.kind === 'suite') {
      const want = String(opts?.packageId || '').trim()
      if (want && want !== peeked.selected.packageId) {
        return { ok: false, error: `package_not_found:${want}` }
      }
    }

    const existing = this.get(manifest.id)
    if (existing && !opts?.overwrite) {
      return { ok: false, error: 'plugin_exists' }
    }
    if (existing?.bundled || existing?.kind === 'bundled') {
      return { ok: false, error: 'plugin_bundled_cannot_overwrite' }
    }

    opts?.onProgress?.({ phase: 'verify', label: '校验压缩包' })
    const conflicts = this.findSuiteConflicts(suiteOf(manifest), manifest.id)
    if (conflicts.length) {
      const replace = opts?.replaceSuite ?? opts?.replaceExclusivity
      if (!replace) return this.suiteConflictError(conflicts)
      opts?.onProgress?.({ phase: 'replace_suite', label: '卸载同套件包' })
      const cleared = this.removeSuiteConflicts(conflicts)
      if (!cleared.ok) return { ok: false, error: cleared.error }
    }

    const destName = sanitizePluginDirName(manifest.id)
    const dest = path.join(this.root, destName)
    const tmp = path.join(
      os.tmpdir(),
      `navora-plugin-${destName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )

    try {
      opts?.onProgress?.({ phase: 'extract', label: '解压并写入插件目录' })
      ensureDir(tmp)
      if (peeked.kind === 'suite') {
        extractSuitePackageToDir(zipPath, peeked.selected.packagePrefix, tmp)
      } else {
        extractSingleZipToDir(zipPath, tmp, peeked.rootPrefix)
      }
      validatePluginDir(tmp)

      // Clear previous link + dest
      this.setLinkPath(manifest.id, undefined)
      this.index.plugins = this.index.plugins.filter((p) => p.id !== manifest.id)
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
      this.removeInstalledDirForId(manifest.id)

      copyDirSync(tmp, dest)
      const destManifestPath = path.join(dest, 'plugin.json')
      const written = readJsonFile(destManifestPath) as PluginManifest
      written.bundled = false
      fs.writeFileSync(destManifestPath, JSON.stringify(written, null, 2), 'utf8')

      this.index.plugins.push({
        id: manifest.id,
        enabled: existing ? existing.enabled : manifest.defaultEnabled !== false,
        sourceArchive: path.basename(zipPath),
      })
      this.persistIndex()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    opts?.onProgress?.({ phase: 'import', label: '加载插件模块' })
    this.reload()
    const plugin = this.get(manifest.id)
    if (!plugin) return { ok: false, error: 'import_load_failed' }
    if (plugin.error) return { ok: false, error: plugin.error, plugin }
    return { ok: true, plugin }
  }

  /** Pack plugin directory into a .zip at destPath. */
  exportToZip(id: string, destPath: string): { ok: boolean; path?: string; error?: string } {
    const loaded = this.loaded.get(id)
    if (!loaded) return { ok: false, error: 'plugin_not_found' }
    if (loaded.loadError && !fs.existsSync(path.join(loaded.dirPath, 'plugin.json'))) {
      return { ok: false, error: loaded.loadError }
    }
    try {
      validatePluginDir(loaded.dirPath)
      const zip = new AdmZip()
      const addDir = (dir: string, prefix: string) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name)
          const st = fs.lstatSync(full)
          if (st.isSymbolicLink()) continue
          const entryName = prefix ? `${prefix}/${name}` : name
          if (st.isDirectory()) addDir(full, entryName)
          else zip.addLocalFile(full, prefix || undefined, name)
        }
      }
      addDir(loaded.dirPath, '')
      const out = path.resolve(destPath)
      ensureDir(path.dirname(out))
      zip.writeZip(out)
      const st = fs.statSync(out)
      if (st.size > PLUGIN_ZIP_MAX_BYTES) {
        try {
          fs.unlinkSync(out)
        } catch {
          /* ignore */
        }
        return { ok: false, error: 'plugin_too_large' }
      }
      return { ok: true, path: out }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  suggestExportFilename(id: string): string {
    const p = this.get(id)
    const safeId = sanitizePluginDirName(p?.id || id)
    const ver = (p?.version || '0').replace(/[^\w.-]+/g, '-')
    return `${safeId}-${ver}.zip`
  }

  /** Absolute dirs of all session-scoped (plugin-dev) links — for hot reload watch. */
  sessionLinkedDirs(): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const map of this.sessionLoaded.values()) {
      for (const loaded of map.values()) {
        const dir = path.resolve(loaded.dirPath)
        if (!dir || seen.has(dir)) continue
        seen.add(dir)
        if (fs.existsSync(dir)) out.push(dir)
      }
    }
    return out
  }

  listSessionPlugins(scopeChatId: string): PluginRecord[] {
    const scope = String(scopeChatId || '').trim()
    const map = this.sessionLoaded.get(scope)
    if (!map?.size) return []
    const out: PluginRecord[] = []
    for (const [id, loaded] of map) {
      out.push({
        id,
        dirName: loaded.dirName,
        name: loaded.manifest.name,
        description: loaded.manifest.description || '',
        version: loaded.manifest.version,
        enabled: true,
        bundled: false,
        kind: 'session',
        path: loaded.dirPath,
        source: '会话开发外链',
        sourceDetail: loaded.dirPath,
        tools: (loaded.mod?.tools.map((t) => t.function.name).filter(Boolean) as string[]) || [],
        hasReadme: Boolean(findPluginReadmePath(loaded.dirPath)),
        ...(suiteOf(loaded.manifest) ? { suite: suiteOf(loaded.manifest) } : {}),
        ...(loaded.loadError ? { error: loaded.loadError } : {}),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  /**
   * Link a plugin folder for one chat scope (and its sub-chats). Does not touch global index.
   */
  linkSessionPlugin(
    scopeChatId: string,
    absPath: string,
  ): { ok: boolean; plugin?: PluginRecord; error?: string } {
    const scope = String(scopeChatId || '').trim()
    if (!scope) return { ok: false, error: 'chat_required' }
    const dir = path.resolve(String(absPath || ''))
    if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'path_not_found' }
    let st: fs.Stats
    try {
      st = fs.statSync(dir)
    } catch {
      return { ok: false, error: 'path_not_found' }
    }
    if (!st.isDirectory()) return { ok: false, error: 'plugin_path_must_be_dir_or_zip' }

    let manifest: PluginManifest
    try {
      ;({ manifest } = validatePluginDir(dir))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    const loaded = this.loadOne(dir, path.basename(dir), 'session')
    loaded.kind = 'session'
    loaded.manifest = { ...loaded.manifest, bundled: false }

    let byId = this.sessionLoaded.get(scope)
    if (!byId) {
      byId = new Map()
      this.sessionLoaded.set(scope, byId)
    }
    byId.set(manifest.id, loaded)
    this.rebuildSessionToolIndex(scope)
    this.scheduleChanged()

    const plugin = this.listSessionPlugins(scope).find((p) => p.id === manifest.id)
    if (!plugin) return { ok: false, error: 'import_load_failed' }
    if (plugin.error) return { ok: false, error: plugin.error, plugin }
    return { ok: true, plugin }
  }

  unloadSessionPlugin(scopeChatId: string, pluginId: string): boolean {
    const scope = String(scopeChatId || '').trim()
    const id = String(pluginId || '').trim()
    const byId = this.sessionLoaded.get(scope)
    if (!byId?.has(id)) return false
    byId.delete(id)
    if (!byId.size) this.sessionLoaded.delete(scope)
    this.rebuildSessionToolIndex(scope)
    this.scheduleChanged()
    return true
  }

  /** Re-load all session plugins that point at this directory (after dist rebuild). */
  reloadSessionDir(absDir: string): void {
    const want = path.resolve(absDir)
    for (const [scope, byId] of this.sessionLoaded) {
      let changed = false
      for (const [id, loaded] of [...byId.entries()]) {
        if (path.resolve(loaded.dirPath) !== want) continue
        const next = this.loadOne(want, path.basename(want), 'session')
        next.kind = 'session'
        next.manifest = { ...next.manifest, bundled: false }
        byId.set(id, next)
        changed = true
      }
      if (changed) this.rebuildSessionToolIndex(scope)
    }
  }

  /** Hydrate session links from persisted chat records (app start). */
  hydrateSessionLinks(
    entries: Array<{ scopeChatId: string; path: string }>,
  ): void {
    for (const e of entries) {
      const scope = String(e.scopeChatId || '').trim()
      const dir = String(e.path || '').trim()
      if (!scope || !dir) continue
      this.linkSessionPlugin(scope, dir)
    }
  }

  private rebuildSessionToolIndex(scopeChatId: string): void {
    const scope = String(scopeChatId || '').trim()
    const byId = this.sessionLoaded.get(scope)
    const owners = new Map<string, string>()
    if (byId) {
      for (const [id, loaded] of byId) {
        if (!loaded.mod) continue
        for (const t of loaded.mod.tools) {
          const name = t.function?.name
          if (!name || owners.has(name)) continue
          owners.set(name, id)
        }
      }
    }
    if (owners.size) this.sessionToolOwner.set(scope, owners)
    else this.sessionToolOwner.delete(scope)
  }

  private resolveScopedLoaded(
    scopeChatId: string | undefined,
    toolName: string,
  ): { pluginId: string; loaded: LoadedPlugin } | null {
    const scope = String(scopeChatId || '').trim()
    if (scope) {
      const sid = this.sessionToolOwner.get(scope)?.get(toolName)
      if (sid) {
        const loaded = this.sessionLoaded.get(scope)?.get(sid)
        if (loaded) return { pluginId: sid, loaded }
      }
    }
    const id = this.toolOwner.get(toolName)
    if (!id) return null
    const loaded = this.loaded.get(id)
    if (!loaded) return null
    return { pluginId: id, loaded }
  }

  enabledTools(): ChatCompletionTool[] {
    const out: ChatCompletionTool[] = []
    const enabled = this.enabledIds()
    for (const [id, loaded] of this.loaded) {
      if (!enabled.has(id) || !loaded.mod) continue
      out.push(...loaded.mod.tools)
    }
    return out
  }

  /** Global enabled tools + session-scoped tools for this chat (session wins on name clash). */
  enabledToolsForChat(scopeChatId: string): ChatCompletionTool[] {
    const scope = String(scopeChatId || '').trim()
    const sessionNames = new Set<string>()
    const sessionTools: ChatCompletionTool[] = []
    const byId = this.sessionLoaded.get(scope)
    if (byId) {
      for (const loaded of byId.values()) {
        if (!loaded.mod) continue
        for (const t of loaded.mod.tools) {
          const name = t.function?.name
          if (!name || sessionNames.has(name)) continue
          sessionNames.add(name)
          sessionTools.push(t)
        }
      }
    }
    const global = this.enabledTools().filter((t) => {
      const name = t.function?.name
      return name && !sessionNames.has(name)
    })
    return [...global, ...sessionTools]
  }

  ownsTool(name: string): boolean {
    return this.toolOwner.has(name)
  }

  ownsToolForChat(scopeChatId: string, name: string): boolean {
    const scope = String(scopeChatId || '').trim()
    if (scope && this.sessionToolOwner.get(scope)?.has(name)) return true
    return this.toolOwner.has(name)
  }

  /** Owning plugin for a tool name, if any (enabled or not — registration wins). */
  ownerOfTool(name: string): { id: string; name: string } | null {
    const id = this.toolOwner.get(name)
    if (!id) return null
    const loaded = this.loaded.get(id)
    return { id, name: loaded?.manifest.name || id }
  }

  ownerOfToolForChat(
    scopeChatId: string,
    name: string,
  ): { id: string; name: string; session?: boolean } | null {
    const scope = String(scopeChatId || '').trim()
    const sid = scope ? this.sessionToolOwner.get(scope)?.get(name) : undefined
    if (sid) {
      const loaded = this.sessionLoaded.get(scope)?.get(sid)
      return { id: sid, name: loaded?.manifest.name || sid, session: true }
    }
    return this.ownerOfTool(name)
  }

  buildPromptAppendix(scopeChatId?: string): string {
    const global = this.list().filter((p) => p.enabled && !p.error)
    const session = scopeChatId ? this.listSessionPlugins(scopeChatId).filter((p) => !p.error) : []
    if (!global.length && !session.length) return ''
    const lines = [
      '',
      '## 已启用插件（额外工具 / 接口）',
      '下列是插件（Plugins），不是技能（Skills）。查插件能力用 plugin_list / plugin_read；未安装则 store_search。禁止 skill_list / skill_read。',
      '需要时直接按工具名调用；关闭或卸载后不可用。',
      '',
    ]
    for (const p of global) {
      const tools = p.tools.length ? p.tools.map((t) => `\`${t}\``).join(', ') : '(无)'
      const kindLabel =
        p.kind === 'linked' ? '外链' : p.kind === 'bundled' ? '随附' : '已安装'
      lines.push(
        `- **${p.name}**（id=\`${p.id}\`${p.version ? ` v${p.version}` : ''} · ${kindLabel}）：${p.description}`,
      )
      lines.push(`  接口：${tools}`)
    }
    for (const p of session) {
      const tools = p.tools.length ? p.tools.map((t) => `\`${t}\``).join(', ') : '(无)'
      lines.push(
        `- **${p.name}**（id=\`${p.id}\`${p.version ? ` v${p.version}` : ''} · 本会话开发外链）：${p.description}`,
      )
      lines.push(`  接口：${tools}`)
    }
    return lines.join('\n')
  }

  async checkPermissions(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<{ ok: true; capabilities: import('../../shared/types').PermissionCapability[] } | { ok: false; error: string }> {
    const resolved = this.resolveScopedLoaded(ctx.pluginScopeChatId || ctx.chatId, name)
    if (!resolved) return { ok: false, error: `unknown_plugin_tool:${name}` }
    const { pluginId, loaded } = resolved
    if (!loaded.mod) return { ok: false, error: `plugin_not_loaded:${pluginId}` }
    if (typeof loaded.mod.planPermissions !== 'function') {
      return { ok: false, error: 'plugin_permissions_undeclared' }
    }
    const planCtx = {
      hasSession: (ctx.registry.getTree(ctx.chatId) || []).length > 0,
    }
    let plan: { capabilities: import('../../shared/types').PermissionCapability[] }
    try {
      plan = loaded.mod.planPermissions(name, args, planCtx)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const capabilities = Array.isArray(plan?.capabilities) ? plan.capabilities : []
    if (!capabilities.length) {
      return { ok: false, error: 'plugin_permissions_empty' }
    }
    for (const capability of capabilities) {
      const gate = await ctx.gate.check(
        ctx.chatId,
        capability,
        `${name} ${capability} ${JSON.stringify(args).slice(0, 160)}`,
        ctx.signal,
      )
      if (!gate.ok) return { ok: false, error: gate.reason || 'permission_denied' }
    }
    return { ok: true, capabilities }
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<unknown> {
    const resolved = this.resolveScopedLoaded(ctx.pluginScopeChatId || ctx.chatId, name)
    if (!resolved) return { ok: false, error: `unknown_plugin_tool:${name}` }
    const { pluginId, loaded } = resolved
    if (!loaded.mod) return { ok: false, error: `plugin_not_loaded:${pluginId}` }
    if (typeof loaded.mod.planPermissions !== 'function') {
      return { ok: false, error: 'plugin_permissions_undeclared' }
    }
    const planCtx = {
      hasSession: (ctx.registry.getTree(ctx.chatId) || []).length > 0,
    }
    let capabilities: import('../../shared/types').PermissionCapability[] = []
    try {
      const plan = loaded.mod.planPermissions(name, args, planCtx)
      capabilities = Array.isArray(plan?.capabilities) ? plan.capabilities : []
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!capabilities.length) {
      return { ok: false, error: 'plugin_permissions_empty' }
    }
    const api = createPluginHostApi(ctx, capabilities)
    const exec = loaded.mod.execute
    if (typeof exec !== 'function') {
      return { ok: false, error: 'plugin_execute_missing' }
    }
    try {
      return await Reflect.apply(exec, loaded.mod, [name, args, api])
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
