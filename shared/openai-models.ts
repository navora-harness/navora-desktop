/** OpenAI-compatible /v1/models helpers (Node/Electron fetch, no browser). */

export type OpenAiModelsListResult =
  | {
      ok: true
      baseUrl: string
      modelsUrl: string
      models: string[]
      count: number
    }
  | {
      ok: false
      error: string
      baseUrl?: string
      modelsUrl?: string
      status?: number
      bodyPreview?: string
    }

/** Normalize user URL into API base (`…/v1`) and models endpoint (`…/v1/models`). */
export function resolveOpenAiModelsEndpoints(rawUrl: string): {
  baseUrl: string
  modelsUrl: string
} {
  let u = String(rawUrl || '').trim()
  if (!u) throw new Error('url_required')
  // Allow host:port without scheme for localhost convenience
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `http://${u}`

  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    throw new Error('url_invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url_protocol_unsupported')
  }

  let path = parsed.pathname.replace(/\/+$/, '') || ''
  if (/\/models$/i.test(path)) {
    path = path.replace(/\/models$/i, '')
  }
  if (!/\/v1$/i.test(path)) {
    // bare origin or custom prefix → assume OpenAI-compatible /v1
    if (!path || path === '/') path = '/v1'
    else path = `${path}/v1`
  }

  parsed.pathname = path
  parsed.search = ''
  parsed.hash = ''
  const baseUrl = parsed.toString().replace(/\/+$/, '')
  const modelsUrl = `${baseUrl}/models`
  return { baseUrl, modelsUrl }
}

export function parseOpenAiModelsPayload(data: unknown): string[] {
  const ids: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.push(v.trim())
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const id = (v as { id?: unknown }).id
      if (typeof id === 'string' && id.trim()) ids.push(id.trim())
    }
  }

  if (Array.isArray(data)) {
    for (const row of data) push(row)
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) for (const row of obj.data) push(row)
    else if (Array.isArray(obj.models)) for (const row of obj.models) push(row)
  }

  return [...new Set(ids)]
}

export async function fetchOpenAiModelsList(opts: {
  url: string
  apiKey?: string | null
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<OpenAiModelsListResult> {
  let baseUrl: string
  let modelsUrl: string
  try {
    ;({ baseUrl, modelsUrl } = resolveOpenAiModelsEndpoints(opts.url))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'url_invalid' }
  }

  const timeoutMs = Math.min(120000, Math.max(3000, Math.floor(opts.timeoutMs ?? 20000)))
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const key = String(opts.apiKey || '').trim()
    if (key) headers.Authorization = `Bearer ${key}`

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        baseUrl,
        modelsUrl,
        status: res.status,
        bodyPreview: text.slice(0, 400),
      }
    }

    let data: unknown
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      return {
        ok: false,
        error: 'response_not_json',
        baseUrl,
        modelsUrl,
        bodyPreview: text.slice(0, 400),
      }
    }

    const models = parseOpenAiModelsPayload(data)
    if (!models.length) {
      return {
        ok: false,
        error: 'models_empty',
        baseUrl,
        modelsUrl,
        bodyPreview: text.slice(0, 400),
      }
    }

    return { ok: true, baseUrl, modelsUrl, models, count: models.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const aborted = msg === 'aborted' || /aborted|AbortError/i.test(msg)
    return {
      ok: false,
      error: aborted ? 'timeout_or_aborted' : `fetch_failed:${msg}`,
      baseUrl,
      modelsUrl,
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
