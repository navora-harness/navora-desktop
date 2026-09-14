import type { PermissionCapability, PermissionMode, PermissionPreset } from './types'
import { DEFAULT_EDGE_UA } from './types'
import { findUaPresetByUa, getUaPreset } from './ua-presets'

/** Default remote password "admin" (scrypt). Kept here so renderer can import config without node:crypto. */
export const DEFAULT_REMOTE_PASSWORD_HASH =
  'scrypt$84d1e3974951ea77e6bb823dbe9a2d67$a43bac39a620e3d129cb2f2c81442cf917d292d716d9457c56ac486d0398b8fd'

/** True when remote still uses the shipped default password hash (settings shows a warning). */
export function isDefaultRemotePasswordHash(hash: string | null | undefined): boolean {
  return Boolean(hash && hash === DEFAULT_REMOTE_PASSWORD_HASH)
}

/** Default basename allowlist for shell_exec (no path separators). */
export const DEFAULT_SHELL_ALLOWLIST = [
  'git',
  'node',
  'npm',
  'npx',
  'navora-plugin',
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'dir',
  'ls',
  'echo',
  'type',
  'cat',
  'where',
  'which',
  'powershell',
  'pwsh',
] as const

export type WaitConfig = {
  load: boolean
  network_idle: boolean
  network_idle_ms: number
  delay_ms: number
}

export type RemoteAccessConfig = {
  enabled: boolean
  host: string
  port: number
  username: string
  /** scrypt hash; empty means unset */
  passwordHash: string
}

/** Agent path-fork / ask-user decision UX */
export type ForkDecisionConfig = {
  /** Master switch: allow agent_ask_user at path forks (default true) */
  enabled: boolean
  /** Allow free-text custom answers in the choice dialog (default true) */
  allow_custom: boolean
  /** Show per-option consequence hints when the model provides them (default true) */
  option_hints: boolean
  /** Attach current page evidence (url / title / snippet) to the dialog (default true) */
  context_evidence: boolean
  /** Highlight the model’s recommended option (default true) */
  recommended: boolean
  /** Reuse the same answer for similar asks within one Chat (default true) */
  remember_in_chat: boolean
  /** Present low-risk asks as inline chips instead of a modal (default false) */
  inline_low_risk: boolean
  /** Allow revising a past decision from the timeline and continuing (default false) */
  allow_revise: boolean
  /** How long to wait for a user choice before timing out (default 60000; 0 = wait forever) */
  ask_timeout_ms: number
}

/** Fresh default fork_decision block (safe to mutate after copy). */
export function createDefaultForkDecision(): ForkDecisionConfig {
  return {
    enabled: true,
    allow_custom: true,
    option_hints: true,
    context_evidence: true,
    recommended: true,
    remember_in_chat: true,
    inline_low_risk: false,
    allow_revise: false,
    ask_timeout_ms: 60000,
  }
}

/** Concurrent sub-chat (parallel child Agent) settings */
export type SubchatConfig = {
  /** Master switch: allow agent_spawn_subchat / await / status (default true) */
  enabled: boolean
  /**
   * Max concurrent running sub-chats per parent chat (default 4).
   * Does not count the parent itself — so 4 means four children can run alongside the parent.
   */
  max_parallel: number
}

export const SUBCHAT_MAX_PARALLEL_MIN = 1
export const SUBCHAT_MAX_PARALLEL_MAX = 8

/** Fresh default subchat block (safe to mutate after copy). */
export function createDefaultSubchat(): SubchatConfig {
  return {
    enabled: true,
    max_parallel: 4,
  }
}

export type AiProviderConfig = {
  id: string
  type: 'openai_compatible' | 'anthropic' | 'gemini' | 'ollama' | 'custom'
  label: string
  base_url: string
  api_key_ref: string
  /** Active / default model id for this provider */
  model: string
  /** Selectable model ids (must include `model`) */
  models: string[]
  timeout_ms: number
  /** Built-in template id this entry was created from (`custom` for user-defined). */
  source_preset?: string
}

