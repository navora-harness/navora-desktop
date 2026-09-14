import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { app } from 'electron'
import AdmZip from 'adm-zip'
import type { AppConfig } from '../../shared/config'
import type { ConfigService } from './config-service'
import type { PluginStore } from './plugin-store'
import type { SkillStore } from './skill-store'
import {
  STORE_DOWNLOAD_TIMEOUT_MS,
  STORE_ZIP_MAX_BYTES,
  assertCatalogIndex,
  assertCatalogRelPath,
  compareStoreVersions,
  findCatalogPackage,
  isSafeZipEntryName,
  latestPackageVersion,
  type StoreCatalogIndex,
  type StoreCatalogProduct,
  type StoreInstallAction,
  type StoreInstallInput,
  type StoreInstallProgress,
  type StoreInstallResult,
  type StoreKind,
  type StorePreviewInstallInput,
  type StorePreviewInstallResult,
  type StoreStatus,
} from '../../shared/store'

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function extractZipSafe(zipPath: string, destDir: string) {
  const zip = new AdmZip(zipPath)
  ensureDir(destDir)
  const realRoot = fs.realpathSync(destDir)
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\\/g, '/')
    if (!isSafeZipEntryName(name)) throw new Error('zip_unsafe_path')
    if (e.isDirectory) continue
    const out = path.join(destDir, name)
    const outDir = path.dirname(out)
    ensureDir(outDir)
    const realOutDir = fs.realpathSync(outDir)
    const relToRoot = path.relative(realRoot, realOutDir)
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
      throw new Error('zip_unsafe_path')
    }
    fs.writeFileSync(out, e.getData())
  }
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function normalizeBaseUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return 'http://127.0.0.1:8791'
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file:')) {
    return s.replace(/\/+$/, '')
  }
  // Absolute filesystem path → file URL
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) {
    return pathToFileURL(path.resolve(s)).href.replace(/\/+$/, '')
  }
  return s.replace(/\/+$/, '')
}

export class MarketplaceClient {
  private cache: { at: number; catalog: StoreCatalogIndex; etag?: string } | null = null
  onProgress?: (p: StoreInstallProgress) => void

  constructor(
    private dataRoot: string,
    private config: ConfigService,
    private plugins: PluginStore,
    private skills: SkillStore,
  ) {}

  baseUrl(): string {
    const cfg = this.config.get() as AppConfig
    return normalizeBaseUrl(cfg.store?.base_url || 'http://127.0.0.1:8791')
  }

  cacheDir(): string {
    return path.join(this.dataRoot, 'cache', 'store')
  }

