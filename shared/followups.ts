import type { ChatMessage } from './types'
import type { StoreKind } from './store'

/** Executable follow-up chip (or plain prompt fill). */
export type FollowupAction =
  | { type: 'prompt'; text: string }
  | { type: 'file_reveal'; path: string }
  | { type: 'file_open'; path: string }
  | {
      type: 'store_install'
      kind: StoreKind
      productId: string
      name?: string
      description?: string
    }

export type FollowupSuggestion = {
  label: string
  action: FollowupAction
}

export type FollowupArtifact = {
  path: string
  name: string
  kind: 'download' | 'file'
}

const DOWNLOAD_TOOLS = new Set(['file_download', 'file_download_compose'])

const REVEAL_HINT =
  /(打开|显示|查看).{0,12}(文件夹|目录|位置|所在)|资源管理器|访达|Finder|所在文件夹/i
const OPEN_HINT = /^(打开|用默认程序打开|打开文件)(?!.*文件夹)/i

/** Stable key for Vue / dedupe. */
export function followupKey(s: FollowupSuggestion): string {
  if (s.action.type === 'prompt') return `prompt:${s.action.text}`
  if (s.action.type === 'store_install') {
    return `store_install:${s.action.kind}:${s.action.productId}`
  }
  return `${s.action.type}:${s.action.path}`
}

export function sanitizeWorkspaceRelPath(raw: string): string | null {
  const p = String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null
  if (p.split('/').some((seg) => seg === '..')) return null
  if (p.length > 512) return null
  return p
}

function basenameRel(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || rel
}

/** Collect recent workspace files from tool results + download logs. */
export function collectWorkspaceArtifacts(messages: ChatMessage[]): FollowupArtifact[] {
  const seen = new Set<string>()
  const out: FollowupArtifact[] = []

  const add = (raw: string, kind: FollowupArtifact['kind']) => {
    const path = sanitizeWorkspaceRelPath(raw)
    if (!path || seen.has(path)) return
    seen.add(path)
    out.push({ path, name: basenameRel(path), kind })
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      const toolName = String(m.meta?.toolName || '')
      if (!DOWNLOAD_TOOLS.has(toolName)) continue
      if (m.meta?.status === 'error') continue
      const result =
        m.meta?.result && typeof m.meta.result === 'object'
          ? (m.meta.result as Record<string, unknown>)
          : null
      if (result?.ok === false) continue
      const path = result?.path != null ? String(result.path) : ''
      if (path) add(path, 'download')
      continue
    }

    if (m.role === 'log') {
      const blob = `${m.meta?.detail || ''}\n${m.content || ''}`
      const hit = blob.match(
        /(?:工作区路径|保存到|默认另存为已屏蔽。待确认后保存到)[：:]\s*([^\s\n]+)/,
      )
      if (hit?.[1]) add(hit[1], 'download')
    }
  }

  return out.slice(-4)
}

export type StoreFollowupSeed = {
  kind: StoreKind
  productId: string
  name: string
  description: string
}

