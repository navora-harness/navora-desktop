/**
 * Compress browser page payloads before they are sent back to the LLM.
 * Full news-site bodies often trip provider content filters ("high risk");
 * a headline-oriented digest keeps analysis useful while reducing rejections.
 */

const NAV_NOISE =
  /^(subscribe|log in|sign in|menu|skip to content|cookie|accept all|the economist pro|weekly edition|world in brief|search|close|back to top)$/i

const SECTION_CHIPS =
  /^(united states|finance & economics|business|china|asia|europe|britain|middle east & africa|artificial intelligence|games|opinion|culture|science & technology|international)$/i

export function isLlmContentRejected(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  if (/request was rejected because it was considered high risk/i.test(t)) return true
  if (/content (?:was )?(?:filtered|blocked|flagged)|safety (?:system|policy)|sensitive content/i.test(t)) {
    return true
  }
  if (/因(?:内容)?安全策略|内容审核|高风险|违规内容|无法回答该问题/.test(t) && t.length < 120) {
    return true
  }
  return false
}

function uniqKeepOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const k = item.toLowerCase()
    if (!item || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/** Pull likely headlines from raw page innerText. */
export function extractPageHeadlines(raw: string, limit = 30): string[] {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const headlines: string[] = []
  for (const line of lines) {
    if (NAV_NOISE.test(line) || SECTION_CHIPS.test(line)) continue
    if (/^\d+\s*min read$/i.test(line)) continue
    if (/^https?:\/\//i.test(line)) continue
    if (line.length < 18 || line.length > 140) continue
    if (/^[\[{]/.test(line)) continue
    headlines.push(line)
    if (headlines.length >= limit * 2) break
  }
  return uniqKeepOrder(headlines).slice(0, limit)
}

function digestDomSummary(value: Record<string, unknown>, maxChars: number): string {
  const title = String(value.title || '').trim()
  const url = String(value.url || '').trim()
  const headings = Array.isArray(value.headings) ? value.headings : []
  const lines: string[] = []
  lines.push('【页面结构摘要】公开网页标题与栏目，供客观总结。')
  if (title) lines.push(`标题：${title}`)
  if (url) lines.push(`地址：${url}`)
  const heads: string[] = []
  for (const h of headings) {
    if (!h || typeof h !== 'object') continue
    const text = String((h as { text?: unknown }).text || '').trim()
    if (!text || text === 'undefined undefined') continue
    if (NAV_NOISE.test(text) || SECTION_CHIPS.test(text)) continue
    heads.push(text)
  }
  const uniq = uniqKeepOrder(heads).slice(0, 36)
  if (uniq.length) {
    lines.push('标题列表：')
    for (const h of uniq) lines.push(`- ${h}`)
  }
  return lines.join('\n').slice(0, maxChars)
}

/**
 * Build a model-facing digest from page text (or return as-is if already short).
 */
export function digestPageTextForModel(
  raw: string,
  opts?: { maxChars?: number; safe?: boolean },
): string {
  const safe = opts?.safe === true
  const maxChars = Math.max(800, opts?.maxChars ?? (safe ? 4500 : 9000))
  const text = String(raw || '').replace(/\r/g, '').trim()
  if (!text) return ''
  if (text.length <= Math.min(2400, maxChars) && !safe) return text

  const headlines = extractPageHeadlines(text, safe ? 22 : 36)
  const cleanedLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NAV_NOISE.test(l))
  const excerptBudget = Math.max(600, maxChars - headlines.join('\n').length - 120)
  const excerpt = cleanedLines.join('\n').slice(0, excerptBudget)

  const parts = [
    safe
      ? '【页面安全摘要】以下仅为公开新闻标题与短摘录，请用中文客观概述主题与篇目，勿展开敏感细节。'
      : '【页面摘要】标题优先；正文为节选。',
  ]
  if (headlines.length) {
    parts.push(`标题列表：\n- ${headlines.join('\n- ')}`)
  }
  if (excerpt.trim()) {
    parts.push(`正文节选：\n${excerpt.trim()}`)
  }
  return parts.join('\n\n').slice(0, maxChars)
}

/**
 * Rewrite a browser_get / fetch style tool result for the model.
 * `safe` uses a tighter headline-only digest (retry after content rejection).
 */
export function prepareToolResultForModel(
  result: unknown,
  maxChars: number,
  safe = false,
): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const obj = { ...(result as Record<string, unknown>) }
  const budget = Math.max(1200, Math.floor(maxChars * (safe ? 0.45 : 0.55)))

  if (typeof obj.value === 'string') {
    const s = obj.value
    if (s.length > (safe ? 1200 : 2800) || safe) {
      obj.value = digestPageTextForModel(s, { maxChars: budget, safe })
      obj.digested = true
      if (safe) obj.safe_digest = true
    }
  } else if (obj.value && typeof obj.value === 'object' && !Array.isArray(obj.value)) {
    const v = obj.value as Record<string, unknown>
    if ('headings' in v || 'links' in v || 'inputs' in v) {
      obj.value = digestDomSummary(v, budget)
      obj.digested = true
      if (safe) obj.safe_digest = true
    }
  }

  if (typeof obj.body === 'string' && (obj.body.length > 2800 || safe)) {
    obj.body = digestPageTextForModel(obj.body, { maxChars: budget, safe })
    obj.digested = true
  }

  return obj
}

/** Best-effort local summary when the model keeps rejecting the page. */
export function buildLocalPageSummaryFromToolJson(toolContents: string[]): string {
  const headlines: string[] = []
  let title = ''
  let url = ''
  for (const raw of toolContents) {
    let text = raw
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.url === 'string' && parsed.url) url = parsed.url
      if (typeof parsed.title === 'string' && parsed.title) title = parsed.title
      if (typeof parsed.value === 'string') text = parsed.value
      else if (parsed.value && typeof parsed.value === 'object') {
        text = digestDomSummary(parsed.value as Record<string, unknown>, 6000)
      }
    } catch {
      /* plain text */
    }
    for (const h of extractPageHeadlines(text, 16)) headlines.push(h)
  }
  const uniq = uniqKeepOrder(headlines).slice(0, 12)
  if (!uniq.length && !title && !url) return ''
  const lines = ['页面已成功读取，但当前模型因内容安全策略拒绝深入分析。以下为本地提取的公开标题：', '']
  if (title) lines.push(`页面：${title}`)
  if (url) lines.push(`地址：${url}`)
  if (uniq.length) {
    lines.push('')
    for (const h of uniq) lines.push(`- ${h}`)
  }
  lines.push('', '可更换模型后重试，或指定只要标题列表 / 某一主题摘要。')
  return lines.join('\n')
}
