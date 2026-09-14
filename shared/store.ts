/** Local store catalog + install preview types (navora-store protocol). See navora-store/PROTOCOL.md. */

export type StoreKind = 'plugin' | 'skill'
export type StoreDisplayMode = 'single' | 'suite'
export type StoreInstallAction = 'fresh' | 'upgrade' | 'reinstall' | 'switch_variant'
export type StoreVersionStatus = 'active' | 'yanked'
export type StoreProgressPhase = 'replace_suite' | 'download' | 'verify' | 'extract' | 'import'

export const STORE_SCHEMA_VERSION = 1
export const STORE_ZIP_MAX_BYTES = 200 * 1024 * 1024
export const STORE_DOWNLOAD_TIMEOUT_MS = 600_000
export const STORE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const CATALOG_FILE_RE =
  /^(plugins|skills)\/[a-z][a-z0-9._-]{0,63}\/[A-Za-z0-9._+-]+\/(package\.zip|README\.md|SKILL\.md)$/

export type StoreInstallProgress = {
  phase: StoreProgressPhase
  label: string
  bytesReceived?: number
  bytesTotal?: number
}

export type StoreCatalogVersion = {
  version: string
  sha256: string
  size: number
  downloadPath: string
  publishedAt: string
  sourceName?: string
  hasReadme?: boolean
  readmePath?: string
  readmeFileName?: string
  minHostVersion?: string
  status?: StoreVersionStatus
}

export type StoreCatalogPackage = {
  id: string
  name: string
  description: string
  suite?: string
  minHostVersion?: string
  versions: StoreCatalogVersion[]
}

export type StoreCatalogProduct = {
  kind: StoreKind
  productId: string
  displayMode: StoreDisplayMode
  name: string
  description: string
  packages: StoreCatalogPackage[]
  /** Filled by desktop when listing against local installs. */
  installed?: {
    packageId: string
    version?: string
    name?: string
  }
}

export type StoreCatalogIndex = {
  schemaVersion: number
  generatedAt: string
  products: StoreCatalogProduct[]
}

export type StoreStatus = {
  baseUrl: string
  reachable: boolean
  productCount: number
  generatedAt?: string
  error?: string
}

export type StorePreviewInstallInput = {
  kind: StoreKind
  packageId: string
  version?: string
}

export type StorePreviewInstallResult = {
  ok: boolean
  error?: string
  blockers?: string[]
  kind?: StoreKind
  packageId?: string
  version?: string
  name?: string
  description?: string
  suite?: string
  size?: number
  sha256?: string
  downloadPath?: string
  action?: StoreInstallAction
  needsOverwrite?: boolean
  needsReplaceSuite?: boolean
  yanked?: boolean
  minHostVersion?: string
  local?: {
    sameId?: {
      id: string
      name: string
      version?: string
      enabled?: boolean
      kind?: string
      bundled?: boolean
    }
    suiteConflicts?: Array<{
      id: string
      name: string
      version?: string
      kind?: string
      bundled?: boolean
      enabled?: boolean
      source?: string
    }>
  }
}

export type StoreInstallInput = {
  kind: StoreKind
  packageId: string
  version?: string
  overwrite?: boolean
  replaceSuite?: boolean
}

export type StoreInstallResult = {
  ok: boolean
  error?: string
  action?: StoreInstallAction
  plugin?: import('./plugins').PluginRecord
  skill?: import('./skills').SkillRecord
  suiteConflicts?: StorePreviewInstallResult['local'] extends infer L
    ? L extends { suiteConflicts?: infer C }
      ? C
      : never
    : never
}

export function normalizeStoreSuite(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const g = raw.trim().toLowerCase()
  if (!g || !STORE_ID_RE.test(g) || g.length > 64) return undefined
  return g
}

export function assertCatalogRelPath(raw: string): string {
  const s = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!s || s.includes('..') || s.includes(':') || s.startsWith('/') || !CATALOG_FILE_RE.test(s)) {
    throw new Error('invalid_catalog_path')
  }
  return s
}

/** Semver-ish: major.minor.patch then prerelease. Higher = newer. */
export function compareStoreVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (!pa.pre.length && !pb.pre.length) return 0
  if (!pa.pre.length) return 1
  if (!pb.pre.length) return -1
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = typeof x === 'number'
    const yn = typeof y === 'number'
    if (xn && yn) {
      if (x !== y) return x < y ? -1 : 1
      continue
    }
    if (xn !== yn) return xn ? -1 : 1
    if (x !== y) return String(x) < String(y) ? -1 : 1
  }
  return 0
}

