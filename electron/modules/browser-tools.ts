import { desktopCapturer, net, screen, type NativeImage, type Session, type WebContents } from 'electron'
import { buildNavigationLikeHeaders } from './navigation-headers'
import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../../shared/config'
import type { SkillReviewDraft, SkillReviewRequest, SkillReviewResponse } from '../../shared/types'
import { isUrlAllowed } from '../../shared/url-allowlist'
import {
  listSettingsSections,
  prepareSettingsPatch,
  sanitizeConfigForAgent,
} from '../../shared/settings-tools'
import { fetchOpenAiModelsList, resolveOpenAiModelsEndpoints } from '../../shared/openai-models'
import { allocProviderId, normalizeProvider } from '../../shared/model-providers'
import type { AiProviderConfig } from '../../shared/config'
import type { BrowserRegistry } from './browser-registry'
import type { BrowserNetworkManager } from './browser-network'
import type { WorkspaceFiles } from './workspace-files'
import { isPathInsideOrEqual } from './workspace-files'
import type { FileDownloadService } from './file-download'
import type { WorkspaceShell } from './workspace-shell'
import type { ChatStore } from './chat-store'
import type { SecretsStore } from './secrets'
import type { SkillStore } from './skill-store'
import {
  networkAddCapability,
  toolNameToCapability,
  type PermissionGate,
} from './permission-gate'
import { dispatchTrustedPointer } from './trusted-input'
import {
  centerOf,
  clickSelector,
  hasClickSelector,
  hasQuerySelectorDeep,
  querySelectorDeep,
} from './deep-dom'
import { clickInIframe, clickInIframeWhenReady } from './iframe-click'
import { loadDocumentWithResponse } from './load-document-response'
import { resolveGeolocation } from './geolocation'
import { latestPackageVersion } from '../../shared/store'
import { resolvePluginDevMode } from '../../shared/config'
import { runPluginDevCli, type PluginDevCliAction } from './plugin-dev-cli'
import { packPluginProject } from './plugin-pack'
import { findPluginReadmePath } from './plugin-store'

export type ToolExecContext = {
  chatId: string
  /** Root chat id for session-scoped plugin-dev links (parent of sub-chats). */
  pluginScopeChatId?: string
  signal: AbortSignal
  registry: BrowserRegistry
  network: BrowserNetworkManager
  files: WorkspaceFiles
  downloads: FileDownloadService
  shell: WorkspaceShell
  chats: ChatStore
  gate: PermissionGate
  getConfig: () => AppConfig
  /** Optional: resolve API keys for model listing */
  secrets?: SecretsStore
  /** Persist partial AppConfig (same semantics as settings save). */
  updateConfig?: (patch: Record<string, unknown>) => AppConfig | Promise<AppConfig>
  /** Optional: user-imported Agent skills */
  skills?: SkillStore
  /** Optional: enabled Agent plugins (extra tools). */
  plugins?: import('./plugin-store').PluginStore
  /** Optional: local plugin/skill store catalog. */
  store?: import('./marketplace-client').MarketplaceClient
  /** Interactive skill create/update/delete/export review (UI dialog). */
  askSkillReview?: (
    partial: Omit<SkillReviewRequest, 'id' | 'timeoutMs' | 'wait' | 'canDefer' | 'proposalId'> & {
      timeoutMs?: number
      wait?: boolean
      canDefer?: boolean
      proposalId?: string
    },
  ) => Promise<SkillReviewResponse>
  onDownloadProgress?: (info: {
    dest: string
    partIndex: number
    partsTotal: number
    bytesTotal: number
    bytesPart: number
    contentLength?: number
    url?: string
  }) => void
}

/** Resolve dist/<packageId> after a successful plugin_build (must stay in workspace). */
function resolvePluginDistDir(
  workspaceRoot: string,
  cliCwd: string,
  packageId: string,
): string | null {
  const id = String(packageId || '').trim()
  if (!id) return null
  const root = path.resolve(workspaceRoot)
  for (const dir of [path.join(cliCwd, 'dist', id), path.join(root, 'dist', id)]) {
    const abs = path.resolve(dir)
    if (!isPathInsideOrEqual(root, abs)) continue
    try {
      if (fs.existsSync(path.join(abs, 'plugin.json')) && fs.existsSync(path.join(abs, 'main.cjs'))) {
        return abs
      }
    } catch {
      /* next */
    }
  }
  return null
}

function packageIdFromBuildStdout(stdout: string): string | null {
  const m = String(stdout || '').match(/build ok\s+(\S+)/)
  return m?.[1]?.trim() || null
}

/** Session-scoped plugin-dev link (current chat + subchats only). */
function linkPluginForChatSession(
  ctx: ToolExecContext,
  absDir: string,
): Record<string, unknown> {
  if (!ctx.plugins) return { ok: false, error: 'plugins_unavailable' }
  const scope = ctx.pluginScopeChatId || ctx.chats.resolvePluginScopeChatId(ctx.chatId)
  const linked = ctx.plugins.linkSessionPlugin(scope, absDir)
  if (!linked.ok) {
    return {
      ok: false,
      error: linked.error || 'link_failed',
      scopeChatId: scope,
      ...(linked.plugin?.error ? { loadError: linked.plugin.error } : {}),
    }
  }
  const pluginId = linked.plugin?.id || ''
  if (pluginId) {
    ctx.chats.upsertDevPluginLink(scope, { id: pluginId, path: absDir })
  }
  return {
    ok: true,
    scopeChatId: scope,
    scope: 'chat',
    pluginId,
    tools: linked.plugin?.tools || [],
    note: '仅对本会话及子对话生效，未写入全局插件列表。',
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`
}

/** Map file:// URL to a local filesystem path (Windows-aware). */
function localPathFromFileUrl(url: string): string | null {
  try {
    const u = new URL(String(url || '').trim())
    if (u.protocol !== 'file:') return null
    let p = decodeURIComponent(u.pathname || '')
    if (process.platform === 'win32') {
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      p = p.replace(/\//g, '\\')
    }
    return path.normalize(p)
  } catch {
    return null
  }
}

/**
 * Opening a local folder via Chromium file:// usually fails (ERR_FILE_NOT_FOUND).
 * Steer the agent to file_open / file_reveal instead.
 */
function rejectLocalFolderFileUrl(url: string): { ok: false; error: string; hint: string } | null {
  const fsPath = localPathFromFileUrl(url)
  if (!fsPath) return null
  let isDir = false
  try {
    isDir = fs.statSync(fsPath).isDirectory()
  } catch {
    const ext = path.extname(fsPath)
    isDir = !ext || /[/\\]$/.test(String(url))
  }
  if (!isDir) return null
  return {
    ok: false,
    error: 'local_folder_use_file_open',
    hint:
      '打开本地文件夹请用 file_open（或 file_reveal），path 相对当前工作区根（根目录用 "."）。禁止用 browser_open / browser_navigate 打开 file:// 目录。',
  }
}

function assertSkillWriteAllowed(ctx: ToolExecContext): { ok: false; error: string } | null {
  if (ctx.gate.getMode(ctx.chatId, 'skills.write') === 'deny') {
    return { ok: false, error: 'skills_write_denied' }
  }
  return null
}

async function reviewSkillWrite(
  ctx: ToolExecContext,
  partial: Omit<SkillReviewRequest, 'id' | 'timeoutMs' | 'chatId' | 'wait' | 'canDefer' | 'proposalId'> & {
    timeoutMs?: number
    wait?: boolean
    /** create/update may defer; delete/export cannot enter 待确认. */
    canDefer?: boolean
  },
): Promise<
  | { status: 'confirm'; res: SkillReviewResponse }
  | { status: 'deferred'; proposalId: string }
  | { ok: false; error: string }
> {
  const denied = assertSkillWriteAllowed(ctx)
  if (denied) return denied
  if (!ctx.askSkillReview) return { ok: false, error: 'skill_review_unavailable' }
  if (ctx.signal.aborted) return { ok: false, error: 'aborted' }
  const canDefer = partial.canDefer === true
  const wait = partial.wait === true
  const res = await ctx.askSkillReview({
    ...partial,
    chatId: ctx.chatId,
    wait,
    canDefer,
    timeoutMs: wait ? partial.timeoutMs : 0,
  })
  if (ctx.signal.aborted || res.source === 'aborted') return { ok: false, error: 'aborted' }
  if (res.source === 'timeout') return { ok: false, error: 'timeout' }
  if (res.source === 'cancel') return { ok: false, error: 'canceled' }
  if (res.source === 'deferred') {
    return { status: 'deferred', proposalId: String(res.proposalId || '') }
  }
  return { status: 'confirm', res }
}

function isWaitArg(rawArgs: Record<string, unknown>): boolean {
  // Default false: show dialog but do not block the agent turn.
  if (rawArgs.wait === true || rawArgs.await_result === true || rawArgs.wait_for_user === true) {
    return true
  }
  return false
}

function deferredToolResult(proposalId: string, waited: boolean, canDefer = true) {
  if (!canDefer) {
    return {
      ok: true,
      pending: true,
      waited: false,
      proposal_id: proposalId || null,
      note: '已弹出确认（不等待结果）。用户须当场确认或取消；不会进入设置→技能→待确认。',
    }
  }
  return {
    ok: true,
    pending: true,
    deferred: true,
    waited,
    proposal_id: proposalId || null,
    note: waited
      ? '用户选择稍后处理。提案已在 设置→技能→待确认，可稍后再打开确认。'
      : '已提交待确认提案（不等待结果）。用户可在弹窗确认，或稍后在 设置→技能→待确认 打开。',
  }
}

function headerLookup(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v
  }
  return undefined
}

/** Keep browser_flow step logs small for the model context. */
function truncateFlowResult(result: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    'ok',
    'matched',
    'matchReason',
    'waitTimedOut',
    'partial',
    'error',
    'method',
    'iframeSelector',
    'innerSelector',
    'x',
    'y',
    'detail',
    'hint',
    'url',
    'title',
    'delayedMs',
    'selectorFound',
    'waitedMs',
    'polls',
    'clearCheckMs',
    'offsetRatioX',
    'offsetRatioY',
  ]
  const out: Record<string, unknown> = {}
  for (const k of keep) {
    if (result[k] !== undefined) out[k] = result[k]
  }
  return out
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error('aborted')
}

function screenshotFormat(raw: unknown): 'png' | 'jpeg' {
  return String(raw || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png'
}

function screenshotQuality(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 80
  return Math.min(100, Math.max(1, Math.round(n)))
}

function defaultScreenshotPath(kind: 'page' | 'desktop', format: 'png' | 'jpeg', tag?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const safe = tag ? sanitizeFilename(tag) : ''
  const name =
    kind === 'page'
      ? `page_${safe || 'win'}_${ts}.${format === 'jpeg' ? 'jpg' : 'png'}`
      : `desktop_${ts}.${format === 'jpeg' ? 'jpg' : 'png'}`
  return `screenshots/${name}`
}

function sanitizeFilename(s: string): string {
  return String(s || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40)
}

function encodeNativeImage(img: NativeImage, format: 'png' | 'jpeg', quality: number): Buffer {
  if (format === 'jpeg') return img.toJPEG(quality)
  return img.toPNG()
}

function maybeResize(img: NativeImage, maxWidth?: number): NativeImage {
  if (!maxWidth || maxWidth <= 0) return img
  const { width } = img.getSize()
  if (width <= maxWidth) return img
  return img.resize({ width: maxWidth })
}

async function captureWindowImage(
  wc: WebContents,
  opts?: { maxWidth?: number; rect?: { x: number; y: number; width: number; height: number } },
): Promise<NativeImage> {
  const rect = opts?.rect
    ? {
        x: Math.max(0, Math.floor(opts.rect.x)),
        y: Math.max(0, Math.floor(opts.rect.y)),
        width: Math.max(1, Math.ceil(opts.rect.width)),
        height: Math.max(1, Math.ceil(opts.rect.height)),
      }
    : undefined
  const img = await wc.capturePage(rect, { stayHidden: true, stayAwake: true })
  if (!img || img.isEmpty()) throw new Error('screenshot_empty')
  return maybeResize(img, opts?.maxWidth)
}

type ScreenshotClip = { x: number; y: number; width: number; height: number }

function parseClipArg(raw: unknown): ScreenshotClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const width = Number(o.width)
  const height = Number(o.height)
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null
  if (width < 1 || height < 1) return null
  return { x, y, width, height }
}

function clampClipToViewport(clip: ScreenshotClip, vw: number, vh: number): ScreenshotClip | null {
  const left = Math.max(0, Math.min(vw, clip.x))
  const top = Math.max(0, Math.min(vh, clip.y))
  const right = Math.max(0, Math.min(vw, clip.x + clip.width))
  const bottom = Math.max(0, Math.min(vh, clip.y + clip.height))
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null
  return { x: left, y: top, width, height }
}

async function resolveElementScreenshotClip(
  wc: WebContents,
  worldId: number,
  selector: string,
  opts: { signal: AbortSignal; timeoutMs: number; padding?: number },
): Promise<{ clip: ScreenshotClip; viewport: { width: number; height: number } } | { error: string }> {
  const padding = Math.max(0, Math.min(80, Math.round(Number(opts.padding) || 0)))
  const located = (await isolatedEval(
    wc,
    worldId,
    `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'element_not_found' };
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (r.width < 1 || r.height < 1) return { ok: false, error: 'element_not_visible', viewport: { width: vw, height: vh } };
        const pad = ${padding};
        return {
          ok: true,
          clip: {
            x: r.left - pad,
            y: r.top - pad,
            width: r.width + pad * 2,
            height: r.height + pad * 2,
          },
          viewport: { width: vw, height: vh },
          raw: { x: r.left, y: r.top, width: r.width, height: r.height },
        };
      })()`,
    { timeoutMs: opts.timeoutMs, signal: opts.signal, label: 'screenshot_locate' },
  )) as
    | {
        ok: true
        clip: ScreenshotClip
        viewport: { width: number; height: number }
      }
    | { ok: false; error: string; viewport?: { width: number; height: number } }
    | null

  if (!located || typeof located !== 'object') return { error: 'element_not_found' }
  if (!('ok' in located) || !located.ok) {
    return { error: (located as { error?: string }).error || 'element_not_found' }
  }
  const clamped = clampClipToViewport(located.clip, located.viewport.width, located.viewport.height)
  if (!clamped) return { error: 'element_outside_viewport' }
  // Let layout settle after scrollIntoView before capture.
  await sleep(80, opts.signal)
  return { clip: clamped, viewport: located.viewport }
}

async function captureDesktopImage(opts?: {
  displayId?: number
  maxWidth?: number
}): Promise<{ img: NativeImage; displayId: number; label: string }> {
  const displays = screen.getAllDisplays()
  const display =
    opts?.displayId != null
      ? displays.find((d) => d.id === opts.displayId) || screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  const width = Math.max(1, Math.floor(display.size.width * scale))
  const height = Math.max(1, Math.floor(display.size.height * scale))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  })
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ||
    sources.find((s) => s.id.startsWith('screen:')) ||
    sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('desktop_capture_failed')
  return {
    img: maybeResize(source.thumbnail, opts?.maxWidth),
    displayId: display.id,
    label: source.name || `display_${display.id}`,
  }
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error('aborted')
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  try {
    const racers: Array<Promise<T>> = [
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout:${label}`)), Math.max(1, ms))
      }),
    ]
    if (signal) {
      racers.push(
        new Promise<T>((_, reject) => {
          onAbort = () => reject(new Error('aborted'))
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      )
    }
    return await Promise.race(racers)
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

type WaitUntilMode = 'none' | 'load' | 'text_stable'

type SoftWaitResult = {
  ready: boolean
  timedOut: boolean
  loadingMainFrame: boolean
  reason?: string
  /** True if main frame was loading when wait started (used for post-load settle). */
  wasLoading?: boolean
}

function parseWaitUntil(raw: unknown, fallback: WaitUntilMode): WaitUntilMode {
  const v = String(raw || '').trim()
  if (v === 'none' || v === 'load' || v === 'text_stable') return v
  return fallback
}

function pageWaitMeta(wc: WebContents, wait: SoftWaitResult) {
  return {
    partial: wait.timedOut || wait.loadingMainFrame || !wait.ready,
    loading: wait.loadingMainFrame || wc.isLoadingMainFrame(),
    waitTimedOut: wait.timedOut,
    waitReason: wait.reason,
    url: wc.getURL(),
    title: wc.getTitle(),
  }
}

/** Wait until main frame leaves loading; ignore subframe did-fail-load. Soft: timeout → timedOut. */
async function waitForMainFrameLoad(
  wc: WebContents,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<SoftWaitResult> {
  if (!wc.isLoadingMainFrame()) {
    return { ready: true, timedOut: false, loadingMainFrame: false, wasLoading: false }
  }
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const settle = () => {
          if (!wc.isLoadingMainFrame()) {
            cleanup()
            resolve()
          }
        }
        const onFinish = () => settle()
        const onStop = () => settle()
        const onFail = (
          _e: Electron.Event,
          _errCode: number,
          errDesc: string,
          _validatedURL: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame) return
          cleanup()
          reject(new Error(`load_failed:${errDesc}`))
        }
        const onAbort = () => {
          cleanup()
          reject(new Error('aborted'))
        }
        const cleanup = () => {
          wc.removeListener('did-finish-load', onFinish)
          wc.removeListener('did-stop-loading', onStop)
          wc.removeListener('did-fail-load', onFail)
          signal.removeEventListener('abort', onAbort)
        }
        wc.on('did-finish-load', onFinish)
        wc.on('did-stop-loading', onStop)
        wc.on('did-fail-load', onFail)
        signal.addEventListener('abort', onAbort, { once: true })
        // Race: loading may finish between isLoadingMainFrame check and listener attach
        settle()
      }),
      timeoutMs,
      'wait_load',
      signal,
    )
    return { ready: true, timedOut: false, loadingMainFrame: wc.isLoadingMainFrame(), wasLoading: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'aborted') throw e
    if (msg.startsWith('load_failed:')) throw e
    if (msg.startsWith('timeout:')) {
      return {
        ready: false,
        timedOut: true,
        loadingMainFrame: wc.isLoadingMainFrame(),
        reason: 'timeout:wait_load',
        wasLoading: true,
      }
    }
    throw e
  }
}

