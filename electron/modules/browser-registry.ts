import {browserTabShortcut} from '../../shared/browser-workspace'
import {BrowserHostManager,type BrowserPage} from './browser-host'
import {
  session as electronSession,
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
import { resolveAcceptLanguageList, resolveUserAgent } from '../../shared/config'
import { isUrlAllowed } from '../../shared/url-allowlist'
import type { BrowserNetworkManager } from './browser-network'
import type { PermissionGate } from './permission-gate'
import type { WorkspaceFiles } from './workspace-files'
import { jsDialogHost } from './js-dialog-host'

const WINDOW_MIN_W = 320
const WINDOW_MIN_H = 240
const WINDOW_MAX_W = 7680
const WINDOW_MAX_H = 4320

function displayBrowserTabTitle(url:string,title:string):string{
  if(!url||url==='about:blank')return '新标签页'
  if(title.trim()&&!/^(新标签页|新窗口|Navora Browser)$/i.test(title.trim()))return title.trim()
  try{return new URL(url).hostname||'网页'}catch{return title.trim()||'网页'}
}

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

function windowBoundsSnapshot(win: BrowserPage): {
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
  tabKey?: string
  crashed?: boolean
  loadError?: import('../../shared/browser-workspace').BrowserLoadError
  win: BrowserPage
  title: string
  faviconUrl?: string
  url: string
  restoreUrl?:string
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
  onVisit?:(info:{chatId:string;url:string;title:string})=>void
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
    state: 'intercepted' | 'started' | 'paused' | 'completed' | 'failed' | 'cancelled'
    url: string
    filename: string
    savePath?: string
    relPath?: string
    receivedBytes?: number
    totalBytes?: number
    error?: string
  }) => { id: string } | void
  /** Bind live DownloadItem for pause/resume/cancel from the downloads panel. */
  bindBrowserDownloadItem?: (entryId: string, item: Electron.DownloadItem) => void
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
  readonly hosts = new BrowserHostManager()
  private sessions = new Map<string, AgentSessionRecord>()
  private windows = new Map<string, AgentWindowRecord>()
  private persistenceFile:string|null=null
  private restoring=false
  private restored=false
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
    this.hosts.onChanged = () => { for (const id of this.nextIndex.keys()) this.emitTree(id) }
    this.hosts.onActivate = page => {
      if(this.restoring)return
      const rec=this.windows.get(page.id),url=rec?.restoreUrl
      if(!rec||!url)return
      rec.restoreUrl=undefined;rec.url=url
      this.quietNavigateLog(page.id)
      void page.loadURL(url).catch(error=>console.warn('[browser] restored page load failed',error))
    }
  }

  bindNetwork(network: BrowserNetworkManager): void {
    this.network = network
  }

  /** Re-bind webRequest listeners for all live sessions (config toggles). */
  reapplyNetwork(): void {
    if (!this.network) return
    for (const sessionId of this.sessions.keys()) {
      this.network.touch(sessionId)
    }
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
    return { 'accept-language': resolveAcceptLanguageList(this.getConfig()) }
  }

  /** session.setUserAgent once（UA/CH 按引擎适配）；不对每个 webContents 重复 setUserAgent。 */
  private applySessionUserAgent(s: AgentSessionRecord, ua: string): void {
    const trimmed = String(ua || '').trim()
    s.userAgent = trimmed
    // Stock Electron UA: leave runtime Client Hints alone and skip webRequest UA rewriting.
    // applyUserAgentOverride would invent "Google Chrome" brands while UA still says Electron/ —
    // that mismatch is worse than the honest Chromium-only CH defaults.
    if (/Electron\//i.test(trimmed)) {
      // Do not call setUserAgent / uaGuard — keep Chromium's default Client Hints
      // (grease + Chromium only). Rewriting invents Google Chrome brands and trips DD.
      s.userAgent = trimmed
      this.network?.setUaGuard(s.sessionId, '', {})
      return
    }
    const init = this.uaInitHeader()
    const parsed = applyUserAgentOverride(s.ses, trimmed, init)
    s.userAgent = parsed?.toString() || trimmed
    // Native setUserAgent + UserAgentURLLoaderThrottle already rewrite UA / CH.
    // webRequest onBeforeSendHeaders reorders headers and strips Sec-CH-UA-* — skip it.
    this.network?.setUaGuard(s.sessionId, '', {})
  }

  private emitTree(chatId: string): void {
    const ms = this.getConfig().browser.tree_update_debounce_ms || 100
    const prev = this.debounceTimers.get(chatId)
    if (prev) clearTimeout(prev)
    this.debounceTimers.set(
      chatId,
      setTimeout(() => {
        this.debounceTimers.delete(chatId)
        this.savePersistent()
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
          viewport:w.win.fixedViewport,
          zoomFactor:w.win.webContents.getZoomFactor(),
          canGoBack:w.win.webContents.navigationHistory.canGoBack(),
          canGoForward:w.win.webContents.navigationHistory.canGoForward(),
          crashed:w.crashed,
          loadError:w.loadError,
          annotationSelecting:w.win.annotationSelecting,
          tabKey: w.tabKey,
          pageId: w.windowId,
          hostWindowId: w.win.hostId || undefined,
          presentation: this.hosts.presentation(w.win),
          selected:this.hosts.selectedPageId===w.windowId,
          manualControl: w.win.manualControl,
          windowId: w.windowId,
          sessionId: w.sessionId,
          title: displayBrowserTabTitle(w.url,w.win.getTitle()||w.title),
          faviconUrl:w.faviconUrl,
          url: w.url,
          visible: w.win.isVisible(),
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

  markNavigationStopped(windowId:string){
    const rec=this.windows.get(windowId)
    if(!rec)return
    rec.win.navigationStopped=true
    rec.loading=false
    rec.loadError=undefined
    this.emitTree(rec.chatId)
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
        visible: rec.win.isVisible(),
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
    if (!w || w.win.isDestroyed() || w.win.webContents.isDestroyed()) {
      throw new Error(`window_not_found:${windowId}`)
    }
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

  createSession(chatId: string, opts: { persist?: boolean; ua?: string; restoreId?:string } = {}): BrowserTreeSession {
    const persist = opts.persist === true
    const index = (this.nextIndex.get(chatId) || 0) + 1
    this.nextIndex.set(chatId, index)
    const partition = this.partitionOf(chatId, index, persist)
    const ses = electronSession.fromPartition(partition)
    const cfg = this.getConfig()
    const ua = opts.ua?.trim() || resolveUserAgent(cfg)

    const sessionId = opts.restoreId || `sess_${randomUUID().replace(/-/g, '').slice(0, 10)}`
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
    // Apply webRequest (incl. optional DataDome telemetry) for this session.
    this.network?.touch(sessionId)
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

      const intercepted = this.events.onBrowserDownload?.({
        ...baseInfo,
        state: 'intercepted',
      })
      if (intercepted?.id) this.events.bindBrowserDownloadItem?.(intercepted.id, item)

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

      let accepted = false
      const attachDoneHandlers = () => {
        this.events.onBrowserDownload?.({
          ...baseInfo,
          state: 'started',
        })
        let lastProgressAt = 0
        item.on('updated', (_e, state) => {
          if (state === 'interrupted') {
            // User pause → keep paused; network blip → auto-resume after accept.
            if (item.isPaused()) {
              if (accepted) {
                this.events.onBrowserDownload?.({
                  ...baseInfo,
                  state: 'paused',
                  receivedBytes: item.getReceivedBytes(),
                  totalBytes: item.getTotalBytes() || totalBytes,
                })
              }
              return
            }
            if (!accepted) return
            try {
              item.resume()
            } catch {
              /* ignore */
            }
            return
          }
          if (state !== 'progressing') return
          if (!accepted) return
          const now = Date.now()
          if (now - lastProgressAt < 200) return
          lastProgressAt = now
          this.events.onBrowserDownload?.({
            ...baseInfo,
            state: item.isPaused() ? 'paused' : 'started',
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
        try {
          const st = item.getState()
          if (st === 'cancelled' || st === 'completed') return
        } catch {
          return
        }
        accepted = true
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
      restoreId?: string
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
    const windowId = opts.restoreId || `win_${randomUUID().replace(/-/g, '').slice(0, 10)}`

    const win = this.hosts.create(windowId, s.chatId, {
      partition: s.partition, contextIsolation: true, nodeIntegration: false,
      sandbox: false, autoplayPolicy: 'document-user-activation-required',
    }, {width,height}, show)
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
    // Do NOT attach CDP / js-dialog here — permanent debugger is a bot signal.
    // jsDialogHost installs lazily on browser_dialog (native handler if available).

    const url = opts.url?.trim() || 'about:blank'
    // Initial load is always programmatic — never a "user navigated" op.
    this.quietNavigateLog(windowId)
    // A new WebContentsView already owns an empty document. Loading about:blank
    // again races the first real navigation (and may report a spurious failure).
    if(url!=='about:blank')void win.loadURL(url).catch((e) => console.warn('[browser] loadURL', e))

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

    wc.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown'||!input.control&&!input.meta)return
      const key=input.key.toLowerCase(),host=this.hosts.getHost(win.hostId||'')
      if(!host)return
      const action=browserTabShortcut(input)
      if(action&&host.ready&&!host.suspended&&host.active===rec.windowId){event.preventDefault();if(action==='new')host.window.webContents.focus();host.window.webContents.send('navora:browser.tab-shortcut',{pageId:rec.windowId,action});return}
      if(input.alt||input.isComposing||input.isAutoRepeat)return
      if(key==='l'&&!input.shift){event.preventDefault();host.window.webContents.focus();host.window.webContents.send('navora:browser.address-focus',rec.windowId)}
      else if(key==='f'&&!input.shift&&host.ready&&!host.suspended&&host.active===rec.windowId){event.preventDefault();host.window.webContents.focus();host.window.webContents.send('navora:browser.find-shortcut',{pageId:rec.windowId,action:'open'})}
      else if(action==='close'){event.preventDefault();win.close()}
      else if(action==='new'){
        event.preventDefault();const created=this.createWindow(rec.sessionId,{show:false}),page=this.windows.get(created.windowId)!.win
        this.hosts.transfer(page,host.id);this.hosts.present(page)
      }else if(action==='next'||action==='previous'){
        event.preventDefault();const ids=[...host.pages],at=ids.indexOf(rec.windowId),next=ids[(at+(input.shift?-1:1)+ids.length)%ids.length]
        if(next)this.hosts.present(this.windows.get(next)!.win)
      }
    })
    wc.on('page-title-updated', (_e, title) => {
      rec.title = title || rec.title
      this.hosts.updateWindowTitle(win)
      this.emitTree(rec.chatId)
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      rec.faviconUrl = favicons.find(url => /^https?:/i.test(url))
      this.emitTree(rec.chatId)
    })
    wc.on('did-start-navigation',(_e,_url,inPlace,mainFrame)=>{
      if(!mainFrame||inPlace)return
      rec.loadError=undefined;rec.faviconUrl=undefined;rec.crashed=false;win.annotationSelecting=false;win.navigationStopped=false
      this.emitTree(rec.chatId)
    })
    wc.on('did-navigate', (_e, url, httpResponseCode, httpStatusText) => {
      rec.url = url
      this.hosts.updateWindowTitle(win)
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
    wc.on('did-navigate-in-page', (_e, url,mainFrame) => {
      if(!mainFrame)return
      rec.url = url
      this.hosts.updateWindowTitle(win)
      this.events.onVisit?.({chatId:rec.chatId,url,title:rec.title})
      this.emitTree(rec.chatId)
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      // Redirects / superseded navigations commonly emit ERR_ABORTED (-3).
      if (errorCode === -3 || win.navigationStopped) return
      const url = String(validatedURL || rec.url || '').trim()
      if (!url) return
      rec.url = url
      rec.loadError={code:errorCode,url,description:String(errorDescription||'load_failed')}
      rec.loading=false
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
    wc.on('render-process-gone',()=>{rec.crashed=true;rec.loading=false;win.annotationSelecting=false;this.emitTree(rec.chatId)})
    wc.on('did-start-loading', () => {
      // A late loading notification from a navigation that was just stopped
      // must not restore the stale stop-button state. A new main-frame
      // navigation clears this flag in did-start-navigation above.
      if(win.navigationStopped){rec.loading=false;this.emitTree(rec.chatId);return}
      rec.crashed=false
      rec.loading = true
      this.emitTree(rec.chatId)
    })
    wc.on('did-stop-loading', () => {
      rec.loading = false
      rec.title = wc.getTitle() || rec.title
      if(!rec.loadError)rec.url = wc.getURL() || rec.url
      this.hosts.updateWindowTitle(win)
      if(!rec.loadError)this.events.onVisit?.({chatId:rec.chatId,url:rec.url,title:rec.title})
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

  private installWindowOpenHandler(rec: AgentWindowRecord): void {
    const cfg = () => this.getConfig()
    rec.win.webContents.setWindowOpenHandler((details) => {
      if (cfg().browser.block_window_open) {
        return { action: 'deny' }
      }
      const openUrl = details.url || 'about:blank'
      if(openUrl!=='about:blank'&&!/^https?:\/\//i.test(openUrl))return {action:'deny'}
      if (openUrl !== 'about:blank' && !isUrlAllowed(openUrl, cfg().browser.url_allowlist)) {
        console.warn('[browser] window.open blocked by allowlist', openUrl)
        return { action: 'deny' }
      }
      // Electron's createWindow hook requires a WebContents attached to the
      // BrowserWindow created with its supplied options. BrowserPage uses a
      // WebContentsView instead, so route popups through our tab registry and
      // deny Chromium's incompatible native popup creation.
      try {
        const child=this.createWindow(rec.sessionId,{url:openUrl,show:false,openerWindowId:rec.windowId})
        const page=this.windows.get(child.windowId)?.win
        if(!page)return {action:'deny'}
        if(rec.win.hostId&&page.hostId!==rec.win.hostId)this.hosts.transfer(page,rec.win.hostId)
        this.hosts.present(page)
      } catch(error) {
        console.warn('[browser] could not open popup in a new tab',error)
      }
      return {action:'deny'}
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

  requestCloseWindow(windowId:string):void {this.windows.get(windowId)?.win.close()}

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
    jsDialogHost.uninstall(windowId)
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

  restorePersistent(file:string,chatExists:(id:string)=>boolean){
    if(this.restored)return
    this.restored=true;this.persistenceFile=file;this.restoring=true
    try{
      if(!fs.existsSync(file))return
      const records=JSON.parse(fs.readFileSync(file,'utf8'))
      if(!Array.isArray(records))return
      const detachedGroups=new Map<string,string>()
      for(const saved of records.slice(0,100).sort((a,b)=>a.sessionIndex-b.sessionIndex)){
        if(!chatExists(saved.chatId)||!Number.isSafeInteger(saved.sessionIndex)||saved.sessionIndex<1)continue
        this.nextIndex.set(saved.chatId,saved.sessionIndex-1)
        const session=this.createSession(saved.chatId,{persist:true,restoreId:/^sess_[a-f0-9]{10}$/.test(saved.sessionId)?saved.sessionId:undefined})
        this.nextIndex.set(saved.chatId,Math.max(saved.sessionIndex,this.nextIndex.get(saved.chatId)||0))
        for(const item of Array.isArray(saved.pages)?saved.pages.slice(0,32):[]){
          if(!/^win_[a-f0-9]{10}$/.test(item.id)||this.windows.has(item.id))continue
          if(item.url!=='about:blank'&&!/^https?:\/\//i.test(item.url))continue
          if(item.url!=='about:blank'&&!isUrlAllowed(item.url,this.getConfig().browser.url_allowlist))continue
          const created=this.createWindow(session.sessionId,{url:'about:blank',show:false,restoreId:item.id})
          const rec=this.windows.get(created.windowId)!
          if(item.url!=='about:blank'){rec.url=item.url;rec.restoreUrl=item.url}
          rec.tabKey=typeof item.tabKey==='string'?item.tabKey:undefined
          if(item.viewport&&Number.isFinite(item.viewport.width)&&Number.isFinite(item.viewport.height))rec.win.fixedViewport={width:clampDim(item.viewport.width,1,WINDOW_MAX_W),height:clampDim(item.viewport.height,1,WINDOW_MAX_H)}
          if(item.detached){const group=detachedGroups.get(item.host);if(group)this.hosts.transfer(rec.win,group);else detachedGroups.set(item.host,this.hosts.detach(rec.win))}
        }
      }
    }catch(error){console.warn('[browser] persistent workspace could not be restored',error)}finally{this.restoring=false}
  }
  savePersistent(){
    if(!this.persistenceFile||this.restoring)return
    const records=[...this.sessions.values()].filter(s=>s.persist).map(s=>({sessionId:s.sessionId,chatId:s.chatId,sessionIndex:s.sessionIndex,pages:[...s.windows.values()].filter(w=>!w.win.isDestroyed()).map(w=>({id:w.windowId,url:w.restoreUrl||w.win.webContents.getURL()||w.url,tabKey:w.tabKey,viewport:w.win.fixedViewport,detached:this.hosts.presentation(w.win)==='detached',host:w.win.hostId}))}))
    try{const temp=this.persistenceFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(records));fs.renameSync(temp,this.persistenceFile)}catch(error){console.warn('[browser] workspace save failed',error)}
  }
  shutdown(){this.savePersistent();this.persistenceFile=null;this.hosts.dispose()}

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
