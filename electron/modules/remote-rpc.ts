import type { WsLiteSocket } from './ws-lite'

export type RpcHandler = (...args: unknown[]) => unknown | Promise<unknown>

/**
 * Shared Navora RPC registry: used by ipcMain and remote WS.
 */
export class NavoraRpcRegistry {
  private handlers = new Map<string, RpcHandler>()

  register(channel: string, handler: RpcHandler): void {
    this.handlers.set(channel, handler)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  async invoke(channel: string, args: unknown[] = []): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (!fn) throw new Error(`unknown_rpc:${channel}`)
    return await fn(...args)
  }
}

/** Dangerous / host-local channels blocked for remote WS clients. */
const REMOTE_FORBIDDEN = new Set([
  'navora:workspace.pickDirectory',
  'navora:workspace.setChatRoot',
  'navora:secrets.setApiKey',
  'navora:secrets.clearApiKey',
  'navora:skills.pickImport',
  'navora:skills.pickParse',
  'navora:skills.export',
  'navora:skills.exportMany',
  'navora:skills.import',
  'navora:skills.parsePath',
  'navora:plugins.pickImport',
  'navora:plugins.pickParse',
  'navora:plugins.export',
  'navora:plugins.import',
  'navora:plugins.parsePath',
  'navora:chats.export',
])

/** Channels that behave differently (or are blocked) for remote WS clients. */
export async function invokeForRemote(
  registry: NavoraRpcRegistry,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  if (REMOTE_FORBIDDEN.has(channel)) {
    if (
      channel === 'navora:workspace.pickDirectory' ||
      channel === 'navora:skills.pickImport' ||
      channel === 'navora:skills.pickParse' ||
      channel === 'navora:skills.export' ||
      channel === 'navora:skills.exportMany' ||
      channel === 'navora:plugins.pickImport' ||
      channel === 'navora:plugins.pickParse' ||
      channel === 'navora:plugins.export' ||
      channel === 'navora:chats.export'
    ) {
      return { ok: false, canceled: true, error: 'remote_unsupported' }
    }
    return { ok: false, error: 'remote_forbidden' }
  }
  if (channel === 'navora:remote.openWindow') {
    const windowId = String(args[0] || '').trim()
    if (!windowId) return { ok: false, error: 'window_id_required' }
    return { ok: true, windowId, route: `/remote/${encodeURIComponent(windowId)}` }
  }
  return registry.invoke(channel, args)
}

export function broadcastRpcEvent(clients: Iterable<WsLiteSocket>, event: string, payload: unknown): void {
  const text = JSON.stringify({ type: 'rpc.event', event, payload })
  for (const c of clients) {
    try {
      c.send(text)
    } catch {
      /* ignore */
    }
  }
}