function parseSemver(raw: string): { core: number[]; pre: Array<string | number> } {
  let s = String(raw || '')
    .trim()
    .replace(/^v/i, '')
  const plus = s.indexOf('+')
  if (plus >= 0) s = s.slice(0, plus)
  const dash = s.indexOf('-')
  let core = s
  let pre: Array<string | number> = []
  if (dash >= 0) {
    core = s.slice(0, dash)
    pre = s
      .slice(dash + 1)
      .split('.')
      .map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  }
  const parts = core.split('.')
  return {
    core: [0, 1, 2].map((i) => (/^\d+$/.test(parts[i] || '') ? Number(parts[i]) : 0)),
    pre,
  }
}

export function assertCatalogIndex(raw: unknown): StoreCatalogIndex {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_catalog_schema')
  const o = raw as Record<string, unknown>
  const ver = Number(o.schemaVersion)
  if (!Number.isFinite(ver) || ver < 1) throw new Error('invalid_catalog_schema')
  if (!Array.isArray(o.products)) throw new Error('invalid_catalog_schema')
  return o as StoreCatalogIndex
}

export function latestPackageVersion(
  pkg: StoreCatalogPackage | undefined | null,
  opts?: { includeYanked?: boolean },
): StoreCatalogVersion | null {
  if (!pkg?.versions?.length) return null
  const list = opts?.includeYanked
    ? pkg.versions
    : pkg.versions.filter((v) => v.status !== 'yanked')
  const pool = list.length ? list : pkg.versions
  return [...pool].sort((a, b) => compareStoreVersions(b.version, a.version))[0] || null
}

export function findCatalogPackage(
  catalog: StoreCatalogIndex | null | undefined,
  kind: StoreKind,
  packageId: string,
): { product: StoreCatalogProduct; pkg: StoreCatalogPackage } | null {
  if (!catalog?.products?.length) return null
  for (const product of catalog.products) {
    if (product.kind !== kind) continue
    const pkg = product.packages.find((p) => p.id === packageId)
    if (pkg) return { product, pkg }
  }
  return null
}

export function findCatalogProduct(
  catalog: StoreCatalogIndex | null | undefined,
  productId: string,
  kind?: StoreKind,
): StoreCatalogProduct | null {
  if (!catalog?.products?.length) return null
  const id = String(productId || '').trim()
  const hits = catalog.products.filter((p) => p.productId === id && (!kind || p.kind === kind))
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) return null
  return null
}

export function isSafeZipEntryName(raw: string): boolean {
  const n = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return false
  return !n.split('/').some((p) => p === '..' || p === '')
}

const STORE_ERROR_HINTS: Record<string, string> = {
  host_too_old: '当前桌面版本过低，无法安装该版本',
  invalid_catalog_path: '商店目录路径无效，已拒绝下载',
  invalid_catalog_json: '商店目录不是合法 JSON',
  invalid_catalog_schema: '商店目录格式无效',
  product_not_found: '商店中找不到该产品',
  product_kind_required: '插件与技能同名，请指定类型',
  package_not_found: '商店中找不到该包',
  version_not_found: '商店中找不到该版本',
  package_id_required: '缺少包标识',
  kind_required: '缺少产品类型',
  product_id_required: '缺少产品标识',
  size_mismatch: '下载体积与目录声明不符',
  checksum_mismatch: '校验和不匹配，已拒绝安装',
  download_timeout: '下载超时',
  plugin_too_large: '压缩包超过 200MB 上限',
  skill_too_large: '技能包超过 200MB 上限',
  store_unreachable: '商店不可达',
  store_list_failed: '无法读取商店目录',
  bundled_cannot_overwrite: '随附包无法覆盖',
  plugin_exists: '插件已存在',
  skill_exists: '技能已存在',
  plugin_suite_conflict: '同套件已安装其它包，请先卸载或确认更换',
  skill_md_missing: '包内缺少 SKILL.md',
  zip_unsafe_path: '压缩包含不安全路径',
  zip_empty: '压缩包为空',
  readme_not_found: '该产品未提供说明文件',
  preview_failed: '预检失败',
}

/** User-facing label for store / catalog / install error codes. */
export function storeErrorText(code?: string, extra?: { minHostVersion?: string }): string {
  if (!code) return '操作失败'
  if (code === 'host_too_old') {
    return extra?.minHostVersion
      ? `当前桌面版本过低，需要 ≥ ${extra.minHostVersion}`
      : STORE_ERROR_HINTS.host_too_old
  }
  if (code.startsWith('http_')) return `商店返回 HTTP ${code.slice(5)}`
  if (code.startsWith('main_missing:')) return `缺少入口文件 ${code.slice('main_missing:'.length)}`
  return STORE_ERROR_HINTS[code] || code
}
