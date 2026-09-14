import type { ChatMessage } from './types'
import type { StoreCatalogProduct, StoreKind } from './store'
import { compareStoreVersions, latestPackageVersion } from './store'

export type CatalogToolItem = {
  key: string
  name: string
  idLine: string
  description: string
  sourceLine?: string
  tags: string[]
  kind?: StoreKind
  productId?: string
  canOpen: boolean
  canInstall: boolean
  canUpdate: boolean
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseToolPayload(message: ChatMessage): Record<string, unknown> | null {
  const fromMeta = asRecord(message.meta?.result)
  if (fromMeta) return fromMeta
  const raw = String(message.content || '').trim()
  if (!raw) return null
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return asRecord(JSON.parse(m[0]))
    } catch {
      return null
    }
  }
}

function str(v: unknown): string {
  return String(v || '').trim()
}

export function productHasUpdate(p: StoreCatalogProduct): boolean {
  if (!p.installed?.packageId) return false
  const pkg = p.packages.find((x) => x.id === p.installed!.packageId)
  const latest = latestPackageVersion(pkg)
  if (!latest) return false
  if (!p.installed.version) return true
  return compareStoreVersions(latest.version, p.installed.version) > 0
}

export function catalogProductIdLine(p: StoreCatalogProduct): string {
  if (p.installed?.packageId) {
    return `${p.installed.packageId}${p.installed.version ? ` · v${p.installed.version}` : ''}`
  }
  const first = p.packages[0]
  const latest = latestPackageVersion(first)
  if (p.displayMode === 'suite') {
    return `${p.productId} · ${p.packages.length} 个变体`
  }
  return `${p.productId}${latest?.version ? ` · v${latest.version}` : ''}`
}

export function catalogProductSourceLine(p: StoreCatalogProduct): string | undefined {
  if (!p.installed) return undefined
  return `本机 ${p.installed.packageId}${p.installed.version ? `@${p.installed.version}` : ''}`
}

export function catalogProductTags(p: StoreCatalogProduct): string[] {
  const tags: string[] = []
  if (p.displayMode === 'suite') tags.push(`套件 · ${p.packages.length}`)
  if (p.installed) tags.push('已安装')
  return tags
}

export function parseCatalogToolItems(message: ChatMessage): CatalogToolItem[] {
  const name = String(message.meta?.toolName || '').trim()
  const payload = parseToolPayload(message)
  if (!payload || payload.ok === false) return []

  if (name === 'store_search') {
    const rows = Array.isArray(payload.products) ? payload.products : []
    const out: CatalogToolItem[] = []
    for (const raw of rows) {
      const p = asRecord(raw)
      if (!p) continue
      const kind = p.kind === 'skill' ? 'skill' : p.kind === 'plugin' ? 'plugin' : undefined
      const productId = str(p.productId)
      if (!kind || !productId) continue
      const installed = asRecord(p.installed)
      const latestVersion = str(p.latestVersion)
      const localVersion = installed ? str(installed.version) : ''
      const canUpdate = Boolean(
        installed && latestVersion && compareStoreVersions(latestVersion, localVersion || '0') > 0,
      )
      const displayMode = p.displayMode === 'suite' ? 'suite' : 'single'
      const packageCount = Number(p.packageCount) || 0
      const tags: string[] = []
      if (displayMode === 'suite') tags.push(`套件${packageCount ? ` · ${packageCount}` : ''}`)
      if (installed) tags.push('已安装')
      out.push({
        key: `${kind}:${productId}`,
        name: str(p.name) || productId,
        idLine: installed
          ? `${str(installed.packageId) || productId}${localVersion ? ` · v${localVersion}` : ''}`
          : `${productId}${latestVersion ? ` · v${latestVersion}` : ''}`,
        description: str(p.description),
        sourceLine: installed
          ? `本机 ${str(installed.packageId) || productId}${localVersion ? `@${localVersion}` : ''}`
          : undefined,
        tags,
        kind,
        productId,
        canOpen: true,
        canInstall: !installed,
        canUpdate,
      })
    }
    return out
  }

  if (name === 'plugin_list') {
    const rows = Array.isArray(payload.plugins) ? payload.plugins : []
    const out: CatalogToolItem[] = []
    rows.forEach((raw, i) => {
      const p = asRecord(raw)
      if (!p) return
      const id = str(p.id)
      if (!id) return
      const tools = Array.isArray(p.tools) ? p.tools.map(String).filter(Boolean) : []
      out.push({
        key: `plugin:${id}:${i}`,
        name: str(p.name) || id,
        idLine: `${id}${str(p.version) ? ` · v${p.version}` : ''}`,
        description: tools.length
          ? `${str(p.description)}\n接口：${tools.join(', ')}`
          : str(p.description),
        sourceLine: p.enabled === false ? '已禁用' : '已启用',
        tags: p.error ? ['加载失败'] : [],
        kind: 'plugin',
        productId: id,
        canOpen: false,
        canInstall: false,
        canUpdate: false,
      })
    })
    return out
  }

  if (name === 'skill_list') {
    const rows = Array.isArray(payload.skills) ? payload.skills : []
    const out: CatalogToolItem[] = []
    rows.forEach((raw, i) => {
      const s = asRecord(raw)
      if (!s) return
      const id = str(s.id)
      if (!id) return
      out.push({
        key: `skill:${id}:${i}`,
        name: str(s.name) || id,
        idLine: `${id}${str(s.version) ? ` · v${s.version}` : ''}`,
        description: str(s.description),
        sourceLine: s.enabled === false ? '已禁用' : '已启用',
        tags: s.needs_skill_read || s.disable_model_invocation ? ['需 skill_read'] : [],
        kind: 'skill',
        productId: id,
        canOpen: false,
        canInstall: false,
        canUpdate: false,
      })
    })
    return out
  }

  return []
}
