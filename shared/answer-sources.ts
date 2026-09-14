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

export function makeSnippet(raw: unknown, maxChars = 140): string {
  let text = ''
  if (typeof raw === 'string') text = raw
  else if (raw && typeof raw === 'object') {
    try {
      text = JSON.stringify(raw)
    } catch {
      text = String(raw)
    }
  } else if (raw != null) text = String(raw)
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trim()}…`
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
  if (next.snippet && (!prev.snippet || next.snippet.length > prev.snippet.length)) {
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
  const section = text.slice(last.index)
  const bag = new Map<string, AnswerSource>()
  const linkRe = /\[([^\]]*)\]\((https?:[^)\s]+)\)/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(section))) {
    upsertSource(bag, { url: m[2], title: m[1], readAt: Date.now() })
  }
  return [...bag.values()]
}
