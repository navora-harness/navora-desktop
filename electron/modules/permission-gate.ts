import type {
  ChatPermissions,
  PermissionCapability,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
} from '../../shared/types'
import { modesForPreset, type AppConfig } from '../../shared/config'

export type { PermissionDecision, PermissionRequest }

type AskFn = (req: PermissionRequest) => Promise<PermissionDecision>

/**
 * Permission gate for Agent tools.
 * deny / allow / allow_notify are sync; ask / ask_chat go through AskFn (UI).
 */
export class PermissionGate {
  private getConfig: () => AppConfig
  private askFn: AskFn
  private chatAllow = new Map<string, Set<PermissionCapability>>()
  /** Per-chat sticky allow (UI:「本会话始终允许」). */
  private alwaysAllow = new Map<string, Set<PermissionCapability>>()
  /** Per-chat sticky deny (UI:「本会话始终拒绝」). */
  private alwaysDeny = new Map<string, Set<PermissionCapability>>()
  private onNotify?: (chatId: string, capability: PermissionCapability, detail: string) => void
  private getChatPermissions?: (chatId: string) => ChatPermissions | null

  constructor(
    getConfig: () => AppConfig,
    askFn: AskFn,
    onNotify?: (chatId: string, capability: PermissionCapability, detail: string) => void,
    getChatPermissions?: (chatId: string) => ChatPermissions | null,
  ) {
    this.getConfig = getConfig
    this.askFn = askFn
    this.onNotify = onNotify
    this.getChatPermissions = getChatPermissions
  }

  clearChat(chatId: string): void {
    this.chatAllow.delete(chatId)
    this.alwaysAllow.delete(chatId)
    this.alwaysDeny.delete(chatId)
  }

  private stickySet(
    map: Map<string, Set<PermissionCapability>>,
    chatId: string,
  ): Set<PermissionCapability> {
    let set = map.get(chatId)
    if (!set) {
      set = new Set()
      map.set(chatId, set)
    }
    return set
  }

  private modesForChat(chatId: string): Record<PermissionCapability, PermissionMode> {
    const chat = this.getChatPermissions?.(chatId)
    const preset = chat?.preset || this.getConfig().permissions.preset
    if (preset === 'conservative' || preset === 'balanced' || preset === 'open') {
      return modesForPreset(preset)
    }
    if (chat?.modes) return chat.modes
    return this.getConfig().permissions.modes
  }

  getMode(chatId: string, capability: PermissionCapability): PermissionMode {
    return this.modesForChat(chatId)[capability] || 'ask'
  }

  /** Remember ask_chat approval without showing another dialog. */
  rememberChatAllow(chatId: string, capability: PermissionCapability): void {
    this.stickySet(this.chatAllow, chatId).add(capability)
  }

  /**
   * Sync peek without prompting. Used by Chromium permission check handlers.
   * `allow` = already permitted; `deny` = hard deny; `ask` = need interactive request
   * (also used for allow_notify so the request path can emit a notify log).
   */
  peek(
    chatId: string,
    capability: PermissionCapability,
  ): 'allow' | 'deny' | 'ask' {
    if (this.alwaysDeny.get(chatId)?.has(capability)) return 'deny'
    if (this.alwaysAllow.get(chatId)?.has(capability)) return 'allow'
    const mode: PermissionMode = this.modesForChat(chatId)[capability] || 'ask'
    if (mode === 'deny') return 'deny'
    if (mode === 'allow') return 'allow'
    if (mode === 'ask_chat' && this.chatAllow.get(chatId)?.has(capability)) return 'allow'
    // allow_notify / ask / ask_chat → go through request handler
    return 'ask'
  }

