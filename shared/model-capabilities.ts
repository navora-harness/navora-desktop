import type { AiProviderConfig } from './config'

export type ReasoningLevel = { id: string; value: string }
export type ModelCapabilities = {
  label: string
  context_window: number
  max_output_tokens: number
  input_types: ('text' | 'image')[]
  reasoning: { enabled: boolean; default: string; levels: ReasoningLevel[] }
}

export function defaultModelCapabilities(label = ''): ModelCapabilities {
  return {
    label, context_window: 128000, max_output_tokens: 8192, input_types: ['text'],
    reasoning: { enabled: false, default: 'medium', levels: [
      { id: 'off', value: 'none' }, { id: 'low', value: 'low' },
      { id: 'medium', value: 'medium' }, { id: 'high', value: 'high' }, { id: 'xhigh', value: 'xhigh' },
    ] },
  }
}

export function normalizeModelCapabilities(raw: Partial<ModelCapabilities> | undefined, id = ''): ModelCapabilities {
  const defaults = defaultModelCapabilities(id)
  const positive = (value: unknown, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.min(10000000, Math.floor(n)) : fallback
  }
  const context = Math.max(1024, positive(raw?.context_window, defaults.context_window))
  const seen = new Set<string>()
  const levels = (Array.isArray(raw?.reasoning?.levels) ? raw.reasoning.levels : defaults.reasoning.levels)
    .filter(level => level && typeof level.id === 'string' && level.id.trim() && !seen.has(level.id.trim()) && seen.add(level.id.trim()))
    .map(level => ({ id: level.id.trim().slice(0, 40), value: String(level.value ?? '').trim().slice(0, 100) }))
  const preferred = raw?.reasoning?.default || defaults.reasoning.default
  return {
    label: String(raw?.label || id), context_window: context,
    max_output_tokens: Math.min(context - 1, positive(raw?.max_output_tokens, defaults.max_output_tokens)),
    input_types: raw?.input_types?.includes('image') ? ['text', 'image'] : ['text'],
    reasoning: { enabled: raw?.reasoning?.enabled === true, default: levels.some(l => l.id === preferred) ? preferred : levels[0]?.id || '', levels },
  }
}

export function modelCapabilities(provider: AiProviderConfig | undefined, model: string): ModelCapabilities {
  return normalizeModelCapabilities(provider?.model_settings?.[model], model)
}

export function reasoningValue(settings: ModelCapabilities, selected?: string): string | undefined {
  if (!settings.reasoning.enabled) return undefined
  const level = settings.reasoning.levels.find(l => l.id === selected) || settings.reasoning.levels.find(l => l.id === settings.reasoning.default)
  return level?.value || undefined
}

/** User-supplied endpoint/catalog, not a claim about public model availability. */
export function cloudbypassModelSettings(): Record<string, ModelCapabilities> {
  const model = defaultModelCapabilities('SC117 512K IQ3_XXS MT')
  model.context_window = 524288
  model.max_output_tokens = 81920
  model.input_types = ['text', 'image']
  model.reasoning.enabled = true
  model.reasoning.default = 'low'
  model.reasoning.levels.find(l => l.id === 'high')!.value = 'xhigh'
  return { 'qwen38-turbo-q6': model }
}
