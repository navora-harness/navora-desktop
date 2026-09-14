import type { AppConfig, AiProviderConfig } from './config'

/** Sections the Agent may read/write. `permissions` is intentionally excluded. */
const SETTINGS_SECTIONS = [
  'app',
  'browser',
  'files',
  'ai',
  'fork_decision',
  'subchat',
  'remote',
] as const

/** Hard-blocked for Agent (user-only in Settings / per-chat permission UI). */
export const AGENT_FORBIDDEN_SETTING_SECTIONS = ['permissions'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function isSettingsSection(v: string): v is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(v)
}

export function isAgentForbiddenSettingSection(v: string): boolean {
  return (AGENT_FORBIDDEN_SETTING_SECTIONS as readonly string[]).includes(v)
}

export function listSettingsSections(): SettingsSection[] {
  return [...SETTINGS_SECTIONS]
}

const PERMISSIONS_FORBIDDEN_HINT =
  '权限设置仅能由用户在「设置 → 权限」或本会话权限面板中查看/修改，Agent 不可访问。'

/** Public view of config for Agent / UI export (no password hashes; no permissions). */
export function sanitizeConfigForAgent(
  cfg: AppConfig,
  sections?: string[] | null,
): Record<string, unknown> {
  const requested = Array.isArray(sections)
    ? sections.map((s) => String(s || '').trim()).filter(Boolean)
    : null
  const all = !requested || requested.length === 0
  const want = new Set(
    (requested || []).filter((s): s is SettingsSection => isSettingsSection(s)),
  )
  // Requested only forbidden/unknown sections → empty (do not fall through to "all").
  if (!all && want.size === 0) return {}

  const out: Record<string, unknown> = {}

  if (all || want.has('app')) out.app = structuredClone(cfg.app)
  if (all || want.has('browser')) out.browser = structuredClone(cfg.browser)
  if (all || want.has('files')) out.files = structuredClone(cfg.files)
  if (all || want.has('fork_decision')) out.fork_decision = structuredClone(cfg.fork_decision)
  if (all || want.has('subchat')) out.subchat = structuredClone(cfg.subchat)
  if (all || want.has('ai')) {
    out.ai = {
      default_provider: cfg.ai.default_provider,
      max_tool_rounds: cfg.ai.max_tool_rounds,
      continue_tool_rounds: cfg.ai.continue_tool_rounds,
      providers: cfg.ai.providers.map(sanitizeProvider),
    }
  }
  if (all || want.has('remote')) {
    out.remote = {
      enabled: cfg.remote.enabled,
      host: cfg.remote.host,
      port: cfg.remote.port,
      username: cfg.remote.username,
      passwordConfigured: Boolean(cfg.remote.passwordHash),
    }
  }
  return out
}

function sanitizeProvider(p: AiProviderConfig): Record<string, unknown> {
  return {
    id: p.id,
    type: p.type,
    label: p.label,
    base_url: p.base_url,
    api_key_ref: p.api_key_ref,
    model: p.model,
    models: [...(p.models || [])],
    timeout_ms: p.timeout_ms,
    ...(p.source_preset ? { source_preset: p.source_preset } : {}),
    note: 'API Key 存于密钥库，不在此返回；请在设置页填写。',
  }
}

export type SettingsUpdateResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string; hint?: string }

/**
 * Validate & normalize an Agent settings patch.
 * Strips secrets; allows remote.password (plain) for hash update by caller.
 * Rejects permissions entirely.
 */
export function prepareSettingsPatch(raw: unknown): SettingsUpdateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'patch_must_be_object' }
  }
  const src = raw as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  for (const key of Object.keys(src)) {
    if (isAgentForbiddenSettingSection(key)) {
      return {
        ok: false,
        error: 'permissions_section_forbidden',
        hint: PERMISSIONS_FORBIDDEN_HINT,
      }
    }
    if (!isSettingsSection(key)) {
      return { ok: false, error: `unknown_section:${key}` }
    }
    const section = src[key]
    if (section === undefined) continue
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      return { ok: false, error: `section_must_be_object:${key}` }
    }

    if (key === 'remote') {
      const r = section as Record<string, unknown>
      if ('passwordHash' in r) {
        return { ok: false, error: 'remote.passwordHash_forbidden_use_password' }
      }
      const next: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) {
        if (k === 'password') {
          if (v != null && typeof v !== 'string') {
            return { ok: false, error: 'remote.password_must_be_string' }
          }
          if (typeof v === 'string' && v.trim()) next.password = v
          continue
        }
        next[k] = v
      }
      patch.remote = next
      continue
    }

    if (key === 'ai') {
      const a = section as Record<string, unknown>
      if (Array.isArray(a.providers)) {
        for (const p of a.providers) {
          if (!p || typeof p !== 'object' || Array.isArray(p)) {
            return { ok: false, error: 'ai.providers_invalid' }
          }
          const row = p as Record<string, unknown>
          if ('api_key' in row || 'apiKey' in row) {
            return { ok: false, error: 'ai.api_key_forbidden_use_settings_ui' }
          }
        }
      }
      patch.ai = structuredClone(a)
      continue
    }

    patch[key] = structuredClone(section)
  }

  if (!Object.keys(patch).length) return { ok: false, error: 'empty_patch' }
  return { ok: true, patch }
}

export function permissionsForbiddenHint(): string {
  return PERMISSIONS_FORBIDDEN_HINT
}
