import { getRemoteWsSession } from './navora-remote-shim'
import { getStoredToken, setStoredToken } from './remote-token'

export { getStoredToken, setStoredToken } from './remote-token'

/** True when running in browser against remote HTTP server (not Electron). */
export function isWebRemote(): boolean {
  return typeof window !== 'undefined' && !window.navoraElectron
}

export type BridgeFrame = {
  contentW: number
  contentH: number
  imageW: number
  imageH: number
  blobUrl: string
}

type StatusHandler = (msg: Record<string, unknown>) => void
type FrameHandler = (frame: BridgeFrame) => void

/**
 * Bridge view/control over the shared authenticated WS (same socket as RPC).
 */
class RemoteBridgeClient {
  private onStatus: StatusHandler | null = null
  private onFrame: FrameHandler | null = null
  private unsubStatus: (() => void) | null = null
  private unsubFrame: (() => void) | null = null
  private windowId = ''

  async connect(token: string): Promise<void> {
    setStoredToken(token)
    const ws = getRemoteWsSession()
    await ws.ensureConnected(token)
    this.unsubStatus?.()
    this.unsubFrame?.()
    this.unsubStatus = ws.addStatusHandler((msg) => this.onStatus?.(msg))
    this.unsubFrame = ws.addFrameHandler((frame) => {
      this.onFrame?.(frame)
    })
  }

  disconnect(): void {
    this.unsubscribe()
    this.unsubStatus?.()
    this.unsubFrame?.()
    this.unsubStatus = null
    this.unsubFrame = null
    // Keep shared RPC WS alive for Chat/Settings; only drop bridge handlers.
  }

  subscribe(windowId: string, fps = 8): void {
    this.windowId = windowId
    getRemoteWsSession().setBridgeWindowId(windowId)
    getRemoteWsSession().sendBridge({ type: 'bridge.subscribe', windowId, fps })
  }

  unsubscribe(): void {
    getRemoteWsSession().sendBridge({ type: 'bridge.unsubscribe' })
  }

  status(windowId?: string): void {
    getRemoteWsSession().sendBridge({
      type: 'bridge.status',
      windowId: windowId || this.windowId,
    })
  }

  input(payload: {
    action: 'down' | 'move' | 'up' | 'wheel'
    nx: number
    ny: number
    deltaY?: number
    buttons?: number
  }): void {
    getRemoteWsSession().sendBridge({
      type: 'bridge.input',
      windowId: this.windowId || getRemoteWsSession().getBridgeWindowId(),
      ...payload,
    })
  }

  setHandlers(opts: { onStatus?: StatusHandler; onFrame?: FrameHandler }): void {
    this.onStatus = opts.onStatus || null
    this.onFrame = opts.onFrame || null
  }
}

let client: RemoteBridgeClient | null = null

export function getBridgeClient(): RemoteBridgeClient {
  if (!client) client = new RemoteBridgeClient()
  return client
}

export async function remoteLogin(username: string, password: string): Promise<{
  ok: boolean
  token?: string
  error?: string
}> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = (await res.json()) as { ok?: boolean; token?: string; error?: string }
  if (!res.ok || !data.ok || !data.token) {
    return { ok: false, error: data.error || 'login_failed' }
  }
  setStoredToken(data.token)
  return { ok: true, token: data.token }
}

export async function remoteAuthMe(token?: string): Promise<boolean> {
  const t = token || getStoredToken()
  if (!t) return false
  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${t}` },
  })
  return res.ok
}
