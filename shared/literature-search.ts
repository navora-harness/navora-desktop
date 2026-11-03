export type LiteratureProvider = 'openalex' | 'crossref' | 'semanticscholar'

export interface LiteratureWork {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  url?: string
  citationCount?: number
  openAccess?: boolean
  sources: LiteratureProvider[]
  sourceIds: Partial<Record<LiteratureProvider, string>>
}

export interface LiteratureSearchInput {
  query: string
  providers?: LiteratureProvider[]
  fromYear?: number
  toYear?: number
  limit?: number
}

export type LiteratureSearchEvent =
  | { searchId: string; type: 'provider-status'; provider: LiteratureProvider; state: 'running' | 'complete' | 'failed' | 'cancelled'; resultCount?: number; message?: string }
  | { searchId: string; type: 'results-batch'; provider: LiteratureProvider; results: LiteratureWork[] }
  | { searchId: string; type: 'search-summary'; state: 'complete' | 'cancelled'; failedProviders: LiteratureProvider[] }

export interface LiteratureApi {
  search(input: LiteratureSearchInput): Promise<{ searchId: string }>
  cancel(searchId: string): Promise<void>
  onEvent(callback: (event: LiteratureSearchEvent) => void): () => void
}