export type AppConfig = {
  app: {
    language: string
    close_to_tray: boolean
    /**
     * Show the main window after launch (default true).
     * Legacy `start_minimized` in older config.yml is migrated on load.
     */
    show_main_on_start: boolean
    /** Show suggested follow-up prompts after an Agent reply finishes */
    show_followup_suggestions: boolean
    /** Use AI to generate a short chat title after the first successful reply */
    ai_generate_chat_title: boolean
    /** Show “已阅读 N 个网页” summary + dialog for pages whose content was read */
    show_read_pages: boolean
    /** Show collapsible system/op logs in chat (does not hide tool calls) */
    show_run_logs: boolean
    /** Collapse consecutive tool calls (+ logs) into a summary row.
     * During a run shows the current step; when finished stays collapsed until clicked.
     */
    collapse_tool_runs: boolean
    /**
     * When tool-run collapse is off: fold consecutive run logs into a summary row (default true).
     * Disabled in Settings while collapse_tool_runs is on (logs always join the tool summary then),
     * or while show_run_logs is off.
     */
    collapse_run_logs: boolean
    /** Max characters in the chat composer / draft (default 16000). */
    max_composer_chars: number
    /** First-run welcome wizard finished or skipped (default false → show on launch) */
    onboarding_completed: boolean
  }
  browser: {
    default_ua_preset: string
    custom_ua: string
    accept_language: string
    show_agent_windows: boolean
    default_width: number
    default_height: number
    navigation_timeout_ms: number
    action_timeout_ms: number
    wait: WaitConfig
    page_get_max_chars: number
    network_log_buffer: number
    evaluate_world_id: number
    evaluate_code_max_chars: number
    evaluate_result_max_chars: number
    fetch_timeout_ms: number
    fetch_max_body_chars: number
    fetch_max_body_bytes: number
    block_window_open: boolean
    url_allowlist: string[]
    max_windows_total: number
    max_fetch_inflight: number
    max_parallel_agent_chats: number
    tree_update_debounce_ms: number
  }
  files: {
    /** Relative to dataRoot; each Chat uses workspace/<chatId>/ when custom_root is empty */
    root_dirname: string
    /**
     * Absolute custom workspace parent. When set, each chat uses
     * `{custom_root}/{chatId}/` instead of dataRoot/root_dirname.
     */
    custom_root: string
    max_read_chars: number
    max_write_bytes: number
    max_list_entries: number
    download_timeout_ms: number
    download_max_bytes: number
    shell_timeout_ms: number
    shell_timeout_ms_max: number
    shell_max_output_chars: number
    /** Allowed command basenames for shell_exec (empty = deny all). */
    shell_allowlist: string[]
    /** If false (default), shell_exec always uses spawn(..., { shell: false }). */
    shell_allow_shell_flag: boolean
  }
  permissions: {
    preset: PermissionPreset
    confirm_timeout_ms: number
    user_intent_bypass_ask: boolean
    modes: Record<PermissionCapability, PermissionMode>
  }
  ai: {
    default_provider: string
    providers: AiProviderConfig[]
    /** Max LLM rounds (thinking + tool cycle) per user message */
    max_tool_rounds: number
    /** Extra rounds granted when user chooses to continue after hitting the limit */
    continue_tool_rounds: number
  }
  /** Path-fork / user-choice decision behavior */
  fork_decision: ForkDecisionConfig
  /** Parallel sub-conversation (child Agent) behavior */
  subchat: SubchatConfig
  remote: RemoteAccessConfig
  /** Local testing store (navora-store serve / file catalog root). */
  store: {
    /** http(s) base or file path / file URL to catalog root. Default http://127.0.0.1:8791 */
    base_url: string
  }
  /** Plugin authoring aids (SDK prompt + linked dist auto-reload). */
  plugins: {
    /**
     * When true: inject plugin SDK contract into Agent system prompt,
     * and auto-reload linked (dev) plugins when their dist folder changes.
     */
    dev_mode: boolean
  }
}