/**
 * Approximate network idle: main frame not loading for idleMs continuously.
 * Ignores long-lived connections that do not flip isLoadingMainFrame.
 */
async function waitForLoadingQuiet(
  wc: WebContents,
  idleMs: number,
  timeoutMs: number,
  signal: AbortSignal,
  opts?: { requireIdlePeriod?: boolean },
): Promise<SoftWaitResult> {
  const idle = Math.max(50, idleMs)
  const requirePeriod = Boolean(opts?.requireIdlePeriod)
  // Already settled and no post-load settle requested
  if (!requirePeriod && !wc.isLoadingMainFrame()) {
    return { ready: true, timedOut: false, loadingMainFrame: false }
  }
  const deadline = Date.now() + Math.max(1, timeoutMs)
  let quietSince = !wc.isLoadingMainFrame() ? Date.now() : 0
  while (Date.now() < deadline) {
    assertNotAborted(signal)
    if (wc.isLoadingMainFrame()) {
      quietSince = 0
    } else {
      if (!quietSince) quietSince = Date.now()
      if (Date.now() - quietSince >= idle) {
        return { ready: true, timedOut: false, loadingMainFrame: false }
      }
    }
    const slice = Math.min(100, Math.max(10, deadline - Date.now()))
    if (slice <= 0) break
    await sleep(slice, signal)
  }
  return {
    ready: !wc.isLoadingMainFrame(),
    timedOut: true,
    loadingMainFrame: wc.isLoadingMainFrame(),
    reason: 'timeout:network_idle',
  }
}

async function waitForTextStable(
  wc: WebContents,
  worldId: number,
  opts: {
    selector?: string
    stableMs?: number
    timeoutMs: number
    signal: AbortSignal
  },
): Promise<SoftWaitResult> {
  const stableMs = Math.max(100, opts.stableMs ?? 400)
  const deadline = Date.now() + Math.max(1, opts.timeoutMs)
  const sel = opts.selector ? JSON.stringify(opts.selector) : ''
  const sampleCode = sel
    ? `(() => {
        const el = document.querySelector(${sel});
        if (!el) return null;
        return String(el.innerText || '').slice(0, 8000);
      })()`
    : `(() => {
        if (!document.body) return null;
        return String(document.body.innerText || '').slice(0, 8000);
      })()`

  let last: string | null = null
  let sameSince = 0
  while (Date.now() < deadline) {
    assertNotAborted(opts.signal)
    let sample: string | null = null
    try {
      const v = await isolatedEval(wc, worldId, sampleCode, {
        timeoutMs: 3000,
        signal: opts.signal,
        label: 'text_stable_sample',
      })
      sample = v == null ? null : String(v)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'aborted') throw e
      // Renderer busy / navigating — keep polling until deadline
      sample = null
    }
    if (sample != null && sample === last && sample.length > 0) {
      if (!sameSince) sameSince = Date.now()
      if (Date.now() - sameSince >= stableMs) {
        return { ready: true, timedOut: false, loadingMainFrame: wc.isLoadingMainFrame() }
      }
    } else {
      last = sample
      sameSince = sample != null && sample.length > 0 ? Date.now() : 0
    }
    const slice = Math.min(200, Math.max(10, deadline - Date.now()))
    if (slice <= 0) break
    await sleep(slice, opts.signal)
  }
  return {
    ready: false,
    timedOut: true,
    loadingMainFrame: wc.isLoadingMainFrame(),
    reason: 'timeout:text_stable',
  }
}

async function applyPageWait(
  wc: WebContents,
  cfg: AppConfig,
  opts: {
    waitUntil: WaitUntilMode
    timeoutMs: number
    signal: AbortSignal
    selector?: string
    worldId?: number
  },
): Promise<SoftWaitResult> {
  if (opts.waitUntil === 'none') {
    return {
      ready: true,
      timedOut: false,
      loadingMainFrame: wc.isLoadingMainFrame(),
    }
  }

  let result: SoftWaitResult
  if (opts.waitUntil === 'text_stable') {
    // Cap text_stable — dynamic pages (ads/search) often never fully settle.
    const capped = Math.min(Math.max(1, opts.timeoutMs), 10000)
    result = await waitForTextStable(wc, opts.worldId ?? cfg.browser.evaluate_world_id, {
      selector: opts.selector,
      timeoutMs: capped,
      signal: opts.signal,
    })
  } else {
    result = await waitForMainFrameLoad(wc, opts.timeoutMs, opts.signal)
    if (result.ready && cfg.browser.wait.network_idle && result.wasLoading) {
      const idleMs = cfg.browser.wait.network_idle_ms || 500
      const remain = Math.min(opts.timeoutMs, Math.max(idleMs * 4, idleMs + 800))
      const quiet = await waitForLoadingQuiet(wc, idleMs, remain, opts.signal, {
        requireIdlePeriod: true,
      })
      if (!quiet.ready) result = quiet
    }
  }

  if (result.ready && cfg.browser.wait.delay_ms > 0) {
    await sleep(cfg.browser.wait.delay_ms, opts.signal)
  }
  return result
}

/** Short pre-wait for click/type/evaluate; soft-timeout never throws. */
async function prepareActionPageWait(
  wc: WebContents,
  cfg: AppConfig,
  rawArgs: Record<string, unknown>,
  opts: { signal: AbortSignal; worldId: number; selector?: string },
): Promise<SoftWaitResult> {
  const actionMs = cfg.browser.action_timeout_ms || 15000
  const waitBudget = Math.min(actionMs, Number(rawArgs.waitTimeoutMs) || 5000)
  let waitUntil: WaitUntilMode
  if (rawArgs.waitUntil != null && String(rawArgs.waitUntil).trim()) {
    waitUntil = parseWaitUntil(rawArgs.waitUntil, 'load')
  } else if (rawArgs.iframeSelector) {
    // Iframe clicks should not wait for main-frame load (often never settles).
    waitUntil = 'none'
  } else if (wc.isLoadingMainFrame()) {
    waitUntil = 'load'
  } else if (cfg.browser.wait.load || cfg.browser.wait.network_idle) {
    waitUntil = 'load'
  } else {
    waitUntil = 'none'
  }
  return applyPageWait(wc, cfg, {
    waitUntil,
    timeoutMs: waitBudget,
    signal: opts.signal,
    selector: opts.selector,
    worldId: opts.worldId,
  })
}

async function waitForSelectorSoft(
  wc: WebContents,
  worldId: number,
  selector: string,
  timeoutMs: number,
  signal: AbortSignal,
  opts?: { pierce?: boolean; pollMs?: number },
): Promise<{ found: boolean; timedOut: boolean; via?: 'deep' | 'js' }> {
  const pierce = opts?.pierce !== false
  const ac = new AbortController()
  const onParentAbort = () => ac.abort()
  signal.addEventListener('abort', onParentAbort)
  const budget = Math.max(1, timeoutMs)
  const pollEvery = Math.max(40, Math.min(120, opts?.pollMs ?? 80))
  const timer = setTimeout(() => ac.abort(), budget)
  try {
    await withTimeout(
      pollUntil(async () => {
        assertNotAborted(ac.signal)
        const slice = Math.max(80, Math.min(400, budget))
        if (pierce && hasQuerySelectorDeep(wc)) {
          try {
            const info = await withTimeout(
              querySelectorDeep(wc, selector, { pierce: true }),
              slice,
              'deep_sel',
              ac.signal,
            )
            if (info) return true
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'aborted') throw e
            /* fall through to page JS */
          }
        }
        try {
          const found = await isolatedEval(
            wc,
            worldId,
            `!!document.querySelector(${JSON.stringify(selector)})`,
            { timeoutMs: slice, signal: ac.signal, label: 'action_sel_poll' },
          )
          return Boolean(found)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'aborted') throw e
          return false
        }
      }, pollEvery, ac.signal),
      budget,
      'wait_selector',
      signal,
    )
    return { found: true, timedOut: false, via: pierce && hasQuerySelectorDeep(wc) ? 'deep' : 'js' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'aborted' && signal.aborted) throw e
    return { found: false, timedOut: true }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onParentAbort)
    ac.abort()
  }
}

/** One-shot selector probe for tight wait loops (avoids nested poll + long deep timeouts). */
async function probeSelectorOnce(
  wc: WebContents,
  worldId: number,
  selector: string,
  signal: AbortSignal,
  opts?: { pierce?: boolean; sliceMs?: number },
): Promise<boolean> {
  const pierce = opts?.pierce !== false
  const slice = Math.max(60, Math.min(350, opts?.sliceMs ?? 280))
  if (pierce && hasQuerySelectorDeep(wc)) {
    try {
      const info = await withTimeout(
        querySelectorDeep(wc, selector, { pierce: true }),
        slice,
        'deep_once',
        signal,
      )
      if (info) return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'aborted') throw e
    }
  }
  try {
    return Boolean(
      await isolatedEval(
        wc,
        worldId,
        `!!document.querySelector(${JSON.stringify(selector)})`,
        { timeoutMs: slice, signal, label: 'sel_once' },
      ),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'aborted') throw e
    return false
  }
}

async function isolatedEval(
  wc: WebContents,
  worldId: number,
  code: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal; label?: string },
): Promise<unknown> {
  // Embed user code as JSON so syntax/runtime errors are caught inside the page
  // and returned with message/stack instead of Electron's opaque failure string.
  const wrapped = `(() => {
    const __navoraPack = (ok, payload) => Object.assign({ __navoraEval: true, ok }, payload);
    try {
      const __code = ${JSON.stringify(code)};
      let __value;
      try {
        __value = (0, eval)('(' + __code + ')');
      } catch (exprErr) {
        try {
          __value = (0, eval)(__code);
        } catch (stmtErr) {
          const e = stmtErr || exprErr;
          return __navoraPack(false, {
            error: String((e && e.message) || e),
            name: e && e.name ? String(e.name) : 'Error',
            stack: e && e.stack ? String(e.stack).slice(0, 2500) : undefined,
            phase: 'execute',
          });
        }
      }
      try {
        return __navoraPack(true, {
          value: JSON.parse(JSON.stringify(__value)),
        });
      } catch (serErr) {
        try {
          return __navoraPack(true, {
            value: String(__value),
            note: 'result_coerced_to_string',
            serializeError: String((serErr && serErr.message) || serErr),
          });
        } catch {
          return __navoraPack(false, {
            error: 'result_not_serializable',
            name: 'DataCloneError',
            hint: '返回值必须可 JSON 序列化（勿返回 DOM/函数/循环引用）',
            phase: 'serialize',
          });
        }
      }
    } catch (e) {
      return __navoraPack(false, {
        error: String((e && e.message) || e),
        name: e && e.name ? String(e.name) : 'Error',
        stack: e && e.stack ? String(e.stack).slice(0, 2500) : undefined,
        phase: 'wrapper',
      });
    }
  })()`

  const run = async () => {
    const fn = (wc as WebContents & {
      executeJavaScriptInIsolatedWorld?: (
        worldId: number,
        scripts: Array<{ code: string }>,
      ) => Promise<unknown>
    }).executeJavaScriptInIsolatedWorld
    if (typeof fn !== 'function') {
      return wc.executeJavaScript(wrapped)
    }
    return fn.call(wc, worldId, [{ code: wrapped }])
  }

  const timeoutMs = opts?.timeoutMs ?? 15000
  let raw: unknown
  try {
    raw = await withTimeout(run(), timeoutMs, opts?.label || 'evaluate', opts?.signal)
  } catch (e) {
    throw enrichScriptHostError(e)
  }

  if (raw && typeof raw === 'object' && (raw as { __navoraEval?: boolean }).__navoraEval === true) {
    const env = raw as {
      ok: boolean
      value?: unknown
      error?: string
      name?: string
      stack?: string
      hint?: string
      note?: string
      phase?: string
      serializeError?: string
    }
    if (!env.ok) {
      const parts = [
        env.name && env.name !== 'Error' ? `${env.name}: ` : '',
        env.error || 'script_error',
        env.hint ? ` (${env.hint})` : '',
        env.phase ? ` [phase=${env.phase}]` : '',
      ]
      const err = new Error(parts.join('')) as Error & {
        navoraScript?: typeof env
      }
      err.name = env.name || 'ScriptError'
      if (env.stack) err.stack = env.stack
      err.navoraScript = env
      throw err
    }
    return env.value
  }
  return raw
}

function enrichScriptHostError(e: unknown): Error {
  if (e instanceof Error && (e as Error & { navoraScript?: unknown }).navoraScript) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (msg === 'aborted' || msg.startsWith('timeout:')) {
    return e instanceof Error ? e : new Error(msg)
  }
  if (/Script failed to execute/i.test(msg)) {
    const err = new Error(
      `${msg} — 页面未返回详细异常（常见：导航中、frame 已销毁、CSP 拦截，或隔离世界不可用）。`,
    ) as Error & { cause?: unknown }
    err.name = 'ScriptHostError'
    err.cause = e
    return err
  }
  return e instanceof Error ? e : new Error(msg)
}

async function sessionFetch(
  ses: Session,
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: 'follow' | 'error'
    /** Prefer navigation-like headers + headerOrder (default true). */
    navigationLike?: boolean
    userAgent?: string
    acceptLanguage?: string
    referer?: string
  },
): Promise<{ status: number; url: string; headers: Record<string, string>; body: string }> {
  const redirect = init.redirect === 'error' ? 'error' : 'follow'
  const navigationLike = init.navigationLike !== false
  let headers = init.headers
  let headerOrder: string[] | undefined
  if (navigationLike) {
    const built = buildNavigationLikeHeaders({
      base: init.headers,
      userAgent: init.userAgent,
      acceptLanguage: init.acceptLanguage,
      referer: init.referer,
    })
    headers = built.headers
    headerOrder = built.headerOrder
  } else if (init.headers) {
    headerOrder = Object.keys(init.headers)
  }

  // Avoid custom protocol.handle intercepting Agent HTTP tools.
  const fetchInit: Record<string, unknown> = {
    method: init.method || 'GET',
    headers,
    body: init.body,
    redirect,
    bypassCustomProtocolHandlers: true,
  }
  if (headerOrder?.length) fetchInit.headerOrder = headerOrder

  const sesFetch = (ses as Session & { fetch?: typeof fetch }).fetch
  let res: Response
  if (typeof sesFetch === 'function') {
    res = await sesFetch.call(ses, url, fetchInit as RequestInit)
  } else {
    res = await net.fetch(url, {
      ...fetchInit,
      session: ses,
    } as never)
  }
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    outHeaders[k] = v
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    url: res.url,
    headers: outHeaders,
    body: buf.toString('utf8'),
  }
}

