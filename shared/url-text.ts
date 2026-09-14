/**
 * Bare URL extraction / normalization for chat Markdown autolink
 * and agent context enrichment. Stops at CJK punctuation so
 * `https://a.com/x、还有` does not swallow following prose.
 */

/** Characters that end a bare URL (ASCII + CJK punctuation / brackets). */
const URL_STOP_CLASS =
  '\\s<>"\'`' +
  // CJK / fullwidth punctuation & brackets
  '。，、；：！？…·—–\\u3000【】《》「」『』（）' +
  // closing ASCII already covered for strip; keep ] } from swallowing prose
  '\\]}'

const BARE_URL_RE = new RegExp(
  `https?:\\/\\/[^${URL_STOP_CLASS}]+`,
  'gi',
)

/** Trailing ASCII punctuation commonly stuck after a URL in prose. */
const TRAILING_ASCII_PUNCT = /[.,;:!?。，；：！？'"”’›»]$/

/**
 * Trim trailing punctuation / unbalanced closers from a matched URL span.
 */
export function normalizeAutolinkUrl(raw: string): string {
  let u = String(raw || '').trim()
  while (u.length) {
    const last = u[u.length - 1]
    if (TRAILING_ASCII_PUNCT.test(last)) {
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
    break
  }
  return u.trim()
}

export function extractHttpUrls(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const src = String(text || '')
  for (const m of src.matchAll(BARE_URL_RE)) {
    const u = normalizeAutolinkUrl(m[0])
    if (!u || !/^https?:\/\//i.test(u) || seen.has(u)) continue
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
 * Turn bare http(s) URLs into Markdown links before `marked` parses,
 * so GFM autolink cannot pull in Chinese punctuation / following words.
 */
export function linkifyBareUrlsInMarkdown(src: string): string {
  return protectSegments(String(src || ''), (plain) =>
    plain.replace(BARE_URL_RE, (raw) => {
      const url = normalizeAutolinkUrl(raw)
      if (!url || !/^https?:\/\//i.test(url)) return raw
      const suffix = raw.slice(url.length)
      // Escape ')' in URL for Markdown link destination when needed
      const dest = url.replace(/\)/g, '%29')
      return `[${url}](${dest})${suffix}`
    }),
  )
}
