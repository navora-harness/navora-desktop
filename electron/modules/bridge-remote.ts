import type { BrowserWindow } from 'electron'
import type { WsLiteSocket } from './ws-lite'
import { dispatchTrustedPointer } from './trusted-input'

export type BridgeInputAction = 'down' | 'move' | 'up' | 'wheel'

export interface BridgeInputPayload {
  windowId: string
  action: BridgeInputAction
  /** Normalized 0..1 relative to content area */
  nx: number
  ny: number
  buttons?: number
  deltaY?: number
}

interface SubState {
  windowId: string
  fps: number
}

const FRAME_MAGIC = Buffer.from('BRF1')

/**
 * LAN remote view/control for Agent BrowserWindows.
 * Frames: binary BRF1 header + JPEG. Control: JSON over the same WS.
 */
export class BridgeRemoteService {
  private subs = new Map<WsLiteSocket, SubState>()
  private timer: ReturnType<typeof setInterval> | null = null
  private capturing = false
  private lastSentAt = new Map<string, number>()

  constructor(private getWindow: (windowId: string) => BrowserWindow | null) {}

  subscribe(client: WsLiteSocket, windowId: string, fps = 8): void {
    const id = String(windowId || '').trim()
    this.subs.set(client, {
      windowId: id,
      fps: Math.min(15, Math.max(2, Math.round(fps || 8))),
    })
    this.ensureTimer()
    const win = id ? this.getWindow(id) : null
    client.send(
      JSON.stringify({
        type: 'bridge.status',
        windowId: id,
        subscribed: true,
        hasWindow: !!(win && !win.isDestroyed()),
        title: win && !win.isDestroyed() ? win.getTitle() : '',
        url: win && !win.isDestroyed() ? win.webContents.getURL() : '',
      }),
    )
  }

  unsubscribe(client: WsLiteSocket): void {
    this.subs.delete(client)
    if (!this.subs.size) this.stopTimer()
  }

  dropClient(client: WsLiteSocket): void {
    this.unsubscribe(client)
  }

  async handleInput(payload: BridgeInputPayload): Promise<{ ok: boolean; error?: string }> {
    const windowId = String(payload.windowId || '').trim()
    const win = windowId ? this.getWindow(windowId) : null
    if (!win || win.isDestroyed()) {
      return { ok: false, error: '窗口不存在或已关闭' }
    }
    const nx = Number(payload.nx)
    const ny = Number(payload.ny)
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      return { ok: false, error: '无效坐标' }
    }
    const [cw, ch] = win.getContentSize()
    if (cw <= 0 || ch <= 0) return { ok: false, error: '窗口尺寸无效' }
    const x = Math.max(0, Math.min(cw - 1, Math.round(nx * cw)))
    const y = Math.max(0, Math.min(ch - 1, Math.round(ny * ch)))
    const action = payload.action
    if (action !== 'down' && action !== 'move' && action !== 'up' && action !== 'wheel') {
      return { ok: false, error: '无效动作' }
    }
    try {
      await dispatchTrustedPointer(win.webContents, {
        action,
        x,
        y,
        deltaY: payload.deltaY,
        buttons: payload.buttons,
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  status(windowId: string) {
    const id = String(windowId || '').trim()
    const win = id ? this.getWindow(id) : null
    const alive = !!(win && !win.isDestroyed())
    return {
      windowId: id,
      hasWindow: alive,
      visible: !!(alive && win!.isVisible()),
      title: alive ? win!.getTitle() : '',
      url: alive ? win!.webContents.getURL() : '',
      subscribers: [...this.subs.values()].filter((s) => s.windowId === id).length,
    }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 100)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.capturing || !this.subs.size) return
    this.capturing = true
    try {
      const now = Date.now()
      const byWindow = new Map<string, WsLiteSocket[]>()
      for (const [client, st] of this.subs) {
        if (!st.windowId) continue
        const minGap = 1000 / st.fps
        const last = this.lastSentAt.get(st.windowId) || 0
        if (now - last < minGap) continue
        const list = byWindow.get(st.windowId) || []
        list.push(client)
        byWindow.set(st.windowId, list)
      }
      for (const [windowId, clients] of byWindow) {
        const win = this.getWindow(windowId)
        const alive = !!(win && !win.isDestroyed())
        const frame = alive ? await this.captureFrame(windowId) : null
        if (!frame) {
          for (const c of clients) {
            c.send(
              JSON.stringify({
                type: 'bridge.status',
                windowId,
                subscribed: true,
                hasWindow: alive,
                title: alive ? win!.getTitle() : '',
                url: alive ? win!.webContents.getURL() : '',
                detail: alive ? '画面未就绪，正在重试…' : '窗口不存在或已关闭',
              }),
            )
          }
          continue
        }
        this.lastSentAt.set(windowId, now)
        for (const c of clients) c.sendBinary(frame)
      }
    } finally {
      this.capturing = false
    }
  }

  private async captureFrame(windowId: string): Promise<Buffer | null> {
    const win = this.getWindow(windowId)
    if (!win || win.isDestroyed()) return null
    try {
      const wc = win.webContents
      const imgOrNull = await Promise.race([
        wc.capturePage(undefined, { stayHidden: true, stayAwake: true }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ])
      if (!imgOrNull) return null
      let img = imgOrNull
      const size = img.getSize()
      if (!size.width || !size.height || img.isEmpty()) return null
      if (size.width > 1280) {
        img = img.resize({ width: 1280 })
      }
      const jpeg = img.toJPEG(55)
      if (!jpeg.length) return null
      const [cw, ch] = win.getContentSize()
      const out = Buffer.alloc(14 + jpeg.length)
      FRAME_MAGIC.copy(out, 0)
      out[4] = 0
      out[5] = 0
      out.writeUInt16BE(Math.max(1, cw || size.width), 6)
      out.writeUInt16BE(Math.max(1, ch || size.height), 8)
      out.writeUInt16BE(img.getSize().width, 10)
      out.writeUInt16BE(img.getSize().height, 12)
      jpeg.copy(out, 14)
      return out
    } catch {
      return null
    }
  }
}
