import type { BrowserPage } from './browser-host'
import type { WsLiteSocket } from './ws-lite'
import { dispatchTrustedPointer } from './trusted-input'
import { withBrowserInputOperation } from './browser-input-context'
import type { BrowserAutomationOperation } from './browser-automation-controller'

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

type InputResult = { ok: boolean; error?: string }
type InputPacket = { payload: BridgeInputPayload; resolve: (result: InputResult) => void }
type RemoteGesture = {
  page: BrowserPage
  client?: WsLiteSocket
  abort: AbortController
  packets: InputPacket[]
  wake?: () => void
  timer?: ReturnType<typeof setTimeout>
  done: Promise<void>
  ending: boolean
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
  private gestures = new Map<string, RemoteGesture>()

  constructor(private getWindow: (windowId: string) => BrowserPage | null) {}

  subscribe(client: WsLiteSocket, windowId: string, fps = 8): void {
    const id = String(windowId || '').trim()
    if (this.subs.get(client)?.windowId !== id) this.cancelClientInput(client)
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
    this.cancelClientInput(client)
    this.subs.delete(client)
    if (!this.subs.size) this.stopTimer()
  }

  dropClient(client: WsLiteSocket): void {
    this.unsubscribe(client)
  }

  async handleInput(payload: BridgeInputPayload, client?: WsLiteSocket): Promise<InputResult> {
    const windowId = String(payload.windowId || '').trim()
    const win = windowId ? this.getWindow(windowId) : null
    if (!win || win.isDestroyed()) {
      return { ok: false, error: '窗口不存在或已关闭' }
    }
    if (win.manualControl) return {ok:false,error:'页面已由本机用户接管'}
    const nx = Number(payload.nx)
    const ny = Number(payload.ny)
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      return { ok: false, error: '无效坐标' }
    }
    const action = payload.action
    if (action !== 'down' && action !== 'move' && action !== 'up' && action !== 'wheel') {
      return { ok: false, error: '无效动作' }
    }
    if (payload.buttons !== undefined && (!Number.isInteger(payload.buttons) || payload.buttons < 0 || payload.buttons > 1)) return { ok: false, error: '无效按键状态' }
    const existing = this.gestures.get(windowId)
    if (existing) {
      if (existing.page !== win || existing.client !== client || existing.ending || action === 'down') return { ok: false, error: 'remote_pointer_busy' }
      return this.enqueue(existing, { ...payload, nx, ny })
    }
    if (action === 'up' || (payload.buttons !== undefined && payload.buttons !== (action === 'down' ? 1 : 0))) {
      return { ok: false, error: 'remote_pointer_not_owned' }
    }
    try {
      const expectedEpoch = win.automation.captureEpoch()
      const expectedDocumentEpoch = win.automation.captureDocumentEpoch()
      win.automation.assertEpoch(expectedEpoch)
      if (action === 'down') {
        const gesture: RemoteGesture = { page: win, client, abort: new AbortController(), packets: [], done: Promise.resolve(), ending: false }
        this.gestures.set(windowId, gesture)
        const accepted = this.enqueue(gesture, { ...payload, nx, ny })
        gesture.done = win.automation.run({ expectedEpoch, expectedDocumentEpoch, signal: gesture.abort.signal, label: '远程指针操作' }, operation =>
          withBrowserInputOperation(win.webContents, operation, () => this.runGesture(gesture, operation)),
        ).then(() => {}, error => {
          const message = error instanceof Error ? error.message : String(error)
          for (const packet of gesture.packets.splice(0)) packet.resolve({ ok: false, error: message })
        }).finally(() => {
          if (gesture.timer) clearTimeout(gesture.timer)
          if (this.gestures.get(windowId) === gesture) this.gestures.delete(windowId)
          for (const packet of gesture.packets.splice(0)) packet.resolve({ ok: false, error: 'remote_pointer_closed' })
        })
        return accepted
      }
      await win.automation.run({ expectedEpoch, expectedDocumentEpoch, label: '远程指针操作' }, operation =>
        withBrowserInputOperation(win.webContents, operation, async () => {
          operation.assertCurrent()
          await this.dispatchPacket(win, { ...payload, nx, ny }, false)
          operation.assertCurrent()
        }),
      )
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private cancelClientInput(client: WsLiteSocket): void {
    for (const gesture of this.gestures.values()) if (gesture.client === client) gesture.abort.abort(new Error('remote_client_disconnected'))
  }

  private enqueue(gesture: RemoteGesture, payload: BridgeInputPayload): Promise<InputResult> {
    if (gesture.abort.signal.aborted || gesture.ending) return Promise.resolve({ ok: false, error: 'remote_pointer_closed' })
    if (gesture.packets.length >= 128) return Promise.resolve({ ok: false, error: 'remote_input_queue_full' })
    if (gesture.timer) clearTimeout(gesture.timer)
    gesture.timer = setTimeout(() => gesture.abort.abort(new Error('remote_input_idle_timeout')), 15000)
    if (payload.action === 'up') gesture.ending = true
    return new Promise(resolve => {
      gesture.packets.push({ payload, resolve })
      gesture.wake?.(); gesture.wake = undefined
    })
  }

  private async runGesture(gesture: RemoteGesture, operation: BrowserAutomationOperation): Promise<void> {
    const wake = () => { gesture.wake?.(); gesture.wake = undefined }
    operation.signal.addEventListener('abort', wake)
    try {
      while (true) {
        operation.assertCurrent()
        const packet = gesture.packets.shift()
        if (!packet) { await new Promise<void>(resolve => { gesture.wake = resolve }); continue }
        try {
          await this.dispatchPacket(gesture.page, packet.payload, packet.payload.action !== 'up')
          operation.assertCurrent()
          packet.resolve({ ok: true })
          if (packet.payload.action === 'up') return
        } catch (error) {
          packet.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
    } finally { operation.signal.removeEventListener('abort', wake); gesture.wake = undefined }
  }

  private async dispatchPacket(page: BrowserPage, payload: BridgeInputPayload, pressed: boolean): Promise<void> {
    const [cw, ch] = page.getContentSize()
    const zoom = page.webContents.getZoomFactor()
    if (cw <= 0 || ch <= 0 || !Number.isFinite(zoom) || zoom <= 0) throw new Error('窗口尺寸无效')
    const x = Math.max(0, Math.min(cw - 1, Math.round(payload.nx * cw))) / zoom
    const y = Math.max(0, Math.min(ch - 1, Math.round(payload.ny * ch))) / zoom
    await dispatchTrustedPointer(page.webContents, {
      action: payload.action, x, y, deltaY: payload.deltaY,
      buttons: payload.action === 'down' || (pressed && payload.action !== 'up') ? 1 : 0,
    })
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
