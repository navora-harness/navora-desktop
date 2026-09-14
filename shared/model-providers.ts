/** Helpers to build / reset the user-editable `ai.providers` list. */

import type { AiProviderConfig } from './config'
import { MODEL_PRESETS, type ModelPreset, findModelPreset } from './model-presets'

/** Legacy / default-config ids that do not match `MODEL_PRESETS[].id`. */
const PRESET_ID_ALIASES: Record<string, string> = {
  openai_compatible: 'openai',
}

export function allocProviderId(base: string, existingIds: Iterable<string>): string {
  const used = new Set(existingIds)
  const root = String(base || 'provider')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'provider'
  if (!used.has(root)) return root
  let n = 2
  while (used.has(`${root}_${n}`)) n += 1
  return `${root}_${n}`
}

/**
 * Stable secrets path for a provider id.
 * `openai_compatible` (legacy default id) maps to the OpenAI preset ref `secrets/openai`.
 */
export function stockApiKeyRef(providerId: string): string {
  const id = String(providerId || '').trim()
  if (!id) return 'secrets/custom'
  const alias = PRESET_ID_ALIASES[id]
  const preset = findModelPreset(alias || id)
  if (preset && (preset.id === id || alias === preset.id)) return preset.api_key_ref
  return `secrets/${id}`
}

/**
 * Normalize a selectable model id list.
 * `fallbackModel` is only used when the list is empty — a missing active model
 * is NOT forced back into an explicit list (Settings: drop → pick models[0]).
 */
export function normalizeModelList(models: unknown, fallbackModel: string): string[] {
  const raw = Array.isArray(models) ? models : []
  const list = raw
    .map((m) => String(m || '').trim())
    .filter(Boolean)
  const fb = String(fallbackModel || '').trim()
  if (!list.length && fb) list.push(fb)
  if (!list.length) list.push('gpt-4.1')
  return [...new Set(list)]
}

/** Ensure `models` exists and `model` is one of them. Mutates in place. */
export function normalizeProvider(p: AiProviderConfig): AiProviderConfig {
  const models = normalizeModelList(p.models, p.model)
  let model = String(p.model || '').trim()
  if (!model || !models.includes(model)) model = models[0]
  p.models = models
  p.model = model
  if (!String(p.api_key_ref || '').trim()) p.api_key_ref = stockApiKeyRef(p.id)
  return p
}

export function providerFromPreset(
  preset: ModelPreset,
  existingIds: Iterable<string> = [],
  id?: string,
): AiProviderConfig {
  const providerId = id || allocProviderId(preset.id, existingIds)
  const models = normalizeModelList(preset.models, preset.model)
  return {
    id: providerId,
    type: 'openai_compatible',
    label: preset.label,
    base_url: preset.base_url,
    api_key_ref: stockApiKeyRef(providerId),
    model: models.includes(preset.model) ? preset.model : models[0],
    models,
    timeout_ms: preset.timeout_ms ?? 120000,
    source_preset: preset.id,
  }
}

/** Factory list used by「重置预设」— one entry per built-in preset (incl. custom template). */
export function defaultProviderList(): AiProviderConfig[] {
  return MODEL_PRESETS.map((p) => providerFromPreset(p, [], p.id))
}

export function newCustomProvider(existingIds: Iterable<string> = []): AiProviderConfig {
  const id = allocProviderId('custom', existingIds)
  return {
    id,
    type: 'openai_compatible',
    label: '自定义',
    base_url: 'https://api.openai.com/v1',
    api_key_ref: `secrets/${id}`,
    model: 'gpt-4.1',
    models: ['gpt-4.1'],
    timeout_ms: 120000,
    source_preset: 'custom',
  }
}

export function addProviderFromPresetId(
  presetId: string,
  existing: AiProviderConfig[],
): AiProviderConfig | null {
  const preset = findModelPreset(presetId)
  if (!preset) return null
  return providerFromPreset(
    preset,
    existing.map((p) => p.id),
  )
}

/** Prefer first listed provider (preset order). */
export function pickDefaultProviderId(providers: AiProviderConfig[]): string {
  if (!providers.length) return ''
  return providers[0].id
}

function cloneProvider(p: AiProviderConfig): AiProviderConfig {
  return normalizeProvider({
    ...p,
    models: [...(p.models || [])],
  })
}

function asProviderRow(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id || '').trim()
}

function rowBaseUrl(row: Record<string, unknown>): string {
  return String(row.base_url || '').trim()
}

function rowHasModelInfo(row: Record<string, unknown>): boolean {
  const model = String(row.model || '').trim()
  if (model) return true
  return Array.isArray(row.models) && row.models.some((m) => String(m || '').trim())
}

/** Full provider row from Settings UI / app_provider_add — safe to replace the list. */
export function isCompleteProviderRow(row: Record<string, unknown>): boolean {
  return Boolean(rowId(row) && rowBaseUrl(row) && rowHasModelInfo(row))
}

function resolveProviderSeed(
  id: string,
  row: Record<string, unknown>,
  seeds: AiProviderConfig[],
): AiProviderConfig | undefined {
  const fromList = seeds.find((p) => p.id === id)
  if (fromList && !looksLikeStrippedFallback(fromList as unknown as Record<string, unknown>)) {
    return cloneProvider(fromList)
  }
  const presetKey =
    String(row.source_preset || '').trim() || id || PRESET_ID_ALIASES[id] || ''
  let preset =
    findModelPreset(presetKey) ||
    (PRESET_ID_ALIASES[id] ? findModelPreset(PRESET_ID_ALIASES[id]) : undefined)
  // `custom` template is OpenAI's URL + gpt-4.1; never use it to "repair" a stripped row.
  if (preset?.id === 'custom' && looksLikeStrippedFallback(row)) preset = undefined
  if (!preset) return fromList ? cloneProvider(fromList) : undefined
  return providerFromPreset(preset, [], id)
}

