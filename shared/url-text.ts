/**
 * Bare URL extraction / normalization for chat Markdown autolink
 * and agent context enrichment. Prefers a positive URI charset so
 * CJK prose after a URL is never swallowed (e.g. `https://a.com看看`).
 */

/** RFC 3986-ish body chars for bare http(s) URLs (ASCII only). */
const URL_BODY_CHARS = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]`

/**
 * Match http(s) URLs, or bare `www.` hosts (normalized to https later).
 * Avoid starting mid-token (e.g. `xhttps://`).
 */
const BARE_URL_RE = new RegExp(
  `(?:^|[^A-Za-z0-9@])((?:https?:\\/\\/|www\\.)${URL_BODY_CHARS}+)`,
  'gi',
)

/** Trailing punctuation commonly stuck after a URL in prose. */
const TRAILING_PUNCT = /[.,;:!?。，、；：！？…·'"”’›»）】》」』]+$/u

/**
 * Trim trailing punctuation / unbalanced closers from a matched URL span.
 * Bare `www.` hosts are promoted to `https://`.
 */
export function normalizeAutolinkUrl(raw: string): string {
  let u = String(raw || '').trim()
  if (/^www\./i.test(u) && !/^https?:\/\//i.test(u)) {
    u = `https://${u}`
  }
  while (u.length) {
    const last = u[u.length - 1]
    if (TRAILING_PUNCT.test(last)) {
      u = u.slice(0, -1)
      continue
    }
    if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) {
      u = u.slice(0, -1)
      continue
    }
    if (last === ']' && (u.match(/\[/g) || []).length < (u.match(/\]/g) || []).length) {
      u = u.slice(0, -1)
      continue
    }
    if (last === '}' && (u.match(/\{/g) || []).length < (u.match(/\}/g) || []).length) {
      u = u.slice(0, -1)
      continue
    }
    // Drop trailing % that is not a complete percent-encoding
    if (last === '%' && !/%[0-9A-Fa-f]{2}$/.test(u)) {
      u = u.slice(0, -1)
      continue
    }
    break
  }
  // Hard stop: URL must stay ASCII (guards against any CJK leak)
  const nonAscii = u.search(/[^\x00-\x7F]/)
  if (nonAscii > 0) u = u.slice(0, nonAscii)
  return u.trim()
}

function matchBareUrls(src: string): Array<{ raw: string; index: number }> {
  const out: Array<{ raw: string; index: number }> = []
  const text = String(src || '')
  for (const m of text.matchAll(BARE_URL_RE)) {
    const captured = m[1]
    if (!captured) continue
    const full = m[0]
    const offset = full.length - captured.length
    const index = (m.index ?? 0) + offset
    out.push({ raw: captured, index })
  }
  return out
}

function isPlausibleHttpUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false
  try {
    const host = new URL(u).hostname
    if (!host) return false
    if (host === 'localhost') return true
    return host.includes('.')
  } catch {
    return false
  }
}

/** How many leading chars of `raw` normalize to `url`. */
function consumedUrlLength(raw: string, url: string): number {
  for (let n = raw.length; n >= 1; n--) {
    if (normalizeAutolinkUrl(raw.slice(0, n)) === url) return n
  }
  return raw.length
}

export function extractHttpUrls(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const { raw } of matchBareUrls(text)) {
    const u = normalizeAutolinkUrl(raw)
    if (!u || !isPlausibleHttpUrl(u) || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function protectSegments(src: string, fn: (plain: string) => string): string {
  const slots: string[] = []
  const stash = (m: string) => {
    const i = slots.length
    slots.push(m)
    return `\0NAVORAURL${i}\0`
  }
  let s = src
  // Fenced code
  s = s.replace(/```[\s\S]*?```/g, stash)
  // Inline code
  s = s.replace(/`[^`\n]+`/g, stash)
  // Images / links already written as Markdown
  s = s.replace(/!\[[^\]]*]\([^)]*\)/g, stash)
  s = s.replace(/\[[^\]]*]\([^)]*\)/g, stash)
  // Angle autolinks
  s = s.replace(/<https?:\/\/[^>\s]+>/gi, stash)
  s = fn(s)
  return s.replace(/\0NAVORAURL(\d+)\0/g, (_, i) => slots[Number(i)] ?? '')
}

/**
 * Turn bare http(s) / www. URLs into Markdown links before `marked` parses,
 * so GFM autolink cannot pull in Chinese punctuation / following words.
 */
export function linkifyBareUrlsInMarkdown(src: string): string {
  return protectSegments(String(src || ''), (plain) => {
    let out = ''
    let last = 0
    for (const { raw, index } of matchBareUrls(plain)) {
      if (index < last) continue
      out += plain.slice(last, index)
      const url = normalizeAutolinkUrl(raw)
      if (!url || !isPlausibleHttpUrl(url)) {
        out += raw
        last = index + raw.length
        continue
      }
      const consumed = consumedUrlLength(raw, url)
      const trail = raw.slice(consumed)
      const dest = url.replace(/\)/g, '%29')
      const label = /^www\./i.test(raw) ? url.replace(/^https:\/\//i, '') : url
      out += `[${label}](${dest})${trail}`
      last = index + raw.length
    }
    out += plain.slice(last)
    return out
  })
}