export const BALANCED_PERMISSION_MODES: Record<PermissionCapability, PermissionMode> = {
  'session.create': 'allow',
  'session.persist': 'ask',
  'session.close': 'allow',
  'session.clear': 'allow',
  'session.set_proxy': 'ask',
  'session.set_ua': 'ask_chat',
  'session.cookies_read': 'ask_chat',
  'session.cookies_write': 'ask',
  'session.fetch': 'allow_notify',
  'window.create': 'allow',
  'window.close': 'allow',
  'window.set_visible': 'allow',
  navigate: 'allow_notify',
  wait: 'allow',
  click: 'allow',
  type: 'ask_chat',
  get_page: 'allow',
  evaluate: 'ask',
  screenshot: 'allow_notify',
  'desktop.screenshot': 'ask',
  'network.observe': 'allow',
  'network.modify': 'ask',
  'network.block': 'ask',
  'file.read': 'allow',
  'file.write': 'ask',
  'file.download': 'ask',
  'file.download.passive': 'ask',
  'shell.open': 'ask',
  'shell.exec': 'ask',
  'settings.read': 'allow',
  'settings.write': 'ask',
  'skills.write': 'ask',
  'browser.geolocation': 'ask',
  'compute.local': 'allow',
}

/** Capabilities treated as higher-risk under balanced defaults. */
export const DANGEROUS_PERMISSION_CAPABILITIES: PermissionCapability[] = [
  'session.persist',
  'session.set_proxy',
  'session.cookies_write',
  'evaluate',
  'desktop.screenshot',
  'network.modify',
  'network.block',
  'file.write',
  'file.download',
  'file.download.passive',
  'shell.open',
  'shell.exec',
  'settings.write',
  'skills.write',
  'browser.geolocation',
]

export function modesForPreset(preset: PermissionPreset): Record<PermissionCapability, PermissionMode> {
  if (preset === 'custom') return { ...BALANCED_PERMISSION_MODES }
  if (preset === 'balanced') return { ...BALANCED_PERMISSION_MODES }
  if (preset === 'conservative') {
    const modes = { ...BALANCED_PERMISSION_MODES }
    for (const k of Object.keys(modes) as PermissionCapability[]) {
      if (modes[k] === 'allow') modes[k] = 'ask_chat'
      else if (modes[k] === 'allow_notify') modes[k] = 'ask'
    }
    for (const k of DANGEROUS_PERMISSION_CAPABILITIES) modes[k] = 'ask'
    modes['session.cookies_write'] = 'deny'
    modes.evaluate = 'deny'
    modes['network.modify'] = 'deny'
    modes['network.block'] = 'deny'
    modes['shell.exec'] = 'deny'
    return modes
  }
  // open / 放手：除技能写入外全部直接放行（不再弹确认）。
  const modes = { ...BALANCED_PERMISSION_MODES }
  for (const k of Object.keys(modes) as PermissionCapability[]) {
    modes[k] = 'allow'
  }
  // Skill create/update must always prompt (never silent allow).
  modes['skills.write'] = 'ask'
  return modes
}

export function detectPermissionPreset(
  modes: Record<PermissionCapability, PermissionMode>,
): PermissionPreset {
  for (const preset of ['conservative', 'balanced', 'open'] as const) {
    const expect = modesForPreset(preset)
    let same = true
    for (const k of Object.keys(expect) as PermissionCapability[]) {
      if (modes[k] !== expect[k]) {
        same = false
        break
      }
    }
    if (same) return preset
  }
  return 'custom'
}

/** Fill missing capability keys (e.g. after app upgrade) without wiping custom values. */
export function ensurePermissionModes(cfg: AppConfig): void {
  if (!cfg.permissions) return
  if (!cfg.permissions.modes || typeof cfg.permissions.modes !== 'object') {
    cfg.permissions.modes = { ...BALANCED_PERMISSION_MODES }
  }
  const modes = cfg.permissions.modes as Record<string, PermissionMode>
  for (const [k, v] of Object.entries(BALANCED_PERMISSION_MODES)) {
    if (modes[k] == null) modes[k] = v
  }
  // Named presets always mirror code defaults (so upgrades apply, e.g. 放手).
  const preset = cfg.permissions.preset
  if (preset === 'conservative' || preset === 'balanced' || preset === 'open') {
    cfg.permissions.modes = modesForPreset(preset)
    return
  }
  cfg.permissions.preset = detectPermissionPreset(
    cfg.permissions.modes as Record<PermissionCapability, PermissionMode>,
  )
}