/** Uninstalled store products from recent store_search tool results. */
export function collectStoreRecommendations(messages: ChatMessage[]): StoreFollowupSeed[] {
  const seen = new Set<string>()
  const out: StoreFollowupSeed[] = []
  for (const m of messages) {
    if (m.role !== 'tool') continue
    if (String(m.meta?.toolName || '') !== 'store_search') continue
    if (m.meta?.status === 'error') continue
    const result =
      m.meta?.result && typeof m.meta.result === 'object'
        ? (m.meta.result as Record<string, unknown>)
        : null
    const rows = Array.isArray(result?.products)
      ? result.products
      : (() => {
          try {
            const parsed = JSON.parse(String(m.content || '')) as Record<string, unknown>
            return Array.isArray(parsed.products) ? parsed.products : []
          } catch {
            return []
          }
        })()
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue
      const p = raw as Record<string, unknown>
      const kind = p.kind === 'skill' ? 'skill' : p.kind === 'plugin' ? 'plugin' : null
      const productId = String(p.productId || '').trim()
      if (!kind || !productId || p.installed) continue
      const key = `${kind}:${productId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        kind,
        productId,
        name: String(p.name || productId).trim() || productId,
        description: String(p.description || '').trim(),
      })
    }
  }
  return out.slice(-3)
}

export function buildStoreFollowups(recs: StoreFollowupSeed[]): FollowupSuggestion[] {
  return recs.map((r) => ({
    label: `安装「${r.name}」`,
    action: {
      type: 'store_install',
      kind: r.kind,
      productId: r.productId,
      name: r.name,
      description: r.description,
    },
  }))
}

/** Deterministic chips bound to known artifacts (no LLM needed). */
export function buildArtifactFollowups(artifacts: FollowupArtifact[]): FollowupSuggestion[] {
  const out: FollowupSuggestion[] = []
  for (const a of artifacts.slice(-2)) {
    out.push({
      label: `打开「${a.name}」所在文件夹`,
      action: { type: 'file_reveal', path: a.path },
    })
  }
  return out
}

/**
 * Map a free-text follow-up onto a file action when it clearly asks to reveal/open
 * a known artifact from this turn.
 */
export function bindFollowupToArtifacts(
  label: string,
  text: string,
  artifacts: FollowupArtifact[],
): FollowupSuggestion {
  const cleanedLabel = label.trim() || text.trim()
  const cleanedText = text.trim() || cleanedLabel
  const latest = artifacts[artifacts.length - 1]
  if (!latest) {
    return { label: cleanedLabel, action: { type: 'prompt', text: cleanedText } }
  }

  // Explicit path in the text wins when it matches an artifact.
  for (const a of [...artifacts].reverse()) {
    if (cleanedText.includes(a.path) || cleanedText.includes(a.name)) {
      if (REVEAL_HINT.test(cleanedText) || REVEAL_HINT.test(cleanedLabel)) {
        return {
          label: cleanedLabel.startsWith('打开')
            ? cleanedLabel
            : `打开「${a.name}」所在文件夹`,
          action: { type: 'file_reveal', path: a.path },
        }
      }
      if (OPEN_HINT.test(cleanedText) || OPEN_HINT.test(cleanedLabel)) {
        return {
          label: cleanedLabel.startsWith('打开') ? cleanedLabel : `打开「${a.name}」`,
          action: { type: 'file_open', path: a.path },
        }
      }
    }
  }

  if (REVEAL_HINT.test(cleanedText) || REVEAL_HINT.test(cleanedLabel)) {
    return {
      label: `打开「${latest.name}」所在文件夹`,
      action: { type: 'file_reveal', path: latest.path },
    }
  }
  if (OPEN_HINT.test(cleanedText) || OPEN_HINT.test(cleanedLabel)) {
    return {
      label: `打开「${latest.name}」`,
      action: { type: 'file_open', path: latest.path },
    }
  }

  return { label: cleanedLabel, action: { type: 'prompt', text: cleanedText } }
}

function parseOneFollowup(item: unknown, artifacts: FollowupArtifact[]): FollowupSuggestion | null {
  if (typeof item === 'string') {
    const t = item.trim().replace(/^[\d]+[.\s、)]+/, '')
    if (t.length < 4 || t.length > 80) return null
    return bindFollowupToArtifacts(t, t, artifacts)
  }
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const label = String(row.label || row.text || '').trim().replace(/^[\d]+[.\s、)]+/, '')
  if (!label || label.length < 2 || label.length > 80) return null

  const actionRaw = row.action
  if (actionRaw && typeof actionRaw === 'object') {
    const a = actionRaw as Record<string, unknown>
    const type = String(a.type || '')
    if (type === 'store_install') {
      const kind = a.kind === 'skill' ? 'skill' : a.kind === 'plugin' ? 'plugin' : null
      const productId = String(a.productId || '').trim()
      if (!kind || !productId) return bindFollowupToArtifacts(label, label, artifacts)
      return {
        label,
        action: {
          type: 'store_install',
          kind,
          productId,
          name: String(a.name || '').trim() || undefined,
          description: String(a.description || '').trim() || undefined,
        },
      }
    }
    if (type === 'file_reveal' || type === 'file_open') {
      const path = sanitizeWorkspaceRelPath(String(a.path || ''))
      if (!path) return bindFollowupToArtifacts(label, label, artifacts)
      return { label, action: { type, path } }
    }
    if (type === 'prompt') {
      const text = String(a.text || label).trim() || label
      return bindFollowupToArtifacts(label, text, artifacts)
    }
  }

  const text = String(row.text || label).trim() || label
  return bindFollowupToArtifacts(label, text, artifacts)
}

/** Parse LLM JSON (string[] or object[]) and bind to artifacts when possible. */
export function parseFollowupSuggestions(
  raw: string,
  artifacts: FollowupArtifact[] = [],
): FollowupSuggestion[] {
  const text = raw.trim()
  if (!text) return []

  const tryParse = (s: string): FollowupSuggestion[] => {
    const v = JSON.parse(s) as unknown
    if (!Array.isArray(v)) return []
    const out: FollowupSuggestion[] = []
    for (const item of v) {
      const one = parseOneFollowup(item, artifacts)
      if (one) out.push(one)
      if (out.length >= 4) break
    }
    return out
  }

  try {
    return tryParse(text)
  } catch {
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return []
    try {
      return tryParse(m[0])
    } catch {
      return []
    }
  }
}

export function mergeFollowups(
  seeded: FollowupSuggestion[],
  fromLlm: FollowupSuggestion[],
  max = 4,
): FollowupSuggestion[] {
  const out: FollowupSuggestion[] = []
  const seen = new Set<string>()
  for (const s of [...seeded, ...fromLlm]) {
    const key = followupKey(s)
    if (seen.has(key)) continue
    // Also skip duplicate labels for action vs prompt collisions.
    const labelKey = `label:${s.label}`
    if (seen.has(labelKey)) continue
    seen.add(key)
    seen.add(labelKey)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Normalize wire payload (legacy string[] or structured). */
export function normalizeFollowupList(list: unknown): FollowupSuggestion[] {
  if (!Array.isArray(list)) return []
  const out: FollowupSuggestion[] = []
  for (const item of list) {
    const one = parseOneFollowup(item, [])
    if (one) out.push(one)
    if (out.length >= 4) break
  }
  return out
}
