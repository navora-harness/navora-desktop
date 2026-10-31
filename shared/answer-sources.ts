export type AnswerSource = {
  url: string
  title?: string
  /** e.g. example.com */
  siteName?: string
  /** Short preview of read content (about two lines). */
  snippet?: string
  readAt?: number
  favicon?: string
}

const SOURCE_HEADING_RE = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?来源(?:\*\*)?\s*[:：]?\s*(?:\n|$)/i

export function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString()
  } catch {
    return url.trim()
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(String(url || '').trim())
}

export function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

export function faviconForUrl(url: string): string {
  const host = siteNameFromUrl(url)
  if (!host) return ''
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
}

/** True when text looks like JSON / JS source rather than readable prose. */
export function looksLikeCodeOrJson(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  if (t.length >= 2 && ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) {
    // JSON-ish; allow short plain arrays of words
    if (/^\[\s*"[^"]{1,40}"\s*(,\s*"[^"]{1,40}"\s*){0,6}\]$/.test(t)) return false
    return true
  }
  if (/^(?:function\b|class\b|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|=>|return\s+|module\.exports|export\s+)/.test(t)) {
    return true
  }
  if (/<\/?(?:script|style|html|body|div|span)\b/i.test(t) && t.includes('{') && t.includes('}')) {
    return true
  }
  // High density of JS/JSON punctuation vs letters
  const symbols = (t.match(/[{}\[\]();=]/g) || []).length
  const letters = (t.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length
  if (symbols >= 8 && letters > 0 && symbols / letters > 0.45) return true
  return false
}

function pickStringFields(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() && !looksLikeCodeOrJson(v)) return v.trim()
  }
  return ''
}

function textsFromDomSummary(obj: Record<string, unknown>): string {
  const parts: string[] = []
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (title) parts.push(title)
  const headings = Array.isArray(obj.headings) ? obj.headings : []
  for (const h of headings.slice(0, 10)) {
    if (!h || typeof h !== 'object') continue
    const text = String((h as Record<string, unknown>).text || '').trim()
    if (text && text !== title) parts.push(text)
  }
  if (parts.length) return parts.join(' · ')
  const links = Array.isArray(obj.links) ? obj.links : []
  for (const l of links.slice(0, 6)) {
    if (!l || typeof l !== 'object') continue
    const text = String((l as Record<string, unknown>).text || '').trim()
    if (text) parts.push(text)
  }
  return parts.join(' · ')
}

function shallowReadableText(obj: Record<string, unknown>): string {
  // dom_summary-shaped payloads: prefer title + headings over a lone title field
  if ('headings' in obj || 'links' in obj || 'inputs' in obj) {
    const fromDom = textsFromDomSummary(obj)
    if (fromDom) return fromDom
  }
  const prefer = pickStringFields(obj, [
    'text',
    'content',
    'body',
    'markdown',
    'innerText',
    'description',
    'summary',
    'excerpt',
    'message',
    'title',
  ])
  if (prefer) return prefer
  const bits: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (/^(ok|url|favicon|readAt|status|code|id|windowId|type|tag|href|src)$/i.test(k)) continue
    if (typeof v === 'string') {
      const s = v.trim()
      if (s && !looksLikeCodeOrJson(s) && s.length >= 2) bits.push(s)
    } else if (Array.isArray(v)) {
      for (const item of v.slice(0, 8)) {
        if (typeof item === 'string' && item.trim() && !looksLikeCodeOrJson(item)) {
          bits.push(item.trim())
        } else if (item && typeof item === 'object') {
          const t = pickStringFields(item as Record<string, unknown>, ['text', 'title', 'label', 'name'])
          if (t) bits.push(t)
        }
      }
    }
    if (bits.join(' ').length > 200) break
  }
  return bits.join(' · ')
}

/** Flatten tool results into readable prose (never raw JSON / JS dumps). */
export function readableTextFromUnknown(raw: unknown, depth = 0): string {
  if (raw == null) return ''
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (typeof raw === 'string') {
    let text = raw
    const trimmed = text.trim()
    if (
      depth < 2 &&
      trimmed.length >= 2 &&
      ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const nested = readableTextFromUnknown(parsed, depth + 1)
        if (nested) return nested
      } catch {
        /* keep as string */
      }
    }
    if (looksLikeCodeOrJson(trimmed)) return ''
    return text
  }
  if (Array.isArray(raw)) {
    return raw
      .slice(0, 20)
      .map((item) => readableTextFromUnknown(item, depth + 1))
      .filter(Boolean)
      .join(' · ')
  }
  if (typeof raw === 'object') {
    return shallowReadableText(raw as Record<string, unknown>)
  }
  return ''
}