export function createDefaultConfig(): AppConfig {
  return {
    app: {
      language: 'zh-CN',
      close_to_tray: true,
      show_main_on_start: true,
      show_followup_suggestions: false,
      ai_generate_chat_title: true,
      show_read_pages: true,
      show_run_logs: true,
      collapse_tool_runs: true,
      collapse_run_logs: true,
      max_composer_chars: 16000,
      onboarding_completed: false,
    },
    browser: {
      default_ua_preset: 'edge152',
      custom_ua: '',
      accept_language: 'zh-CN,zh;q=0.9,en;q=0.8',
      show_agent_windows: false,
      default_width: 1280,
      default_height: 800,
      navigation_timeout_ms: 30000,
      action_timeout_ms: 15000,
      wait: {
        load: true,
        network_idle: false,
        network_idle_ms: 500,
        delay_ms: 0,
      },
      page_get_max_chars: 80000,
      network_log_buffer: 200,
      evaluate_world_id: 1000,
      evaluate_code_max_chars: 32000,
      evaluate_result_max_chars: 80000,
      fetch_timeout_ms: 30000,
      fetch_max_body_chars: 200000,
      fetch_max_body_bytes: 524288,
      block_window_open: false,
      url_allowlist: [],
      max_windows_total: 24,
      max_fetch_inflight: 8,
      max_parallel_agent_chats: 4,
      tree_update_debounce_ms: 100,
    },
    files: {
      root_dirname: 'workspace',
      custom_root: '',
      max_read_chars: 200000,
      max_write_bytes: 52_428_800,
      max_list_entries: 500,
      download_timeout_ms: 600000,
      download_max_bytes: 524_288_000,
      shell_timeout_ms: 30000,
      shell_timeout_ms_max: 120000,
      shell_max_output_chars: 80000,
      shell_allowlist: [...DEFAULT_SHELL_ALLOWLIST],
      shell_allow_shell_flag: false,
    },
    permissions: {
      preset: 'balanced',
      confirm_timeout_ms: 120000,
      user_intent_bypass_ask: true,
      modes: { ...BALANCED_PERMISSION_MODES },
    },
    ai: {
      default_provider: 'openai_compatible',
      providers: [
        {
          id: 'openai_compatible',
          type: 'openai_compatible',
          label: 'OpenAI Compatible',
          base_url: 'https://api.openai.com/v1',
          api_key_ref: 'secrets/openai',
          model: 'gpt-4.1',
          models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-5.4', 'gpt-5-mini'],
          timeout_ms: 120000,
        },
      ],
      max_tool_rounds: 24,
      continue_tool_rounds: 12,
    },
    fork_decision: createDefaultForkDecision(),
    subchat: createDefaultSubchat(),
    remote: {
      enabled: false,
      host: '127.0.0.1',
      port: 8790,
      username: 'admin',
      passwordHash: DEFAULT_REMOTE_PASSWORD_HASH,
    },
    store: {
      base_url: 'http://127.0.0.1:8791',
    },
    plugins: {
      dev_mode: false,
    },
  }
}

/** Plugin development mode (SDK appendix + linked dist watch). Default off. */
export function resolvePluginDevMode(cfg: AppConfig | null | undefined): boolean {
  return cfg?.plugins?.dev_mode === true
}

export function resolveForkDecision(cfg: AppConfig | null | undefined): ForkDecisionConfig {
  const defaults = createDefaultConfig().fork_decision
  const f = cfg?.fork_decision
  if (!f || typeof f !== 'object') return { ...defaults }
  const rawTimeout = Number(f.ask_timeout_ms)
  const ask_timeout_ms = Number.isFinite(rawTimeout)
    ? rawTimeout <= 0
      ? 0
      : Math.min(600000, Math.max(5000, Math.floor(rawTimeout)))
    : defaults.ask_timeout_ms
  return {
    enabled: f.enabled !== false,
    allow_custom: f.allow_custom !== false,
    option_hints: f.option_hints !== false,
    context_evidence: f.context_evidence !== false,
    recommended: f.recommended !== false,
    remember_in_chat: f.remember_in_chat !== false,
    inline_low_risk: f.inline_low_risk === true,
    allow_revise: f.allow_revise === true,
    ask_timeout_ms,
  }
}

