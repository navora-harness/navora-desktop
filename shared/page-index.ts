/** Compact, model-facing observations. Element references are scoped to a document. */
export type PageIndexEntry = {
  ref: string
  role: string
  name: string
  tag: string
  selector: string
  url?: string
  disabled?: boolean
  checked?: boolean
}

export type PageSnapshot = {
  documentId: string
  url: string
  title: string
  text: string
  entries: PageIndexEntry[]
  capturedAt: number
  revision: number
  reused: boolean
  scanned: number
  truncated: boolean
  captureMs: number
  coverage: { mainFrame: true; openShadow: true; closedShadow: false; frameContents: false }
}

/** Deterministic lexical retrieval; keeps distinct controls with the same label. */
export function searchPageIndex(entries: readonly PageIndexEntry[], query: string, limit = 15): PageIndexEntry[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  const phrase = normalize(query)
  const count = Math.min(80, Math.max(1, Math.floor(limit) || 15))
  if (!phrase) {
    const selected = new Set<string>()
    const take = (predicate: (entry: PageIndexEntry) => boolean, quota: number) => {
      let taken = 0
      for (const entry of entries) {
        if (selected.size >= count || taken >= quota) break
        if (!selected.has(entry.ref) && predicate(entry)) { selected.add(entry.ref); taken++ }
      }
    }
    take((entry) => entry.role === 'heading', Math.max(1, Math.floor(count * .15)))
    take((entry) => /^(textbox|searchbox|combobox|button|checkbox|radio|slider|switch|tab|menuitem)$/.test(entry.role), Math.ceil(count * .5))
    take((entry) => entry.role === 'frame', Math.max(1, Math.floor(count * .05)))
    take((entry) => entry.role === 'link', count)
    take((entry) => entry.role !== 'text', count)
    return entries.filter((entry) => selected.has(entry.ref))
  }
  const words = phrase.match(/[\p{L}\p{N}_-]+/gu) || []
  const segmented = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter('zh', {granularity:'word'}).segment(phrase))
      .filter((part) => part.isWordLike).map((part) => part.segment)
    : []
  const terms = [...new Set([...words, ...segmented])]
  const ranked = entries.map((entry, index) => {
    const name = normalize(entry.name)
    const url = normalize(entry.url || '')
    let score = name === phrase ? 100 : name.includes(phrase) ? 50 : 0
    let matched = 0
    for (const term of terms) {
      if (name.includes(term)) { score += 12; matched++ }
      else if (url.includes(term)) { score += 3; matched++ }
    }
    if (terms.length > 1 && matched === terms.length) score += 20
    if (score > 0 && entry.role !== 'text') score += 2
    return { entry, index, score }
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const minimum = (ranked[0]?.score || 0) * .35
  return ranked.filter((item) => item.score >= minimum).slice(0, count).map((item) => item.entry)
}

/** Crop at complete records so refs, URLs and JSON remain usable. */
export function compactPageSnapshot(snapshot: PageSnapshot, opts?: { query?: string; limit?: number; maxChars?: number }) {
  const maxChars = Math.max(1500, opts?.maxChars ?? 12000)
  const candidates = searchPageIndex(snapshot.entries, opts?.query || '', opts?.limit ?? 60)
  const { entries: _entries, text, ...metadata } = snapshot
  const output = {
    ...metadata,
    text: text.slice(0, Math.min(4000, Math.floor(maxChars / 3))),
    entries: [] as PageIndexEntry[],
    totalEntries: snapshot.entries.length,
    truncated: snapshot.truncated || text.length > Math.min(4000, Math.floor(maxChars / 3)),
  }
  for (const entry of candidates) {
    if (JSON.stringify({ ...output, entries: [...output.entries, entry] }).length > maxChars) {
      output.truncated = true
      continue
    }
    output.entries.push(entry)
  }
  if (output.entries.length < candidates.length || candidates.length < snapshot.entries.length) output.truncated = true
  return output
}
