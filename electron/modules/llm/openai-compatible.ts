import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessageParam,
  ChatCompletionTool,
  ToolCall,
} from '../../shared/openai-types'

export type OpenAIClientOptions = {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

export type ChatRequestOptions = {
  temperature?: number
  maxTokens?: number
  /** Per-request timeout; falls back to client default. */
  timeoutMs?: number
}

function isAbortLike(e: unknown): boolean {
  if (!e) return false
  if (typeof e === 'object' && e !== null && 'name' in e && (e as { name?: string }).name === 'AbortError') {
    return true
  }
  const msg = e instanceof Error ? e.message : String(e)
  return /aborted|AbortError|The operation was aborted|This operation was aborted/i.test(msg)
}

function looksLikeLocalBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl)
    const host = u.hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local')
    )
  } catch {
    return /127\.0\.0\.1|localhost/i.test(baseUrl)
  }
}

/** Local / Ollama-style servers are often slow with large tool schemas. */
export function resolveLlmTimeoutMs(baseUrl: string, configuredMs: number | undefined): number {
  const raw = Number(configuredMs)
  const configured = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120000
  if (looksLikeLocalBaseUrl(baseUrl)) return Math.max(configured, 300000)
  return configured
}

export class OpenAICompatibleClient {
  private opts: OpenAIClientOptions

  constructor(opts: OpenAIClientOptions) {
    this.opts = opts
  }

  private endpoint(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '')
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  }

  async chat(
    messages: ChatMessageParam[],
    tools: ChatCompletionTool[],
    signal?: AbortSignal,
    reqOpts?: ChatRequestOptions,
  ): Promise<{
    content: string | null
    reasoningContent?: string | null
    tool_calls?: ToolCall[]
    finish_reason: string | null
  }> {
    if (signal?.aborted) throw new Error('aborted')

    const body: ChatCompletionRequest = {
      model: this.opts.model,
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      stream: false,
      temperature: reqOpts?.temperature ?? 0.2,
      ...(reqOpts?.maxTokens != null ? { max_tokens: reqOpts.maxTokens } : {}),
    }

    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      signal.removeEventListener('abort', onAbort)
      throw new Error('aborted')
    }

    const timeoutMs = Math.max(
      1000,
      Math.floor(reqOpts?.timeoutMs ?? this.opts.timeoutMs ?? 120000),
    )
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, timeoutMs)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      const key = String(this.opts.apiKey || '').trim()
      if (key) headers.Authorization = `Bearer ${key}`

      const res = await fetch(this.endpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `llm_auth_${res.status}:服务端要求鉴权。可在对话中提供 API Key，或到设置 → 模型中填写后重试。${truncate(text, 200)}`,
          )
        }
        throw new Error(`llm_http_${res.status}:${truncate(text, 500)}`)
      }
      const data = (await res.json()) as ChatCompletionResponse
      const choice = data.choices?.[0]
      if (!choice) throw new Error('llm_empty_choices')
      return {
        content: choice.message.content,
        reasoningContent: choice.message.reasoning_content ?? null,
        tool_calls: choice.message.tool_calls,
        finish_reason: choice.finish_reason,
      }
    } catch (e) {
      if (signal?.aborted && !timedOut) throw new Error('aborted')
      if (timedOut || (isAbortLike(e) && !signal?.aborted)) {
        const sec = Math.round(timeoutMs / 1000)
        throw new Error(
          `llm_timeout:模型响应超时（${sec}s）。可在「设置 → 模型」增大超时后重试。`,
        )
      }
      if (isAbortLike(e)) throw new Error('aborted')
      throw e
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