export function resolveSubchat(cfg: AppConfig | null | undefined): SubchatConfig {
  const defaults = createDefaultConfig().subchat
  const s = cfg?.subchat
  if (!s || typeof s !== 'object') return { ...defaults }
  const raw = Number(s.max_parallel)
  const max_parallel = Number.isFinite(raw)
    ? Math.min(
        SUBCHAT_MAX_PARALLEL_MAX,
        Math.max(SUBCHAT_MAX_PARALLEL_MIN, Math.floor(raw)),
      )
    : defaults.max_parallel
  return {
    enabled: s.enabled !== false,
    max_parallel,
  }
}

/** Prefer show_main_on_start; fall back to inverted legacy start_minimized. */
export function shouldShowMainOnStart(cfg: AppConfig | null | undefined): boolean {
  const app = cfg?.app as
    | (AppConfig['app'] & { start_minimized?: boolean })
    | undefined
  if (!app) return true
  if (typeof app.show_main_on_start === 'boolean') return app.show_main_on_start
  if (typeof app.start_minimized === 'boolean') return !app.start_minimized
  return true
}

/**
 * Existing installs lack onboarding_completed; treat as already done so the
 * welcome wizard only appears for brand-new data roots.
 */
export function migrateOnboardingFromParsed(cfg: AppConfig, parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
  const app = (parsed as { app?: Record<string, unknown> }).app
  if (!app || typeof app !== 'object' || Array.isArray(app)) return
  if (!('onboarding_completed' in app)) {
    cfg.app.onboarding_completed = true
  }
}

/**
 * Drop legacy start_minimized after ensuring show_main_on_start is set.
 * Call migrateAppStartupFromParsed before merge when loading from disk.
 */
export function normalizeAppStartupPrefs(cfg: AppConfig): void {
  const app = cfg.app as AppConfig['app'] & { start_minimized?: boolean }
  if (typeof app.show_main_on_start !== 'boolean') {
    app.show_main_on_start =
      typeof app.start_minimized === 'boolean' ? !app.start_minimized : true
  }
  delete app.start_minimized
}

/** Apply before/after merge when raw YAML still uses start_minimized only. */
export function migrateShowMainOnStartFromParsed(cfg: AppConfig, parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
  const app = (parsed as { app?: Record<string, unknown> }).app
  if (!app || typeof app !== 'object') return
  if ('show_main_on_start' in app) return
  if (typeof app.start_minimized === 'boolean') {
    cfg.app.show_main_on_start = !app.start_minimized
  }
}

export function resolveUserAgent(cfg: AppConfig): string {
  const custom = cfg.browser.custom_ua?.trim()
  const presetId = cfg.browser.default_ua_preset || 'edge152'
  if (presetId === 'custom') return custom || DEFAULT_EDGE_UA
  const preset = getUaPreset(presetId)
  if (preset?.ua) {
    // Legacy: non-empty custom_ua used to always override; keep that if it diverges.
    if (custom && custom !== preset.ua) return custom
    return preset.ua
  }
  return custom || DEFAULT_EDGE_UA
}

/**
 * Keep preset id and custom_ua string consistent for the settings form.
 * Mutates cfg.browser in place; returns the effective UA shown in the textarea.
 */
export function syncBrowserUaFields(cfg: AppConfig): string {
  const browser = cfg.browser
  const custom = (browser.custom_ua || '').trim()
  let presetId = browser.default_ua_preset || 'edge152'

  if (custom) {
    const matched = findUaPresetByUa(custom)
    if (matched) {
      presetId = matched.id
      browser.default_ua_preset = matched.id
      browser.custom_ua = matched.ua
      return matched.ua
    }
    browser.default_ua_preset = 'custom'
    browser.custom_ua = custom
    return custom
  }

  if (presetId === 'custom') {
    browser.custom_ua = ''
    return ''
  }

  const preset = getUaPreset(presetId) || getUaPreset('edge152')!
  browser.default_ua_preset = preset.id
  browser.custom_ua = preset.ua
  return preset.ua
}
