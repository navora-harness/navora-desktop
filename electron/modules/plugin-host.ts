/**
 * Build the host API passed into loadable plugins.
 * Registry / runTool are constrained to capabilities approved for this invocation.
 */
import { isUrlAllowed } from '../../shared/url-allowlist'
import type { PermissionCapability } from '../../shared/types'
import type { PluginHostApi, PluginHostRegistry } from '../../shared/plugins'
import { toolNameToCapability } from './permission-gate'
import { executeAgentTool, type ToolExecContext } from './browser-tools'

function capabilitiesForCoreTool(
  name: string,
  args: Record<string, unknown>,
): PermissionCapability[] {
  if (name === 'browser_open') return ['session.create', 'window.create']
  if (name === 'browser_flow') {
    const steps = Array.isArray(args.steps) ? args.steps : []
    const needsClick = steps.some((s) => {
      if (!s || typeof s !== 'object') return false
      const d = String(
        (s as { do?: unknown; action?: unknown }).do ||
          (s as { action?: unknown }).action ||
          '',
      )
      return d === 'click'
    })
    return needsClick ? ['wait', 'click'] : ['wait']
  }
  if (name === 'browser_network_rule_add') {
    const kind = String(args.kind || 'observe')
    if (kind === 'block') return ['network.block']
    if (kind === 'modify') return ['network.modify']
    return ['network.observe']
  }
  const one = toolNameToCapability(name)
  return one ? [one] : []
}

function allowCapability(
  approved: Set<PermissionCapability>,
  cap: PermissionCapability,
): boolean {
  if (approved.has(cap)) return true
  // Cleanup of resources created in the same invocation.
  if (cap === 'window.close' && approved.has('window.create')) return true
  if (cap === 'session.close' && approved.has('session.create')) return true
  return false
}

export function createPluginHostApi(
  ctx: ToolExecContext,
  approvedCapabilities: readonly PermissionCapability[],
): PluginHostApi {
  if (!ctx || typeof ctx.getConfig !== 'function') {
    throw new Error('plugin_host_context_invalid')
  }
  const approved = new Set(approvedCapabilities)

  const requireCap = (cap: PermissionCapability): void => {
    if (!allowCapability(approved, cap)) {
      throw new Error(`plugin_capability_not_declared:${cap}`)
    }
  }

  const registry: PluginHostRegistry = {
    createSession: (chatId, opts) => {
      requireCap('session.create')
      return ctx.registry.createSession(chatId, opts)
    },
    createWindow: (sessionId, opts) => {
      requireCap('window.create')
      return ctx.registry.createWindow(sessionId, opts)
    },
    closeWindow: (windowId) => {
      requireCap('window.close')
      ctx.registry.closeWindow(windowId)
    },
    closeSession: (sessionId, clear) => {
      requireCap('session.close')
      return ctx.registry.closeSession(sessionId, clear)
    },
    assertSessionOwned: (chatId, sessionId) =>
      ctx.registry.assertSessionOwned(chatId, sessionId),
    assertWindowOwned: (chatId, windowId) =>
      ctx.registry.assertWindowOwned(chatId, windowId) as { win: unknown },
    getSessionRecord: (sessionId) =>
      ctx.registry.getSessionRecord(sessionId) as
        | { ses: unknown }
        | null
        | undefined,
    getTree: (chatId) => ctx.registry.getTree(chatId),
    setUserAgent: (sessionId, ua) => {
      requireCap('session.set_ua')
      ctx.registry.setUserAgent(sessionId, ua)
    },
    setProxy: (sessionId, proxy) => {
      requireCap('session.set_proxy')
      return ctx.registry.setProxy(sessionId, proxy)
    },
  }

  const api: PluginHostApi & { ctx?: PluginHostApi } = {
    chatId: ctx.chatId,
    signal: ctx.signal,
    approvedCapabilities: [...approvedCapabilities],
    helpers: { isUrlAllowed },
    getConfig: () => {
      const cfg = ctx.getConfig()
      if (!cfg || typeof cfg !== 'object') {
        throw new Error('plugin_host_config_empty')
      }
      return cfg as ReturnType<PluginHostApi['getConfig']>
    },
    registry,
    runTool: async (name, args) => {
      const needed = capabilitiesForCoreTool(name, args)
      for (const cap of needed) {
        if (!allowCapability(approved, cap)) {
          return { ok: false, error: `plugin_capability_not_declared:${cap}` }
        }
      }
      // Already covered by outer plan + approved set; do not re-prompt.
      return executeAgentTool(name, args, ctx, { skipPermission: true })
    },
  }
  // Back-compat: older plugins called api.ctx.getConfig / api.ctx.registry
  // after the trust-boundary change removed the bare ToolExecContext.
  api.ctx = api
  return api
}
