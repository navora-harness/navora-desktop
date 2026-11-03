import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { LiteratureProvider, LiteratureSearchEvent, LiteratureSearchInput, LiteratureWork } from '../../shared/literature-search'

type Emit = (event: LiteratureSearchEvent) => void
type ProviderAdapter = (query: string, limit: number, signal: AbortSignal) => Promise<LiteratureWork[]>
const active = new Map<string, AbortController>()
const providers: LiteratureProvider[] = ['openalex', 'crossref', 'semanticscholar']
const providerLastRequest = new Map<LiteratureProvider, number>()
const providerQueues = new Map<LiteratureProvider, Promise<void>>()
const providerIntervals: Record<LiteratureProvider, number> = { openalex: 150, crossref: 1100, semanticscholar: 1000 }
function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('检索已取消'))
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('检索已取消')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback
}
const cleanText = (value: unknown) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
const normalizeDoi = (value: unknown) => cleanText(value).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase() || undefined
const yearFromDate = (value: unknown) => {
  const match = String(value || '').match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)
  return match ? Number(match[1]) : undefined
}
const abstractFromOpenAlex = (value: unknown) => {
  if (!value || typeof value !== 'object') return ''
  const pairs = Object.entries(value as Record<string, unknown>)
  const words: string[] = []
  for (const [word, positions] of pairs) {
    if (!Array.isArray(positions)) continue
    for (const position of positions) if (Number.isInteger(position)) words[position as number] = word
  }
  return words.join(' ')
}
const work = (provider: LiteratureProvider, fields: Partial<LiteratureWork> & { sourceId: string }): LiteratureWork => ({
  id: fields.doi ? `doi:${normalizeDoi(fields.doi)}` : `${provider}:${fields.sourceId}`,
  title: cleanText(fields.title) || '未命名文献',
  authors: (fields.authors || []).map(cleanText).filter(Boolean),
  year: fields.year,
  venue: cleanText(fields.venue) || undefined,
  abstract: cleanText(fields.abstract) || undefined,
  doi: normalizeDoi(fields.doi),
  url: fields.url,
  citationCount: fields.citationCount,
  openAccess: fields.openAccess,
  sources: [provider],
  sourceIds: { [provider]: fields.sourceId },
})

async function getJson(url: URL, signal: AbortSignal, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(10000)
    const response = await fetch(url, { signal: AbortSignal.any([signal, timeout]), headers: { accept: 'application/json', ...headers } })
    if (response.ok) return response.json()
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 0) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay = Math.min(5000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800)
        await waitFor(delay, signal)
        continue
      }
      if (response.status === 429) throw new Error('来源限流，请稍后重试')
    }
    throw new Error(`HTTP ${response.status}`)
  }
  throw new Error('检索失败')
}

const adapters: Record<LiteratureProvider, ProviderAdapter> = {
  async openalex(query, limit, signal) {
    const url = new URL('https://api.openalex.org/works')
    url.searchParams.set('search', query)
    url.searchParams.set('per_page', String(Math.min(limit, 100)))
    url.searchParams.set('select', 'id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count,open_access')
    const json = await getJson(url, signal)
    return (json.results || []).map((item: any) => work('openalex', {
      sourceId: String(item.id || '').split('/').pop() || '', title: item.title, doi: item.doi,
      year: Number(item.publication_year) || undefined,
      authors: (item.authorships || []).map((entry: any) => entry.author?.display_name),
      venue: item.primary_location?.source?.display_name,
      abstract: abstractFromOpenAlex(item.abstract_inverted_index),
      citationCount: item.cited_by_count,
      openAccess: item.open_access?.is_oa,
      url: item.doi || item.id,
    }))
  },
  async crossref(query, limit, signal) {
    const url = new URL('https://api.crossref.org/works')
    url.searchParams.set('query.bibliographic', query)
    url.searchParams.set('rows', String(Math.min(limit, 100)))
    url.searchParams.set('select', 'DOI,title,author,published,created,container-title,URL,type,is-referenced-by-count')
    const json = await getJson(url, signal)
    return (json.message?.items || []).map((item: any) => work('crossref', {
      sourceId: String(item.DOI || item.URL || ''), title: item.title?.[0], doi: item.DOI,
      year: yearFromDate(item.published?.['date-parts']?.[0]?.join('-') || item.created?.['date-time']),
      authors: (item.author || []).map((entry: any) => [entry.given, entry.family].filter(Boolean).join(' ')),
      venue: item['container-title']?.[0], citationCount: item['is-referenced-by-count'], url: item.URL,
    }))
  },
  async semanticscholar(query, limit, signal) {
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search')
    url.searchParams.set('query', query)
    url.searchParams.set('limit', String(Math.min(limit, 100)))
    url.searchParams.set('fields', 'title,year,authors,venue,abstract,externalIds,url,citationCount,openAccessPdf')
    const json = await getJson(url, signal)
    return (json.data || []).map((item: any) => work('semanticscholar', {
      sourceId: String(item.paperId || ''), title: item.title, doi: item.externalIds?.DOI,
      year: Number(item.year) || undefined,
      authors: (item.authors || []).map((entry: any) => entry.name),
      venue: item.venue, abstract: item.abstract, citationCount: item.citationCount,
      openAccess: Boolean(item.openAccessPdf?.url), url: item.openAccessPdf?.url || item.url,
    }))
  },
}