export function makeSnippet(raw: unknown, maxChars = 140): string {
  let text = readableTextFromUnknown(raw)
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || looksLikeCodeOrJson(text)) return ''
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trim()}…`
}

function snippetQuality(s: string | undefined): number {
  if (!s) return 0
  if (looksLikeCodeOrJson(s)) return 1
  // Prefer natural language: letters/CJK over symbols
  const letters = (s.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length
  return 10 + Math.min(letters, 120)
}

function upsertSource(bag: Map<string, AnswerSource>, next: AnswerSource): void {
  const url = normalizeSourceUrl(next.url)
  if (!isHttpUrl(url)) return
  if (/^(about:|chrome:|devtools:|data:)/i.test(url)) return
  const siteName = next.siteName || siteNameFromUrl(url)
  const favicon = next.favicon || faviconForUrl(url)
  const prev = bag.get(url)
  if (!prev) {
    bag.set(url, {
      url,
      title: next.title || siteName || undefined,
      siteName: siteName || undefined,
      snippet: next.snippet || undefined,
      readAt: next.readAt || Date.now(),
      favicon: favicon || undefined,
    })
    return
  }
  if (!prev.title && next.title) prev.title = next.title
  if (next.snippet && snippetQuality(next.snippet) >= snippetQuality(prev.snippet)) {
    prev.snippet = next.snippet
  }
  if (next.readAt) prev.readAt = next.readAt
  if (!prev.siteName && siteName) prev.siteName = siteName
  if (!prev.favicon && favicon) prev.favicon = favicon
}

/**
 * Collect pages whose *content* was read (not mere navigation).
 * Prefer browser_get text/html/dom_summary and fetch bodies.
 */
export function collectReadPageSources(
  result: unknown,
  bag: Map<string, AnswerSource>,
  ctx?: { toolName?: string; args?: Record<string, unknown> },
): void {
  if (!result || typeof result !== 'object') return
  const r = result as Record<string, unknown>
  if (r.ok === false) return

  const tool = ctx?.toolName || ''
  const args = ctx?.args || {}

  if (tool === 'browser_get') {
    const what = String(args.what || 'text')
    if (!['text', 'html', 'dom_summary'].includes(what)) return
    const url = String(r.url || '').trim()
    if (!isHttpUrl(url)) return
    let snippet = ''
    let title = String(r.title || '').trim()
    if (what === 'dom_summary' && r.value && typeof r.value === 'object') {
      const v = r.value as Record<string, unknown>
      title = String(v.title || title || '').trim()
      snippet = makeSnippet(v)
    } else {
      snippet = makeSnippet(r.value)
    }
    if (!snippet && !title) return
    upsertSource(bag, {
      url,
      title: title || undefined,
      snippet: snippet || undefined,
      readAt: Date.now(),
    })
    return
  }

  if (tool === 'weather_get') {
    const url = String(r.sourceUrl || '').trim()
    if (r.ok !== true || !isHttpUrl(url)) return
    upsertSource(bag, { url, title: 'Open-Meteo 天气预报', readAt: Date.now(), snippet: '天气模型估算与逐日预报' })
    return
  }

  if (tool === 'browser_session_fetch') {
    const url = String(r.url || args.url || '').trim()
    if (!isHttpUrl(url)) return
    const body = r.body ?? r.value
    const snippet = makeSnippet(body)
    if (!snippet) return
    upsertSource(bag, {
      url,
      title: String(r.title || '').trim() || undefined,
      snippet,
      readAt: Date.now(),
    })
    return
  }

  // evaluate / screenshot: only if payload clearly includes page url + textual value
  if (tool === 'browser_evaluate' || tool === 'browser_screenshot') {
    const url = String(r.url || '').trim()
    if (!isHttpUrl(url)) return
    const snippet =
      tool === 'browser_evaluate' ? makeSnippet(r.value) : makeSnippet(r.title || r.url)
    if (tool === 'browser_evaluate' && snippet.length < 8) return
    upsertSource(bag, {
      url,
      title: String(r.title || '').trim() || undefined,
      snippet: snippet || undefined,
      readAt: Date.now(),
    })
  }
}

/** @deprecated use collectReadPageSources — kept for markdown fallback parsing */
export function collectAnswerSources(result: unknown, bag: Map<string, AnswerSource>): void {
  if (!result || typeof result !== 'object') return
  const r = result as Record<string, unknown>
  if (r.ok === false) return
  const url = String(r.url || '').trim()
  if (!isHttpUrl(url)) return
  upsertSource(bag, {
    url,
    title: String(r.title || '').trim() || undefined,
    snippet: makeSnippet(r.value || r.body || ''),
    readAt: Date.now(),
  })
}

export function messageAlreadyHasSources(text: string): boolean {
  return SOURCE_HEADING_RE.test(text || '')
}

export function formatSourcesMarkdown(sources: AnswerSource[]): string {
  if (!sources.length) return ''
  const lines = sources.map((s, i) => {
    const label = (s.title || s.siteName || s.url).replace(/[\[\]]/g, '').trim() || s.url
    return `${i + 1}. [${label}](${s.url})`
  })
  return `\n\n---\n\n**来源**\n\n${lines.join('\n')}`
}

/** Remove a trailing auto/model「来源」block so UI can render the panel instead. */
export function stripTrailingSourcesSection(content: string): string {
  const text = content || ''
  const matches = [...text.matchAll(new RegExp(SOURCE_HEADING_RE.source, 'gi'))]
  const last = matches[matches.length - 1]
  if (!last || last.index == null) return text
  if (last.index < text.length * 0.45 && text.length > 400) return text
  return text.slice(0, last.index).trimEnd()
}

export function parseSourcesFromMarkdown(content: string): AnswerSource[] {
  const text = content || ''
  const matches = [...text.matchAll(new RegExp(SOURCE_HEADING_RE.source, 'gi'))]
  const last = matches[matches.length - 1]
  if (!last || last.index == null) return []
  const bag = new Map<string, AnswerSource>()
  const section = text.slice(last.index)
  const linkRe = /\[([^\]]*)\]\((https?:[^)\s]+)\)/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(section))) {
    upsertSource(bag, { url: m[2], title: m[1], readAt: Date.now() })
  }
  return [...bag.values()]
}