export async function executeAgentTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecContext,
  opts?: { skipPermission?: boolean },
): Promise<unknown> {
  assertNotAborted(ctx.signal)
  const cfg = ctx.getConfig()

  if (!opts?.skipPermission) {
    // Combined open checks both session.create and window.create.
    if (name === 'browser_open') {
      const sessGate = await ctx.gate.check(
        ctx.chatId,
        'session.create',
        `browser_open ${JSON.stringify(rawArgs).slice(0, 200)}`,
        ctx.signal,
      )
      if (!sessGate.ok) return { ok: false, error: sessGate.reason || 'permission_denied' }
      const winGate = await ctx.gate.check(
        ctx.chatId,
        'window.create',
        `browser_open window ${JSON.stringify(rawArgs).slice(0, 200)}`,
        ctx.signal,
      )
      if (!winGate.ok) return { ok: false, error: winGate.reason || 'permission_denied' }
    } else if (name === 'browser_flow') {
      const steps = Array.isArray(rawArgs.steps) ? rawArgs.steps : []
      const needsClick = steps.some((s) => {
        if (!s || typeof s !== 'object') return false
        const d = String((s as { do?: unknown; action?: unknown }).do || (s as { action?: unknown }).action || '')
        return d === 'click'
      })
      for (const capability of needsClick ? (['wait', 'click'] as const) : (['wait'] as const)) {
        const gate = await ctx.gate.check(
          ctx.chatId,
          capability,
          `browser_flow ${capability} ${JSON.stringify(rawArgs).slice(0, 160)}`,
          ctx.signal,
        )
        if (!gate.ok) return { ok: false, error: gate.reason || 'permission_denied' }
      }
    } else if (
      ctx.plugins?.ownsToolForChat(ctx.pluginScopeChatId || ctx.chatId, name)
    ) {
      const pluginGate = await ctx.plugins.checkPermissions(name, rawArgs, ctx)
      if (!pluginGate.ok) return { ok: false, error: pluginGate.error || 'permission_denied' }
    } else {
      let capability = toolNameToCapability(name)
      if (name === 'browser_network_rule_add') {
        capability = networkAddCapability(String(rawArgs.kind || 'observe'))
      }

      if (capability) {
        const gate = await ctx.gate.check(
          ctx.chatId,
          capability,
          `${name} ${JSON.stringify(rawArgs).slice(0, 200)}`,
          ctx.signal,
        )
        if (!gate.ok) return { ok: false, error: gate.reason || 'permission_denied' }
      }
    }
  }

  switch (name) {
    case 'datetime_now': {
      const now = new Date()
      const locale = String(rawArgs.locale || 'zh-CN').trim() || 'zh-CN'
      const pad = (n: number) => String(n).padStart(2, '0')
      const offsetMin = -now.getTimezoneOffset()
      const sign = offsetMin >= 0 ? '+' : '-'
      const abs = Math.abs(offsetMin)
      const tzOffset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
      let timeZone = 'local'
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
      } catch {
        /* ignore */
      }
      const weekdays = ['日', '一', '二', '三', '四', '五', '六']
      return {
        ok: true,
        iso: now.toISOString(),
        localIso: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${tzOffset}`,
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        weekday: now.getDay(),
        weekdayLabel: `星期${weekdays[now.getDay()]}`,
        timeZone,
        utcOffset: tzOffset,
        epochMs: now.getTime(),
        formatted: now.toLocaleString(locale, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      }
    }

    case 'geolocation_get': {
      const preferRaw = String(rawArgs.prefer || 'auto').trim().toLowerCase()
      const prefer =
        preferRaw === 'device' || preferRaw === 'ip' || preferRaw === 'auto' ? preferRaw : 'auto'
      const timeoutMs = Number(rawArgs.timeoutMs)
      return resolveGeolocation({
        prefer,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
        signal: ctx.signal,
      })
    }

    case 'browser_list_resources':
      return { ok: true, tree: ctx.registry.getTree(ctx.chatId) }

    case 'browser_open': {
      const urlEarly = rawArgs.url ? String(rawArgs.url) : 'about:blank'
      if (urlEarly !== 'about:blank') {
        const folderReject = rejectLocalFolderFileUrl(urlEarly)
        if (folderReject) return folderReject
      }
      const existing = ctx.registry.getTree(ctx.chatId)
      const sessionCount = existing.length
      const windowCount = existing.reduce((n, s) => n + (s.windows?.length || 0), 0)
      // Hard efficiency guard: one browse context per chat unless user needs isolation.
      if (sessionCount >= 1) {
        return {
          ok: false,
          error: 'reuse_existing_session',
          hint:
            '本 Chat 已有浏览器资源。请用 browser_list_resources 查看，并用已有 windowId 执行 browser_navigate / browser_get。不要为同一问题再次 browser_open。',
          tree: existing,
          sessionCount,
          windowCount,
        }
      }
      const wantPersist = rawArgs.persist === true
      let persist = false
      if (wantPersist) {
        const persistGate = await ctx.gate.check(
          ctx.chatId,
          'session.persist',
          '创建持久化 Session（Cookie/存储可跨重启保留）。拒绝则改为创建临时 Session。',
          ctx.signal,
        )
        persist = persistGate.ok
      }
      const sess = ctx.registry.createSession(ctx.chatId, {
        persist,
        ua: rawArgs.ua ? String(rawArgs.ua) : undefined,
      })
      const url = urlEarly
      if (url !== 'about:blank' && !isUrlAllowed(url, cfg.browser.url_allowlist)) {
        await ctx.registry.closeSession(sess.sessionId, true)
        return { ok: false, error: 'url_not_allowed' }
      }
      const win = ctx.registry.createWindow(sess.sessionId, {
        url,
        show: rawArgs.show !== undefined ? Boolean(rawArgs.show) : undefined,
        width: rawArgs.width != null ? Number(rawArgs.width) : undefined,
        height: rawArgs.height != null ? Number(rawArgs.height) : undefined,
      })
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, win.windowId)
      const wc = rec.win.webContents
      const defaultUntil: WaitUntilMode =
        url !== 'about:blank' && (cfg.browser.wait.load || cfg.browser.wait.network_idle)
          ? 'load'
          : 'none'
      let waitUntil = parseWaitUntil(rawArgs.waitUntil, defaultUntil)
      // Search/result pages rarely reach a quiet text_stable; prefer load.
      if (
        waitUntil === 'text_stable' &&
        /(?:^|\.)baidu\.com|(?:^|\.)bing\.com|(?:^|\.)google\./i.test(url)
      ) {
        waitUntil = 'load'
      }
      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.navigation_timeout_ms || 30000
      const waitTimeout = waitUntil === 'text_stable' ? Math.min(timeout, 10000) : timeout
      const wait =
        waitUntil === 'none'
          ? ({
              ready: !wc.isLoadingMainFrame(),
              timedOut: false,
              loadingMainFrame: wc.isLoadingMainFrame(),
            } satisfies SoftWaitResult)
          : await applyPageWait(wc, cfg, {
              waitUntil,
              timeoutMs: waitTimeout,
              signal: ctx.signal,
              worldId: cfg.browser.evaluate_world_id,
            })
      return {
        ok: true,
        session: sess,
        persist: sess.persist,
        ...(wantPersist && !persist
          ? {
              persistDenied: true,
              note: 'User denied persist; created ephemeral Session (cookies/storage cleared when closed).',
            }
          : {}),
        window: {
          ...win,
          url: wc.getURL() || win.url,
          title: wc.getTitle() || win.title,
          loading: wc.isLoadingMainFrame(),
        },
        ...pageWaitMeta(wc, wait),
      }
    }

    case 'browser_session_create': {
      // Default ephemeral; persist only when the model explicitly requests it.
      const wantPersist = rawArgs.persist === true
      let persist = false
      if (wantPersist) {
        const persistGate = await ctx.gate.check(
          ctx.chatId,
          'session.persist',
          '创建持久化 Session（Cookie/存储可跨重启保留）。拒绝则改为创建临时 Session。',
          ctx.signal,
        )
        persist = persistGate.ok
      }
      const sess = ctx.registry.createSession(ctx.chatId, {
        persist,
        ua: rawArgs.ua ? String(rawArgs.ua) : undefined,
      })
      return {
        ok: true,
        session: sess,
        persist: sess.persist,
        ...(wantPersist && !persist
          ? {
              persistDenied: true,
              note: 'User denied persist; created ephemeral Session (cookies/storage cleared when closed).',
            }
          : {}),
      }
    }

    case 'browser_session_close': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      ctx.network.disposeSession(sessionId)
      await ctx.registry.closeSession(sessionId, true)
      return { ok: true }
    }

    case 'browser_session_clear': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      await ctx.registry.clearSessionData(sessionId)
      return { ok: true }
    }

    case 'browser_session_set_proxy': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const rules = String(rawArgs.proxyRules || '').trim()
      await ctx.registry.setProxy(sessionId, rules || null)
      return { ok: true, proxyRules: rules || null }
    }

    case 'browser_session_set_ua': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const ua = String(rawArgs.userAgent || '')
      ctx.registry.setUserAgent(sessionId, ua)
      return { ok: true }
    }

    case 'browser_session_fetch': {
      const sessionId = String(rawArgs.sessionId || '')
      const url = String(rawArgs.url || '')
      const s = ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      if (!isUrlAllowed(url, cfg.browser.url_allowlist)) {
        return { ok: false, error: 'url_not_allowed' }
      }
      const result = await withTimeout(
        sessionFetch(s.ses, url, {
          method: rawArgs.method ? String(rawArgs.method) : 'GET',
          headers: (rawArgs.headers as Record<string, string>) || undefined,
          body: rawArgs.body != null ? String(rawArgs.body) : undefined,
          redirect: rawArgs.redirect === 'error' ? 'error' : 'follow',
          navigationLike: rawArgs.navigationLike === false ? false : true,
          userAgent: typeof rawArgs.userAgent === 'string' ? rawArgs.userAgent : undefined,
          acceptLanguage:
            typeof rawArgs.acceptLanguage === 'string' ? rawArgs.acceptLanguage : undefined,
          referer: typeof rawArgs.referer === 'string' ? rawArgs.referer : undefined,
        }),
        cfg.browser.fetch_timeout_ms || 30000,
        'fetch',
        ctx.signal,
      )
      const maxChars = cfg.browser.fetch_max_body_chars || 200000
      const maxBytes = cfg.browser.fetch_max_body_bytes || 524288
      const bodyBuf = Buffer.from(result.body, 'utf8')
      let body = result.body
      if (bodyBuf.length > maxBytes) {
        body = truncate(bodyBuf.subarray(0, maxBytes).toString('utf8'), maxChars)
      } else {
        body = truncate(body, maxChars)
      }
      return {
        ok: true,
        status: result.status,
        url: result.url,
        headers: result.headers,
        body,
      }
    }

    case 'browser_window_create': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const url = rawArgs.url ? String(rawArgs.url) : 'about:blank'
      if (url !== 'about:blank' && !isUrlAllowed(url, cfg.browser.url_allowlist)) {
        return { ok: false, error: 'url_not_allowed' }
      }
      const win = ctx.registry.createWindow(sessionId, {
        url,
        show: rawArgs.show !== undefined ? Boolean(rawArgs.show) : undefined,
        width: rawArgs.width != null ? Number(rawArgs.width) : undefined,
        height: rawArgs.height != null ? Number(rawArgs.height) : undefined,
      })
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, win.windowId)
      const wc = rec.win.webContents
      const defaultUntil: WaitUntilMode =
        url !== 'about:blank' && (cfg.browser.wait.load || cfg.browser.wait.network_idle)
          ? 'load'
          : 'none'
      const waitUntil = parseWaitUntil(rawArgs.waitUntil, defaultUntil)
      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.navigation_timeout_ms || 30000
      const wait =
        waitUntil === 'none'
          ? ({
              ready: !wc.isLoadingMainFrame(),
              timedOut: false,
              loadingMainFrame: wc.isLoadingMainFrame(),
            } satisfies SoftWaitResult)
          : await applyPageWait(wc, cfg, {
              waitUntil,
              timeoutMs: timeout,
              signal: ctx.signal,
              worldId: cfg.browser.evaluate_world_id,
            })
      return {
        ok: true,
        window: {
          ...win,
          url: wc.getURL() || win.url,
          title: wc.getTitle() || win.title,
          loading: wc.isLoadingMainFrame(),
        },
        ...pageWaitMeta(wc, wait),
      }
    }

    case 'browser_window_close': {
      const windowId = String(rawArgs.windowId || '')
      ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      ctx.registry.closeWindow(windowId)
      return { ok: true }
    }

    case 'browser_window_set_visible': {
      const windowId = String(rawArgs.windowId || '')
      ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      ctx.registry.setVisible(windowId, Boolean(rawArgs.visible))
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const bounds = rec.win.isDestroyed()
        ? undefined
        : {
            width: rec.win.getBounds().width,
            height: rec.win.getBounds().height,
            x: rec.win.getBounds().x,
            y: rec.win.getBounds().y,
          }
      return { ok: true, windowId, visible: Boolean(rawArgs.visible), ...(bounds || {}) }
    }

    case 'browser_window_set_bounds': {
      const windowId = String(rawArgs.windowId || '')
      ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const hasAny =
        rawArgs.width != null ||
        rawArgs.height != null ||
        rawArgs.x != null ||
        rawArgs.y != null
      if (!hasAny) {
        return { ok: false, error: 'bounds_required', detail: 'Pass width and/or height and/or x/y' }
      }
      const bounds = ctx.registry.setBounds(windowId, {
        width: rawArgs.width != null ? Number(rawArgs.width) : undefined,
        height: rawArgs.height != null ? Number(rawArgs.height) : undefined,
        x: rawArgs.x != null ? Number(rawArgs.x) : undefined,
        y: rawArgs.y != null ? Number(rawArgs.y) : undefined,
      })
      return { ok: true, windowId, ...bounds }
    }

    case 'browser_navigate': {
      const windowId = String(rawArgs.windowId || '')
      const url = String(rawArgs.url || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const folderReject = rejectLocalFolderFileUrl(url)
      if (folderReject) return folderReject
      if (!isUrlAllowed(url, cfg.browser.url_allowlist)) {
        return { ok: false, error: 'url_not_allowed' }
      }
      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.navigation_timeout_ms || 30000
      const wc = rec.win.webContents
      try {
        await withTimeout(wc.loadURL(url), timeout, 'navigate', ctx.signal)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.startsWith('timeout:')) {
          // Soft: keep window; Agent can still get partial content
          return {
            ok: true,
            url: wc.getURL(),
            title: wc.getTitle(),
            partial: true,
            loading: wc.isLoadingMainFrame(),
            waitTimedOut: true,
            waitReason: msg,
          }
        }
        throw e
      }
      const waitUntil = parseWaitUntil(
        rawArgs.waitUntil,
        cfg.browser.wait.load || cfg.browser.wait.network_idle ? 'load' : 'none',
      )
      const wait = await applyPageWait(wc, cfg, {
        waitUntil,
        timeoutMs: timeout,
        signal: ctx.signal,
        worldId: cfg.browser.evaluate_world_id,
      })
      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
        ...pageWaitMeta(wc, wait),
      }
    }

    case 'browser_load_url_with_response': {
      const windowId = String(rawArgs.windowId || '')
      const url = String(rawArgs.url || '').trim()
      const body = rawArgs.body != null ? String(rawArgs.body) : ''
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      if (!url) return { ok: false, error: 'url_required' }
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'url_must_be_http_https' }
      if (!isUrlAllowed(url, cfg.browser.url_allowlist)) {
        return { ok: false, error: 'url_not_allowed' }
      }
      if (!body) return { ok: false, error: 'body_required' }
      if (body.length > 2_000_000) return { ok: false, error: 'body_too_large' }

      const statusCodeRaw = Number(rawArgs.statusCode)
      const statusCode =
        Number.isFinite(statusCodeRaw) && statusCodeRaw >= 100 && statusCodeRaw <= 599
          ? Math.floor(statusCodeRaw)
          : 200

      let headers: Record<string, string> | undefined
      if (rawArgs.headers && typeof rawArgs.headers === 'object' && !Array.isArray(rawArgs.headers)) {
        headers = {}
        for (const [k, v] of Object.entries(rawArgs.headers as Record<string, unknown>)) {
          if (v == null) continue
          headers[String(k)] = String(v)
        }
      }

      const preferRaw = String(rawArgs.prefer || rawArgs.injectMode || 'native')
        .trim()
        .toLowerCase()
      const prefer = preferRaw === 'protocol' ? 'protocol' : 'native'

      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.navigation_timeout_ms || 30000
      const wc = rec.win.webContents
      const sessRec = ctx.registry.getSessionRecord(rec.sessionId)
      try {
        await withTimeout(
          loadDocumentWithResponse(
            wc,
            url,
            { statusCode, headers, body },
            sessRec?.ses,
            { prefer },
          ),
          timeout,
          'load_url_with_response',
          ctx.signal,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.startsWith('timeout:')) {
          return {
            ok: true,
            url: wc.getURL(),
            title: wc.getTitle(),
            partial: true,
            loading: wc.isLoadingMainFrame(),
            waitTimedOut: true,
            waitReason: msg,
          }
        }
        throw e
      }
      const waitUntil = parseWaitUntil(
        rawArgs.waitUntil,
        cfg.browser.wait.load || cfg.browser.wait.network_idle ? 'load' : 'none',
      )
      const wait = await applyPageWait(wc, cfg, {
        waitUntil,
        timeoutMs: timeout,
        signal: ctx.signal,
        worldId: cfg.browser.evaluate_world_id,
      })
      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
        injectModeUsed: prefer,
        ...pageWaitMeta(wc, wait),
      }
    }

    case 'browser_wait': {
      const windowId = String(rawArgs.windowId || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.action_timeout_ms || 15000
      const pierce = rawArgs.pierce !== false
      const pollMs = Math.max(40, Math.min(500, Number(rawArgs.pollMs) || 80))

      const untilSelector =
        rawArgs.untilSelector != null
          ? String(rawArgs.untilSelector)
          : rawArgs.selector
            ? String(rawArgs.selector)
            : ''
      const untilGone = rawArgs.untilGone != null ? String(rawArgs.untilGone) : ''
      const untilTextContains =
        rawArgs.untilTextContains != null ? String(rawArgs.untilTextContains) : ''
      const untilTitleContains =
        rawArgs.untilTitleContains != null ? String(rawArgs.untilTitleContains) : ''
      const untilTitleNotContains =
        rawArgs.untilTitleNotContains != null ? String(rawArgs.untilTitleNotContains) : ''
      const untilUrlContains =
        rawArgs.untilUrlContains != null ? String(rawArgs.untilUrlContains) : ''
      const untilUrlNotContains =
        rawArgs.untilUrlNotContains != null ? String(rawArgs.untilUrlNotContains) : ''

      const hasCondition = Boolean(
        untilSelector ||
          untilGone ||
          untilTextContains ||
          untilTitleContains ||
          untilTitleNotContains ||
          untilUrlContains ||
          untilUrlNotContains,
      )

      if (hasCondition) {
        const deadline = Date.now() + timeout
        let matched = false
        let matchReason = ''

        while (Date.now() < deadline) {
          assertNotAborted(ctx.signal)
          const pageUrl = wc.getURL()
          const pageTitle = wc.getTitle()

          if (untilTitleContains && pageTitle.includes(untilTitleContains)) {
            matched = true
            matchReason = 'untilTitleContains'
            break
          }
          if (untilTitleNotContains && !pageTitle.includes(untilTitleNotContains)) {
            matched = true
            matchReason = 'untilTitleNotContains'
            break
          }
          if (untilUrlContains && pageUrl.includes(untilUrlContains)) {
            matched = true
            matchReason = 'untilUrlContains'
            break
          }
          if (untilUrlNotContains && !pageUrl.includes(untilUrlNotContains)) {
            matched = true
            matchReason = 'untilUrlNotContains'
            break
          }
          if (untilSelector) {
            const found = await probeSelectorOnce(wc, worldId, untilSelector, ctx.signal, {
              pierce,
              sliceMs: Math.min(320, Math.max(80, deadline - Date.now())),
            })
            if (found) {
              matched = true
              matchReason = 'untilSelector'
              break
            }
          } else if (untilGone) {
            let present = false
            if (pierce && hasQuerySelectorDeep(wc)) {
              try {
                present = Boolean(
                  await withTimeout(
                    querySelectorDeep(wc, untilGone, { pierce: true }),
                    2000,
                    'wait_gone_deep',
                    ctx.signal,
                  ),
                )
              } catch {
                present = false
              }
            }
            if (!present) {
              try {
                present = Boolean(
                  await isolatedEval(
                    wc,
                    worldId,
                    `!!document.querySelector(${JSON.stringify(untilGone)})`,
                    { timeoutMs: 2000, signal: ctx.signal, label: 'wait_gone' },
                  ),
                )
              } catch {
                present = false
              }
            }
            if (!present) {
              matched = true
              matchReason = 'untilGone'
              break
            }
          }
          if (untilTextContains) {
            try {
              const text = String(
                (await isolatedEval(
                  wc,
                  worldId,
                  `(() => (document.body && (document.body.innerText || '')) || '')`,
                  { timeoutMs: 3000, signal: ctx.signal, label: 'wait_text' },
                )) || '',
              )
              if (text.includes(untilTextContains)) {
                matched = true
                matchReason = 'untilTextContains'
                break
              }
            } catch {
              /* keep polling */
            }
          }
          const remain = deadline - Date.now()
          if (remain <= 0) break
          await sleep(Math.min(pollMs, remain), ctx.signal)
        }
        return {
          ok: true,
          matched,
          matchReason: matched ? matchReason : undefined,
          waitTimedOut: !matched,
          partial: !matched,
          url: wc.getURL(),
          title: wc.getTitle(),
          loading: wc.isLoadingMainFrame(),
          hint: matched
            ? undefined
            : '等待条件未在超时内满足；可加大 timeoutMs 或改用其它 until* 条件。',
        }
      }

      const wantLoad =
        rawArgs.load !== false && (rawArgs.load || cfg.browser.wait.load || cfg.browser.wait.network_idle)
      const wantStable = Boolean(rawArgs.textStable) || String(rawArgs.waitUntil || '') === 'text_stable'
      let waitLegacy = {
        ready: true,
        timedOut: false,
        loadingMainFrame: wc.isLoadingMainFrame(),
      }
      if (wantStable) {
        waitLegacy = await applyPageWait(wc, cfg, {
          waitUntil: 'text_stable',
          timeoutMs: timeout,
          signal: ctx.signal,
          selector: untilSelector || undefined,
          worldId,
        })
      } else if (wantLoad) {
        waitLegacy = await applyPageWait(wc, cfg, {
          waitUntil: 'load',
          timeoutMs: timeout,
          signal: ctx.signal,
          worldId,
        })
      }
      let selectorFound
      if (untilSelector && !wantStable) {
        const sel = await waitForSelectorSoft(wc, worldId, untilSelector, timeout, ctx.signal, {
          pierce,
        })
        selectorFound = sel.found
        if (!sel.found) {
          waitLegacy = {
            ready: false,
            timedOut: true,
            loadingMainFrame: wc.isLoadingMainFrame(),
            reason: 'timeout:wait_selector',
          }
        }
      }
      const delay = Number(rawArgs.delayMs) || 0
      if (delay > 0) await sleep(delay, ctx.signal)
      return {
        ok: true,
        selectorFound,
        ...pageWaitMeta(wc, waitLegacy),
      }
    }

    case 'browser_click': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || '')
      const iframeSelector = rawArgs.iframeSelector ? String(rawArgs.iframeSelector) : ''
      const pierce = rawArgs.pierce !== false
      const buttonRaw = String(rawArgs.button || 'left')
      const button = (
        ['left', 'middle', 'right', 'back', 'forward'].includes(buttonRaw) ? buttonRaw : 'left'
      )
      const clickCount = Math.max(1, Math.min(3, Number(rawArgs.clickCount) || 1))
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      const actionMs = cfg.browser.action_timeout_ms || 15000
      const wait = await prepareActionPageWait(wc, cfg, rawArgs, {
        signal: ctx.signal,
        worldId,
        selector: iframeSelector || selector,
      })
      const meta = {
        ...pageWaitMeta(wc, wait),
      }

      if (iframeSelector) {
        const fr = await clickInIframe(wc, {
          iframeSelector,
          innerSelector: rawArgs.innerSelector
            ? String(rawArgs.innerSelector)
            : selector && selector !== iframeSelector
              ? selector
              : undefined,
          offsetX: typeof rawArgs.offsetX === 'number' ? rawArgs.offsetX : undefined,
          offsetY: typeof rawArgs.offsetY === 'number' ? rawArgs.offsetY : undefined,
          offsetRatioX:
            typeof rawArgs.offsetRatioX === 'number' ? rawArgs.offsetRatioX : undefined,
          offsetRatioY:
            typeof rawArgs.offsetRatioY === 'number' ? rawArgs.offsetRatioY : undefined,
        })
        return { ...fr, ...meta }
      }

      if (!selector) {
        return { ok: false, error: 'selector_required', ...meta }
      }

      const selWaitMs = Math.min(actionMs, Number(rawArgs.waitTimeoutMs) || 5000)
      const sel = await waitForSelectorSoft(wc, worldId, selector, selWaitMs, ctx.signal, {
        pierce,
      })
      if (!sel.found) {
        return {
          ok: false,
          error: 'element_not_found',
          ...meta,
          waitTimedOut: meta.waitTimedOut || sel.timedOut,
          hint: '若目标在 iframe 内，请传 iframeSelector（及 innerSelector 或 offsetRatioX/Y）。',
        }
      }

      if (hasClickSelector(wc)) {
        try {
          const ok = await clickSelector(wc, selector, {
            button,
            clickCount,
            pierce,
            scrollIntoView: true,
          })
          if (ok) {
            return {
              ok: true,
              method: 'clickSelector',
              pierce,
              ...meta,
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/not_found|element_not_found|null/i.test(msg)) {
            return { ok: false, error: 'element_not_found', ...meta }
          }
        }
      }

      let box = null
      if (pierce && hasQuerySelectorDeep(wc)) {
        const info = await querySelectorDeep(wc, selector, {
          pierce: true,
          scrollIntoView: true,
        })
        if (info && info.width >= 1 && info.height >= 1) box = centerOf(info)
      }
      if (!box) {
        box = (await isolatedEval(
          wc,
          worldId,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
          })()`,
          { timeoutMs: actionMs, signal: ctx.signal, label: 'click_locate' },
        ))
      }
      if (!box) return { ok: false, error: 'element_not_found', ...meta }
      await dispatchTrustedPointer(wc, {
        action: 'down',
        x: box.x,
        y: box.y,
        button: button === 'middle' || button === 'right' ? button : 'left',
        clickCount,
      })
      await dispatchTrustedPointer(wc, {
        action: 'up',
        x: box.x,
        y: box.y,
        button: button === 'middle' || button === 'right' ? button : 'left',
        clickCount,
      })
      return { ok: true, x: box.x, y: box.y, method: 'pointer', pierce, ...meta }
    }

    case 'browser_flow': {
      const windowId = String(rawArgs.windowId || '')
      ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const rawSteps = Array.isArray(rawArgs.steps) ? rawArgs.steps : []
      if (rawSteps.length > 12) {
        return { ok: false, error: 'too_many_steps', max: 12 }
      }

      type FlowStep = Record<string, unknown>
      const steps: FlowStep[] = []
      for (const s of rawSteps) {
        if (!s || typeof s !== 'object') {
          return { ok: false, error: 'invalid_step' }
        }
        const step = s as FlowStep
        const kind = String(step.do || step.action || '')
          .trim()
          .toLowerCase()
        if (kind !== 'wait' && kind !== 'click' && kind !== 'delay' && kind !== 'sleep') {
          return {
            ok: false,
            error: 'invalid_step_do',
            detail: 'Each step needs do: wait | click | delay',
          }
        }
        steps.push({ ...step, do: kind === 'sleep' ? 'delay' : kind })
      }

      const goal = String(rawArgs.goal || rawArgs.preset || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_')
      const DEFAULT_OFFSET_VARIANTS = [0.08, 0.1, 0.12, 0.14, 0.16, 0.2]

      // Optional presets — prefer explicit steps from skills when site-specific.
      if (
        !steps.length &&
        (goal === 'appear_then_click' || goal === 'click_when' || goal === 'click_when_ready')
      ) {
        const sel = String(
          rawArgs.untilSelector || rawArgs.selector || rawArgs.iframeSelector || '',
        ).trim()
        if (!sel) {
          return {
            ok: false,
            error: 'goal_needs_selector',
            detail: 'appear_then_click requires untilSelector / iframeSelector',
          }
        }
        const iframeSel = String(rawArgs.iframeSelector || sel).trim()
        steps.push(
          { do: 'wait', untilSelector: sel, timeoutMs: Number(rawArgs.locateTimeoutMs) || 8000 },
          {
            do: 'click',
            ...(rawArgs.iframeSelector || /iframe/i.test(iframeSel)
              ? {
                  iframeSelector: iframeSel,
                  offsetRatioX:
                    typeof rawArgs.offsetRatioX === 'number' ? rawArgs.offsetRatioX : 0.12,
                  offsetRatioY:
                    typeof rawArgs.offsetRatioY === 'number' ? rawArgs.offsetRatioY : 0.5,
                }
              : { selector: sel }),
          },
        )
      }

      if (!steps.length) {
        return {
          ok: false,
          error: 'steps_required',
          hint: '传 steps，或使用 goal:"appear_then_click"（需 untilSelector / iframeSelector）。',
        }
      }

      const retries = Math.min(
        8,
        Math.max(
          0,
          Number.isFinite(Number(rawArgs.retries)) ? Number(rawArgs.retries) : 2,
        ),
      )
      const retryDelayMs = Math.min(10000, Math.max(0, Number(rawArgs.retryDelayMs) || 300))
      const onStepError = String(rawArgs.onStepError || 'retry_from')
      const retryFrom = Math.min(
        steps.length - 1,
        Math.max(0, Number.isFinite(Number(rawArgs.retryFrom)) ? Number(rawArgs.retryFrom) : 0),
      )
      const maxTotalMs = Math.min(180000, Math.max(3000, Number(rawArgs.maxTotalMs) || 60000))
      const clickJitter = rawArgs.clickJitter !== false
      const flowDeadline = Date.now() + maxTotalMs
      /** Cap settle delays before iframe clicks so flow reaches click faster. */
      const maxSettleDelayMs = Math.min(800, Math.max(0, Number(rawArgs.maxSettleDelayMs) || 50))
      /** After an iframe click, how long to wait for clear before clicking again (default 3500). */
      const clearCheckMs = Math.min(20000, Math.max(500, Number(rawArgs.clearCheckMs) || 3500))

      const offsetVariants: number[] = (
        Array.isArray(rawArgs.offsetVariants) ? rawArgs.offsetVariants : DEFAULT_OFFSET_VARIANTS
      )
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      const offsetVariantList = offsetVariants.length ? offsetVariants : DEFAULT_OFFSET_VARIANTS

      const iframeSelectorList: string[] = (() => {
        const out: string[] = []
        const push = (s: string) => {
          const t = String(s || '').trim()
          if (t && !out.includes(t)) out.push(t)
        }
        if (Array.isArray(rawArgs.iframeSelectors)) {
          for (const s of rawArgs.iframeSelectors) push(String(s))
        }
        push(String(rawArgs.iframeSelector || ''))
        for (const s of steps) {
          if (String(s.do) === 'click') push(String(s.iframeSelector || ''))
          if (String(s.do) === 'wait') push(String(s.untilSelector || s.selector || ''))
        }
        return out
      })()

      const looksLikeClearanceFlow = steps.some((s) => {
        const kind = String(s.do || '')
        if (kind === 'wait') {
          if (String(s.untilTitleNotContains || '').trim()) return true
          if (String(s.untilUrlNotContains || '').trim()) return true
        }
        return false
      })

      const log: Array<Record<string, unknown>> = []
      let attempts = 0
      let cursor = 0
      let chainAttempt = 0

      const summarizePage = () => {
        try {
          const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
          const wc = rec.win.webContents
          return {
            url: wc.getURL(),
            title: wc.getTitle(),
            loading: wc.isLoadingMainFrame(),
          }
        } catch {
          return {}
        }
      }

      const pageMatchesClearNeedles = () => {
        try {
          const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
          const wc = rec.win.webContents
          const title = wc.getTitle()
          const url = wc.getURL()
          const titleNeedles: string[] = []
          const urlNeedles: string[] = []
          for (const s of steps) {
            if (String(s.do) !== 'wait') continue
            const t = String(s.untilTitleNotContains || '').trim()
            const u = String(s.untilUrlNotContains || '').trim()
            if (t) titleNeedles.push(t)
            if (u) urlNeedles.push(u)
          }
          if (!titleNeedles.length && !urlNeedles.length) return false
          const titleOk =
            !titleNeedles.length || titleNeedles.every((n) => !title.includes(n))
          const urlOk = !urlNeedles.length || urlNeedles.every((n) => !url.includes(n))
          return titleOk && urlOk
        } catch {
          return false
        }
      }

      // Clear-condition already satisfied — skip remaining wait/click chain.
      if (looksLikeClearanceFlow && pageMatchesClearNeedles()) {
        return {
          ok: true,
          earlyExit: 'already_done',
          attempts: 0,
          steps: [],
          ...summarizePage(),
          hint: '页面已满足结束条件，跳过后续步骤。',
        }
      }

      const remainMs = () => Math.max(0, flowDeadline - Date.now())

      const isHardFail = (result: Record<string, unknown> | null | undefined) => {
        const err = String(result?.error || '')
        return (
          err === 'permission_denied' ||
          err === 'aborted' ||
          err === 'url_not_allowed' ||
          err.startsWith('unknown_tool')
        )
      }

      const stepSucceeded = (kind: string, result: Record<string, unknown>) => {
        if (kind === 'delay') return true
        if (kind === 'wait') {
          if (result.matched === true) return true
          if (result.matched === false) return false
          return result.ok !== false && !result.waitTimedOut
        }
        if (kind === 'click') return result.ok === true
        return result.ok === true
      }

      const withClickJitterArgs = (args: Record<string, unknown>, attempt: number) => {
        if (!clickJitter || attempt <= 0 || !args.iframeSelector) return args
        const baseX =
          typeof args.offsetRatioX === 'number' && Number.isFinite(args.offsetRatioX)
            ? Number(args.offsetRatioX)
            : 0.12
        const baseY =
          typeof args.offsetRatioY === 'number' && Number.isFinite(args.offsetRatioY)
            ? Number(args.offsetRatioY)
            : 0.5
        const deltas = [0, -0.02, 0.02, -0.04, 0.03, -0.01]
        const d = deltas[attempt % deltas.length]
        return {
          ...args,
          offsetRatioX: Math.min(0.4, Math.max(0.04, baseX + d)),
          offsetRatioY: baseY,
        }
      }

      /** wait(untilSelector) + optional delay + click(iframeSelector) → click as soon as iframe exists. */
      const matchClickWhenReady = (from: number) => {
        const w = steps[from]
        if (!w || String(w.do) !== 'wait') return null
        const waitSel = String(w.untilSelector || w.selector || '').trim()
        if (!waitSel) return null
        let idx = from + 1
        let settleMs = 40
        if (steps[idx] && String(steps[idx].do) === 'delay') {
          settleMs = Math.min(
            maxSettleDelayMs,
            Math.max(0, Number(steps[idx].delayMs) || Number(steps[idx].timeoutMs) || 40),
          )
          idx += 1
        }
        const c = steps[idx]
        if (!c || String(c.do) !== 'click') return null
        const iframeSel = String(c.iframeSelector || '').trim()
        if (!iframeSel) return null
        const clickFallbacks = Array.isArray(c.iframeSelectors)
          ? (c.iframeSelectors as unknown[]).map((s) => String(s).trim()).filter(Boolean)
          : []
        const related =
          iframeSel === waitSel ||
          clickFallbacks.includes(waitSel) ||
          iframeSelectorList.includes(waitSel)
        if (!related) return null
        return { waitStep: w, clickStep: c, settleMs, endIndex: idx }
      }

      /** wait+click + title/url clear wait → burst: click, short clear-check, reclick… */
      const matchClearBurst = (from: number) => {
        const pair = matchClickWhenReady(from)
        if (!pair) return null
        const clearStep = steps[pair.endIndex + 1]
        if (!clearStep || String(clearStep.do) !== 'wait') return null
        const isClear =
          Boolean(String(clearStep.untilTitleNotContains || '').trim()) ||
          Boolean(String(clearStep.untilUrlNotContains || '').trim())
        if (!isClear) return null
        return { ...pair, clearStep, clearEndIndex: pair.endIndex + 1 }
      }

      const runIframeClickWhenReady = async (
        clickStep: FlowStep,
        attempt: number,
        timeoutMs: number,
        settleMs: number,
      ) => {
        const baseX =
          typeof clickStep.offsetRatioX === 'number' && Number.isFinite(clickStep.offsetRatioX)
            ? Number(clickStep.offsetRatioX)
            : offsetVariantList[0]
        // Prefer explicit offsetVariants by attempt; small jitter remains as fallback spice.
        let ox = offsetVariantList[attempt % offsetVariantList.length] ?? baseX
        if (clickJitter && attempt > 0) {
          const deltas = [0, -0.015, 0.015, -0.03, 0.025]
          ox = Math.min(0.4, Math.max(0.04, ox + deltas[attempt % deltas.length]))
        }
        const oy =
          typeof clickStep.offsetRatioY === 'number' && Number.isFinite(clickStep.offsetRatioY)
            ? Number(clickStep.offsetRatioY)
            : 0.5
        const primary = String(clickStep.iframeSelector || iframeSelectorList[0] || '').trim()
        const selectors = [
          primary,
          ...iframeSelectorList,
          ...(Array.isArray(clickStep.iframeSelectors)
            ? (clickStep.iframeSelectors as unknown[]).map((s) => String(s))
            : []),
        ].filter(Boolean)
        const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
        const fr = await clickInIframeWhenReady(
          rec.win.webContents,
          {
            iframeSelector: primary || selectors[0],
            iframeSelectors: selectors,
            innerSelector: clickStep.innerSelector ? String(clickStep.innerSelector) : undefined,
            offsetX: typeof clickStep.offsetX === 'number' ? Number(clickStep.offsetX) : undefined,
            offsetY: typeof clickStep.offsetY === 'number' ? Number(clickStep.offsetY) : undefined,
            offsetRatioX: ox,
            offsetRatioY: oy,
            preferOffset: true,
            locateBudgetMs: 500,
          },
          {
            timeoutMs,
            settleMs,
            pollMs: 45,
            signal: ctx.signal,
            minWidth: Math.max(0, Number(rawArgs.iframeMinWidth) || 0),
            minHeight: Math.max(0, Number(rawArgs.iframeMinHeight) || 0),
            stableMs: Math.max(0, Number(rawArgs.iframeStableMs) || 0),
          },
        )
        return { ...fr, offsetRatioX: ox, offsetRatioY: oy }
      }

      while (cursor < steps.length) {
        assertNotAborted(ctx.signal)
        if (remainMs() <= 0) {
          return {
            ok: false,
            error: 'max_total_ms',
            attempts,
            steps: log,
            ...summarizePage(),
            hint: 'browser_flow 总时长耗尽。可加大 maxTotalMs，或缩短单步 timeoutMs。',
          }
        }

        const burst = matchClearBurst(cursor)
        if (burst) {
          if (looksLikeClearanceFlow && pageMatchesClearNeedles()) {
            return {
              ok: true,
              earlyExit: 'already_clear',
              attempts,
              steps: log,
              ...summarizePage(),
            }
          }
          const locateTimeout = Math.min(
            remainMs(),
            Math.max(200, Number(burst.waitStep.timeoutMs) || 8000),
          )
          const clearFinal = Math.min(
            remainMs(),
            Math.max(500, Number(burst.clearStep.timeoutMs) || 15000),
          )
          let cleared = false
          for (let a = 0; a <= retries; a++) {
            assertNotAborted(ctx.signal)
            if (remainMs() <= 0) break
            if (pageMatchesClearNeedles()) {
              cleared = true
              break
            }
            attempts += 1
            const fr = await runIframeClickWhenReady(
              burst.clickStep,
              a,
              Math.min(remainMs(), locateTimeout),
              burst.settleMs,
            )
            const clickOk = fr.ok === true
            log.push({
              index: cursor,
              do: 'wait+click',
              attempt: a,
              ok: clickOk,
              result: truncateFlowResult({
                ...fr,
                matched: clickOk,
                matchReason: clickOk ? 'click_when_ready' : undefined,
              }),
            })
            if (!clickOk) {
              if (pageMatchesClearNeedles()) {
                cleared = true
                break
              }
              if (a >= retries) break
              if (retryDelayMs > 0) await sleep(Math.min(retryDelayMs, remainMs()), ctx.signal)
              continue
            }
            // Short clear-check between clicks; full timeout only on last attempt.
            const clearBudget =
              a < retries
                ? Math.min(remainMs(), clearCheckMs)
                : Math.min(remainMs(), clearFinal)
            const { do: _cd, action: _ca, ...clearRest } = burst.clearStep
            const clearResult = (await executeAgentTool(
              'browser_wait',
              {
                windowId,
                ...clearRest,
                timeoutMs: clearBudget,
                pollMs: 80,
              },
              ctx,
              { skipPermission: true },
            )) as Record<string, unknown>
            const clearOk = clearResult.matched === true || pageMatchesClearNeedles()
            log.push({
              index: burst.clearEndIndex,
              do: 'wait',
              attempt: a,
              ok: clearOk,
              result: truncateFlowResult({
                ...clearResult,
                clearCheckMs: clearBudget,
              }),
            })
            if (clearOk) {
              cleared = true
              break
            }
            if (a < retries && retryDelayMs > 0) {
              await sleep(Math.min(retryDelayMs, remainMs()), ctx.signal)
            }
          }
          if (cleared || pageMatchesClearNeedles()) {
            return {
              ok: true,
              earlyExit: 'done_early',
              attempts,
              chainAttempts: retries + 1,
              steps: log,
              ...summarizePage(),
            }
          }
          return {
            ok: false,
            error: 'flow_exhausted',
            failedStep: burst.clearEndIndex,
            attempts,
            steps: log,
            ...summarizePage(),
            hint: '多次点击后条件仍未满足。可调 offsetRatioX / retries / clearCheckMs，或显示窗口后请用户协助。',
          }
        }

        const coalesced = matchClickWhenReady(cursor)
        if (coalesced) {
          attempts += 1
          if (looksLikeClearanceFlow && pageMatchesClearNeedles()) {
            return {
              ok: true,
              earlyExit: 'already_clear',
              attempts,
              chainAttempts: chainAttempt + 1,
              steps: log,
              ...summarizePage(),
            }
          }
          const timeout = Math.min(
            remainMs(),
            Math.max(200, Number(coalesced.waitStep.timeoutMs) || 8000),
          )
          const fr = await runIframeClickWhenReady(
            coalesced.clickStep,
            chainAttempt,
            timeout,
            coalesced.settleMs,
          )
          const clickOk = fr.ok === true
          log.push({
            index: cursor,
            do: 'wait+click',
            attempt: chainAttempt,
            ok: clickOk,
            result: truncateFlowResult({
              ...fr,
              matched: clickOk,
              matchReason: clickOk ? 'click_when_ready' : undefined,
            }),
          })
          if (clickOk) {
            cursor = coalesced.endIndex + 1
            if (looksLikeClearanceFlow && pageMatchesClearNeedles() && cursor < steps.length) {
              return {
                ok: true,
                earlyExit: 'done_early',
                attempts,
                chainAttempts: chainAttempt + 1,
                steps: log,
                ...summarizePage(),
              }
            }
            continue
          }
          if (looksLikeClearanceFlow && pageMatchesClearNeedles()) {
            return {
              ok: true,
              earlyExit: 'already_clear',
              attempts,
              chainAttempts: chainAttempt + 1,
              steps: log,
              ...summarizePage(),
              hint: '点击未命中 iframe，但页面状态已变化，视为成功。',
            }
          }
          if (onStepError === 'abort' || chainAttempt >= retries) {
            return {
              ok: false,
              error: 'flow_exhausted',
              failedStep: cursor,
              attempts,
              steps: log,
              ...summarizePage(),
              hint: 'iframe 未及时出现或点击未成功。可加大 wait timeoutMs / retries。',
            }
          }
          chainAttempt += 1
          if (retryDelayMs > 0) {
            await sleep(Math.min(retryDelayMs, remainMs()), ctx.signal)
          }
          cursor = onStepError === 'retry_step' ? cursor : retryFrom
          continue
        }

        const step = steps[cursor]
        const kind = String(step.do)
        attempts += 1

        let result: Record<string, unknown>
        if (kind === 'delay') {
          let ms = Math.min(remainMs(), Math.max(0, Number(step.delayMs) || Number(step.timeoutMs) || 300))
          // Shorten settle delay when the next step is an iframe click.
          const next = steps[cursor + 1]
          if (
            next &&
            String(next.do) === 'click' &&
            (next.iframeSelector || String(next.selector || '').includes('iframe'))
          ) {
            ms = Math.min(ms, maxSettleDelayMs)
          }
          if (ms > 0) await sleep(ms, ctx.signal)
          result = { ok: true, delayedMs: ms }
        } else if (kind === 'wait') {
          const stepTimeout = Math.min(
            remainMs(),
            Math.max(200, Number(step.timeoutMs) || cfg.browser.action_timeout_ms || 15000),
          )
          const { do: _d, action: _a, ...rest } = step
          result = (await executeAgentTool(
            'browser_wait',
            {
              ...rest,
              windowId,
              timeoutMs: stepTimeout,
              // Faster title/selector polling inside flow.
              pollMs: Number(rest.pollMs) || 80,
            },
            ctx,
            { skipPermission: true },
          )) as Record<string, unknown>
        } else {
          const { do: _d, action: _a, ...rest } = step
          const clickArgs = withClickJitterArgs(
            {
              ...rest,
              windowId,
              // Prefer short pre-click wait; sticky loading pages should not block clicks.
              waitUntil: rest.waitUntil ?? 'none',
              waitTimeoutMs: Number(rest.waitTimeoutMs) || 800,
            },
            chainAttempt,
          )
          // Standalone iframe click: also poll-until-ready instead of one-shot miss.
          if (clickArgs.iframeSelector) {
            const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
            const fr = await clickInIframeWhenReady(
              rec.win.webContents,
              {
                iframeSelector: String(clickArgs.iframeSelector),
                innerSelector: clickArgs.innerSelector
                  ? String(clickArgs.innerSelector)
                  : undefined,
                offsetX: typeof clickArgs.offsetX === 'number' ? clickArgs.offsetX : undefined,
                offsetY: typeof clickArgs.offsetY === 'number' ? clickArgs.offsetY : undefined,
                offsetRatioX:
                  typeof clickArgs.offsetRatioX === 'number' ? clickArgs.offsetRatioX : undefined,
                offsetRatioY:
                  typeof clickArgs.offsetRatioY === 'number' ? clickArgs.offsetRatioY : undefined,
                preferOffset: true,
                locateBudgetMs: 500,
              },
              {
                timeoutMs: Math.min(remainMs(), Number(rest.timeoutMs) || 5000),
                settleMs: 40,
                pollMs: 45,
                signal: ctx.signal,
              },
            )
            result = { ...fr }
          } else {
            result = (await executeAgentTool('browser_click', clickArgs, ctx, {
              skipPermission: true,
            })) as Record<string, unknown>
          }
        }

        const ok = stepSucceeded(kind, result)
        log.push({
          index: cursor,
          do: kind,
          attempt: chainAttempt,
          ok,
          result: truncateFlowResult(result),
        })

        if (ok) {
          cursor += 1
          // After a successful click/wait, end conditions may already hold — finish early.
          if (
            looksLikeClearanceFlow &&
            pageMatchesClearNeedles() &&
            cursor < steps.length
          ) {
            return {
              ok: true,
              earlyExit: 'done_early',
              attempts,
              chainAttempts: chainAttempt + 1,
              steps: log,
              ...summarizePage(),
            }
          }
          continue
        }

        // Wait for CF iframe timed out but page already navigated away — treat as success.
        if (
          looksLikeClearanceFlow &&
          pageMatchesClearNeedles() &&
          (kind === 'wait' || kind === 'click')
        ) {
          return {
            ok: true,
            earlyExit: 'already_clear',
            attempts,
            chainAttempts: chainAttempt + 1,
            steps: log,
            ...summarizePage(),
            hint: '等待/点击未按原条件完成，但页面状态已变化，视为成功。',
          }
        }

        if (isHardFail(result)) {
          return {
            ok: false,
            error: String(result.error || 'step_failed'),
            failedStep: cursor,
            attempts,
            steps: log,
            ...summarizePage(),
          }
        }

        if (onStepError === 'abort' || chainAttempt >= retries) {
          return {
            ok: false,
            error: 'flow_exhausted',
            failedStep: cursor,
            attempts,
            steps: log,
            ...summarizePage(),
            hint:
              kind === 'click'
                ? '点击未成功（iframe 可能刷新或热区偏移）。可调 offsetRatioX(0.08~0.16)、加大 retries，或 browser_window_set_visible(true)+agent_ask_user。'
                : '等待条件未满足。确认 until* 条件，或先 wait iframe 再 click。',
          }
        }

        chainAttempt += 1
        if (retryDelayMs > 0) {
          await sleep(Math.min(retryDelayMs, remainMs()), ctx.signal)
        }
        if (onStepError === 'retry_step') {
          // stay on cursor
        } else {
          // retry_from (default)
          cursor = retryFrom
        }
      }

      return {
        ok: true,
        attempts,
        chainAttempts: chainAttempt + 1,
        steps: log,
        ...summarizePage(),
      }
    }

    case 'browser_type': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || '')
      const text = String(rawArgs.text ?? '')
      const append = Boolean(rawArgs.append)
      const submit = Boolean(rawArgs.submit)
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      const actionMs = cfg.browser.action_timeout_ms || 15000
      const wait = await prepareActionPageWait(wc, cfg, rawArgs, {
        signal: ctx.signal,
        worldId,
        selector,
      })
      const meta = pageWaitMeta(wc, wait)
      const selWaitMs = Math.min(actionMs, Number(rawArgs.waitTimeoutMs) || 5000)
      const sel = await waitForSelectorSoft(wc, worldId, selector, selWaitMs, ctx.signal)
      if (!sel.found) {
        return {
          ok: false,
          error: 'element_not_found',
          ...meta,
          waitTimedOut: meta.waitTimedOut || sel.timedOut,
        }
      }
      const okFocus = await isolatedEval(
        wc,
        worldId,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          if (!${append} && 'value' in el) {
            el.value = '';
            try {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_) {}
          }
          return true;
        })()`,
        { timeoutMs: actionMs, signal: ctx.signal, label: 'type_focus' },
      )
      if (!okFocus) return { ok: false, error: 'element_not_found', ...meta }
      wc.insertText(text)
      if (submit) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      }
      return { ok: true, length: text.length, ...meta }
    }

    case 'browser_get': {
      const windowId = String(rawArgs.windowId || '')
      const what = String(rawArgs.what || 'text')
      const selector = rawArgs.selector ? String(rawArgs.selector) : ''
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const max = cfg.browser.page_get_max_chars || 80000
      const worldId = cfg.browser.evaluate_world_id
      const getMs = Math.max(cfg.browser.action_timeout_ms || 15000, 20000)
      if (what === 'title') {
        return {
          ok: true,
          value: wc.getTitle(),
          url: wc.getURL(),
          title: wc.getTitle(),
          loading: wc.isLoadingMainFrame(),
          partial: wc.isLoadingMainFrame(),
        }
      }
      if (what === 'url') {
        return {
          ok: true,
          value: wc.getURL(),
          url: wc.getURL(),
          title: wc.getTitle(),
          loading: wc.isLoadingMainFrame(),
          partial: wc.isLoadingMainFrame(),
        }
      }
      const waitBudget = Math.min(getMs, Number(rawArgs.waitTimeoutMs) || 8000)
      const defaultUntil: WaitUntilMode =
        cfg.browser.wait.load || cfg.browser.wait.network_idle
          ? 'load'
          : wc.isLoadingMainFrame()
            ? 'load'
            : 'none'
      const waitUntil = parseWaitUntil(rawArgs.waitUntil, defaultUntil)
      const wait = await applyPageWait(wc, cfg, {
        waitUntil,
        timeoutMs: waitBudget,
        signal: ctx.signal,
        selector: selector || undefined,
        worldId,
      })
      const meta = pageWaitMeta(wc, wait)
      const evalOpts = {
        timeoutMs: Math.max(3000, getMs - Math.min(waitBudget, 5000)),
        signal: ctx.signal,
        label: `get_${what}`,
      }
      try {
        if (what === 'text') {
          const code = selector
            ? `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return null;
                const s = el.innerText || '';
                return s.length > ${max} ? s.slice(0, ${max}) : s;
              })()`
            : `(() => {
                const s = document.body ? (document.body.innerText || '') : '';
                return s.length > ${max} ? s.slice(0, ${max}) : s;
              })()`
          const v = await isolatedEval(wc, worldId, code, evalOpts)
          if (v == null) return { ok: false, error: 'element_not_found', ...meta }
          const text = String(v)
          return { ok: true, value: text, ...meta }
        }
        if (what === 'html') {
          const code = selector
            ? `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return null;
                const s = el.outerHTML || '';
                return s.length > ${max} ? s.slice(0, ${max}) : s;
              })()`
            : `(() => {
                const s = document.documentElement ? document.documentElement.outerHTML : '';
                return s.length > ${max} ? s.slice(0, ${max}) : s;
              })()`
          const v = await isolatedEval(wc, worldId, code, evalOpts)
          if (v == null) return { ok: false, error: 'element_not_found', ...meta }
          return { ok: true, value: String(v), ...meta }
        }
        if (what === 'dom_summary') {
          const v = await isolatedEval(
            wc,
            worldId,
            `(() => {
              const pick = (sel, n) => [...document.querySelectorAll(sel)].slice(0, n).map(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id || undefined,
                name: el.getAttribute('name') || undefined,
                type: el.getAttribute('type') || undefined,
                text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 80),
                href: el.getAttribute('href') || undefined,
              }));
              return {
                title: document.title,
                url: location.href,
                headings: pick('h1,h2,h3', 20),
                links: pick('a[href]', 30),
                inputs: pick('input,textarea,select,button', 40),
              };
            })()`,
            evalOpts,
          )
          return { ok: true, value: v, ...meta }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'aborted') throw e
        // Prefer partial over hard failure when page is mid-load
        if (msg.startsWith('timeout:') && (meta.partial || wc.isLoadingMainFrame())) {
          return {
            ok: true,
            value: what === 'dom_summary' ? { title: wc.getTitle(), url: wc.getURL(), headings: [], links: [], inputs: [] } : '',
            partial: true,
            loading: true,
            waitTimedOut: meta.waitTimedOut,
            waitReason: msg,
            hint: '页面仍在加载或脚本超时；已返回空/不完整内容，可稍后 browser_wait(textStable) 再 get。',
          }
        }
        throw e
      }
      return { ok: false, error: 'unknown_what', ...meta }
    }

    case 'browser_evaluate': {
      const windowId = String(rawArgs.windowId || '')
      let code = String(rawArgs.code || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const maxCode = cfg.browser.evaluate_code_max_chars || 32000
      const maxOut = cfg.browser.evaluate_result_max_chars || 80000
      if (code.length > maxCode) return { ok: false, error: 'code_too_long' }
      const worldId = cfg.browser.evaluate_world_id
      const wait = await prepareActionPageWait(wc, cfg, rawArgs, {
        signal: ctx.signal,
        worldId,
      })
      const meta = pageWaitMeta(wc, wait)
      const actionMs = cfg.browser.action_timeout_ms || 15000
      try {
        const result = await isolatedEval(wc, worldId, code, {
          timeoutMs: actionMs,
          signal: ctx.signal,
          label: 'evaluate',
        })
        const serialized = truncate(JSON.stringify(result, null, 0) ?? 'null', maxOut)
        try {
          return { ok: true, value: JSON.parse(serialized), ...meta }
        } catch {
          return { ok: true, value: serialized, ...meta }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'aborted') throw e
        if (msg.startsWith('timeout:')) {
          return { ok: false, error: 'evaluate_timeout', message: msg, ...meta }
        }
        const detail = e as Error & {
          navoraScript?: {
            error?: string
            name?: string
            stack?: string
            hint?: string
            phase?: string
          }
        }
        const script = detail.navoraScript
        return {
          ok: false,
          error: 'script_error',
          message: script?.error || msg,
          name: script?.name || detail.name || 'Error',
          stack: truncate(script?.stack || detail.stack || '', 2500) || undefined,
          hint: script?.hint,
          phase: script?.phase,
          ...meta,
        }
      }
    }

    case 'browser_screenshot': {
      const windowId = String(rawArgs.windowId || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const format = screenshotFormat(rawArgs.format)
      const quality = screenshotQuality(rawArgs.quality)
      const maxWidth = rawArgs.maxWidth != null ? Number(rawArgs.maxWidth) : undefined
      const selector = rawArgs.selector != null ? String(rawArgs.selector).trim() : ''
      const padding = rawArgs.padding != null ? Number(rawArgs.padding) : 0
      const rel =
        String(rawArgs.path || '').trim() ||
        defaultScreenshotPath('page', format, selector ? 'el' : windowId)

      let clip: ScreenshotClip | undefined
      let clipSource: 'full' | 'selector' | 'clip' = 'full'
      if (selector) {
        const worldId = cfg.browser.evaluate_world_id
        const actionMs = cfg.browser.action_timeout_ms || 15000
        const selWaitMs = Math.min(actionMs, Number(rawArgs.waitTimeoutMs) || 5000)
        const sel = await waitForSelectorSoft(wc, worldId, selector, selWaitMs, ctx.signal)
        if (!sel.found) {
          return {
            ok: false,
            error: 'element_not_found',
            windowId,
            selector,
            waitTimedOut: sel.timedOut,
          }
        }
        const resolved = await resolveElementScreenshotClip(wc, worldId, selector, {
          signal: ctx.signal,
          timeoutMs: actionMs,
          padding,
        })
        if ('error' in resolved) {
          return { ok: false, error: resolved.error, windowId, selector }
        }
        clip = resolved.clip
        clipSource = 'selector'
      } else {
        const parsed = parseClipArg(rawArgs.clip)
        if (parsed) {
          const vp = (await isolatedEval(
            wc,
            cfg.browser.evaluate_world_id,
            `(() => ({
              width: window.innerWidth || document.documentElement.clientWidth || 0,
              height: window.innerHeight || document.documentElement.clientHeight || 0,
            }))()`,
            {
              timeoutMs: cfg.browser.action_timeout_ms || 15000,
              signal: ctx.signal,
              label: 'screenshot_viewport',
            },
          )) as { width: number; height: number } | null
          const vw = Math.max(1, Number(vp?.width) || 1)
          const vh = Math.max(1, Number(vp?.height) || 1)
          const clamped = clampClipToViewport(parsed, vw, vh)
          if (!clamped) {
            return { ok: false, error: 'clip_outside_viewport', windowId, clip: parsed }
          }
          clip = clamped
          clipSource = 'clip'
        }
      }

      try {
        const img = await captureWindowImage(wc, { maxWidth, rect: clip })
        const size = img.getSize()
        const buf = encodeNativeImage(img, format, quality)
        const saved = await ctx.files.writeBytes(ctx.chatId, rel, buf)
        return {
          ok: true,
          kind: 'page',
          windowId,
          url: rec.win.webContents.getURL(),
          title: rec.win.getTitle(),
          format,
          width: size.width,
          height: size.height,
          path: saved.path,
          size: saved.size,
          clipSource,
          ...(clip ? { clip } : {}),
          ...(selector ? { selector } : {}),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'aborted') throw e
        return { ok: false, error: msg || 'screenshot_failed', windowId, ...(selector ? { selector } : {}) }
      }
    }

    case 'desktop_screenshot': {
      const format = screenshotFormat(rawArgs.format)
      const quality = screenshotQuality(rawArgs.quality)
      const maxWidth = rawArgs.maxWidth != null ? Number(rawArgs.maxWidth) : undefined
      const displayId = rawArgs.displayId != null ? Number(rawArgs.displayId) : undefined
      const rel =
        String(rawArgs.path || '').trim() || defaultScreenshotPath('desktop', format)
      try {
        const captured = await captureDesktopImage({ displayId, maxWidth })
        const size = captured.img.getSize()
        const buf = encodeNativeImage(captured.img, format, quality)
        const saved = await ctx.files.writeBytes(ctx.chatId, rel, buf)
        return {
          ok: true,
          kind: 'desktop',
          displayId: captured.displayId,
          label: captured.label,
          format,
          width: size.width,
          height: size.height,
          path: saved.path,
          size: saved.size,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'aborted') throw e
        return { ok: false, error: msg || 'desktop_capture_failed' }
      }
    }

    case 'browser_network_rule_add': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const rule = ctx.network.add(sessionId, {
        kind: (rawArgs.kind as 'observe' | 'modify' | 'block') || 'observe',
        urlPattern: String(rawArgs.urlPattern || '*://*/*'),
        headers: rawArgs.headers as Record<string, string> | undefined,
      })
      return {
        ok: true,
        rule,
        note:
          rule.kind === 'observe'
            ? 'observe 会暂存匹配请求的 statusCode / 请求头 / 响应头，用 browser_network_log 查看。'
            : undefined,
      }
    }

    case 'browser_network_rule_remove': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const ok = ctx.network.remove(sessionId, String(rawArgs.ruleId || ''))
      return ok ? { ok: true } : { ok: false, error: 'rule_not_found' }
    }

    case 'browser_network_rule_list': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const log = ctx.network.getLog(sessionId, { limit: 20 })
      return {
        ok: true,
        rules: ctx.network.list(sessionId),
        logSummary: log.map((e) => ({
          id: e.id,
          method: e.method,
          url: e.url,
          statusCode: e.statusCode,
          action: e.action,
          cfMitigated: headerLookup(e.responseHeaders, 'cf-mitigated'),
        })),
        hint: '完整头信息用 browser_network_log。',
      }
    }

    case 'browser_network_log': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      if (rawArgs.clear === true) {
        ctx.network.clearLog(sessionId)
        return { ok: true, cleared: true, count: 0, entries: [] }
      }
      const limit =
        typeof rawArgs.limit === 'number' && Number.isFinite(rawArgs.limit)
          ? rawArgs.limit
          : 40
      const entries = ctx.network.getLog(sessionId, {
        limit,
        urlContains: rawArgs.urlContains ? String(rawArgs.urlContains) : undefined,
        status: typeof rawArgs.status === 'number' ? rawArgs.status : undefined,
        includePending: Boolean(rawArgs.includePending),
      })
      return {
        ok: true,
        count: entries.length,
        entries,
        hint: '可按 status / urlContains 筛选观察日志；敏感头已脱敏。',
      }
    }

    case 'browser_network_clear': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      ctx.network.clear(sessionId)
      return { ok: true }
    }

    case 'browser_cookies_get': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const url = rawArgs.url ? String(rawArgs.url) : undefined
      const cookies = await ctx.registry.getCookies(sessionId, url)
      return { ok: true, cookies, count: cookies.length }
    }

    case 'browser_cookies_set': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const url = String(rawArgs.url || '')
      const name = String(rawArgs.name || '')
      const value = String(rawArgs.value ?? '')
      if (!url || !name) return { ok: false, error: 'url_and_name_required' }
      await ctx.registry.setCookie(sessionId, {
        url,
        name,
        value,
        domain: rawArgs.domain ? String(rawArgs.domain) : undefined,
        path: rawArgs.path ? String(rawArgs.path) : undefined,
        secure: rawArgs.secure != null ? Boolean(rawArgs.secure) : undefined,
        httpOnly: rawArgs.httpOnly != null ? Boolean(rawArgs.httpOnly) : undefined,
        expirationDate:
          rawArgs.expirationDate != null ? Number(rawArgs.expirationDate) : undefined,
      })
      return { ok: true }
    }

    case 'browser_cookies_remove': {
      const sessionId = String(rawArgs.sessionId || '')
      ctx.registry.assertSessionOwned(ctx.chatId, sessionId)
      const removed = await ctx.registry.removeCookie(sessionId, {
        url: rawArgs.url ? String(rawArgs.url) : undefined,
        name: rawArgs.name ? String(rawArgs.name) : undefined,
        domain: rawArgs.domain ? String(rawArgs.domain) : undefined,
        path: rawArgs.path ? String(rawArgs.path) : undefined,
      })
      return { ok: true, removed }
    }

    case 'browser_scroll': {
      const windowId = String(rawArgs.windowId || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      await prepareActionPageWait(wc, cfg, rawArgs, { signal: ctx.signal, worldId })
      const selector = rawArgs.selector ? String(rawArgs.selector) : ''
      const deltaX = Number(rawArgs.deltaX) || 0
      const deltaY = Number(rawArgs.deltaY) || 0
      const code = selector
        ? `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { ok: false };
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            if (${deltaX} || ${deltaY}) el.scrollBy(${deltaX}, ${deltaY});
            return { ok: true, top: el.scrollTop, left: el.scrollLeft };
          })()`
        : `(() => {
            window.scrollBy(${deltaX}, ${deltaY || (rawArgs.to === 'bottom' ? 99999 : rawArgs.to === 'top' ? -99999 : 0)});
            return { ok: true, top: window.scrollY, left: window.scrollX };
          })()`
      const v = await isolatedEval(wc, worldId, code, {
        timeoutMs: cfg.browser.action_timeout_ms || 15000,
        signal: ctx.signal,
        label: 'scroll',
      })
      if (v && typeof v === 'object' && (v as { ok?: boolean }).ok === false) {
        return { ok: false, error: 'element_not_found' }
      }
      return { ok: true, ...(typeof v === 'object' && v ? v : {}) }
    }

    case 'browser_press': {
      const windowId = String(rawArgs.windowId || '')
      const key = String(rawArgs.key || '')
      if (!key) return { ok: false, error: 'key_required' }
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const selector = rawArgs.selector ? String(rawArgs.selector) : ''
      if (selector) {
        await waitForSelectorSoft(
          wc,
          cfg.browser.evaluate_world_id,
          selector,
          Math.min(cfg.browser.action_timeout_ms || 15000, 5000),
          ctx.signal,
        )
        await isolatedEval(
          wc,
          cfg.browser.evaluate_world_id,
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.focus(); return !!el; })()`,
          { timeoutMs: 5000, signal: ctx.signal, label: 'press_focus' },
        )
      }
      const keyCode = mapKeyCode(key)
      wc.sendInputEvent({ type: 'keyDown', keyCode })
      wc.sendInputEvent({ type: 'keyUp', keyCode })
      return { ok: true, key: keyCode }
    }

    case 'browser_hover': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || '')
      const pierce = rawArgs.pierce !== false
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      await prepareActionPageWait(wc, cfg, rawArgs, { signal: ctx.signal, worldId, selector })
      const sel = await waitForSelectorSoft(
        wc,
        worldId,
        selector,
        Math.min(cfg.browser.action_timeout_ms || 15000, 5000),
        ctx.signal,
        { pierce },
      )
      if (!sel.found) return { ok: false, error: 'element_not_found' }
      let box: { x: number; y: number } | null = null
      if (pierce && hasQuerySelectorDeep(wc)) {
        const info = await querySelectorDeep(wc, selector, {
          pierce: true,
          scrollIntoView: true,
        })
        if (info && info.width >= 1 && info.height >= 1) box = centerOf(info)
      }
      if (!box) {
        box = (await isolatedEval(
          wc,
          worldId,
          `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return null;
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`,
          { timeoutMs: cfg.browser.action_timeout_ms || 15000, signal: ctx.signal, label: 'hover' },
        )) as { x: number; y: number } | null
      }
      if (!box) return { ok: false, error: 'element_not_found' }
      await dispatchTrustedPointer(wc, { action: 'move', x: box.x, y: box.y })
      return { ok: true, x: box.x, y: box.y, pierce, method: sel.via || 'js' }
    }

    case 'browser_select': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || '')
      const value = rawArgs.value != null ? String(rawArgs.value) : ''
      const label = rawArgs.label != null ? String(rawArgs.label) : ''
      if (!value && !label) return { ok: false, error: 'value_or_label_required' }
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      await prepareActionPageWait(wc, cfg, rawArgs, { signal: ctx.signal, worldId, selector })
      const v = await isolatedEval(
        wc,
        worldId,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'not_select' };
          const wantVal = ${JSON.stringify(value)};
          const wantLabel = ${JSON.stringify(label)};
          let opt = null;
          for (const o of [...el.options]) {
            if (wantVal && o.value === wantVal) { opt = o; break; }
            if (wantLabel && (o.textContent || '').trim() === wantLabel) { opt = o; break; }
          }
          if (!opt) return { ok: false, error: 'option_not_found' };
          el.value = opt.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: el.value, label: (opt.textContent || '').trim() };
        })()`,
        { timeoutMs: cfg.browser.action_timeout_ms || 15000, signal: ctx.signal, label: 'select' },
      )
      if (!v || typeof v !== 'object' || (v as { ok?: boolean }).ok === false) {
        return { ok: false, error: (v as { error?: string })?.error || 'select_failed' }
      }
      return v
    }

    case 'browser_back':
    case 'browser_forward':
    case 'browser_reload': {
      const windowId = String(rawArgs.windowId || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      if (name === 'browser_back') {
        if (!wc.canGoBack()) return { ok: false, error: 'cannot_go_back' }
        wc.goBack()
      } else if (name === 'browser_forward') {
        if (!wc.canGoForward()) return { ok: false, error: 'cannot_go_forward' }
        wc.goForward()
      } else {
        wc.reload()
      }
      const timeout = Number(rawArgs.timeoutMs) || cfg.browser.navigation_timeout_ms || 30000
      const wait = await applyPageWait(wc, cfg, {
        waitUntil: parseWaitUntil(rawArgs.waitUntil, cfg.browser.wait.load ? 'load' : 'none'),
        timeoutMs: timeout,
        signal: ctx.signal,
        worldId: cfg.browser.evaluate_world_id,
      })
      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
        ...pageWaitMeta(wc, wait),
      }
    }

    case 'browser_find': {
      const windowId = String(rawArgs.windowId || '')
      const text = String(rawArgs.text || '').trim()
      if (!text) return { ok: false, error: 'text_required' }
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      // Find works on any page state so Agent can locate target widgets.
      const limit = Math.min(30, Math.max(1, Number(rawArgs.limit) || 15))
      const v = await isolatedEval(
        wc,
        cfg.browser.evaluate_world_id,
        `(() => {
          const needle = ${JSON.stringify(text)}.toLowerCase();
          const nodes = [...document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],label,h1,h2,h3,li,td,th')];
          const out = [];
          for (const el of nodes) {
            if (out.length >= ${limit}) break;
            const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim();
            if (!t || !t.toLowerCase().includes(needle)) continue;
            const tag = el.tagName.toLowerCase();
            let sel = tag;
            if (el.id) sel = '#' + CSS.escape(el.id);
            else if (el.getAttribute('name')) sel = tag + '[name=' + JSON.stringify(el.getAttribute('name')) + ']';
            out.push({
              tag,
              text: t.slice(0, 120),
              selector: sel,
              href: el.getAttribute('href') || undefined,
              url: (typeof el.href === 'string' && /^https?:/i.test(el.href)) ? el.href : undefined,
            });
          }
          return out;
        })()`,
        { timeoutMs: cfg.browser.action_timeout_ms || 15000, signal: ctx.signal, label: 'find' },
      )
      return { ok: true, matches: v, hint: '若 match.url 或可解析的 http(s) href 存在，请用 browser_navigate，不要 click。Shadow 内元素用 browser_query_deep / browser_click(pierce)。' }
    }

    case 'browser_query_deep': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || '')
      if (!selector) return { ok: false, error: 'selector_required' }
      const pierce = rawArgs.pierce !== false
      const scrollIntoView = Boolean(rawArgs.scrollIntoView)
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      if (!hasQuerySelectorDeep(wc)) {
        return {
          ok: false,
          error: 'querySelectorDeep_unavailable',
          hint: 'Requires unofficial Electron (querySelectorDeep); fall back to browser_evaluate(document.querySelector).',
        }
      }
      const info = await querySelectorDeep(wc, selector, { pierce, scrollIntoView })
      if (!info) return { ok: false, error: 'element_not_found', pierce }
      return {
        ok: true,
        pierce,
        element: info,
        center: centerOf(info),
        hint: '坐标可用于可信点击；优先 browser_click(selector)（内部会用 clickSelector）。',
      }
    }

    case 'browser_dialog': {
      const windowId = String(rawArgs.windowId || '')
      const action = String(rawArgs.action || 'list')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const worldId = cfg.browser.evaluate_world_id
      if (action === 'set_policy') {
        const confirm = rawArgs.confirm != null ? Boolean(rawArgs.confirm) : true
        const promptAccept = rawArgs.promptAccept != null ? Boolean(rawArgs.promptAccept) : true
        const promptText = rawArgs.promptText != null ? String(rawArgs.promptText) : ''
        await isolatedEval(
          wc,
          worldId,
          `(() => {
            window.__navoraDlg = window.__navoraDlg || { queue: [], policy: {} };
            window.__navoraDlg.policy = {
              confirm: ${confirm},
              promptAccept: ${promptAccept},
              promptText: ${JSON.stringify(promptText)},
            };
            return window.__navoraDlg.policy;
          })()`,
          { timeoutMs: 5000, signal: ctx.signal, label: 'dialog_policy' },
        )
        return { ok: true, policy: { confirm, promptAccept, promptText } }
      }
      if (action === 'clear') {
        await isolatedEval(
          wc,
          worldId,
          `(() => { if (window.__navoraDlg) window.__navoraDlg.queue = []; return true; })()`,
          { timeoutMs: 5000, signal: ctx.signal, label: 'dialog_clear' },
        )
        return { ok: true }
      }
      const queue = await isolatedEval(
        wc,
        worldId,
        `(() => (window.__navoraDlg && Array.isArray(window.__navoraDlg.queue) ? window.__navoraDlg.queue.slice(-20) : []))()`,
        { timeoutMs: 5000, signal: ctx.signal, label: 'dialog_list' },
      )
      return { ok: true, queue }
    }

    case 'browser_upload': {
      const windowId = String(rawArgs.windowId || '')
      const selector = String(rawArgs.selector || 'input[type=file]')
      const paths = Array.isArray(rawArgs.paths)
        ? rawArgs.paths.map(String)
        : rawArgs.path
          ? [String(rawArgs.path)]
          : []
      if (!paths.length) return { ok: false, error: 'paths_required' }
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const wc = rec.win.webContents
      const absPaths = paths.map((p) => {
        if (pathIsAbsolute(p)) return p
        return ctx.files.resolve(ctx.chatId, p)
      })
      for (const p of absPaths) {
        if (!fsExists(p)) return { ok: false, error: `file_not_found:${p}` }
      }
      await setFileInputFiles(wc, selector, absPaths)
      return { ok: true, files: absPaths.length, selector }
    }

    case 'browser_window_focus': {
      const windowId = String(rawArgs.windowId || '')
      const rec = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
      const forceShow = rawArgs.show === true
      if (forceShow && !rec.win.isVisible()) rec.win.show()
      // Focus only when visible (or just shown); avoid forcing show by default.
      if (rec.win.isVisible()) rec.win.focus()
      return {
        ok: true,
        windowId,
        visible: rec.win.isVisible(),
        focused: rec.win.isFocused(),
        url: rec.win.webContents.getURL(),
        title: rec.win.getTitle(),
      }
    }

    case 'workspace_info':
      return ctx.files.rootInfo(ctx.chatId)

    case 'workspace_set': {
      const abs = rawArgs.path != null ? String(rawArgs.path).trim() : ''
      try {
        ctx.files.assertAllowedWorkspaceRoot(abs || null)
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          hint: '工作区根须位于数据目录、自定义根，或由用户在设置中选取的目录。',
        }
      }
      const chat = ctx.chats.setWorkspaceRoot(ctx.chatId, abs || null)
      if (!chat) return { ok: false, error: 'chat_not_found' }
      return { ...ctx.files.rootInfo(ctx.chatId), ok: true as const }
    }

    case 'file_list':
      return ctx.files.list(ctx.chatId, String(rawArgs.path || '.'), Boolean(rawArgs.recursive))

    case 'file_stat':
      return ctx.files.stat(ctx.chatId, String(rawArgs.path || ''))

    case 'file_read':
      return ctx.files.readText(ctx.chatId, String(rawArgs.path || ''), {
        offset: rawArgs.offset != null ? Number(rawArgs.offset) : undefined,
        maxChars: rawArgs.maxChars != null ? Number(rawArgs.maxChars) : undefined,
      })

    case 'file_write':
      return ctx.files.writeText(ctx.chatId, String(rawArgs.path || ''), String(rawArgs.content ?? ''), {
        append: Boolean(rawArgs.append),
      })

    case 'file_mkdir':
      return ctx.files.mkdir(ctx.chatId, String(rawArgs.path || ''))

    case 'file_delete':
      return ctx.files.remove(ctx.chatId, String(rawArgs.path || ''))

    case 'file_move':
      return ctx.files.move(ctx.chatId, String(rawArgs.from || ''), String(rawArgs.to || ''))

    case 'file_copy':
      return ctx.files.copy(ctx.chatId, String(rawArgs.from || ''), String(rawArgs.to || ''))

    case 'file_concat': {
      const sources = Array.isArray(rawArgs.sources) ? rawArgs.sources.map(String) : []
      return ctx.files.concat(ctx.chatId, sources, String(rawArgs.dest || ''))
    }

    case 'file_download': {
      const sessionIdArg = rawArgs.sessionId ? String(rawArgs.sessionId) : ''
      const windowId = rawArgs.windowId ? String(rawArgs.windowId) : ''
      const dest = String(rawArgs.dest || '')
      const bodyEncoding =
        rawArgs.bodyEncoding === 'base64' ? ('base64' as const) : ('utf8' as const)

      let sessionId = sessionIdArg
      let referer =
        String(rawArgs.referer || rawArgs.Referer || '').trim() || undefined
      // Ignore agent-supplied Origin for downloads — browsers don't send it on
      // top-level file navigations; CDNs often 403 CORS-like Origin.

      if (windowId) {
        try {
          const win = ctx.registry.assertWindowOwned(ctx.chatId, windowId)
          sessionId = sessionId || win.sessionId
          const pageUrl = String(win.url || '').trim()
          if (pageUrl && pageUrl !== 'about:blank') {
            referer = referer || pageUrl
          }
        } catch {
          /* ignore */
        }
      } else if (sessionId && !referer) {
        try {
          const tree = ctx.registry.getTree(ctx.chatId)
          const sess = tree.find((s) => s.sessionId === sessionId)
          const pageUrl = String(sess?.windows?.[0]?.url || '').trim()
          if (pageUrl && pageUrl !== 'about:blank') {
            referer = pageUrl
          }
        } catch {
          /* ignore */
        }
      }

      const sesRec = sessionId ? ctx.registry.assertSessionOwned(ctx.chatId, sessionId) : null
      const ses = sesRec?.ses || null
      const userAgent =
        sesRec?.userAgent ||
        (ses && typeof ses.getUserAgent === 'function' ? ses.getUserAgent() : '') ||
        undefined

      // Strip Origin from custom headers; keep other agent headers.
      const rawHeaders = (rawArgs.headers as Record<string, string>) || undefined
      let headers = rawHeaders
      if (rawHeaders) {
        headers = { ...rawHeaders }
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'origin') delete headers[k]
        }
      }

      return ctx.downloads.download(ctx.chatId, {
        url: String(rawArgs.url || ''),
        dest,
        method: rawArgs.method ? String(rawArgs.method) : undefined,
        headers,
        body: rawArgs.body != null ? String(rawArgs.body) : undefined,
        bodyEncoding: rawArgs.body != null ? bodyEncoding : undefined,
        range: rawArgs.range ? String(rawArgs.range) : undefined,
        referer,
        userAgent,
        session: ses,
        signal: ctx.signal,
        onProgress: (p) =>
          ctx.onDownloadProgress?.({
            dest,
            partIndex: p.partIndex,
            partsTotal: p.partsTotal,
            bytesTotal: p.bytesTotal,
            bytesPart: p.bytesPart,
            contentLength: p.contentLength,
            url: p.url,
          }),
      })
    }

    case 'file_download_compose': {
      const sessionId = rawArgs.sessionId ? String(rawArgs.sessionId) : ''
      const ses = sessionId ? ctx.registry.assertSessionOwned(ctx.chatId, sessionId).ses : null
      const dest = String(rawArgs.dest || '')
      const parts = Array.isArray(rawArgs.parts)
        ? rawArgs.parts.map((p) => {
            const part = (p || {}) as Record<string, unknown>
            const enc = part.bodyEncoding === 'base64' ? ('base64' as const) : ('utf8' as const)
            return {
              url: String(part.url || ''),
              headers: part.headers as Record<string, string> | undefined,
              method: part.method ? String(part.method) : undefined,
              body: part.body != null ? String(part.body) : undefined,
              bodyEncoding: part.body != null ? enc : undefined,
              range: part.range ? String(part.range) : undefined,
            }
          })
        : []
      return ctx.downloads.compose(ctx.chatId, {
        dest,
        parts,
        session: ses,
        signal: ctx.signal,
        onProgress: (p) =>
          ctx.onDownloadProgress?.({
            dest,
            partIndex: p.partIndex,
            partsTotal: p.partsTotal,
            bytesTotal: p.bytesTotal,
            bytesPart: p.bytesPart,
            contentLength: p.contentLength,
            url: p.url,
          }),
      })
    }

    case 'file_reveal':
      return ctx.shell.reveal(ctx.chatId, String(rawArgs.path ?? '.'))

    case 'file_open':
      return ctx.shell.open(ctx.chatId, String(rawArgs.path ?? '.'))

    case 'shell_exec':
      return ctx.shell.exec(ctx.chatId, {
        command: String(rawArgs.command || ''),
        args: Array.isArray(rawArgs.args) ? rawArgs.args.map(String) : [],
        cwd: rawArgs.cwd ? String(rawArgs.cwd) : undefined,
        shell: Boolean(rawArgs.shell),
        timeoutMs: typeof rawArgs.timeoutMs === 'number' ? rawArgs.timeoutMs : undefined,
        signal: ctx.signal,
      })

    case 'app_settings_get': {
      const sections = Array.isArray(rawArgs.sections)
        ? rawArgs.sections.map(String)
        : undefined
      const askedPermissions = Boolean(sections?.some((s) => s === 'permissions'))
      if (askedPermissions && sections && sections.every((s) => s === 'permissions')) {
        return {
          ok: false,
          error: 'permissions_section_forbidden',
          hint: '权限设置仅能由用户在「设置 → 权限」或本会话权限面板中查看/修改，Agent 不可访问。',
        }
      }
      const allowed = sections?.filter((s) => s !== 'permissions')
      const settings = sanitizeConfigForAgent(ctx.getConfig(), allowed)
      return {
        ok: true,
        sections: allowed?.length ? allowed : listSettingsSections(),
        settings,
        ...(askedPermissions
          ? {
              omitted: ['permissions'],
              note: '权限设置已对 Agent 隐藏，请用户自行在设置页查看。',
            }
          : {}),
      }
    }

    case 'app_settings_update': {
      if (!ctx.updateConfig) return { ok: false, error: 'settings_update_unavailable' }
      const prepared = prepareSettingsPatch(rawArgs.patch)
      if (!prepared.ok) return prepared
      const saved = await ctx.updateConfig(prepared.patch)
      return {
        ok: true,
        updated: Object.keys(prepared.patch),
        settings: sanitizeConfigForAgent(saved, Object.keys(prepared.patch)),
      }
    }

    case 'app_models_list': {
      const url = String(rawArgs.url || '').trim()
      if (!url) return { ok: false, error: 'url_required' }
      const apiKeyInline = String(rawArgs.api_key || '').trim()
      const apiKeyRef = String(rawArgs.api_key_ref || '').trim()
      let apiKey: string | null = apiKeyInline || null
      if (!apiKey && apiKeyRef) {
        if (!ctx.secrets) return { ok: false, error: 'secrets_unavailable' }
        apiKey = ctx.secrets.get(apiKeyRef)
      }
      const listed = await fetchOpenAiModelsList({
        url,
        apiKey,
        timeoutMs: typeof rawArgs.timeout_ms === 'number' ? rawArgs.timeout_ms : undefined,
        signal: ctx.signal,
      })
      if (!listed.ok) {
        const needsKey = listed.status === 401 || listed.status === 403
        return {
          ...listed,
          ...(needsKey
            ? {
                needs_api_key: true,
                hint: '服务端要求鉴权。用 agent_ask_user 在对话中向用户索要 API Key（allowCustom），再带 api_key 重试；若用户表示不需要密钥，可说明当前端点拒绝了无密钥请求。',
              }
            : {}),
        }
      }
      return {
        ok: true,
        base_url: listed.baseUrl,
        models_url: listed.modelsUrl,
        models: listed.models,
        count: listed.count,
        hint: '用 app_provider_add 可将该端点写入设置；API Key 非必须。',
      }
    }

    case 'app_provider_add': {
      if (!ctx.updateConfig) return { ok: false, error: 'settings_update_unavailable' }
      if (!ctx.secrets) return { ok: false, error: 'secrets_unavailable' }
      const url = String(rawArgs.url || '').trim()
      if (!url) return { ok: false, error: 'url_required' }
      const apiKeyInline = String(rawArgs.api_key || '').trim()
      const apiKeyRefArg = String(rawArgs.api_key_ref || '').trim()
      let apiKey: string | null = apiKeyInline || null

      const cfg = ctx.getConfig()
      const providers = cfg.ai.providers.map((p) => ({ ...p, models: [...(p.models || [])] }))
      const wantId = String(rawArgs.id || '').trim()
      const existingIdx = wantId ? providers.findIndex((p) => p.id === wantId) : -1

      // Resolve api key ref early so we can load stored key before listing
      let hostGuess = 'local'
      try {
        const probe = resolveOpenAiModelsEndpoints(url)
        hostGuess = new URL(probe.baseUrl).hostname || hostGuess
      } catch {
        /* keep */
      }
      const provisionalId =
        existingIdx >= 0
          ? providers[existingIdx].id
          : wantId || allocProviderId(hostGuess.replace(/\./g, '_'), providers.map((p) => p.id))
      const apiKeyRef =
        apiKeyRefArg ||
        (existingIdx >= 0 ? providers[existingIdx].api_key_ref : `secrets/${provisionalId}`)

      if (!apiKey && apiKeyRef) {
        apiKey = ctx.secrets.get(apiKeyRef)
      }

      const listed = await fetchOpenAiModelsList({
        url,
        apiKey,
        timeoutMs: typeof rawArgs.timeout_ms === 'number' ? rawArgs.timeout_ms : undefined,
        signal: ctx.signal,
      })
      if (!listed.ok) {
        const needsKey = listed.status === 401 || listed.status === 403
        return {
          ...listed,
          ...(needsKey
            ? {
                needs_api_key: true,
                hint: '服务端要求鉴权。用 agent_ask_user 在对话中索要 API Key，再带 api_key 调用 app_provider_add。',
              }
            : {}),
        }
      }

      if (apiKeyInline) {
        ctx.secrets.set(apiKeyRef, apiKeyInline)
      }

      const label =
        String(rawArgs.label || '').trim() ||
        (existingIdx >= 0 ? providers[existingIdx].label : hostGuess)

      const id = provisionalId

      const preferredModel = String(rawArgs.model || '').trim()
      const model = listed.models.includes(preferredModel)
        ? preferredModel
        : existingIdx >= 0 && listed.models.includes(providers[existingIdx].model)
          ? providers[existingIdx].model
          : listed.models[0]

      const next: AiProviderConfig = normalizeProvider({
        id,
        type: 'openai_compatible',
        label,
        base_url: listed.baseUrl,
        api_key_ref: apiKeyRef,
        model,
        models: listed.models,
        timeout_ms: existingIdx >= 0 ? providers[existingIdx].timeout_ms || 120000 : 120000,
        source_preset: existingIdx >= 0 ? providers[existingIdx].source_preset || 'custom' : 'custom',
      })

      if (existingIdx >= 0) providers[existingIdx] = next
      else providers.push(next)

      const setDefault = Boolean(rawArgs.set_default)
      const patch: Record<string, unknown> = {
        ai: {
          providers,
          ...(setDefault ? { default_provider: id } : {}),
        },
      }
      const saved = await ctx.updateConfig(patch)
      const aiView = sanitizeConfigForAgent(saved, ['ai']).ai as
        | { providers?: Array<Record<string, unknown>>; default_provider?: string }
        | undefined
      const providerView = aiView?.providers?.find((p) => p.id === id)
      return {
        ok: true,
        provider: providerView,
        base_url: listed.baseUrl,
        models_url: listed.modelsUrl,
        models: listed.models,
        count: listed.count,
        default_provider: saved.ai.default_provider,
        api_key_saved: Boolean(apiKeyInline),
        note: apiKeyInline
          ? '已保存 API Key 到密钥库。'
          : '未提供 API Key（允许）；若后续聊天鉴权失败，可再在对话中补充。',
      }
    }

    case 'skill_list': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const includeDisabled = Boolean(rawArgs.include_disabled)
      const items = ctx.skills.list().filter((s) => includeDisabled || s.enabled)
      return {
        ok: true,
        count: items.length,
        skills: items.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          version: s.version || null,
          enabled: s.enabled,
          disable_model_invocation: s.disableModelInvocation,
          needs_skill_read: s.disableModelInvocation,
        })),
      }
    }

    case 'plugin_list': {
      if (!ctx.plugins) return { ok: false, error: 'plugins_unavailable' }
      const includeDisabled = Boolean(rawArgs.include_disabled)
      const scope = ctx.pluginScopeChatId || ctx.chats.resolvePluginScopeChatId(ctx.chatId)
      const global = ctx.plugins.list().filter((p) => includeDisabled || p.enabled)
      const session = ctx.plugins.listSessionPlugins(scope)
      const items = [...global, ...session]
      return {
        ok: true,
        count: items.length,
        scopeChatId: scope,
        note:
          '这些是插件（可执行 tools），不是技能。kind=session 为本会话开发外链（仅本会话及子对话）。详情用 plugin_read(id)；勿 skill_read。',
        plugins: items.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          version: p.version || null,
          enabled: p.enabled,
          kind: p.kind,
          tools: p.tools,
          has_readme: Boolean(p.hasReadme),
          ...(p.error ? { error: p.error } : {}),
        })),
      }
    }

    case 'plugin_read': {
      if (!ctx.plugins) return { ok: false, error: 'plugins_unavailable' }
      const id = String(rawArgs.id || '').trim()
      if (!id) return { ok: false, error: 'id_required' }
      const scope = ctx.pluginScopeChatId || ctx.chats.resolvePluginScopeChatId(ctx.chatId)
      const detail =
        ctx.plugins.listSessionPlugins(scope).find((p) => p.id === id) || ctx.plugins.get(id)
      if (!detail) return { ok: false, error: 'plugin_not_found' }
      const includeReadme = rawArgs.include_readme !== false
      const out: Record<string, unknown> = {
        ok: true,
        id: detail.id,
        name: detail.name,
        description: detail.description,
        version: detail.version || null,
        enabled: detail.enabled,
        kind: detail.kind,
        tools: detail.tools,
        has_readme: Boolean(detail.hasReadme),
        ...(detail.error ? { error: detail.error } : {}),
      }
      if (includeReadme) {
        let markdown: string | undefined
        let fileName: string | null = null
        let readmeError: string | undefined
        if (detail.kind === 'session' && detail.path) {
          const file = findPluginReadmePath(detail.path)
          if (file) {
            try {
              markdown = fs.readFileSync(file, 'utf8')
              fileName = path.basename(file)
            } catch (e) {
              readmeError = e instanceof Error ? e.message : String(e)
            }
          } else if (detail.hasReadme) {
            readmeError = 'readme_unavailable'
          }
        } else {
          const doc = ctx.plugins.readReadme(id)
          if (doc.ok && doc.markdown) {
            markdown = doc.markdown
            fileName = doc.fileName || null
          } else if (detail.hasReadme) {
            readmeError = doc.error || 'readme_unavailable'
          }
        }
        if (markdown) {
          const max = 12000
          out.readme_file = fileName
          out.readme = markdown.length > max ? `${markdown.slice(0, max)}\n…[truncated]` : markdown
        } else if (readmeError) {
          out.readme_error = readmeError
        }
      }
      return out
    }

    case 'plugin_pack': {
      if (!resolvePluginDevMode(cfg)) {
        return {
          ok: false,
          error: 'plugin_dev_mode_disabled',
          hint: '请在设置 → 插件 → 开启「插件开发模式」后再使用 plugin_pack。',
        }
      }
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' }
      const packed = packPluginProject({
        workspaceRoot: ctx.files.chatRoot(ctx.chatId),
        id: rawArgs.id != null ? String(rawArgs.id) : undefined,
        entry: rawArgs.entry != null ? String(rawArgs.entry) : undefined,
        root: rawArgs.root != null ? String(rawArgs.root) : undefined,
        out: rawArgs.out != null ? String(rawArgs.out) : undefined,
        includeNodeModules: Boolean(rawArgs.include_node_modules),
      })
      if (!packed.ok) return packed
      return {
        ok: true,
        projectId: packed.projectId,
        zips: packed.zips.map((z) => ({
          kind: z.kind,
          packageId: z.packageId,
          path: ctx.files.toRel(ctx.chatId, z.path),
          absolutePath: z.path,
          size: z.size,
        })),
        note: packed.note,
      }
    }

    case 'plugin_build':
    case 'plugin_check': {
      if (!resolvePluginDevMode(cfg)) {
        return {
          ok: false,
          error: 'plugin_dev_mode_disabled',
          hint: '请在设置 → 插件 → 开启「插件开发模式」后再使用 plugin_build / plugin_check。',
        }
      }
      const action = name.slice('plugin_'.length) as PluginDevCliAction
      const workspaceRoot = ctx.files.chatRoot(ctx.chatId)
      const result = await runPluginDevCli({
        action,
        workspaceRoot,
        id: rawArgs.id != null ? String(rawArgs.id) : undefined,
        entry: rawArgs.entry != null ? String(rawArgs.entry) : undefined,
        root: rawArgs.root != null ? String(rawArgs.root) : undefined,
        signal: ctx.signal,
        timeoutMs: typeof rawArgs.timeoutMs === 'number' ? rawArgs.timeoutMs : undefined,
      })
      if (!result.ok) return result

      // After build: session-scoped 外链 (this chat + subchats only).
      let link: Record<string, unknown> | undefined
      if (action === 'build' && ctx.plugins && rawArgs.link !== false) {
        const pkgId =
          String(rawArgs.entry || rawArgs.id || '').trim() ||
          packageIdFromBuildStdout(result.stdout) ||
          ''
        const distDir = resolvePluginDistDir(workspaceRoot, result.cwd, pkgId)
        if (distDir) {
          link = linkPluginForChatSession(ctx, distDir)
        } else {
          link = {
            ok: false,
            error: 'dist_not_found',
            hint: '构建成功但未找到 dist/<packageId>；可用 plugin_link 手动外链该目录。',
          }
        }
      }

      return {
        ...result,
        ...(link ? { link } : {}),
        note:
          action === 'build'
            ? link?.ok
              ? '已构建并外链到本会话（及子对话）；下次发消息即可调用。不影响其它会话；后续 plugin_build 会热重载本会话外链。'
              : '已构建。请用 plugin_link 指向 dist/<packageId>（仅对本会话生效）。'
            : '检查通过。',
      }
    }

    case 'plugin_link': {
      if (!resolvePluginDevMode(cfg)) {
        return {
          ok: false,
          error: 'plugin_dev_mode_disabled',
          hint: '请在设置 → 插件 → 开启「插件开发模式」后再使用 plugin_link。',
        }
      }
      if (!ctx.plugins) return { ok: false, error: 'plugins_unavailable' }
      const rel = String(rawArgs.path || '').trim()
      if (!rel) {
        return {
          ok: false,
          error: 'path_required',
          hint: 'path 应为工作区内 dist/<packageId> 相对路径（含 plugin.json + main.cjs）。',
        }
      }
      const abs = ctx.files.resolve(ctx.chatId, rel)
      const linked = linkPluginForChatSession(ctx, abs)
      if (!linked.ok) {
        return {
          ...linked,
          path: ctx.files.toRel(ctx.chatId, abs),
          absolutePath: abs,
        }
      }
      return {
        ...linked,
        path: ctx.files.toRel(ctx.chatId, abs),
        absolutePath: abs,
        note: '已外链到本会话及子对话；下次发消息可用。不写入全局插件列表。',
      }
    }

    case 'store_search': {
      if (!ctx.store) return { ok: false, error: 'store_unavailable' }
      const kind =
        rawArgs.kind === 'plugin' || rawArgs.kind === 'skill' ? rawArgs.kind : 'all'
      const q = String(rawArgs.q || '').trim()
      const listed = await ctx.store.list({
        kind,
        q: q || undefined,
      })
      if (!listed.ok) return { ok: false, error: listed.error || 'store_list_failed' }
      const products = (listed.products || []).slice(0, 12).map((p) => {
        const pkg =
          p.installed?.packageId
            ? p.packages.find((x) => x.id === p.installed!.packageId) || p.packages[0]
            : p.packages[0]
        const latest = latestPackageVersion(pkg)
        return {
          kind: p.kind,
          productId: p.productId,
          displayMode: p.displayMode,
          name: p.name,
          description: p.description,
          packageCount: p.packages.length,
          latestVersion: latest?.version || null,
          ...(p.installed ? { installed: p.installed } : {}),
        }
      })
      return {
        ok: true,
        count: products.length,
        note: '这些是商店产品。向用户推荐后由界面安装；套件用 productId，不要用变体包 id。',
        products,
      }
    }

    case 'skill_read': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const id = String(rawArgs.id || '').trim()
      if (!id) return { ok: false, error: 'id_required' }
      const detail = ctx.skills.get(id)
      if (!detail) return { ok: false, error: 'skill_not_found' }
      if (!detail.enabled) return { ok: false, error: 'skill_disabled' }
      return {
        ok: true,
        id: detail.id,
        name: detail.name,
        description: detail.description,
        version: detail.version || null,
        disable_model_invocation: detail.disableModelInvocation,
        body: detail.body,
      }
    }

    case 'skill_create': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const name = String(rawArgs.name || '').trim()
      const description = String(rawArgs.description || '').trim()
      const body = String(rawArgs.body || '')
      if (!name) return { ok: false, error: 'name_required' }
      if (!description) return { ok: false, error: 'description_required' }
      if (!body.trim()) return { ok: false, error: 'body_required' }
      const wait = isWaitArg(rawArgs)
      const draft: SkillReviewDraft = {
        name,
        description,
        body,
        version: rawArgs.version != null ? String(rawArgs.version) : undefined,
        disableModelInvocation: Boolean(rawArgs.disable_model_invocation),
        enabled: rawArgs.enabled === undefined ? true : Boolean(rawArgs.enabled),
      }
      const reviewed = await reviewSkillWrite(ctx, { action: 'create', draft, wait, canDefer: true })
      if ('ok' in reviewed && reviewed.ok === false) return reviewed
      if ('status' in reviewed && reviewed.status === 'deferred') {
        return deferredToolResult(reviewed.proposalId, wait)
      }
      if (!('status' in reviewed) || reviewed.status !== 'confirm') {
        return { ok: false, error: 'skill_review_failed' }
      }
      const skill = reviewed.res.skill
      return {
        ok: true,
        skill: skill
          ? {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              version: skill.version || null,
              enabled: skill.enabled,
              disable_model_invocation: skill.disableModelInvocation,
            }
          : null,
        note: '已创建。下一轮对话起，已启用技能会进入系统提示。',
      }
    }

    case 'skill_update': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const id = String(rawArgs.id || '').trim()
      if (!id) return { ok: false, error: 'id_required' }
      const existing = ctx.skills.get(id)
      if (!existing) return { ok: false, error: 'skill_not_found' }
      const wait = isWaitArg(rawArgs)
      const draft: SkillReviewDraft = {
        name: rawArgs.name !== undefined ? String(rawArgs.name) : existing.name,
        description:
          rawArgs.description !== undefined ? String(rawArgs.description) : existing.description,
        body: rawArgs.body !== undefined ? String(rawArgs.body) : existing.body,
        version:
          rawArgs.version !== undefined
            ? String(rawArgs.version)
            : existing.version,
        disableModelInvocation:
          rawArgs.disable_model_invocation !== undefined
            ? Boolean(rawArgs.disable_model_invocation)
            : existing.disableModelInvocation,
        enabled: rawArgs.enabled !== undefined ? Boolean(rawArgs.enabled) : existing.enabled,
      }
      const reviewed = await reviewSkillWrite(ctx, {
        action: 'update',
        skillId: id,
        draft,
        existing: { id: existing.id, name: existing.name, description: existing.description },
        wait,
        canDefer: true,
      })
      if ('ok' in reviewed && reviewed.ok === false) return reviewed
      if ('status' in reviewed && reviewed.status === 'deferred') {
        return deferredToolResult(reviewed.proposalId, wait)
      }
      if (!('status' in reviewed) || reviewed.status !== 'confirm') {
        return { ok: false, error: 'skill_review_failed' }
      }
      const skill = reviewed.res.skill
      return {
        ok: true,
        skill: skill
          ? {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              version: skill.version || null,
              enabled: skill.enabled,
              disable_model_invocation: skill.disableModelInvocation,
            }
          : null,
        note: '已更新。下一轮对话起生效。',
      }
    }

    case 'skill_delete': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const id = String(rawArgs.id || '').trim()
      if (!id) return { ok: false, error: 'id_required' }
      const existing = ctx.skills.get(id)
      if (!existing) return { ok: false, error: 'skill_not_found' }
      const wait = isWaitArg(rawArgs)
      const reviewed = await reviewSkillWrite(ctx, {
        action: 'delete',
        skillId: id,
        draft: {
          name: existing.name,
          description: existing.description,
          body: existing.body,
          enabled: existing.enabled,
          disableModelInvocation: existing.disableModelInvocation,
        },
        existing: { id: existing.id, name: existing.name, description: existing.description },
        wait,
        canDefer: false,
      })
      if ('ok' in reviewed && reviewed.ok === false) return reviewed
      if ('status' in reviewed && reviewed.status === 'deferred') {
        return deferredToolResult(reviewed.proposalId, wait, false)
      }
      return { ok: true, id, note: '已删除技能。' }
    }

    case 'skill_export': {
      if (!ctx.skills) return { ok: false, error: 'skills_unavailable' }
      const id = String(rawArgs.id || '').trim()
      if (!id) return { ok: false, error: 'id_required' }
      const existing = ctx.skills.get(id)
      if (!existing) return { ok: false, error: 'skill_not_found' }
      let markdown = ''
      try {
        markdown = ctx.skills.exportMarkdown(id)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      const wait = isWaitArg(rawArgs)
      const reviewed = await reviewSkillWrite(ctx, {
        action: 'export',
        skillId: id,
        draft: {
          name: existing.name,
          description: existing.description,
          body: existing.body,
        },
        markdown,
        wait,
        canDefer: false,
      })
      if ('ok' in reviewed && reviewed.ok === false) return reviewed
      if ('status' in reviewed && reviewed.status === 'deferred') {
        return deferredToolResult(reviewed.proposalId, wait, false)
      }
      const pathOut =
        'status' in reviewed && reviewed.status === 'confirm' ? reviewed.res.exportPath : null
      return {
        ok: true,
        id,
        name: existing.name,
        path: pathOut || null,
        note: pathOut ? `已导出到 ${pathOut}` : '用户已确认导出。',
      }
    }

    default:
      if (ctx.plugins?.ownsToolForChat(ctx.pluginScopeChatId || ctx.chatId, name)) {
        return ctx.plugins.execute(name, rawArgs, ctx)
      }
      return { ok: false, error: `unknown_tool:${name}` }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function pollUntil(fn: () => Promise<boolean>, intervalMs: number, signal?: AbortSignal): Promise<void> {
  for (;;) {
    if (signal?.aborted) throw new Error('aborted')
    if (await fn()) return
    if (signal) await sleep(intervalMs, signal)
    else await new Promise((r) => setTimeout(r, intervalMs))
  }
}

function mapKeyCode(key: string): string {
  const k = key.trim()
  const aliases: Record<string, string> = {
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
  }
  const lower = k.toLowerCase()
  if (aliases[lower]) return aliases[lower]
  if (/^f([1-9]|1[0-2])$/i.test(k)) return k.toUpperCase()
  return k.length === 1 ? k : k
}

function pathIsAbsolute(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p)
}

function fsExists(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

async function setFileInputFiles(
  wc: WebContents,
  selector: string,
  files: string[],
): Promise<void> {
  const dbg = wc.debugger
  let attachedHere = false
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3')
      attachedHere = true
    }
    const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as {
      root: { nodeId: number }
    }
    const q = (await dbg.sendCommand('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    })) as { nodeId: number }
    if (!q?.nodeId) throw new Error('element_not_found')
    await dbg.sendCommand('DOM.setFileInputFiles', {
      nodeId: q.nodeId,
      files,
    })
  } finally {
    if (attachedHere) {
      try {
        dbg.detach()
      } catch {
        /* ignore */
      }
    }
  }
}