  async status(): Promise<StoreStatus> {
    const baseUrl = this.baseUrl()
    try {
      const catalog = await this.fetchCatalog({ force: true })
      return {
        baseUrl,
        reachable: true,
        productCount: catalog.products?.length || 0,
        generatedAt: catalog.generatedAt,
      }
    } catch (e) {
      return {
        baseUrl,
        reachable: false,
        productCount: 0,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  async fetchCatalog(opts?: { force?: boolean }): Promise<StoreCatalogIndex> {
    const now = Date.now()
    if (!opts?.force && this.cache && now - this.cache.at < 15_000) {
      return this.cache.catalog
    }
    const baseUrl = this.baseUrl()
    const fetched = await this.readRemoteText(`${baseUrl}/index.json`, {
      etag: this.cache?.etag,
      maxBytes: 8 * 1024 * 1024,
    })
    if (fetched.notModified && this.cache) {
      this.cache = { ...this.cache, at: now }
      return this.cache.catalog
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(fetched.text)
    } catch {
      throw new Error('invalid_catalog_json')
    }
    const catalog = assertCatalogIndex(parsed)
    this.cache = { at: now, catalog, etag: fetched.etag }
    return catalog
  }

  async list(opts?: {
    kind?: StoreKind | 'all'
    q?: string
  }): Promise<{ ok: boolean; products?: StoreCatalogProduct[]; error?: string }> {
    try {
      const catalog = await this.fetchCatalog()
      const kind = opts?.kind && opts.kind !== 'all' ? opts.kind : null
      const q = String(opts?.q || '')
        .trim()
        .toLowerCase()
      let products = catalog.products.map((p) => this.withInstalled(p))
      if (kind) products = products.filter((p) => p.kind === kind)
      if (q) {
        products = products.filter((p) => {
          const hay = `${p.productId} ${p.name} ${p.description} ${p.packages.map((x) => x.id).join(' ')}`.toLowerCase()
          return hay.includes(q)
        })
      }
      return { ok: true, products }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async get(
    productId: string,
    kind?: StoreKind,
  ): Promise<{ ok: boolean; product?: StoreCatalogProduct; error?: string }> {
    try {
      const catalog = await this.fetchCatalog()
      const id = String(productId || '').trim()
      const hits = catalog.products.filter((p) => p.productId === id && (!kind || p.kind === kind))
      if (!hits.length) return { ok: false, error: 'product_not_found' }
      if (hits.length > 1) return { ok: false, error: 'product_kind_required' }
      return { ok: true, product: this.withInstalled(hits[0]) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async previewInstall(input: StorePreviewInstallInput): Promise<StorePreviewInstallResult> {
    const kind = input.kind
    const packageId = String(input.packageId || '').trim()
    if (!kind || (kind !== 'plugin' && kind !== 'skill')) {
      return { ok: false, error: 'kind_required', blockers: ['kind_required'] }
    }
    if (!packageId) {
      return { ok: false, error: 'package_id_required', blockers: ['package_id_required'] }
    }

    let catalog: StoreCatalogIndex
    try {
      catalog = await this.fetchCatalog()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg, blockers: ['store_unreachable'] }
    }

    const found = findCatalogPackage(catalog, kind, packageId)
    if (!found) {
      return { ok: false, error: 'package_not_found', blockers: ['package_not_found'] }
    }
    const { pkg } = found
    const wantVer = String(input.version || '').trim()
    const verEntry = wantVer
      ? pkg.versions.find((v) => v.version === wantVer)
      : latestPackageVersion(pkg)
    if (!verEntry) {
      return { ok: false, error: 'version_not_found', blockers: ['version_not_found'] }
    }

    try {
      assertCatalogRelPath(verEntry.downloadPath)
    } catch {
      return { ok: false, error: 'invalid_catalog_path', blockers: ['invalid_catalog_path'] }
    }

    const blockers: string[] = []
    const minHost = verEntry.minHostVersion || pkg.minHostVersion
    if (minHost && compareStoreVersions(this.hostVersion(), minHost) < 0) {
      blockers.push('host_too_old')
    }
    /** @type {StorePreviewInstallResult['local']} */
    const local: StorePreviewInstallResult['local'] = {}

    if (kind === 'plugin') {
      const existing = this.plugins.get(packageId)
      if (existing) {
        local.sameId = {
          id: existing.id,
          name: existing.name,
          version: existing.version,
          enabled: existing.enabled,
          kind: existing.kind,
          bundled: existing.bundled,
        }
        if (existing.bundled || existing.kind === 'bundled') {
          blockers.push('bundled_cannot_overwrite')
        }
      }
      const suite = pkg.suite || existing?.suite
      if (suite) {
        const conflicts = this.plugins
          .list()
          .filter((p) => p.suite === suite && p.id !== packageId)
          .map((c) => ({
            id: c.id,
            name: c.name,
            version: c.version,
            kind: c.kind,
            bundled: c.bundled,
            enabled: c.enabled,
            source: c.source,
          }))
        if (conflicts.length) {
          local.suiteConflicts = conflicts
          if (conflicts.some((c) => c.bundled || c.kind === 'bundled')) {
            blockers.push('bundled_cannot_overwrite')
          }
        }
      }
    } else {
      const skills = this.skills.list()
      const existing = skills.find((s) => s.id === packageId)
      if (existing) {
        local.sameId = {
          id: existing.id,
          name: existing.name,
          version: existing.version,
          enabled: existing.enabled,
        }
      }
    }

    const action = this.resolveAction(local, verEntry.version)
    const needsOverwrite = Boolean(local.sameId)
    const needsReplaceSuite = Boolean(local.suiteConflicts?.length)

    return {
      ok: blockers.length === 0,
      ...(blockers.length ? { error: blockers[0], blockers } : { blockers: [] }),
      kind,
      packageId,
      version: verEntry.version,
      name: pkg.name,
      description: pkg.description,
      suite: pkg.suite,
      size: verEntry.size,
      sha256: verEntry.sha256,
      downloadPath: verEntry.downloadPath,
      action,
      needsOverwrite,
      needsReplaceSuite,
      yanked: verEntry.status === 'yanked',
      minHostVersion: minHost,
      local,
    }
  }

  async install(input: StoreInstallInput): Promise<StoreInstallResult> {
    const preview = await this.previewInstall(input)
    if (!preview.ok || preview.blockers?.length) {
      return {
        ok: false,
        error: preview.error || preview.blockers?.[0] || 'preview_failed',
        suiteConflicts: preview.local?.suiteConflicts,
      }
    }
    if (preview.needsOverwrite && !input.overwrite) {
      return { ok: false, error: preview.kind === 'skill' ? 'skill_exists' : 'plugin_exists' }
    }
    if (preview.needsReplaceSuite && !input.replaceSuite) {
      return {
        ok: false,
        error: 'plugin_suite_conflict',
        suiteConflicts: preview.local?.suiteConflicts,
      }
    }

    const kind = preview.kind!
    const packageId = preview.packageId!
    const version = preview.version!
    const downloadPath = preview.downloadPath!
    const sha256 = preview.sha256!
    const expectSize = preview.size

    let zipPath: string
    try {
      zipPath = await this.downloadArtifact(kind, packageId, version, downloadPath, sha256, expectSize)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    if (kind === 'plugin') {
      const imported = await this.plugins.importFromPath(zipPath, {
        overwrite: Boolean(input.overwrite),
        replaceSuite: Boolean(input.replaceSuite),
        onProgress: (p) => this.emitProgress(p),
      })
      if (!imported.ok) {
        return {
          ok: false,
          error: imported.error,
          suiteConflicts: imported.suiteConflicts,
        }
      }
      return { ok: true, action: preview.action, plugin: imported.plugin }
    }

    // Skills: unzip then import directory
    const extractDir = path.join(this.cacheDir(), 'extract', kind, packageId, version)
    try {
      this.emitProgress({ phase: 'extract', label: '解压技能包' })
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
      ensureDir(extractDir)
      extractZipSafe(zipPath, extractDir)
      // If zip has a single top-level folder, use it
      const entries = fs.readdirSync(extractDir)
      let skillRoot = extractDir
      if (entries.length === 1) {
        const only = path.join(extractDir, entries[0])
        if (fs.statSync(only).isDirectory() && fs.existsSync(path.join(only, 'SKILL.md'))) {
          skillRoot = only
        }
      }
      if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
        return { ok: false, error: 'skill_md_missing' }
      }
      this.emitProgress({ phase: 'import', label: '写入并加载技能' })
      const skill = await this.skills.importFromPath(skillRoot, {
        overwrite: Boolean(input.overwrite),
      })
      return { ok: true, action: preview.action, skill }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }

  async checkUpdates(): Promise<{
    ok: boolean
    updates?: Array<{
      kind: StoreKind
      packageId: string
      localVersion?: string
      storeVersion: string
      name: string
    }>
    error?: string
  }> {
    try {
      const catalog = await this.fetchCatalog({ force: true })
      const updates: Array<{
        kind: StoreKind
        packageId: string
        localVersion?: string
        storeVersion: string
        name: string
      }> = []

      for (const p of this.plugins.list()) {
        const found = findCatalogPackage(catalog, 'plugin', p.id)
        if (!found) continue
        const latest = latestPackageVersion(found.pkg)
        if (!latest) continue
        if (compareStoreVersions(latest.version, p.version || '0') > 0) {
          updates.push({
            kind: 'plugin',
            packageId: p.id,
            localVersion: p.version,
            storeVersion: latest.version,
            name: found.pkg.name,
          })
        }
      }
      for (const s of this.skills.list()) {
        const found = findCatalogPackage(catalog, 'skill', s.id)
        if (!found) continue
        const latest = latestPackageVersion(found.pkg)
        if (!latest) continue
        if (compareStoreVersions(latest.version, s.version || '0') > 0) {
          updates.push({
            kind: 'skill',
            packageId: s.id,
            localVersion: s.version,
            storeVersion: latest.version,
            name: found.pkg.name,
          })
        }
      }
      return { ok: true, updates }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Fetch product/package docs (README.md / SKILL.md) from the store catalog.
   */
  async readDocs(input: {
    kind: StoreKind
    packageId: string
    version?: string
  }): Promise<{ ok: boolean; markdown?: string; fileName?: string; error?: string }> {
    const kind = input.kind
    const packageId = String(input.packageId || '').trim()
    if (!kind || !packageId) return { ok: false, error: 'package_id_required' }
    try {
      const catalog = await this.fetchCatalog()
      const found = findCatalogPackage(catalog, kind, packageId)
      if (!found) return { ok: false, error: 'package_not_found' }
      const ver = String(input.version || '').trim()
      const entry = ver
        ? found.pkg.versions.find((v) => v.version === ver)
        : latestPackageVersion(found.pkg)
      if (!entry) return { ok: false, error: 'version_not_found' }
      if (!entry.hasReadme || !entry.readmePath) return { ok: false, error: 'readme_not_found' }
      const rel = assertCatalogRelPath(entry.readmePath)
      const baseUrl = this.baseUrl()
      const url = `${baseUrl}/${rel}`
      const markdown = (await this.readRemoteText(url, { maxBytes: 2 * 1024 * 1024 })).text
      return {
        ok: true,
        markdown,
        fileName: entry.readmeFileName || path.basename(entry.readmePath),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private withInstalled(product: StoreCatalogProduct): StoreCatalogProduct {
    if (product.kind === 'plugin') {
      if (product.displayMode === 'suite') {
        const suite = product.productId
        const hit = this.plugins.list().find((p) => p.suite === suite)
        if (hit) {
          return {
            ...product,
            installed: { packageId: hit.id, version: hit.version, name: hit.name },
          }
        }
      } else {
        const hit = this.plugins.get(product.productId)
        if (hit) {
          return {
            ...product,
            installed: { packageId: hit.id, version: hit.version, name: hit.name },
          }
        }
      }
    } else {
      const hit = this.skills.list().find((s) => s.id === product.productId)
      if (hit) {
        return {
          ...product,
          installed: { packageId: hit.id, version: hit.version, name: hit.name },
        }
      }
    }
    return { ...product }
  }

  private resolveAction(
    local: StorePreviewInstallResult['local'],
    incomingVersion: string,
  ): StoreInstallAction {
    if (local?.suiteConflicts?.length) return 'switch_variant'
    if (!local?.sameId) return 'fresh'
    const cur = local.sameId.version || ''
    if (cur && compareStoreVersions(incomingVersion, cur) > 0) return 'upgrade'
    return 'reinstall'
  }

  private hostVersion(): string {
    try {
      return String(app.getVersion() || '0.0.0')
    } catch {
      return '0.0.0'
    }
  }

  private emitProgress(p: StoreInstallProgress) {
    try {
      this.onProgress?.(p)
    } catch {
      /* ignore UI listener errors */
    }
  }

  private async downloadArtifact(
    kind: StoreKind,
    packageId: string,
    version: string,
    downloadPath: string,
    expectSha256: string,
    expectSize?: number,
  ): Promise<string> {
    const rel = assertCatalogRelPath(downloadPath)
    const destDir = path.join(this.cacheDir(), kind === 'plugin' ? 'plugins' : 'skills', packageId, version)
    ensureDir(destDir)
    const destZip = path.join(destDir, 'package.zip')
    if (fs.existsSync(destZip)) {
      const st = fs.statSync(destZip)
      const got = sha256File(destZip)
      if (
        got.toLowerCase() === expectSha256.toLowerCase() &&
        (expectSize == null || st.size === expectSize)
      ) {
        return destZip
      }
      fs.unlinkSync(destZip)
    }

    this.emitProgress({
      phase: 'download',
      label: '下载商店包',
      bytesReceived: 0,
      bytesTotal: expectSize,
    })
    const baseUrl = this.baseUrl()
    const url = `${baseUrl}/${rel}`
    const fetched = await this.readRemoteBuffer(url, {
      maxBytes: STORE_ZIP_MAX_BYTES,
      timeoutMs: STORE_DOWNLOAD_TIMEOUT_MS,
      onBytes: (n, total) =>
        this.emitProgress({
          phase: 'download',
          label: '下载商店包',
          bytesReceived: n,
          bytesTotal: total || expectSize,
        }),
    })
    const buf = fetched.buf
    if (expectSize != null && buf.length !== expectSize) {
      throw new Error('size_mismatch')
    }
    this.emitProgress({ phase: 'verify', label: '校验完整性', bytesReceived: buf.length, bytesTotal: buf.length })
    const got = crypto.createHash('sha256').update(buf).digest('hex')
    if (got.toLowerCase() !== expectSha256.toLowerCase()) {
      throw new Error('checksum_mismatch')
    }
    await fsp.writeFile(destZip, buf)
    return destZip
  }

  private async readRemoteText(
    url: string,
    opts?: { etag?: string; maxBytes?: number },
  ): Promise<{ text: string; etag?: string; notModified?: boolean }> {
    const got = await this.readRemoteBuffer(url, {
      maxBytes: opts?.maxBytes ?? 2 * 1024 * 1024,
      etag: opts?.etag,
    })
    if (got.notModified) return { text: '', etag: opts?.etag, notModified: true }
    return { text: got.buf.toString('utf8'), etag: got.etag }
  }

  private async readRemoteBuffer(
    url: string,
    opts?: {
      maxBytes?: number
      timeoutMs?: number
      etag?: string
      onBytes?: (n: number, total?: number) => void
    },
  ): Promise<{ buf: Buffer; etag?: string; notModified?: boolean }> {
    const maxBytes = opts?.maxBytes ?? STORE_ZIP_MAX_BYTES
    if (url.startsWith('file:')) {
      const filePath = fileURLToPath(url.includes('://') ? url : pathToFileURL(url).href)
      return this.readLocalFile(filePath, maxBytes, opts?.onBytes)
    }
    if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) {
      return this.readLocalFile(url, maxBytes, opts?.onBytes)
    }

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), opts?.timeoutMs ?? STORE_DOWNLOAD_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = {}
      if (opts?.etag) headers['If-None-Match'] = opts.etag
      const res = await fetch(url, { signal: ac.signal, headers })
      if (res.status === 304) return { buf: Buffer.alloc(0), etag: opts?.etag, notModified: true }
      if (!res.ok) throw new Error(`http_${res.status}`)
      const headerLen = Number(res.headers.get('content-length') || 0)
      if (headerLen > maxBytes) throw new Error('plugin_too_large')
      const etag = res.headers.get('etag') || undefined
      if (!res.body) {
        const ab = await res.arrayBuffer()
        if (ab.byteLength > maxBytes) throw new Error('plugin_too_large')
        return { buf: Buffer.from(ab), etag }
      }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        received += value.byteLength
        if (received > maxBytes) throw new Error('plugin_too_large')
        chunks.push(value)
        opts?.onBytes?.(received, headerLen || undefined)
      }
      return { buf: Buffer.concat(chunks), etag }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('download_timeout')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  private async readLocalFile(
    filePath: string,
    maxBytes: number,
    onBytes?: (n: number, total?: number) => void,
  ): Promise<{ buf: Buffer }> {
    const st = await fsp.stat(filePath)
    if (st.size > maxBytes) throw new Error('plugin_too_large')
    const buf = await fsp.readFile(filePath)
    onBytes?.(buf.length, buf.length)
    return { buf }
  }
}