  async check(
    chatId: string,
    capability: PermissionCapability,
    detail: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (signal?.aborted) return { ok: false, reason: 'aborted' }
    if (this.alwaysDeny.get(chatId)?.has(capability)) return { ok: false, reason: 'always_deny' }
    if (this.alwaysAllow.get(chatId)?.has(capability)) return { ok: true }

    let mode: PermissionMode = this.modesForChat(chatId)[capability] || 'ask'
    if (mode === 'deny') return { ok: false, reason: 'denied_by_config' }
    if (mode === 'allow') return { ok: true }
    if (mode === 'allow_notify') {
      this.onNotify?.(chatId, capability, detail)
      return { ok: true }
    }

    const chatSet = this.chatAllow.get(chatId)
    if (mode === 'ask_chat' && chatSet?.has(capability)) return { ok: true }

    const cfg = this.getConfig().permissions
    const id = `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const req: PermissionRequest = {
      id,
      chatId,
      capability,
      detail,
      timeoutMs: cfg.confirm_timeout_ms || 120000,
    }

    const decision = await Promise.race([
      this.askFn(req),
      abortDecision(signal),
    ])

    if (decision === 'deny' || decision === 'always_deny') {
      if (decision === 'always_deny') this.stickySet(this.alwaysDeny, chatId).add(capability)
      return { ok: false, reason: 'user_denied' }
    }
    if (decision === 'always_allow') this.stickySet(this.alwaysAllow, chatId).add(capability)
    if (decision === 'allow_chat' || mode === 'ask_chat') {
      this.stickySet(this.chatAllow, chatId).add(capability)
    }
    return { ok: true }
  }
}

function abortDecision(signal?: AbortSignal): Promise<PermissionDecision> {
  return new Promise((resolve) => {
    if (!signal) return
    if (signal.aborted) {
      resolve('deny')
      return
    }
    signal.addEventListener('abort', () => resolve('deny'), { once: true })
  })
}

export function toolNameToCapability(name: string): PermissionCapability | null {
  switch (name) {
    case 'browser_open':
      return null // checked as session.create + window.create in executeAgentTool
    case 'browser_session_create':
      return 'session.create'
    case 'browser_session_close':
      return 'session.close'
    case 'browser_session_clear':
      return 'session.clear'
    case 'browser_session_set_proxy':
      return 'session.set_proxy'
    case 'browser_session_set_ua':
      return 'session.set_ua'
    case 'browser_session_fetch':
      return 'session.fetch'
    case 'browser_cookies_get':
      return 'session.cookies_read'
    case 'browser_cookies_set':
    case 'browser_cookies_remove':
      return 'session.cookies_write'
    case 'browser_window_create':
      return 'window.create'
    case 'browser_window_close':
      return 'window.close'
    case 'browser_window_set_visible':
    case 'browser_window_set_bounds':
    case 'browser_window_focus':
      return 'window.set_visible'
    case 'browser_navigate':
    case 'browser_load_url_with_response':
    case 'browser_back':
    case 'browser_forward':
    case 'browser_reload':
      return 'navigate'
    case 'browser_wait':
      return 'wait'
    case 'browser_flow':
      return null // wait (+ click) gated inside executeAgentTool
    case 'browser_click':
    case 'browser_hover':
    case 'browser_scroll':
    case 'browser_select':
    case 'browser_upload':
      return 'click'
    case 'browser_type':
    case 'browser_press':
      return 'type'
    case 'browser_get':
    case 'browser_find':
    case 'browser_query_deep':
    case 'browser_dialog':
      return 'get_page'
    case 'browser_screenshot':
      return 'screenshot'
    case 'desktop_screenshot':
      return 'desktop.screenshot'
    case 'browser_evaluate':
      return 'evaluate'
    case 'browser_network_rule_add':
      return null // resolved by kind
    case 'browser_network_rule_remove':
    case 'browser_network_rule_list':
    case 'browser_network_log':
    case 'browser_network_clear':
      return 'network.observe'
    case 'browser_list_resources':
    case 'workspace_info':
    case 'datetime_now':
      return null // no gate
    case 'geolocation_get':
      return 'browser.geolocation'
    case 'workspace_set':
      return 'file.write'
    case 'file_list':
    case 'file_stat':
    case 'file_read':
      return 'file.read'
    case 'file_write':
    case 'file_mkdir':
    case 'file_delete':
    case 'file_concat':
    case 'file_move':
    case 'file_copy':
      return 'file.write'
    case 'file_download':
    case 'file_download_compose':
      return 'file.download'
    case 'file_reveal':
    case 'file_open':
      return 'shell.open'
    case 'shell_exec':
      return 'shell.exec'
    case 'app_settings_get':
      return 'settings.read'
    case 'app_settings_update':
      return 'settings.write'
    case 'app_models_list':
      return 'settings.read'
    case 'app_provider_add':
      return 'settings.write'
    case 'skill_list':
    case 'skill_read':
    case 'plugin_list':
    case 'plugin_read':
    case 'store_search':
      return 'settings.read'
    case 'plugin_build':
    case 'plugin_pack':
    case 'plugin_check':
    case 'plugin_link':
      return 'shell.exec'
    case 'skill_create':
    case 'skill_update':
    case 'skill_delete':
    case 'skill_export':
      return null // gated via skill review dialog + skills.write deny check
    default:
      return null
  }
}

export function networkAddCapability(kind: string): PermissionCapability {
  if (kind === 'block') return 'network.block'
  if (kind === 'modify') return 'network.modify'
  return 'network.observe'
}