function throughProviderQueue<T>(provider: LiteratureProvider, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const previous = providerQueues.get(provider) || Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    if (signal.aborted) throw new Error('检索已取消')
    const waitMs = Math.max(0, (providerLastRequest.get(provider) || 0) + providerIntervals[provider] - Date.now())
    if (waitMs) await waitFor(waitMs, signal)
    if (signal.aborted) throw new Error('检索已取消')
    providerLastRequest.set(provider, Date.now())
    return task()
  })
  providerQueues.set(provider, current.then(() => {}, () => {}))
  return current
}

function mergeWorks(works: LiteratureWork[]): LiteratureWork[] {
  const merged = new Map<string, LiteratureWork>()
  for (const item of works) {
    const titleKey = item.title.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const key = item.doi ? `doi:${normalizeDoi(item.doi)}` : `${titleKey}:${item.year || ''}`
    const prior = merged.get(key)
    if (!prior) { merged.set(key, { ...item, id: item.doi ? `doi:${normalizeDoi(item.doi)}` : key }); continue }
    prior.sources = [...new Set([...prior.sources, ...item.sources])]
    Object.assign(prior.sourceIds, item.sourceIds)
    for (const field of ['abstract', 'venue', 'url', 'citationCount', 'openAccess', 'year'] as const) {
      if ((prior[field] === undefined || prior[field] === '') && item[field] !== undefined) (prior as any)[field] = item[field]
    }
    if (item.authors.length > prior.authors.length) prior.authors = item.authors
    if (item.title.length > prior.title.length) prior.title = item.title
  }
  return [...merged.values()]
}

export function registerLiteratureSearch(ipcMain: IpcMain): void {
  ipcMain.handle('navora:literature.search', (event: IpcMainInvokeEvent, raw: LiteratureSearchInput) => {
    const query = String(raw?.query || '').trim().slice(0, 500)
    if (!query) throw new Error('请输入检索主题')
    const searchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    const controller = new AbortController()
    active.set(searchId, controller)
    const limit = clamp(raw?.limit, 10, 100, 40)
    const fromYear = raw?.fromYear ? clamp(raw.fromYear, 1500, 2200, 1500) : undefined
    const toYear = raw?.toYear ? clamp(raw.toYear, 1500, 2200, 2200) : undefined
    const selected = [...new Set((raw?.providers || providers).filter((provider): provider is LiteratureProvider => providers.includes(provider)))].slice(0, providers.length)
    const emit: Emit = payload => { if (!event.sender.isDestroyed()) event.sender.send('navora:literature.event', payload) }
    setImmediate(() => void runSearch({ searchId, query, selected, limit, fromYear, toYear, signal: controller.signal, emit }).finally(() => active.delete(searchId)))
    return { searchId }
  })
  ipcMain.handle('navora:literature.cancel', (_event, searchId: string) => {
    active.get(String(searchId || ''))?.abort()
  })
}

async function runSearch(args: { searchId: string; query: string; selected: LiteratureProvider[]; limit: number; fromYear?: number; toYear?: number; signal: AbortSignal; emit: Emit }) {
  const failed: LiteratureProvider[] = []
  const tasks = args.selected.map(async provider => {
    const emitStatus = (state: 'running' | 'complete' | 'failed' | 'cancelled', extra: { resultCount?: number; message?: string } = {}) => args.emit({ searchId: args.searchId, type: 'provider-status', provider, state, ...extra })
    if (args.signal.aborted) { emitStatus('cancelled'); return }
    emitStatus('running')
    try {
      const controller = new AbortController()
      const abort = () => controller.abort()
      args.signal.addEventListener('abort', abort, { once: true })
      const items = await throughProviderQueue(provider, controller.signal, () => adapters[provider](args.query, args.limit, controller.signal))
      args.signal.removeEventListener('abort', abort)
      const filtered = items.filter(item => (!args.fromYear || !item.year || item.year >= args.fromYear) && (!args.toYear || !item.year || item.year <= args.toYear))
      args.emit({ searchId: args.searchId, type: 'results-batch', provider, results: mergeWorks(filtered) })
      emitStatus('complete', { resultCount: filtered.length })
    } catch (error) {
      if (args.signal.aborted) emitStatus('cancelled')
      else { failed.push(provider); emitStatus('failed', { message: error instanceof Error ? error.message : '检索失败' }) }
    }
  })
  await Promise.all(tasks)
  args.emit({ searchId: args.searchId, type: 'search-summary', state: args.signal.aborted ? 'cancelled' : 'complete', failedProviders: failed })
}
