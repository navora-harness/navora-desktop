import {
  BrowserWindow,
  session as electronSession,
  type BrowserWindowConstructorOptions,
  type Session,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserTreeSession, BrowserTreeWindow } from '../../shared/types'
import { applyUserAgentOverride } from '../../shared/user-agent'
import type { AppConfig } from '../../shared/config'
import { resolveUserAgent } from '../../shared/config'
import { isUrlAllowed } from '../../shared/url-allowlist'
import type { BrowserNetworkManager } from './browser-network'
import type { PermissionGate } from './permission-gate'
import type { WorkspaceFiles } from './workspace-files'

const WINDOW_MIN_W = 320
const WINDOW_MIN_H = 240
const WINDOW_MAX_W = 7680
const WINDOW_MAX_H = 4320

function clampDim(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function resolveWindowSize(
  cfg: AppConfig,
  opts: { width?: number; height?: number },
): { width: number; height: number } {
  const defW = cfg.browser.default_width || 1280
  const defH = cfg.browser.default_height || 800
  const width =
    opts.width != null && Number.isFinite(Number(opts.width))
      ? clampDim(Number(opts.width), WINDOW_MIN_W, WINDOW_MAX_W)
      : defW
  const height =
    opts.height != null && Number.isFinite(Number(opts.height))
      ? clampDim(Number(opts.height), WINDOW_MIN_H, WINDOW_MAX_H)
      : defH
  return { width, height }
}

function windowBoundsSnapshot(win: BrowserWindow): {
  width: number
  height: number
  x: number
  y: number
} {
  const b = win.getBounds()
  return { width: b.width, height: b.height, x: b.x, y: b.y }
}

type AgentWindowRecord = {
  windowId: string
  sessionId: string
  chatId: string
  win: BrowserWindow
  title: string
  url: string
  visible: boolean
  loading: boolean
}

type AgentSessionRecord = {
  sessionId: string
  chatId: string
  sessionIndex: number
  partition: string
  persist: boolean
  ses: Session
  userAgent: string
  windows: Map<string, AgentWindowRecord>
}

export type RegistryEvents = {
  onTreeChanged?: (chatId: string) => void
  /** Fired when user closes an agent window while something may be listening. */
  onWindowClosedByUser?: (info: {
    chatId: string
    sessionId: string
    windowId: string
  }) => void
  onWindowOpened?: (info: {
    chatId: string
    sessionId: string
    windowId: string
    url: string
    openerWindowId?: string
  }) => void
  /** True user/manual navigation only — not Agent tool loadURL / redirects during tools. */
  onUserNavigate?: (info: {
    chatId: string
    sessionId: string
    windowId: string
    url: string
    statusCode?: number
    statusText?: string
  }) => void
  /** Browser/Chromium download: default action blocked until confirm/reject. */
  onBrowserDownload?: (info: {
    chatId: string
    sessionId: string
    windowId?: string
    state: 'intercepted' | 'started' | 'completed' | 'failed' | 'cancelled'
    url: string
    filename: string
    savePath?: string
    relPath?: string
    receivedBytes?: number
    totalBytes?: number
    error?: string
  }) => void
  /**
   * Ask user to confirm a blocked browser download.
   * Must resolve 'confirm' | 'reject'. Timeout / deny / 拒绝 → reject.
   */
  confirmBrowserDownload?: (info: {
    chatId: string
    sessionId: string
    windowId?: string
    url: string
    filename: string
    relPath: string
    totalBytes?: number
  }) => Promise<'confirm' | 'reject'>
}

export class BrowserRegistry {
  private sessions = new Map<string, AgentSessionRecord>()
  private windows = new Map<string, AgentWindowRecord>()
  private nextIndex = new Map<string, number>()
  private getConfig: () => AppConfig
  private events: RegistryEvents
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private network: BrowserNetworkManager | null = null
  private gate: PermissionGate | null = null
  private files: WorkspaceFiles | null = null
  /** chatId → nest depth while Agent browser tools run (skip user-op navigate logs). */
  private quietNavigateDepth = new Map<string, number>()
  /** windowId → timestamp; grace after tools for redirects / late did-navigate. */
  private quietNavigateUntil = new Map<string, number>()
  /**
   * Window ids being destroyed by registry/Agent (closeWindow / closeSession / clearChat).
   * Their `closed` event must NOT be reported as a user op ("你关闭了一个浏览器窗口").
   */
  private programmaticClose = new Set<string>()

  constructor(getConfig: () => AppConfig, events: RegistryEvents = {}) {
    this.getConfig = getConfig
    this.events = events
  }

  bindNetwork(network: BrowserNetworkManager): void {
    this.network = network
  }

  bindPermissionGate(gate: PermissionGate): void {
    this.gate = gate
  }

  bindWorkspaceFiles(files: WorkspaceFiles): void {
    this.files = files
  }

  /**
   * While Agent browser tools drive the page, navigations are browser dynamics —
   * not user ops. Nestable for parallel tool calls on the same chat.
   */
  beginQuietNavigateLogs(chatId: string): void {
    const id = String(chatId || '').trim()
    if (!id) return
    this.quietNavigateDepth.set(id, (this.quietNavigateDepth.get(id) || 0) + 1)
  }

  endQuietNavigateLogs(chatId: string, graceMs = 12000): void {
    const id = String(chatId || '').trim()
    if (!id) return
    const next = (this.quietNavigateDepth.get(id) || 1) - 1
    if (next > 0) {
      this.quietNavigateDepth.set(id, next)
      return
    }
    this.quietNavigateDepth.delete(id)
    const until = Date.now() + Math.max(0, graceMs)
    for (const rec of this.windows.values()) {
      if (rec.chatId !== id) continue
      const prev = this.quietNavigateUntil.get(rec.windowId) || 0
      if (until > prev) this.quietNavigateUntil.set(rec.windowId, until)
    }
  }

  /** Suppress user-op navigate logs for one window (e.g. createWindow initial loadURL). */
  quietNavigateLog(windowId: string, ttlMs = 12000): void {
    const id = String(windowId || '').trim()
    if (!id) return
    const until = Date.now() + Math.max(0, ttlMs)
    const prev = this.quietNavigateUntil.get(id) || 0
    if (until > prev) this.quietNavigateUntil.set(id, until)
  }

  private shouldEmitUserNavigate(rec: AgentWindowRecord): boolean {
    if ((this.quietNavigateDepth.get(rec.chatId) || 0) > 0) return false
    const until = this.quietNavigateUntil.get(rec.windowId) || 0
    if (until > Date.now()) return false
    if (until) this.quietNavigateUntil.delete(rec.windowId)
    return true
  }

  private uaInitHeader(): Record<string, string> {
    const lang = this.getConfig().browser.accept_language?.trim()
    return lang ? { 'accept-language': lang } : {}
  }

  /** session.setUserAgent once + webRequest onBeforeSendHeaders；不对每个 webContents 重复 setUserAgent。 */
  private applySessionUserAgent(s: AgentSessionRecord, ua: string): void {
    const init = this.uaInitHeader()
    const parsed = applyUserAgentOverride(s.ses, ua, init)
    s.userAgent = parsed?.toString() || ua
    // initHeader 默认空：只强制 UA + 剥 Full-Version（与常见可过站路径一致）
    this.network?.setUaGuard(s.sessionId, s.userAgent, {})
  }

  private emitTree(chatId: string): void {
    const ms = this.getConfig().browser.tree_update_debounce_ms || 100
    const prev = this.debounceTimers.get(chatId)
    if (prev) clearTimeout(prev)
    this.debounceTimers.set(
      chatId,
      setTimeout(() => {
        this.debounceTimers.delete(chatId)
        this.events.onTreeChanged?.(chatId)
      }, ms),
    )
  }

  private partitionOf(chatId: string, index: number, persist: boolean): string {
    const base = `${chatId}-${index}`
    return persist ? `persist:${base}` : base
  }

  getTree(chatId: string): BrowserTreeSession[] {
    const list: BrowserTreeSession[] = []
    for (const s of this.sessions.values()) {
      if (s.chatId !== chatId) continue
      const windows: BrowserTreeWindow[] = []
      for (const w of s.windows.values()) {
        const bounds =
          w.win.isDestroyed() ? undefined : windowBoundsSnapshot(w.win)
        windows.push({
          windowId: w.windowId,
          sessionId: w.sessionId,
          title: w.title,
          url: w.url,
          visible: w.visible,
          loading: w.loading,
          ...(bounds || {}),
        })
      }
      list.push({
        sessionId: s.sessionId,
        chatId: s.chatId,
        sessionIndex: s.sessionIndex,
        partition: s.partition,
        persist: s.persist,
        windows,
      })
    }
    return list.sort((a, b) => a.sessionIndex - b.sessionIndex)
  }

  snapshotCounts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const s of this.sessions.values()) {
      out[s.chatId] = (out[s.chatId] || 0) + s.windows.size
    }
    return out
  }

  getSessionRecord(sessionId: string): AgentSessionRecord | undefined {
    return this.sessions.get(sessionId)
  }

  getWindowRecord(windowId: string): AgentWindowRecord | undefined {
    return this.windows.get(windowId)
  }

  listWindowSummaries(): Array<{
    windowId: string
    sessionId: string
    chatId: string
    title: string
    url: string
    visible: boolean
    loading: boolean
  }> {
    const out: Array<{
      windowId: string
      sessionId: string
      chatId: string
      title: string
      url: string
      visible: boolean
      loading: boolean
    }> = []
    for (const rec of this.windows.values()) {
      if (rec.win.isDestroyed()) continue
      out.push({
        windowId: rec.windowId,
        sessionId: rec.sessionId,
        chatId: rec.chatId,
        title: rec.title,
        url: rec.url,
        visible: rec.visible,
        loading: rec.loading,
      })
    }
    return out
  }

  assertSessionOwned(chatId: string, sessionId: string): AgentSessionRecord {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    if (s.chatId !== chatId) throw new Error(`session_wrong_chat:${sessionId}`)
    return s
  }

  assertWindowOwned(chatId: string, windowId: string): AgentWindowRecord {
    const w = this.windows.get(windowId)
    if (!w || w.win.isDestroyed()) throw new Error(`window_not_found:${windowId}`)
    if (w.chatId !== chatId) throw new Error(`window_wrong_chat:${windowId}`)
    return w
  }

  async setProxy(sessionId: string, proxyRules: string | null): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    if (!proxyRules) {
      await s.ses.setProxy({ mode: 'direct' })
    } else {
      await s.ses.setProxy({ mode: 'fixed_servers', proxyRules })
    }
  }

  setUserAgent(sessionId: string, ua: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    this.applySessionUserAgent(s, ua)
  }

  async getCookies(sessionId: string, url?: string) {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    return s.ses.cookies.get(url ? { url } : {})
  }

  async setCookie(
    sessionId: string,
    cookie: {
      url: string
      name: string
      value: string
      domain?: string
      path?: string
      secure?: boolean
      httpOnly?: boolean
      expirationDate?: number
    },
  ): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    await s.ses.cookies.set(cookie)
  }

  async removeCookie(
    sessionId: string,
    filter: { url?: string; name?: string; domain?: string; path?: string },
  ): Promise<number> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    const all = await s.ses.cookies.get(
      filter.url ? { url: filter.url } : filter.domain ? { domain: filter.domain } : {},
    )
    let removed = 0
    for (const c of all) {
      if (filter.name && c.name !== filter.name) continue
      if (filter.path && c.path !== filter.path) continue
      const url =
        filter.url ||
        `${c.secure ? 'https' : 'http'}://${c.domain?.replace(/^\./, '') || 'localhost'}${c.path || '/'}`
      try {
        await s.ses.cookies.remove(url, c.name)
        removed += 1
      } catch {
        /* ignore */
      }
    }
    return removed
  }

  async clearSessionData(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)
    await s.ses.clearData()
    try {
      await s.ses.clearStorageData()
    } catch {
      /* ignore */
    }
  }

  createSession(chatId: string, opts: { persist?: boolean; ua?: string } = {}): BrowserTreeSession {
    const persist = opts.persist === true
    const index = (this.nextIndex.get(chatId) || 0) + 1
    this.nextIndex.set(chatId, index)
    const partition = this.partitionOf(chatId, index, persist)
    const ses = electronSession.fromPartition(partition)
    const cfg = this.getConfig()
    const ua = opts.ua?.trim() || resolveUserAgent(cfg)

    const sessionId = `sess_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const rec: AgentSessionRecord = {
      sessionId,
      chatId,
      sessionIndex: index,
      partition,
      persist,
      ses,
      userAgent: ua,
      windows: new Map(),
    }
    this.sessions.set(sessionId, rec)
    this.applySessionUserAgent(rec, ua)
    this.installSessionPermissionHandlers(rec)
    this.installSessionDownloadHandler(rec)
    this.emitTree(chatId)
    return this.getTree(chatId).find((s) => s.sessionId === sessionId)!
  }

  /**
   * Intercept Chromium downloads: block default (no OS save dialog), notify Agent,
   * ask 确认/拒绝 (timeout = reject), then resume only if confirmed.
   */
  private installSessionDownloadHandler(s: AgentSessionRecord): void {
    s.ses.on('will-download', (_event, item, wc) => {
      const winRec = [...s.windows.values()].find((w) => w.win.webContents === wc)
      const url = String(item.getURL() || '').trim() || 'about:blank'
      const filename = sanitizeDownloadFilename(item.getFilename() || 'download')
      const totalBytes = item.getTotalBytes() || undefined

      const blockToTempAndCancel = (error: string) => {
        try {
          item.setSavePath(path.join(os.tmpdir(), `navora-block-${Date.now()}-${filename}`))
        } catch {
          /* ignore */
        }
        try {
          item.cancel()
        } catch {
          /* ignore */
        }
        this.events.onBrowserDownload?.({
          chatId: s.chatId,
          sessionId: s.sessionId,
          windowId: winRec?.windowId,
          state: 'cancelled',
          url,
          filename,
          totalBytes,
          error,
        })
      }

      if (!this.files) {
        blockToTempAndCancel('workspace_unavailable')
        return
      }

      let abs: string
      let relPath: string
      try {
        const dirAbs = this.files.resolve(s.chatId, 'downloads')
        fs.mkdirSync(dirAbs, { recursive: true })
        abs = uniqueDownloadPath(dirAbs, filename)
        relPath = this.files.toRel(s.chatId, abs)
      } catch (e) {
        blockToTempAndCancel(e instanceof Error ? e.message : String(e))
        return
      }

      // Set path sync to suppress OS save dialog, then pause until confirmed.
      item.setSavePath(abs)
      try {
        item.pause()
      } catch {
        /* ignore */
      }

      const baseInfo = {
        chatId: s.chatId,
        sessionId: s.sessionId,
        windowId: winRec?.windowId,
        url,
        filename,
        savePath: abs,
        relPath,
        totalBytes,
      }

      this.events.onBrowserDownload?.({
        ...baseInfo,
        state: 'intercepted',
      })

      const cap = 'file.download.passive' as const
      const detail = `被动下载 ${filename} → ${relPath}`
      const peek = this.gate?.peek(s.chatId, cap) || 'ask'
      if (peek === 'deny') {
        try {
          item.cancel()
        } catch {
          /* ignore */
        }
        try {
          if (fs.existsSync(abs)) fs.unlinkSync(abs)
        } catch {
          /* ignore */
        }
        this.events.onBrowserDownload?.({
          ...baseInfo,
          state: 'cancelled',
          error: 'permission_denied',
        })
        return
      }

      const attachDoneHandlers = () => {
        this.events.onBrowserDownload?.({
          ...baseInfo,
          state: 'started',
        })
        let lastProgressAt = 0
        item.on('updated', (_e, state) => {
          if (state === 'interrupted') {
            try {
              item.resume()
            } catch {
              /* ignore */
            }
            return
          }
          if (state !== 'progressing') return
          const now = Date.now()
          if (now - lastProgressAt < 200) return
          lastProgressAt = now
          this.events.onBrowserDownload?.({
            ...baseInfo,
            state: 'started',
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes() || totalBytes,
          })
        })
        item.once('done', (_e, state) => {
          const received = item.getReceivedBytes()
          const total = item.getTotalBytes()
          if (state === 'completed') {
            this.events.onBrowserDownload?.({
              ...baseInfo,
              state: 'completed',
              receivedBytes: received,
              totalBytes: total || totalBytes,
            })
            return
          }
          try {
            if (fs.existsSync(abs)) fs.unlinkSync(abs)
          } catch {
            /* ignore */
          }
          this.events.onBrowserDownload?.({
            ...baseInfo,
            state: state === 'cancelled' ? 'cancelled' : 'failed',
            receivedBytes: received,
            totalBytes: total || totalBytes,
            error: state,
          })
        })
      }

      const rejectDownload = (error: string) => {
        try {
          item.cancel()
        } catch {
          /* ignore */
        }
        try {
          if (fs.existsSync(abs)) fs.unlinkSync(abs)
        } catch {
          /* ignore */
        }
        this.events.onBrowserDownload?.({
          ...baseInfo,
          state: 'cancelled',
          error,
        })
      }

      const acceptDownload = () => {
        attachDoneHandlers()
        try {
          item.resume()
        } catch (e) {
          rejectDownload(e instanceof Error ? e.message : String(e))
        }
      }

      // Silent allow (mode=allow / ask_chat remembered / always_allow).
      if (peek === 'allow') {
        acceptDownload()
        return
      }

      const mode = this.gate?.getMode(s.chatId, cap) || 'ask'
      // allow_notify: auto-accept + notify log (via gate.check).
      if (mode === 'allow_notify' && this.gate) {
        void (async () => {
          try {
            const res = await this.gate!.check(s.chatId, cap, detail)
            if (res.ok) acceptDownload()
            else rejectDownload(res.reason || 'permission_denied')
          } catch (e) {
            rejectDownload(e instanceof Error ? e.message : String(e))
          }
        })()
        return
      }

      // ask / ask_chat (first time): specialized download confirm UI (not generic perm dialog).
      void (async () => {
        try {
          const decision = this.events.confirmBrowserDownload
            ? await this.events.confirmBrowserDownload({
                chatId: s.chatId,
                sessionId: s.sessionId,
                windowId: winRec?.windowId,
                url,
                filename,
                relPath,
                totalBytes,
              })
            : 'reject'
          if (decision === 'confirm') {
            if (mode === 'ask_chat') this.gate?.rememberChatAllow(s.chatId, cap)
            acceptDownload()
          } else {
            rejectDownload('user_rejected_or_timeout')
          }
        } catch (e) {
          rejectDownload(e instanceof Error ? e.message : String(e))
        }
      })()
    })
  }

  /**
   * Chromium permission requests (e.g. geolocation). Setting a handler means we
   * decide every permission — deny unknowns; route geolocation through PermissionGate.
   */
  private installSessionPermissionHandlers(s: AgentSessionRecord): void {
    s.ses.setPermissionCheckHandler((_wc, permission, _requestingOrigin, _details) => {
      if (permission !== 'geolocation') return false
      if (!this.gate) return false
      return this.gate.peek(s.chatId, 'browser.geolocation') === 'allow'
    })

    s.ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (permission !== 'geolocation') {
        callback(false)
        return
      }
      void this.resolveGeolocationRequest(s, wc, details).then(callback)
    })
  }

  private async resolveGeolocationRequest(
    s: AgentSessionRecord,
    wc: WebContents,
    details: { requestingUrl?: string },
  ): Promise<boolean> {
    if (!this.gate) return false
    const winRec = [...s.windows.values()].find((w) => w.win.webContents === wc)
    const origin =
      String(details?.requestingUrl || winRec?.url || wc.getURL() || '').trim() || 'unknown'
    const detail = [
      '网页请求获取设备位置（geolocation）',
      `来源：${origin}`,
      winRec ? `窗口：${winRec.windowId}` : null,
      `Session：${s.sessionId}`,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      const res = await this.gate.check(s.chatId, 'browser.geolocation', detail)
      return res.ok
    } catch (e) {
      console.warn('[browser] geolocation permission failed', e)
      return false
    }
  }

  private totalWindows(): number {
    return this.windows.size
  }

  createWindow(
    sessionId: string,
    opts: {
      url?: string
      show?: boolean
      width?: number
      height?: number
      openerWindowId?: string
    } = {},
  ): BrowserTreeWindow {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`session_not_found:${sessionId}`)

    const cfg = this.getConfig()
    if (this.totalWindows() >= cfg.browser.max_windows_total) {
      throw new Error('max_windows_total')
    }

    // Omit show → inherit settings (browser.show_agent_windows).
    const show = opts.show ?? cfg.browser.show_agent_windows
    const { width, height } = resolveWindowSize(cfg, opts)
    const windowId = `win_${randomUUID().replace(/-/g, '').slice(0, 10)}`

    const bwOpts: BrowserWindowConstructorOptions = {
      width,
      height,
      show,
      title: 'Navora Browser',
      webPreferences: {
        partition: s.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Block media autoplay unless the document has user activation.
        autoplayPolicy: 'document-user-activation-required',
      },
    }

    // Session 已 setUserAgent + webRequest；同 partition 的窗口无需再 setUserAgent
    const win = new BrowserWindow(bwOpts)
    // Agent windows default muted so background tabs don't make noise.
    win.webContents.setAudioMuted(true)

    const rec: AgentWindowRecord = {
      windowId,
      sessionId,
      chatId: s.chatId,
      win,
      title: '新窗口',
      url: opts.url || 'about:blank',
      visible: show,
      loading: false,
    }
    s.windows.set(windowId, rec)
    this.windows.set(windowId, rec)

    this.attachWindowListeners(rec)
    this.installWindowOpenHandler(rec)
    this.installDialogHooks(rec)

    const url = opts.url?.trim() || 'about:blank'
    // Initial load is always programmatic — never a "user navigated" op.
    this.quietNavigateLog(windowId)
    void win.loadURL(url).catch((e) => console.warn('[browser] loadURL', e))

    this.emitTree(s.chatId)
    if (opts.openerWindowId) {
      this.events.onWindowOpened?.({
        chatId: s.chatId,
        sessionId,
        windowId,
        url,
        openerWindowId: opts.openerWindowId,
      })
    }
    const bounds = windowBoundsSnapshot(win)
    return {
      windowId,
      sessionId,
      title: rec.title,
      url: rec.url,
      visible: rec.visible,
      loading: rec.loading,
      ...bounds,
    }
  }

  private attachWindowListeners(rec: AgentWindowRecord): void {
    const { win } = rec
    const wc = win.webContents

    wc.on('page-title-updated', (_e, title) => {
      rec.title = title || rec.title
      this.emitTree(rec.chatId)
    })
    wc.on('did-navigate', (_e, url, httpResponseCode, httpStatusText) => {
      rec.url = url
      this.emitTree(rec.chatId)
      if (!this.shouldEmitUserNavigate(rec)) return
      const code = typeof httpResponseCode === 'number' ? httpResponseCode : undefined
      const text = typeof httpStatusText === 'string' ? httpStatusText : undefined
      this.events.onUserNavigate?.({
        chatId: rec.chatId,
        sessionId: rec.sessionId,
        windowId: rec.windowId,
        url,
        ...(code != null ? { statusCode: code } : {}),
        ...(text ? { statusText: text } : {}),
      })
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      rec.url = url
      this.emitTree(rec.chatId)
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      // Redirects / superseded navigations commonly emit ERR_ABORTED (-3).
      if (errorCode === -3) return
      const url = String(validatedURL || rec.url || '').trim()
      if (!url) return
      rec.url = url
      this.emitTree(rec.chatId)
      if (!this.shouldEmitUserNavigate(rec)) return
      this.events.onUserNavigate?.({
        chatId: rec.chatId,
        sessionId: rec.sessionId,
        windowId: rec.windowId,
        url,
        statusCode: typeof errorCode === 'number' ? errorCode : 0,
        statusText: String(errorDescription || 'load_failed').trim() || 'load_failed',
      })
    })
    wc.on('did-start-loading', () => {
      rec.loading = true
      this.emitTree(rec.chatId)
    })
    wc.on('did-stop-loading', () => {
      rec.loading = false
      rec.title = wc.getTitle() || rec.title
      rec.url = wc.getURL() || rec.url
      this.emitTree(rec.chatId)
    })
    win.on('show', () => {
      rec.visible = true
      this.emitTree(rec.chatId)
    })
    win.on('hide', () => {
      rec.visible = false
      this.emitTree(rec.chatId)
    })
    win.on('closed', () => {
      const byUser = !this.programmaticClose.delete(rec.windowId)
      this.detachWindow(rec.windowId, byUser)
    })
  }

  private installDialogHooks(rec: AgentWindowRecord): void {
    const wc = rec.win.webContents
    const inject = () => {
      void wc
        .executeJavaScript(
          `(() => {
            if (window.__navoraDlgInstalled) return true;
            window.__navoraDlgInstalled = true;
            window.__navoraDlg = window.__navoraDlg || {
              queue: [],
              policy: { confirm: true, promptAccept: true, promptText: '' },
            };
            const q = window.__navoraDlg;
            window.alert = (m) => { q.queue.push({ type: 'alert', message: String(m ?? '') }); };
            window.confirm = (m) => {
              q.queue.push({ type: 'confirm', message: String(m ?? '') });
              return !!q.policy.confirm;
            };
            window.prompt = (m, d) => {
              const def = d == null ? '' : String(d);
              q.queue.push({ type: 'prompt', message: String(m ?? ''), defaultValue: def });
              return q.policy.promptAccept ? String(q.policy.promptText || def) : null;
            };
            return true;
          })()`,
        )
        .catch(() => undefined)
    }
    wc.on('dom-ready', inject)
    wc.on('did-finish-load', inject)
  }

  private installWindowOpenHandler(rec: AgentWindowRecord): void {
    const cfg = () => this.getConfig()
    rec.win.webContents.setWindowOpenHandler((details) => {
      if (cfg().browser.block_window_open) {
        return { action: 'deny' }
      }
      const openUrl = details.url || 'about:blank'
      if (openUrl !== 'about:blank' && !isUrlAllowed(openUrl, cfg().browser.url_allowlist)) {
        console.warn('[browser] window.open blocked by allowlist', openUrl)
        return { action: 'deny' }
      }
      // Same-window navigation: avoids spawning extra Agent windows from target=_blank / window.open.
      if (openUrl && openUrl !== 'about:blank') {
        void rec.win.loadURL(openUrl).catch((e) => console.warn('[browser] same-window open failed', e))
      }
      return { action: 'deny' }
    })
  }

  setVisible(windowId: string, visible: boolean): void {
    const rec = this.windows.get(windowId)
    if (!rec || rec.win.isDestroyed()) throw new Error(`window_not_found:${windowId}`)
    if (visible) {
      rec.win.show()
      rec.win.focus()
    } else {
      rec.win.hide()
    }
    rec.visible = visible
    this.emitTree(rec.chatId)
  }

  /**
   * Resize / reposition an existing Agent window.
   * Only provided fields are changed; omitted fields keep current bounds.
   */
  setBounds(
    windowId: string,
    opts: { width?: number; height?: number; x?: number; y?: number },
  ): { width: number; height: number; x: number; y: number } {
    const rec = this.windows.get(windowId)
    if (!rec || rec.win.isDestroyed()) throw new Error(`window_not_found:${windowId}`)
    const cur = rec.win.getBounds()
    const next = { ...cur }
    if (opts.width != null && Number.isFinite(Number(opts.width))) {
      next.width = clampDim(Number(opts.width), WINDOW_MIN_W, WINDOW_MAX_W)
    }
    if (opts.height != null && Number.isFinite(Number(opts.height))) {
      next.height = clampDim(Number(opts.height), WINDOW_MIN_H, WINDOW_MAX_H)
    }
    if (opts.x != null && Number.isFinite(Number(opts.x))) {
      next.x = Math.round(Number(opts.x))
    }
    if (opts.y != null && Number.isFinite(Number(opts.y))) {
      next.y = Math.round(Number(opts.y))
    }
    rec.win.setBounds(next)
    this.emitTree(rec.chatId)
    return windowBoundsSnapshot(rec.win)
  }

  closeWindow(windowId: string): void {
    const rec = this.windows.get(windowId)
    if (!rec) return
    this.programmaticClose.add(windowId)
    if (!rec.win.isDestroyed()) {
      rec.win.destroy()
      // `closed` normally detaches; if it already did, stop here.
      if (!this.windows.has(windowId)) return
    }
    this.detachWindow(windowId, false)
  }

  private detachWindow(windowId: string, byUserClose: boolean): void {
    const rec = this.windows.get(windowId)
    if (!rec) return
    this.windows.delete(windowId)
    this.programmaticClose.delete(windowId)
    const s = this.sessions.get(rec.sessionId)
    s?.windows.delete(windowId)
    if (byUserClose) {
      this.events.onWindowClosedByUser?.({
        chatId: rec.chatId,
        sessionId: rec.sessionId,
        windowId,
      })
    }
    this.emitTree(rec.chatId)
  }

  async closeSession(sessionId: string, purge = false): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    for (const w of [...s.windows.values()]) {
      this.programmaticClose.add(w.windowId)
      if (!w.win.isDestroyed()) w.win.destroy()
      // Prefer closed-handler detach; fall back if window was already destroyed.
      if (this.windows.has(w.windowId)) this.detachWindow(w.windowId, false)
    }
    s.windows.clear()
    try {
      await s.ses.clearData()
    } catch {
      /* ignore */
    }
    if (purge && s.persist) {
      try {
        await s.ses.clearStorageData()
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId)
    this.emitTree(s.chatId)
  }

  async clearChat(chatId: string): Promise<void> {
    const ids = [...this.sessions.values()].filter((s) => s.chatId === chatId).map((s) => s.sessionId)
    for (const id of ids) {
      await this.closeSession(id, true)
    }
    this.nextIndex.delete(chatId)
  }
}

function sanitizeDownloadFilename(name: string): string {
  const base = path
    .basename(String(name || 'download').trim() || 'download')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 180)
  return base || 'download'
}

function uniqueDownloadPath(dirAbs: string, filename: string): string {
  const dest = path.join(dirAbs, filename)
  if (!fs.existsSync(dest)) return dest
  const ext = path.extname(filename)
  const stem = path.basename(filename, ext) || 'download'
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dirAbs, `${stem} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dirAbs, `${stem}-${Date.now()}${ext}`)
}
