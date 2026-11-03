/** Usage reported by the provider for one request, never an estimated value. */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
}

export type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export function normalizeModelUsage(raw: unknown): ModelUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const usage = raw as Record<string, unknown>
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const input = usage.inputTokens ?? usage.prompt_tokens
  const output = usage.outputTokens ?? usage.completion_tokens
  if (!count(input) || !count(output)) return undefined
  const total = usage.totalTokens ?? usage.total_tokens ?? input + output
  if (!count(total) || total < input + output) return undefined
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
  const cached = usage.cachedInputTokens ?? details?.cached_tokens
  return { inputTokens: input, outputTokens: output, totalTokens: total, ...(count(cached) && cached <= input ? { cachedInputTokens: cached } : {}) }
}