/**
 * Incomplete patch leftover (only id + timeout_ms, then normalize filled gpt-4.1).
 * Restore identity + model list from a known seed when base_url is gone.
 */
function looksLikeStrippedFallback(row: Record<string, unknown>): boolean {
  if (rowBaseUrl(row)) return false
  const models = Array.isArray(row.models)
    ? row.models.map((m) => String(m || '').trim()).filter(Boolean)
    : []
  const model = String(row.model || '').trim()
  return (
    (models.length === 0 || (models.length === 1 && models[0] === 'gpt-4.1')) &&
    (!model || model === 'gpt-4.1')
  )
}

export function hydrateProvider(
  raw: unknown,
  seeds: AiProviderConfig[] = [],
): AiProviderConfig | null {
  const row = asProviderRow(raw)
  if (!row) return null
  const id = rowId(row)
  if (!id) return null
  const seed = resolveProviderSeed(id, row, seeds)
  const stripped = looksLikeStrippedFallback(row)
  const merged = {
    type: 'openai_compatible' as AiProviderConfig['type'],
    label: id,
    base_url: '',
    api_key_ref: stockApiKeyRef(id),
    model: '',
    models: [] as string[],
    timeout_ms: 120000,
    ...(seed || {}),
    ...row,
    id,
  }
  if (seed && (stripped || !('models' in row))) merged.models = [...seed.models]
  if (seed && (stripped || row.model == null || row.model === '')) merged.model = seed.model
  if (stripped && seed) {
    if (!rowBaseUrl(row)) merged.base_url = seed.base_url
    if (row.label == null || row.label === '') merged.label = seed.label
    if (row.type == null || row.type === '') merged.type = seed.type
    if (row.source_preset == null && seed.source_preset) merged.source_preset = seed.source_preset
  }
  // Always recover a usable secrets path (agent timeout-only patches wipe api_key_ref).
  if (!String(merged.api_key_ref || '').trim()) {
    merged.api_key_ref = seed?.api_key_ref || stockApiKeyRef(id)
  }
  // Legacy default id used secrets/openai; don't keep the mistaken secrets/openai_compatible.
  if (id === 'openai_compatible' && merged.api_key_ref === 'secrets/openai_compatible') {
    merged.api_key_ref = 'secrets/openai'
  }
  return normalizeProvider(merged as AiProviderConfig)
}

/** Fill missing fields on a loaded provider list. Does not add/remove entries. */
export function hydrateProviderList(
  loaded: unknown,
  seeds: AiProviderConfig[] = [],
): AiProviderConfig[] {
  if (!Array.isArray(loaded) || loaded.length === 0) {
    return seeds.length ? seeds.map(cloneProvider) : defaultProviderList()
  }
  const out: AiProviderConfig[] = []
  for (const row of loaded) {
    const next = hydrateProvider(row, seeds)
    if (next) out.push(next)
  }
  return out.length ? out : seeds.length ? seeds.map(cloneProvider) : defaultProviderList()
}

/**
 * Apply a providers patch.
 * Complete rows (id + base_url + models/model) replace the list (Settings / app_provider_add).
 * Partial rows are merged by id so `{ id, timeout_ms }` cannot wipe models.
 */
export function mergeProviderList(
  existing: AiProviderConfig[],
  incoming: unknown,
): AiProviderConfig[] {
  if (!Array.isArray(incoming)) return existing.map(cloneProvider)
  const rows = incoming.map(asProviderRow).filter((r): r is Record<string, unknown> => Boolean(r))
  if (!rows.length) return existing.map(cloneProvider)

  const replace = rows.every(isCompleteProviderRow)
  if (replace) {
    const out: AiProviderConfig[] = []
    for (const row of rows) {
      const next = hydrateProvider(row, existing)
      if (next) out.push(next)
    }
    return out.length ? out : existing.map(cloneProvider)
  }

  const out = existing.map(cloneProvider)
  for (const row of rows) {
    const id = rowId(row)
    if (!id) continue
    const idx = out.findIndex((p) => p.id === id)
    if (idx >= 0) {
      const next = hydrateProvider({ ...out[idx], ...row, id }, existing)
      if (next) out[idx] = next
      continue
    }
    const canAdd = isCompleteProviderRow(row) || Boolean(resolveProviderSeed(id, row, existing))
    if (!canAdd) continue
    const next = hydrateProvider(row, existing)
    if (next) out.push(next)
  }
  return out
}

export function ensureDefaultProvider(cfg: {
  default_provider: string
  providers: AiProviderConfig[]
}): void {
  if (!cfg.providers.length) {
    cfg.providers = defaultProviderList()
  }
  for (const p of cfg.providers) normalizeProvider(p)
  if (!cfg.providers.some((p) => p.id === cfg.default_provider)) {
    cfg.default_provider = pickDefaultProviderId(cfg.providers)
  }
}

export function resolveProvider(
  providers: AiProviderConfig[],
  defaultProviderId: string,
  chatProviderId?: string | null,
): AiProviderConfig | undefined {
  let pick: AiProviderConfig | undefined
  if (chatProviderId) {
    pick = providers.find((p) => p.id === chatProviderId)
  }
  if (!pick) pick = providers.find((p) => p.id === defaultProviderId) || providers[0]
  if (!pick) return undefined
  return normalizeProvider({
    ...pick,
    models: [...(pick.models || [])],
  })
}

export function resolveModelName(
  provider: AiProviderConfig | undefined,
  chatModel?: string | null,
): string {
  if (!provider) return ''
  normalizeProvider(provider)
  const want = String(chatModel || '').trim()
  if (want && provider.models.includes(want)) return want
  return provider.model
}
