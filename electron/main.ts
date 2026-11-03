import {registerBrowserWorkspace} from './modules/browser-workspace-ipc'
import {subchatIndex} from '../shared/subchat-presentation'
import {BrowserStartStore} from './modules/browser-start-store'
import {registerFileWindows} from './modules/file-windows'
import {registerNativeUi} from './modules/native-ui'
import { registerLiteratureSearch } from './modules/literature-search'
import {downloadNeedsLog} from '../shared/browser-download-status'
import { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { version as productVersion } from '../package.json'
import { applyUserDataPath, ensureDir, ensurePortableRoot, isPortableRuntime, PORTABLE_DATA_DIRNAME, resolveDataRoot } from './data-root'
import { ConfigService } from './modules/config-service'
import { configureBrowserAutomation } from './modules/browser-automation-controller'
import { mainWindowChrome } from './modules/window-chrome'
import {createSettingsNavigation,resetsSettingsDocument} from './modules/settings-navigation'
import { appearancePalette } from '../shared/appearance'
import { fetchOpenAiModelsList } from '../shared/openai-models'
import { probeModel } from './modules/model-probe'
import { CreatorService } from './modules/creator-service'
import type { CreatorKind, CreatorFiles } from '../shared/creators'
import AdmZip from 'adm-zip'
import { ChatStore } from './modules/chat-store'
import { BrowserRegistry } from './modules/browser-registry'
import { BrowserNetworkManager } from './modules/browser-network'
import { WorkspaceFiles } from './modules/workspace-files'
import {WorkspaceResourceIndex} from './modules/workspace-resource-index'
import {associateResourceEvidence} from '../shared/workspace-resources'
import { FileDownloadService } from './modules/file-download'
import { BrowserDownloadList } from './modules/browser-download-list'
import { assertDownloadScope, downloadChatScope, filterDownloadScope, type DownloadCaller } from './modules/browser-download-access'
import { ToolDownloadList } from '../shared/tool-downloads'
import type { AgentEvent, BrowserDownloadsChanged } from '../shared/types'
const toolDownloads = new ToolDownloadList()
function listDownloads(chatId?: string) { return [...browserDownloads.list(chatId), ...toolDownloads.list(chatId)].sort((a,b) => b.createdAt - a.createdAt) }
function downloadHostChats(hostId: string): string[] {
  return registry.hosts.hostPages(hostId).flatMap(id => {
    const page = registry.hosts.pages.get(id)
    return page ? [page.chatId] : []
  })
}
function downloadCaller(event: Electron.IpcMainInvokeEvent | null): DownloadCaller {
  // The remote RPC registry supplies null only after its existing authentication.
  if (event === null) return { kind: 'remote' }
  if (!event?.sender || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return { kind: 'denied' }
  if (mainWindow && event.sender === mainWindow.webContents) return { kind: 'trusted' }
  const host = registry?.hosts.hostForSender(event.sender)
  return host && !host.embedded && !host.window.isDestroyed()
    ? { kind: 'host', chatIds: downloadHostChats(host.id) } : { kind: 'denied' }
}
function downloadForRequest(event: Electron.IpcMainInvokeEvent | null, id: string, chatId?: string) {
  const scope = downloadChatScope(downloadCaller(event), chatId)
  const key = String(id || '').trim()
  const entry = toolDownloads.get(key) || browserDownloads.get(key)
  return entry ? assertDownloadScope(entry, scope) : null
}
import { WorkspaceShell } from './modules/workspace-shell'
import { PermissionGate, type PermissionDecision, type PermissionRequest } from './modules/permission-gate'
import { SecretsStore } from './modules/secrets'
import { PluginStore } from './modules/plugin-store'
import { PluginDevWatcher } from './modules/plugin-dev-watcher'
import { SkillStore } from './modules/skill-store'
import { MarketplaceClient } from './modules/marketplace-client'
import { AgentRuntime } from './modules/agent-runtime'
import { AgentInbox } from './modules/agent-inbox'
import {compileComposerDocument,normalizeComposerDocument,type ComposerDraftOptions,type ComposerSubmitInput,type ComposerQueueEditOptions} from '../shared/composer-document'
import {makeFileTab} from '../shared/file-tabs'
import {createComposerSources} from './modules/composer-sources'
import type {ComposerImportFile,ComposerExcerptInput} from '../shared/composer-sources'
let agentInbox: AgentInbox | undefined
import { createAppTray, type TrayController } from './modules/tray'
import { RemoteServer } from './modules/remote-server'
import { NavoraRpcRegistry } from './modules/remote-rpc'
import { loadWindowState, trackWindowState } from './modules/window-state'
import type { AppConfig, AppConfigPatch } from '../shared/config'
import type {SettingsCommit} from '../shared/settings-commit'
import type {BrowserSessionUpdate,BrowserSessionManageAction} from '../shared/types'
import {confirmedModelSelection,validateModelSelection,assertConfirmedModelSelection} from '../shared/model-selection'
import {
  assertRemoteAccessChange,
  resolveForkDecision,
  resolvePluginDevMode,
  resolveUserAgent,
  shouldShowMainOnStart,
} from '../shared/config'
import { UA_PRESETS } from '../shared/ua-presets'
import type {
  AppInfo,
  BrowserContextRef,
  AgentAskRequest,
  AgentAskResponse,
  ChatPermissions,
  SkillReviewRequest,
  SkillReviewResponse,
} from '../shared/types'
import {
  formatChatExportContent,
  suggestChatExportFilename,
  suggestSkillExportFilename,
} from '../shared/export-chat'
import {
  logBrowserDownloadCompleted,
  logBrowserDownloadFailed,
  logBrowserDownloadStarted,
  logPermissionAutoAllow,
  logUserNavigated,
  logWindowOpened,
} from '../shared/run-logs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
const settingsNavigation=createSettingsNavigation({getMain:()=>mainWindow,createMain:()=>createWindow()})
let tray: TrayController | null = null
let isQuitting = false

const dataRootEarly = (() => {
  const env = process.env.NAVORA_DATA_ROOT
  if (env) return ensurePortableRoot(path.resolve(env))
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return ensurePortableRoot(
      path.join(path.resolve(process.env.PORTABLE_EXECUTABLE_DIR), PORTABLE_DATA_DIRNAME),
    )
  }
  if (process.env.VITE_DEV_SERVER_URL) {
    return ensurePortableRoot(path.resolve(__dirname, '..', 'portable'))
  }
  return ''
})()

if (dataRootEarly) applyUserDataPath(dataRootEarly)
else {
  // Installed NSIS: keep Electron default userData (%APPDATA%/Navora)
  try {
    app.setName('Navora')
  } catch {
    /* ignore */
  }
}

let dataRoot = dataRootEarly
let config!: ConfigService
let chats!: ChatStore
let registry!: BrowserRegistry
let browserStart!:BrowserStartStore
let network!: BrowserNetworkManager
let workspaceResourceIndex:WorkspaceResourceIndex|undefined
let files!: WorkspaceFiles
let downloads!: FileDownloadService
let browserDownloads!: BrowserDownloadList
let workspaceShell!: WorkspaceShell
let secrets!: SecretsStore
let creators!: CreatorService
let skills!: SkillStore
let plugins!: PluginStore
let pluginDevWatch!: PluginDevWatcher
let marketplace!: MarketplaceClient
let gate!: PermissionGate
let agent!: AgentRuntime
let remote!: RemoteServer
let browserAnnotations:ReturnType<typeof registerBrowserWorkspace>|undefined
let fileWindows:ReturnType<typeof registerFileWindows>|undefined
let nativeUiService:ReturnType<typeof registerNativeUi>|undefined
const rpc = new NavoraRpcRegistry()

function rpcHandle(channel: string, handler: (...args: any[]) => any): void {
  // Electron handlers historically take (event, ...args). RPC passes a null event.
  rpc.register(channel, (...args) => handler(null, ...args))
  ipcMain.handle(channel, (e, ...args: unknown[]) => handler(e, ...args))
}

const pendingPerm = new Map<
  string,
  {
    chatId: string
    request: PermissionRequest
    timer: ReturnType<typeof setTimeout>
    resolve: (d: PermissionDecision) => void
  }
>()

const pendingAsk = new Map<
  string,
  {
    chatId: string
    request: AgentAskRequest
    timer: ReturnType<typeof setTimeout> | null
    resolve: (r: AgentAskResponse) => void
  }
>()

const pendingSkillReview = new Map<
  string,
  {
    chatId: string
    timer: ReturnType<typeof setTimeout> | null
    resolve: (r: SkillReviewResponse) => void
  }
>()

function resolveAsk(id: string, response: AgentAskResponse, notifyUi = true): boolean {
  const p = pendingAsk.get(id)
  if (!p) return false
  if (p.timer) clearTimeout(p.timer)
  pendingAsk.delete(id)
  chats?.setPendingAsk(p.chatId, null)
  p.resolve(response)
  // Always dismiss dialogs on both local window and remote web clients.
  if (notifyUi) {
    const reason =
      response.source === 'timeout'
        ? 'timeout'
        : response.source === 'aborted'
          ? 'aborted'
          : response.source === 'deny'
            ? 'deny'
            : 'resolved'
    pushAgentAskCancel(id, reason)
  }
  return true
}

function resolvePerm(id: string, decision: PermissionDecision, notifyUi = true): boolean {
  const p = pendingPerm.get(id)
  if (!p) return false
  clearTimeout(p.timer)
  pendingPerm.delete(id)
  p.resolve(decision)
  if (notifyUi) pushPermissionCancel(id)
  return true
}

function resolveSkillReview(id: string, response: SkillReviewResponse, notifyUi = true): boolean {
  const p = pendingSkillReview.get(id)
  if (!p) return false
  if (p.timer) clearTimeout(p.timer)
  pendingSkillReview.delete(id)
  // 超时/中止：删除/导出不可进待确认，清掉残留提案；新建/修改可留在待确认
  if (response.source === 'timeout' || response.source === 'aborted') {
    const prop = skills.getProposal(id)
    if (prop && (prop.action === 'delete' || prop.action === 'export')) {
      skills.removeProposal(id)
      pushSkillProposalsChanged()
    }
  }
  p.resolve(response)
  if (notifyUi) pushSkillReviewCancel(id)
  return true
}

function abortAsksForChat(chatId: string): boolean {
  let aborted=false
  for (const [id, p] of [...pendingAsk.entries()]) {
    if (p.chatId !== chatId) continue
    resolveAsk(id, { id, answer: '', source: 'aborted' }, true)
    aborted=true
  }
  // Unlimited choices replayed after restart have no live promise resolver.
  const parked=chats?.get(chatId)?.pendingAsk
  if(parked){chats.setPendingAsk(chatId,null);pushAgentAskCancel(parked.id,'aborted');pushChatChanged({type:'upsert',chatId});aborted=true}
  for (const [id, p] of [...pendingPerm.entries()]) {
    if (p.chatId !== chatId) continue
    resolvePerm(id, 'deny', true)
    aborted=true
  }
  for (const [id, p] of [...pendingSkillReview.entries()]) {
    if (p.chatId !== chatId) continue
    resolveSkillReview(id, { id, source: 'aborted' }, true)
    aborted=true
  }
  return aborted
}

function abortAllAsks(opts?: { preservePersistedUnlimited?: boolean }): void {
  for (const [id, p] of [...pendingAsk.entries()]) {
    if (opts?.preservePersistedUnlimited) {
      const saved = chats?.get(p.chatId)?.pendingAsk
      if (saved?.id === id && saved.timeoutMs <= 0 && saved.kind === 'user_choice') {
        pendingAsk.delete(id)
        if (p.timer) clearTimeout(p.timer)
        continue
      }
    }
    resolveAsk(id, { id, answer: '', source: 'aborted' }, true)
  }
  for (const [id] of [...pendingPerm.entries()]) {
    resolvePerm(id, 'deny', true)
  }
  for (const [id] of [...pendingSkillReview.entries()]) {
    resolveSkillReview(id, { id, source: 'aborted' }, true)
  }
}

function replayPersistedAsks(): void {
  if (!chats) return
  for (const c of chats.list()) {
    const req = c.pendingAsk
    if (!req || req.timeoutMs > 0 || req.kind !== 'user_choice') continue
    pushAgentAsk(req)
    pushAgentEvent({
      type: 'phase',
      chatId: req.chatId,
      phase: 'awaiting_user',
      detail: req.question.slice(0, 120),
    })
  }
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, 'assets', 'app-icon.png'),
    path.join(__dirname, '..', 'electron', 'assets', 'app-icon.png'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

/** Open http(s)/mailto in the OS browser; ignore unsafe schemes. */
function openInSystemBrowser(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') {
      return false
    }
    void shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

function isMainAppNavigation(url: string, win: BrowserWindow): boolean {
  try {
    const next = new URL(url)
    const cur = new URL(win.webContents.getURL() || 'about:blank')
    if (next.protocol === 'file:' && cur.protocol === 'file:') {
      return path.normalize(decodeURIComponent(next.pathname)) === path.normalize(decodeURIComponent(cur.pathname))
    }
    if (next.origin === cur.origin) return true
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl && url.startsWith(devUrl)) return true
    return false
  } catch {
    return false
  }
}

/** Keep chat/settings in-app; send external links to the system browser. */
function wireMainWindowExternalLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isMainAppNavigation(url, win)) return
    event.preventDefault()
    openInSystemBrowser(url)
  })
}

/** UI tree for a chat: own sessions plus direct sub-chat sessions (parent can monitor kids). */
function displayBrowserTree(chatId: string): ReturnType<BrowserRegistry['getTree']> {
  const own = registry.getTree(chatId)
  if (!chats) return own
  const children = chats.listChildren(chatId)
  if (!children.length) return own
  // Keep parent sessions first; then each child (listChildren is newest-first).
  return [...own, ...children.flatMap((c) => registry.getTree(c.id))]
}

/** Roll sub-chat window counts into the parent so the sidebar badge reflects activity. */
function displayWindowCounts(): Record<string, number> {
  const raw = registry.snapshotCounts()
  if (!chats) return raw
  const out: Record<string, number> = { ...raw }
  for (const c of chats.list()) {
    if (c.kind !== 'sub' || !c.parentChatId) continue
    const n = raw[c.id] || 0
    if (!n) continue
    out[c.parentChatId] = (out[c.parentChatId] || 0) + n
  }
  return out
}

function emitBrowserTreePayload(chatId: string): void {
  const payload = {
    chatId,
    tree: displayBrowserTree(chatId),
    counts: displayWindowCounts(),
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:browser.treeUpdated', payload)
  }
  registry.hosts.notifyDetachedTreeChanged(payload)
  remote?.broadcast('navora:browser.treeUpdated', payload)
}

function pushBrowserTree(chatId: string): void {
  emitBrowserTreePayload(chatId)
  // Sub-chat resource changes should refresh the parent panel while user stays on parent.
  const chat = chats?.get(chatId)
  if (chat?.kind === 'sub' && chat.parentChatId) {
    emitBrowserTreePayload(chat.parentChatId)
  }
}

let downloadsPushTimer: ReturnType<typeof setTimeout> | null = null
let downloadsRevision = 0
const downloadsInstanceId = randomUUID()
const workspaceChangedPending = new Set<string>()
let workspacePushTimer: ReturnType<typeof setTimeout> | null = null
function pushWorkspaceChanged(chatId: string): void {
  workspaceResourceIndex?.invalidate(chatId)
  const id = String(chatId || '').trim()
  if (!id) return
  workspaceChangedPending.add(id)
  if (workspacePushTimer) return
  workspacePushTimer = setTimeout(() => {
    workspacePushTimer = null
    const ids = [...workspaceChangedPending]
    workspaceChangedPending.clear()
    for (const cid of ids) {
      const payload = { chatId: cid }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('navora:workspace.changed', payload)
      }
      remote?.broadcast('navora:workspace.changed', payload)
    }
  }, 80)
}

function pushBrowserDownloadsChanged(): void {
  downloadsRevision++
  if (downloadsPushTimer) return
  downloadsPushTimer = setTimeout(() => {
    downloadsPushTimer = null
    const payload: BrowserDownloadsChanged = { downloads: listDownloads(), revision: downloadsRevision, instanceId: downloadsInstanceId }
    for(const win of BrowserWindow.getAllWindows()){
      if(win.isDestroyed())continue
      if(win===mainWindow){win.webContents.send('navora:downloads.changed',payload);continue}
      const host=registry?.hosts.hostForSender(win.webContents)
      if(host&&!host.embedded)win.webContents.send('navora:downloads.changed',{
        ...payload,downloads:filterDownloadScope(payload.downloads,new Set(downloadHostChats(host.id))),
      } satisfies BrowserDownloadsChanged)
    }
    remote?.broadcast('navora:downloads.changed', payload)
  }, 100)
  downloadsPushTimer.unref?.()
}

function pushAgentEvent(payload: unknown): void {
  if (toolDownloads.observe(payload as AgentEvent)) pushBrowserDownloadsChanged()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:agent.event', payload)
  }
  remote?.broadcast('navora:agent.event', payload)
  const event=payload as AgentEvent
  if(event.type==='error')agentInbox?.pause(event.chatId)
  if(event.type==='done')agentInbox?.finished(event.chatId)
}

function pushPermissionRequest(req: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:permission.request', req)
  }
  remote?.broadcast('navora:permission.request', req)
}

function pushPermissionCancel(id: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:permission.cancel', id)
  }
  remote?.broadcast('navora:permission.cancel', id)
}

function pushAgentAsk(req: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:agent.ask', req)
  }
  remote?.broadcast('navora:agent.ask', req)
}

function pushAgentAskCancel(
  id: string,
  reason: 'timeout' | 'aborted' | 'resolved' | 'deny' = 'resolved',
): void {
  const payload = { id, reason }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:agent.ask.cancel', payload)
  }
  remote?.broadcast('navora:agent.ask.cancel', payload)
}

function pushSkillReview(req: SkillReviewRequest): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:skill.review.request', req)
  }
  remote?.broadcast('navora:skill.review.request', req)
}

function pushSkillReviewCancel(id: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:skill.review.cancel', id)
  }
  remote?.broadcast('navora:skill.review.cancel', id)
}

function pushSkillProposalsChanged(): void {
  const payload = { proposals: skills.listProposals() }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:skills.proposalsChanged', payload)
  }
  remote?.broadcast('navora:skills.proposalsChanged', payload)
}

function pushSkillsChanged(): void {
  const payload = { skills: skills.list() }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:skills.changed', payload)
  }
  remote?.broadcast('navora:skills.changed', payload)
}

function pushPluginsChanged(): void {
  const payload = { plugins: plugins.list() }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:plugins.changed', payload)
  }
  remote?.broadcast('navora:plugins.changed', payload)
}

function pushStoreProgress(payload: import('../shared/store').StoreInstallProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:store.progress', payload)
  }
  remote?.broadcast('navora:store.progress', payload)
}

function pushPluginImportProgress(payload: import('../shared/plugins').PluginImportProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:plugins.importProgress', payload)
  }
  remote?.broadcast('navora:plugins.importProgress', payload)
}

function pushChatChanged(payload: { type: 'upsert' | 'removed'; chatId: string }): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navora:chats.changed', payload)
  }
  remote?.broadcast('navora:chats.changed', payload)
}

function pushConfigChanged(cfg: AppConfig): void {
  const payload = JSON.parse(JSON.stringify(cfg)) as AppConfig
  const rendererBase = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL().split('#')[0] : ''
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || (win !== mainWindow && (!rendererBase || win.webContents.getURL().split('#')[0] !== rendererBase))) continue
    updateWindowAppearance(win, cfg)
    win.webContents.send('navora:config.changed', payload)
  }
  remote?.broadcast('navora:config.changed', payload)
}

function updateWindowAppearance(win: BrowserWindow, cfg: AppConfig): void {
  const theme = appearancePalette(cfg.app.appearance_theme, cfg.app.appearance_mode, nativeTheme.shouldUseDarkColors)
  win.setBackgroundColor(theme.shell)
  if (process.platform === 'win32') win.setTitleBarOverlay({ color: theme.shell, symbolColor: theme.ink })
}

/** Prefer main window; focus it so native file dialogs are not hidden behind HTML overlays. */
function dialogParentWindow(): BrowserWindow | null {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) return null
  try {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

async function showAppSaveDialog(
  opts: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  // Focus main window first; do not attach as modal parent — nested Vuetify
  // dialogs (settings → export preview) otherwise leave the OS picker behind / stuck.
  dialogParentWindow()
  return dialog.showSaveDialog(opts)
}

async function showAppOpenDialog(
  opts: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  dialogParentWindow()
  return dialog.showOpenDialog(opts)
}

/**
 * Empty chats (no messages yet) are created with the then-current defaults.
 * When the user changes default provider/model or permissions (e.g. first-run
 * onboarding), rewrite those chats so the new-chat UI matches settings.
 * Chats that already diverge from the previous defaults are left alone.
 */
function syncEmptyChatsToConfigDefaults(prev: AppConfig, next: AppConfig): void {
  const prevProvider =
    prev.ai.providers.find((x) => x.id === prev.ai.default_provider) || prev.ai.providers[0]
  const nextProvider =
    next.ai.providers.find((x) => x.id === next.ai.default_provider) || next.ai.providers[0]
  if (!nextProvider) return

  const aiChanged =
    prevProvider?.id !== nextProvider.id || prevProvider?.model !== nextProvider.model
  const permChanged =
    prev.permissions.preset !== next.permissions.preset ||
    JSON.stringify(prev.permissions.modes) !== JSON.stringify(next.permissions.modes)
  if (!aiChanged && !permChanged) return

  for (const chat of chats.list()) {
    if (chat.messages?.length) continue
    let touched = false

    if (aiChanged) {
      const followsPrevAi =
        !chat.providerId ||
        (chat.providerId === prevProvider?.id &&
          (!chat.model || chat.model === prevProvider?.model))
      if (followsPrevAi) {
        chats.setProvider(chat.id, nextProvider.id, nextProvider.model)
        touched = true
      }
    }

    if (permChanged) {
      const followsPrevPerm =
        !chat.permissions || chat.permissions.preset === prev.permissions.preset
      if (followsPrevPerm) {
        chats.setPermissions(chat.id, {
          preset: next.permissions.preset,
          modes: { ...next.permissions.modes },
        })
        touched = true
      }
    }

    if (touched) pushChatChanged({ type: 'upsert', chatId: chat.id })
  }
}

function skillImportErrorResult(e: unknown, importPath?: string) {
  const code = e instanceof Error ? e.message : String(e)
  const extra =
    e && typeof e === 'object'
      ? (e as {
          existing?: unknown
          incoming?: unknown
        })
      : {}
  return {
    ok: false as const,
    error: code,
    ...(importPath ? { path: importPath } : {}),
    ...(code === 'skill_exists'
      ? {
          existing: extra.existing,
          incoming: extra.incoming,
        }
      : {}),
  }
}

async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const icon = resolveAppIcon()
  const winState = loadWindowState(dataRoot)
  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    ...(typeof winState.x === 'number' && typeof winState.y === 'number'
      ? { x: winState.x, y: winState.y }
      : {}),
    minWidth: 720,
    minHeight: 540,
    title: 'Navora',
    ...mainWindowChrome(process.platform),
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
    },
  })
  // Hide native menu; Agent windows manage their own chrome.
  mainWindow.setMenu(null)
  const win = mainWindow
  wireMainWindowExternalLinks(win)
  registry.hosts.bindMain(win)
  registry.restorePersistent(path.join(dataRoot,'browser-workspace.json'),id=>!!chats.get(id))
  trackWindowState(win, dataRoot)

  win.once('ready-to-show', () => {
    if (winState.maximized) win.maximize()
    win.show()
    replayPersistedAsks()
  })

  win.on('close', (e) => {
    if (isQuitting || !config.get().app.close_to_tray) return
    e.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    settingsNavigation.dispose()
    mainWindow = null
  })
  const pushMaximized = () => {
    if (win.isDestroyed()) return
    win.webContents.send('navora:app.window.maximized', win.isMaximized())
  }
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)
  win.webContents.on('did-finish-load', pushMaximized)
  win.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(resetsSettingsDocument(isInPlace,isMainFrame))settingsNavigation.loading(win)})
  // A fresh document must acknowledge readiness after its App listener exists.
  // The mount announcement covers a late app boot; this request covers finish-load ordering.
  win.webContents.on('did-finish-load',()=>{if(win===mainWindow&&!win.isDestroyed())win.webContents.send('navora:app.settings.request-ready')})

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    await win.loadURL(devUrl)
    if (process.env.NAVORA_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function registerIpc(): void {
  function settingsCaller(event:Electron.IpcMainInvokeEvent,mainOnly=false){
    if(event.sender.isDestroyed()||event.senderFrame!==event.sender.mainFrame)throw Error('settings_ui_only')
    const win=BrowserWindow.fromWebContents(event.sender)
    if(!win||win.isDestroyed()||win.webContents!==event.sender)throw Error('settings_ui_only')
    if(win===mainWindow)return win
    if(!mainOnly&&(registry.hosts.hostForSender(event.sender)||fileWindows?.ownsSender(event.sender)))return win
    throw Error('settings_ui_only')
  }
  ipcMain.handle('navora:app.settings.open',(event,section:unknown)=>settingsNavigation.open(settingsCaller(event),section))
  ipcMain.handle('navora:app.settings.ready',event=>settingsNavigation.ready(settingsCaller(event,true)))
  ipcMain.handle('navora:app.settings.handled',(event,id:unknown,accepted:unknown)=>{if(typeof id!=='string'||typeof accepted!=='boolean')throw Error('invalid_settings_ack');settingsNavigation.handled(settingsCaller(event,true),id,accepted)})
  ipcMain.handle('navora:app.settings.return',(event,id:unknown,restore:unknown)=>{if(typeof id!=='string'||typeof restore!=='boolean')throw Error('invalid_settings_return');settingsNavigation.returnToSource(settingsCaller(event,true),id,restore)})
  registerLiteratureSearch(ipcMain)
  const creatorCall = async <T>(operation: () => T | Promise<T>) => {
    try { return { ok: true as const, ...await operation() } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'creator_failed' } }
  }
  rpcHandle('navora:creators.list', (_e, kind: CreatorKind) => creatorCall(() => ({ projects: creators.store.list(kind) })))
  rpcHandle('navora:creators.create', (_e, kind: CreatorKind, template: string) => creatorCall(() => ({ project: creators.store.create(kind, template) })))
  rpcHandle('navora:creators.get', (_e, id: string) => creatorCall(() => ({ project: creators.store.get(id) })))
  rpcHandle('navora:creators.save', (_e, id: string, revision: number, files: CreatorFiles, name: string) => creatorCall(() => ({ project: creators.save(id, revision, files, name) })))
  rpcHandle('navora:creators.validate', (_e, id: string, revision: number) => creatorCall(() => ({ validation: creators.validate(id, revision) })))
  rpcHandle('navora:creators.install', (_e, id: string, revision: number) => creatorCall(async () => ({ project: await creators.install(id, revision) })))
  rpcHandle('navora:creators.trial', (_e, id: string, revision: number, task: string) => creatorCall(() => creators.trial(id, revision, task)))
  rpcHandle('navora:creators.generate', (_e, id: string, revision: number, request: string, providerId?: string, model?: string) => creatorCall(async () => ({ files: await creators.generate(id, revision, request, providerId, model) })))
  rpcHandle('navora:creators.cancelGenerate', (_e, id: string) => creatorCall(() => { creators.cancelGenerate(id); return {} }))
  rpcHandle('navora:creators.export', (_e, id: string, revision: number) => creatorCall(async () => {
    const project = creators.store.get(id)
    if (project.revision !== revision) throw new Error('revision_conflict')
    if (!creators.validate(id, revision).ok) throw new Error('validation_failed')
    const filename = project.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').slice(0,80) || project.kind
    const selected = await dialog.showSaveDialog({ title: '导出'+(project.kind === 'plugin' ? '插件' : '技能'), defaultPath: `Navora-${filename}.zip`, filters: [{name:'ZIP',extensions:['zip']}] })
    if (selected.canceled || !selected.filePath) return { canceled: true }
    const zip = new AdmZip()
    for (const [name, content] of Object.entries(project.files)) zip.addFile(name, Buffer.from(content, 'utf8'))
    zip.writeZip(selected.filePath)
    return { path: selected.filePath }
  }))
  rpcHandle('navora:models.probe', async (_e, providerId: string, model: string, kind: string) => {
    const provider = config.get().ai.providers.find(p => p.id === providerId)
    if (!provider || (kind !== 'connection' && kind !== 'reply')) return { ok: false, text: '配置无效' }
    return probeModel(provider, secrets.get(provider.api_key_ref) || '', model, kind)
  })
  rpcHandle('navora:models.list', async (_e, providerId: string) => {
    const provider = config.get().ai.providers.find(p => p.id === providerId)
    if (!provider) return { ok: false as const, error: 'provider_not_found' }
    const result = await fetchOpenAiModelsList({ url: provider.base_url, apiKey: secrets.get(provider.api_key_ref), timeoutMs: 20000 })
    return result.ok ? { ok: true as const, models: result.models } : { ok: false as const, error: result.status === 401 || result.status === 403 ? '请先填写此服务的 API Key 并应用设置' : result.error }
  })
  rpcHandle('navora:app.info', (): AppInfo => ({
    name: 'Navora',
    version: app.isPackaged ? app.getVersion() : productVersion,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    dataRoot,
    portable: isPortableRuntime(),
  }))
  rpcHandle('navora:app.openExternal', (_e, url: string) => ({
    ok: openInSystemBrowser(String(url || '')),
  }))
  // Local-only IPC (not registered on remote RPC) so remote clients cannot quit the host
  ipcMain.handle('navora:app.quit', () => {
    isQuitting = true
    abortAllAsks({ preservePersistedUnlimited: true })
    agent?.stopAll()
    registry?.shutdown()
    app.quit()
    return { ok: true as const }
  })
  ipcMain.handle('navora:app.window.minimize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && !w.isDestroyed()) w.minimize()
    return { ok: true as const }
  })
  ipcMain.handle('navora:app.window.toggleMaximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed()) return { ok: true as const, maximized: false }
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return { ok: true as const, maximized: w.isMaximized() }
  })
  ipcMain.handle('navora:app.window.close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && !w.isDestroyed()) w.close()
    return { ok: true as const }
  })
  ipcMain.handle('navora:app.window.isMaximized', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    return { maximized: Boolean(w && !w.isDestroyed() && w.isMaximized()) }
  })

  rpcHandle('navora:config.get', () => config.get())
  rpcHandle('navora:config.commit', async (_e, request:SettingsCommit) => {
    const prev=JSON.parse(JSON.stringify(config.get())) as AppConfig
    const commit=JSON.parse(JSON.stringify(request)) as SettingsCommit
    const patch=commit.patch as AppConfigPatch & {remote?:AppConfig['remote'] & {password?:string}}
    if(patch.remote)remote.applyPasswordFromPatch(patch.remote as unknown as Record<string,unknown>)
    const preview={...prev,...patch,remote:{...prev.remote,...patch.remote}} as AppConfig
    assertRemoteAccessChange(prev.remote,preview.remote)
    const saved=config.commit(commit)
    await configureBrowserAutomation(saved.browser.automation)
    if(JSON.stringify(prev.remote)!==JSON.stringify(saved.remote)||(saved.remote.enabled&&!remote.status().running)){
      try{await remote.syncFromConfig()}catch(e){console.warn('[remote] sync after config.commit failed',e)}
    }
    if(prev.browser.log_datadome_telemetry!==saved.browser.log_datadome_telemetry)registry.reapplyNetwork()
    syncEmptyChatsToConfigDefaults(prev,saved);pluginDevWatch?.sync()
    const out=JSON.parse(JSON.stringify(config.get())) as AppConfig;pushConfigChanged(out);return out
  })
  rpcHandle('navora:config.save', async (_e, patch: AppConfigPatch) => {
    const prev = JSON.parse(JSON.stringify(config.get())) as AppConfig
    const next = JSON.parse(JSON.stringify(patch)) as AppConfigPatch & {
      remote?: AppConfig['remote'] & { password?: string }
    }
    if (next.remote) {
      const port = Number(next.remote.port)
      if (Number.isFinite(port) && port > 0) next.remote.port = Math.floor(port)
      else delete (next.remote as { port?: number }).port
      remote.applyPasswordFromPatch(next.remote as unknown as Record<string, unknown>)
    }
    // Preview merge (remote password plaintext applied above).
    const preview = {
      ...prev,
      ...next,
      remote: { ...prev.remote, ...(next.remote || {}) },
    } as AppConfig
    assertRemoteAccessChange(prev.remote, preview.remote)
    const saved = config.update(next)
    // Native errors belong to per-page effective state, not the persisted save.
    await configureBrowserAutomation(saved.browser.automation)
    // Config is already on disk; remote bind failures must not fail the save.
    if ((JSON.stringify(prev.remote) !== JSON.stringify(saved.remote) || (saved.remote.enabled && !remote.status().running))) {
      try { await remote.syncFromConfig() }
      catch (e) { console.warn('[remote] sync after config.save failed', e) }
    }
    if (
      prev.browser.log_datadome_telemetry !== saved.browser.log_datadome_telemetry
    ) {
      registry.reapplyNetwork()
    }
    syncEmptyChatsToConfigDefaults(prev, saved)
    pluginDevWatch?.sync()
    const out = JSON.parse(JSON.stringify(config.get())) as AppConfig
    pushConfigChanged(out)
    return out
  })
  rpcHandle('navora:config.uaPresets', () => UA_PRESETS)
  rpcHandle('navora:config.resolveUa', () => resolveUserAgent(config.get()))
  rpcHandle('navora:remote.status', () => remote.status())
  rpcHandle('navora:remote.openWindow', async (_e, windowId: string) => {
    await remote.syncFromConfig()
    const st = remote.status()
    if (!st.enabled) return { ok: false, error: 'remote_disabled' }
    if (!st.running) {
      try {
        await remote.start()
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    const opened = remote.openWindowUrl(String(windowId || ''))
    if (!opened.ok || !opened.url) return opened
    openInSystemBrowser(opened.url)
    return { ok: true, url: opened.url }
  })

  rpcHandle('navora:workspace.pickDirectory', async () => {
    const opts = {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const res = await showAppOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    const picked = files.allowExtraRoot(res.filePaths[0])
    return { ok: true, path: picked }
  })

  rpcHandle('navora:plugins.list', () => plugins.list())
  rpcHandle('navora:store.status', () => marketplace.status())
  rpcHandle('navora:store.list', (_e, opts?: { kind?: string; q?: string }) =>
    marketplace.list({
      kind: opts?.kind as 'plugin' | 'skill' | 'all' | undefined,
      q: opts?.q,
    }),
  )
  rpcHandle('navora:store.get', (_e, productId: string, kind?: string) =>
    marketplace.get(
      String(productId || ''),
      kind === 'plugin' || kind === 'skill' ? kind : undefined,
    ),
  )
  rpcHandle('navora:store.previewInstall', (_e, input: unknown) => {
    const o = (input && typeof input === 'object' ? input : {}) as {
      kind?: string
      packageId?: string
      version?: string
    }
    return marketplace.previewInstall({
      kind: o.kind as 'plugin' | 'skill',
      packageId: String(o.packageId || ''),
      version: o.version,
    })
  })
  rpcHandle('navora:store.install', (_e, input: unknown) => {
    const o = (input && typeof input === 'object' ? input : {}) as {
      kind?: string
      packageId?: string
      version?: string
      overwrite?: boolean
      replaceSuite?: boolean
    }
    return marketplace.install({
      kind: o.kind as 'plugin' | 'skill',
      packageId: String(o.packageId || ''),
      version: o.version,
      overwrite: o.overwrite,
      replaceSuite: o.replaceSuite,
    })
  })
  rpcHandle('navora:store.checkUpdates', () => marketplace.checkUpdates())
  rpcHandle('navora:store.readDocs', (_e, input: unknown) => {
    const o = (input && typeof input === 'object' ? input : {}) as {
      kind?: string
      packageId?: string
      version?: string
    }
    return marketplace.readDocs({
      kind: o.kind as 'plugin' | 'skill',
      packageId: String(o.packageId || ''),
      version: o.version,
    })
  })
  rpcHandle('navora:plugins.get', (_e, id: string) => plugins.get(String(id || '')))
  rpcHandle('navora:plugins.readReadme', (_e, id: string) => plugins.readReadme(String(id || '')))
  rpcHandle('navora:plugins.setEnabled', (_e, id: string, enabled: boolean) => {
    return plugins.setEnabled(String(id || ''), Boolean(enabled))
  })
  rpcHandle('navora:plugins.reload', () => {
    plugins.reload()
    return { ok: true, plugins: plugins.list() }
  })
  rpcHandle('navora:plugins.remove', (_e, id: string) => plugins.remove(String(id || '')))
  rpcHandle('navora:plugins.removeMany', (_e, ids: string[]) => {
    const list = Array.isArray(ids) ? ids.map((id) => String(id || '')).filter(Boolean) : []
    if (!list.length) return { ok: false, error: 'ids_required', removed: [], failed: [] }
    const { removed, failed } = plugins.removeMany(list)
    return { ok: failed.length === 0 && removed.length > 0, removed, failed }
  })
  rpcHandle('navora:plugins.parsePath', (_e, absPath: string, opts?: { packageId?: string }) => {
    try {
      const preview = plugins.parseFromPath(String(absPath || ''), {
        packageId: opts?.packageId ? String(opts.packageId) : undefined,
      })
      return { ok: true, preview }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle(
    'navora:plugins.import',
    async (
      _e,
      absPath: string,
      opts?: { overwrite?: boolean; replaceSuite?: boolean; packageId?: string },
    ) => {
      return plugins.importFromPath(String(absPath || ''), {
        ...opts,
        packageId: opts?.packageId ? String(opts.packageId) : undefined,
        onProgress: (p) => pushPluginImportProgress(p),
      })
    },
  )
  rpcHandle('navora:plugins.export', async (_e, id: string) => {
    const pluginId = String(id || '').trim()
    if (!pluginId) return { ok: false, error: 'id_required' }
    const defaultName = plugins.suggestExportFilename(pluginId)
    const res = await showAppSaveDialog({
      title: '导出插件压缩包',
      defaultPath: defaultName,
      filters: [
        { name: 'Plugin zip', extensions: ['zip'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    const outPath = path.extname(res.filePath) ? res.filePath : `${res.filePath}.zip`
    return plugins.exportToZip(pluginId, outPath)
  })
  rpcHandle(
    'navora:plugins.pickParse',
    async (_e, kind?: 'directory' | 'zip') => {
      const mode = kind === 'zip' ? 'zip' : 'directory'
      const res =
        mode === 'zip'
          ? await showAppOpenDialog({
              title: '导入插件压缩包',
              properties: ['openFile'],
              filters: [
                { name: 'Plugin zip', extensions: ['zip'] },
                { name: 'All files', extensions: ['*'] },
              ],
            })
          : await showAppOpenDialog({
              title: '外链插件文件夹（开发）',
              properties: ['openDirectory'],
            })
      if (res.canceled || !res.filePaths?.[0]) {
        return { ok: false, canceled: true }
      }
      try {
        const preview = plugins.parseFromPath(res.filePaths[0])
        return { ok: true, preview, path: res.filePaths[0] }
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          path: res.filePaths[0],
        }
      }
    },
  )
  rpcHandle(
    'navora:plugins.pickImport',
    async (
      _e,
      opts?: {
        overwrite?: boolean
        replaceSuite?: boolean
        kind?: 'directory' | 'zip'
        packageId?: string
      },
    ) => {
      const mode = opts?.kind === 'zip' ? 'zip' : 'directory'
      const res =
        mode === 'zip'
          ? await showAppOpenDialog({
              title: '导入插件压缩包',
              properties: ['openFile'],
              filters: [
                { name: 'Plugin zip', extensions: ['zip'] },
                { name: 'All files', extensions: ['*'] },
              ],
            })
          : await showAppOpenDialog({
              title: '外链插件文件夹（开发）',
              properties: ['openDirectory'],
            })
      if (res.canceled || !res.filePaths?.[0]) {
        return { ok: false, canceled: true }
      }
      const imported = await plugins.importFromPath(res.filePaths[0], {
        overwrite: opts?.overwrite,
        replaceSuite: opts?.replaceSuite,
        packageId: opts?.packageId ? String(opts.packageId) : undefined,
        onProgress: (p) => pushPluginImportProgress(p),
      })
      return { ...imported, path: res.filePaths[0] }
    },
  )

  rpcHandle('navora:skills.list', () => skills.list())
  rpcHandle('navora:skills.get', (_e, id: string) => skills.get(String(id || '')))
  rpcHandle('navora:skills.setEnabled', (_e, id: string, enabled: boolean) => {
    const rec = skills.setEnabled(String(id || ''), Boolean(enabled))
    if (!rec) return { ok: false, error: 'skill_not_found' }
    return { ok: true, skill: rec }
  })
  rpcHandle('navora:skills.remove', (_e, id: string) => {
    const ok = skills.remove(String(id || ''))
    return { ok }
  })
  rpcHandle('navora:skills.removeMany', (_e, ids: string[]) => {
    const list = Array.isArray(ids) ? ids.map((id) => String(id || '')).filter(Boolean) : []
    if (!list.length) return { ok: false, error: 'ids_required', removed: [], failed: [] }
    const { removed, failed } = skills.removeMany(list)
    return { ok: failed.length === 0 && removed.length > 0, removed, failed }
  })
  rpcHandle('navora:skills.create', (_e, input: Record<string, unknown>) => {
    try {
      const skill = skills.create({
        name: String(input?.name || ''),
        description: String(input?.description || ''),
        body: String(input?.body || ''),
        version: input?.version != null ? String(input.version) : undefined,
        disableModelInvocation: Boolean(input?.disableModelInvocation),
        enabled: input?.enabled !== false,
      })
      return { ok: true, skill }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle('navora:skills.update', (_e, id: string, input: Record<string, unknown>) => {
    try {
      const skill = skills.update(String(id || ''), {
        name: String(input?.name || ''),
        description: String(input?.description || ''),
        body: String(input?.body || ''),
        version: input?.version != null ? String(input.version) : undefined,
        disableModelInvocation: Boolean(input?.disableModelInvocation),
        enabled: typeof input?.enabled === 'boolean' ? input.enabled : undefined,
      })
      return { ok: true, skill }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle('navora:skills.export', async (_e, id: string) => {
    const skillId = String(id || '').trim()
    if (!skillId) return { ok: false, error: 'id_required' }
    let markdown = ''
    let defaultName = 'SKILL.md'
    try {
      markdown = skills.exportMarkdown(skillId)
      const detail = skills.get(skillId)
      if (detail?.name || detail?.id) {
        defaultName = suggestSkillExportFilename(detail.name || '', detail.id)
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const opts = {
      title: '导出技能',
      defaultPath: defaultName,
      filters: [
        { name: 'SKILL.md', extensions: ['md'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const res = await showAppSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    const outPath = path.extname(res.filePath) ? res.filePath : `${res.filePath}.md`
    try {
      fs.writeFileSync(outPath, markdown, 'utf8')
      return { ok: true, path: outPath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle('navora:skills.exportMany', async (_e, ids: string[]) => {
    const list = Array.isArray(ids)
      ? [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
      : []
    if (!list.length) return { ok: false, error: 'ids_required', exported: [], failed: [] }

    const prepared: Array<{ id: string; name: string; markdown: string; filename: string }> = []
    const failed: Array<{ id: string; error: string }> = []
    const usedNames = new Set<string>()

    for (const skillId of list) {
      try {
        const markdown = skills.exportMarkdown(skillId)
        const detail = skills.get(skillId)
        const name = detail?.name || skillId
        let filename = suggestSkillExportFilename(name, skillId)
        if (usedNames.has(filename.toLowerCase())) {
          const stem = filename.replace(/\.md$/i, '')
          let n = 2
          let candidate = `${stem}-${n}.md`
          while (usedNames.has(candidate.toLowerCase())) {
            n += 1
            candidate = `${stem}-${n}.md`
          }
          filename = candidate
        }
        usedNames.add(filename.toLowerCase())
        prepared.push({ id: skillId, name, markdown, filename })
      } catch (e) {
        failed.push({ id: skillId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    if (!prepared.length) {
      return { ok: false, error: failed[0]?.error || 'export_failed', exported: [], failed }
    }

    const dialogRes = await showAppOpenDialog({
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (dialogRes.canceled || !dialogRes.filePaths[0]) {
      return { ok: false, canceled: true, exported: [], failed: [] }
    }
    const outDir = dialogRes.filePaths[0]
    const exported: Array<{ id: string; path: string; filename: string }> = []

    for (const item of prepared) {
      const outPath = path.join(outDir, item.filename)
      try {
        fs.writeFileSync(outPath, item.markdown, 'utf8')
        exported.push({ id: item.id, path: outPath, filename: item.filename })
      } catch (e) {
        failed.push({ id: item.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return {
      ok: exported.length > 0 && failed.length === 0,
      dir: outDir,
      exported,
      failed,
    }
  })
  rpcHandle(
    'navora:skills.import',
    async (_e, absPath: string, opts?: { overwrite?: boolean }) => {
      try {
        const skill = await skills.importFromPath(String(absPath || ''), {
          overwrite: opts?.overwrite === true,
        })
        return { ok: true, skill }
      } catch (e) {
        return skillImportErrorResult(e, String(absPath || ''))
      }
    },
  )
  rpcHandle(
    'navora:skills.importMarkdown',
    async (_e, markdown: string, opts?: { overwrite?: boolean }) => {
      try {
        const skill = await skills.importFromMarkdown(String(markdown || ''), {
          overwrite: opts?.overwrite === true,
        })
        return { ok: true, skill }
      } catch (e) {
        return skillImportErrorResult(e)
      }
    },
  )
  rpcHandle(
    'navora:skills.pickImport',
    async (_e, mode?: string, opts?: { overwrite?: boolean }) => {
      const asFile = String(mode || 'directory') === 'file'
      const dialogOpts = asFile
        ? {
            title: '导入 SKILL.md',
            properties: ['openFile'] as Array<'openFile'>,
            filters: [
              { name: 'SKILL.md', extensions: ['md'] },
              { name: 'All files', extensions: ['*'] },
            ],
          }
        : {
            title: '导入技能文件夹',
            properties: ['openDirectory'] as Array<'openDirectory'>,
          }
      const res = await showAppOpenDialog(dialogOpts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
      const picked = res.filePaths[0]
      try {
        const skill = await skills.importFromPath(picked, {
          overwrite: opts?.overwrite === true,
        })
        return { ok: true, skill, path: picked }
      } catch (e) {
        return skillImportErrorResult(e, picked)
      }
    },
  )

  rpcHandle('navora:skills.parsePath', async (_e, absPath: string) => {
    try {
      const previews = await skills.discoverFromPath(String(absPath || ''))
      return {
        ok: true,
        preview: previews[0],
        previews,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:skills.parseMarkdown', (_e, markdown: string, sourceLabel?: string) => {
    try {
      const preview = skills.parseFromMarkdown(String(markdown || ''), sourceLabel ? String(sourceLabel) : undefined)
      return { ok: true, preview }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:skills.getMarkdown', (_e, id: string) => {
    try {
      const markdown = skills.exportMarkdown(String(id || ''))
      const detail = skills.get(String(id || ''))
      return {
        ok: true,
        markdown,
        skill: detail
          ? { id: detail.id, name: detail.name, description: detail.description }
          : undefined,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle(
    'navora:skills.pickParse',
    async (_e, mode?: string) => {
      const asFile = String(mode || 'directory') === 'file'
      const dialogOpts = asFile
        ? {
            title: '导入 SKILL.md',
            properties: ['openFile'] as Array<'openFile'>,
            filters: [
              { name: 'SKILL.md', extensions: ['md'] },
              { name: 'All files', extensions: ['*'] },
            ],
          }
        : {
            title: '导入技能文件夹',
            properties: ['openDirectory'] as Array<'openDirectory'>,
          }
      const res = await showAppOpenDialog(dialogOpts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
      const picked = res.filePaths[0]
      try {
        const previews = await skills.discoverFromPath(picked)
        return {
          ok: true,
          preview: previews[0],
          previews,
          path: picked,
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), path: picked }
      }
    },
  )

  rpcHandle(
    'navora:skill.review.respond',
    (
      _e,
      id: string,
      response: {
        source: SkillReviewResponse['source']
        draft?: SkillReviewResponse['draft']
        exportPath?: string
      },
    ) => {
      const reviewId = String(id || '')
      const source = response?.source || 'cancel'
      let skill: SkillReviewResponse['skill']
      const pending = pendingSkillReview.get(reviewId)
      // Prefer proposal id from pending request bookkeeping
      const proposalId = reviewId

      if (source === 'confirm') {
        if (response.exportPath) {
          skills.removeProposal(proposalId)
        } else {
          const applied = skills.applyProposal(proposalId, response.draft)
          if (!applied.ok) {
            return { ok: false, error: applied.error }
          }
          if (applied.skill) {
            skill = {
              id: applied.skill.id,
              name: applied.skill.name,
              description: applied.skill.description,
              version: applied.skill.version,
              enabled: applied.skill.enabled,
              disableModelInvocation: applied.skill.disableModelInvocation,
            }
          }
        }
        pushSkillProposalsChanged()
      } else if (source === 'cancel') {
        skills.removeProposal(proposalId)
        pushSkillProposalsChanged()
      } else if (source === 'deferred') {
        const prop = skills.getProposal(proposalId)
        // 删除/导出不可搁置：误发 deferred 时按取消清掉
        if (prop && (prop.action === 'delete' || prop.action === 'export')) {
          skills.removeProposal(proposalId)
        }
        pushSkillProposalsChanged()
      }

      const payload: SkillReviewResponse = {
        id: reviewId,
        source,
        draft: response?.draft,
        exportPath: response?.exportPath,
        proposalId,
        skill,
      }
      if (pending) {
        resolveSkillReview(reviewId, payload)
      } else {
        pushSkillReviewCancel(reviewId)
      }
      return { ok: true, skill }
    },
  )

  rpcHandle('navora:skills.listProposals', () => skills.listProposals())
  rpcHandle('navora:skills.getProposal', (_e, id: string) => skills.getProposal(String(id || '')))
  rpcHandle('navora:skills.removeProposal', (_e, id: string) => {
    const ok = skills.removeProposal(String(id || ''))
    if (ok) pushSkillProposalsChanged()
    return { ok }
  })
  rpcHandle(
    'navora:skills.applyProposal',
    (_e, id: string, draft?: SkillReviewResponse['draft']) => {
      const applied = skills.applyProposal(String(id || ''), draft)
      if (applied.ok) pushSkillProposalsChanged()
      return applied
    },
  )
  rpcHandle('navora:skills.openProposal', (_e, id: string) => {
    const p = skills.getProposal(String(id || ''))
    if (!p) return { ok: false, error: 'proposal_not_found' }
    const canDefer = p.action === 'create' || p.action === 'update'
    const req: SkillReviewRequest = {
      id: p.id,
      chatId: p.chatId || '',
      action: p.action,
      skillId: p.skillId,
      draft: p.draft,
      markdown: p.markdown,
      existing: p.existing,
      timeoutMs: 0,
      wait: false,
      canDefer,
      proposalId: p.id,
    }
    pushSkillReview(req)
    return { ok: true, proposalId: p.id }
  })

  rpcHandle('navora:workspace.info', (_e, chatId: string) => {
    if (!chatId) throw new Error('chatId_required')
    return files.rootInfo(chatId)
  })

  rpcHandle('navora:workspace.setChatRoot', (_e, chatId: string, absPath: string | null) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      files.assertAllowedWorkspaceRoot(absPath)
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
    const chat = chats.setWorkspaceRoot(chatId, absPath)
    if (!chat) return { ok: false, error: 'chat_not_found' }
    const info = files.rootInfo(chatId)
    pushWorkspaceChanged(chatId)
    return { ...info, ok: true }
  })

  rpcHandle('navora:workspace.preview', async (_e, chatId: string, relPath: string) => {
    if (!chatId || !chats.get(chatId)) return { ok: false, error: 'chat_not_found' }
    try { return await files.preview(chatId, String(relPath || '')) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })

  rpcHandle('navora:workspace.readMedia', async (_e, chatId: string, relPath: string) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      return await files.readMedia(chatId, String(relPath || ''))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:workspace.reveal', async (_e, chatId: string, relPath: string) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      return await workspaceShell.reveal(String(chatId), String(relPath || ''))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:workspace.open', async (_e, chatId: string, relPath: string) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      return await workspaceShell.open(String(chatId), String(relPath || ''))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('navora:workspace.saveAs',async(event,chatId:string,relPath:string)=>{
    if(event.sender!==mainWindow?.webContents)return {ok:false,error:'local_only'}
    try{
      const source=await files.resolveExisting(String(chatId),String(relPath))
      if(!(await fs.promises.stat(source)).isFile())throw Error('not_a_file')
      const selected=await dialog.showSaveDialog(mainWindow!,{title:'另存为',defaultPath:path.basename(source)})
      if(selected.canceled||!selected.filePath)return {ok:false,canceled:true}
      if(path.resolve(source)!==path.resolve(selected.filePath))await fs.promises.copyFile(source,selected.filePath)
      return {ok:true}
    }catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)}}
  })

  rpcHandle('navora:workspace.list', async (_e, chatId: string, relDir?: string) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      return await files.list(chatId, String(relDir || '.'), false)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  workspaceResourceIndex=new WorkspaceResourceIndex(id=>files.containsFiles(id),id=>files.resources(id))
  rpcHandle('navora:workspace.resources',async(_e,chatId:string,refresh?:boolean)=>{
    if(!chatId||!chats.get(chatId))return {ok:false,entries:[],truncated:false,unavailable:0,error:'chat_not_found'}
    try{const result=await workspaceResourceIndex!.resources(chatId,refresh===true);return {...result,entries:associateResourceEvidence(result.entries,chats.get(chatId)?.messages||[])}}
    catch{return {ok:false,entries:[],truncated:false,unavailable:1,error:'resource_index_failed'}}
  })
  rpcHandle('navora:workspace.hasFiles',(_e,chatId:string)=>files.containsFiles(chatId))
  rpcHandle('navora:workspace.owners',(_e,refresh?:boolean)=>workspaceResourceIndex!.owners(chats.list().map(chat=>chat.id),refresh===true))

  rpcHandle('navora:workspace.delete', async (_e, chatId: string, relPath: string) => {
    if (!chatId) throw new Error('chatId_required')
    try {
      return await files.remove(chatId, String(relPath || ''))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:downloads.list', (event, chatId?: string) => filterDownloadScope(listDownloads(), downloadChatScope(downloadCaller(event), chatId)))
  rpcHandle('navora:downloads.clear', (event, chatId?: string) => {
    const scope = downloadChatScope(downloadCaller(event), chatId)
    const before = listDownloads().length
    for (const id of scope ? [...scope] : [undefined]) {
      toolDownloads.clear(id)
      browserDownloads.clear(id)
    }
    pushBrowserDownloadsChanged()
    return { ok: true, removed: before - listDownloads().length }
  })
  rpcHandle('navora:downloads.remove', (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry) return { ok: false, error: 'not_found' }
    const res = entry.source === 'tool' ? toolDownloads.remove(entry.id) : browserDownloads.remove(entry.id)
    if (res.ok) pushBrowserDownloadsChanged()
    return res
  })
  rpcHandle('navora:downloads.pause', (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry) return { ok: false, error: 'not_found' }
    const res = browserDownloads.pause(entry.id)
    if (res.ok) pushBrowserDownloadsChanged()
    return res
  })
  rpcHandle('navora:downloads.resume', (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry) return { ok: false, error: 'not_found' }
    const res = browserDownloads.resume(entry.id)
    if (res.ok) pushBrowserDownloadsChanged()
    return res
  })
  rpcHandle('navora:downloads.cancel', (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry) return { ok: false, error: 'not_found' }
    const res = browserDownloads.cancel(entry.id)
    if (res.ok) pushBrowserDownloadsChanged()
    return res
  })
  rpcHandle('navora:downloads.reveal', async (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry?.relPath) return { ok: false, error: 'not_found' }
    if (entry.state !== 'completed') return { ok: false, error: 'not_ready' }
    try {
      return await workspaceShell.reveal(entry.chatId, entry.relPath)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle('navora:downloads.open', async (event, id: string, chatId?: string) => {
    const entry = downloadForRequest(event, id, chatId)
    if (!entry?.relPath) return { ok: false, error: 'not_found' }
    if (entry.state !== 'completed') return { ok: false, error: 'not_ready' }
    try {
      return await workspaceShell.open(entry.chatId, entry.relPath)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  rpcHandle('navora:secrets.getApiKey', (_e, ref: string) => {
    const v = secrets.get(ref)
    if (!v) return { configured: false, preview: '' }
    return { configured: true, preview: v.length <= 8 ? '********' : `${v.slice(0, 4)}?${v.slice(-4)}` }
  })
  rpcHandle('navora:secrets.setApiKey', (_e, ref: string, value: string) => {
    if (!String(ref || '').trim()) return { ok: false, error: 'invalid_secret_ref' }
    if (!value?.trim()) return { ok: false, error: 'empty_api_key' }
    secrets.set(ref, value.trim())
    return { ok: true }
  })
  rpcHandle('navora:secrets.clearApiKey', (_e, ref: string) => {
    if (!String(ref || '').trim()) return { ok: false, error: 'invalid_secret_ref' }
    secrets.clear(ref)
    return { ok: true }
  })

  rpcHandle('navora:chats.list', () => chats.list())
  rpcHandle('navora:chats.get', (_e, id: string) => chats.get(id))
  const subchatChildren=(parentId:string)=>{
    const parent=chats.get(parentId)
    if(!parent||parent.kind==='sub')throw Error('subchat_parent_not_found')
    return chats.listChildren(parentId)
  }
  const subchatPending=(parentId:string)=>{
    const children=subchatChildren(parentId),ids=new Set(children.map(c=>c.id)),asks=new Map(children.filter(c=>c.pendingAsk).map(c=>[c.pendingAsk!.id,c.pendingAsk!]))
    for(const entry of pendingAsk.values())if(ids.has(entry.chatId))asks.set(entry.request.id,entry.request)
    return {asks:[...asks.values()],permissions:[...pendingPerm.values()].filter(entry=>ids.has(entry.chatId)).map(entry=>entry.request)}
  }
  rpcHandle('navora:subchats.list',async(_e,parentId:string)=>{
    const children=subchatChildren(parentId),pending=subchatPending(parentId)
    return Promise.all(children.map(async chat=>{
      const item=subchatIndex(chat,pending.asks.filter(req=>req.chatId===chat.id).length+pending.permissions.filter(req=>req.chatId===chat.id).length)
      try{const snapshot=await workspaceResourceIndex!.resources(chat.id);if(snapshot.ok&&!snapshot.unavailable){item.resourceCount=snapshot.entries.length+registry.getTree(chat.id).reduce((n,session)=>n+session.windows.length,0);item.resourcesTruncated=snapshot.truncated}}catch{/* Unknown counts stay absent, never presented as zero. */}
      return item
    }))
  })
  rpcHandle('navora:subchats.pending',(_e,parentId:string)=>subchatPending(parentId))

  rpcHandle('navora:chats.export', async (_e, chatId: string) => {
    const id = String(chatId || '').trim()
    if (!id) return { ok: false, error: 'chat_id_required' }
    const chat = chats.get(id)
    if (!chat) return { ok: false, error: 'chat_not_found' }
    if (!chat.messages?.length) return { ok: false, error: 'empty_chat' }

    const opts = {
      title: '导出对话',
      defaultPath: suggestChatExportFilename(chat, 'md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    }
    const res = await showAppSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }

    const filePath = res.filePath
    const ext = path.extname(filePath).toLowerCase()
    const format = ext === '.json' ? 'json' : 'md'
    const outPath = ext ? filePath : `${filePath}.md`
    try {
      fs.writeFileSync(outPath, formatChatExportContent(chat, format), 'utf8')
      return { ok: true, path: outPath, format }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  rpcHandle('navora:chats.create', (_e, title?: string) => {
    const cfg = config.get()
    const p = cfg.permissions
    const provider =
      cfg.ai.providers.find((x) => x.id === cfg.ai.default_provider) || cfg.ai.providers[0]
    const chat = chats.create(title, {
      permissions: {
        preset: p.preset,
        modes: { ...p.modes },
      },
      providerId: provider?.id || cfg.ai.default_provider || cfg.ai.providers[0]?.id,
      model: provider?.model,
    })
    pushChatChanged({ type: 'upsert', chatId: chat.id })
    return chat
  })
  rpcHandle(
    'navora:chats.setPermissions',
    (
      _e: unknown,
      chatId: string,
      permissions: ChatPermissions,
    ) => {
      const chat = chats.setPermissions(chatId, permissions)
      if (chat) pushChatChanged({ type: 'upsert', chatId })
      return chat
    },
  )
  rpcHandle(
    'navora:chats.setProvider',
    (_e: unknown, chatId: string, providerId: string | null, model?: string | null, reasoningLevel?: string | null) => {
      const chat = chats.setProvider(chatId, providerId, model, reasoningLevel)
      if (chat) pushChatChanged({ type: 'upsert', chatId })
      return chat
    },
  )
  rpcHandle('navora:chats.setExecutionMode', (_e, chatId: string, mode: 'auto' | 'chat' | 'agent') => {
    if (agent.isRunning(chatId)) throw new Error('chat_running')
    const chat = chats.setExecutionMode(chatId, mode)
    if (chat) pushChatChanged({ type: 'upsert', chatId })
    return chat
  })
  rpcHandle(
    'navora:chats.append',
    (
      _e: unknown,
      chatId: string,
      msg: {
        role: 'user' | 'assistant' | 'system' | 'log'
        content: string
        meta?: { refs?: BrowserContextRef[] }
      },
    ) => {
      const message = chats.appendMessage(chatId, msg)
      if (message) {
        pushAgentEvent({ type: 'message', chatId, message })
        pushChatChanged({ type: 'upsert', chatId })
      }
      return chats.get(chatId)
    },
  )
  rpcHandle('navora:chats.delete', async (_e, chatId: string) => {
    const cascade = chats.collectCascadeIds(chatId)
    if (!cascade.length) return false
    // Children first so parent cleanup sees a consistent tree.
    for (const id of [...cascade].reverse()) {
      abortAsksForChat(id)
      agent.stop(id)
      agent.clearChatState(id)
      gate.clearChat(id)
      await registry.clearChat(id)
      plugins.cancelChat(id)
      const ok = chats.delete(id)
      if (ok) pushChatChanged({ type: 'removed', chatId: id })
    }
    return true
  })

  rpcHandle('navora:chats.setPinned', (_e, chatId: string, pinned: boolean) => {
    const chat = chats.setPinned(chatId, Boolean(pinned))
    if (chat) pushChatChanged({ type: 'upsert', chatId })
    return chat
  })

  rpcHandle('navora:chats.setTitle', (_e, chatId: string, title: string) => {
    if (!chatId) throw new Error('chatId_required')
    const before = chats.get(chatId)
    if (!before) return null
    const chat = chats.setTitle(chatId, String(title ?? ''), { fromUser: true })
    if (chat && chat.title !== before.title) pushChatChanged({ type: 'upsert', chatId })
    return chat
  })

  rpcHandle(
    'navora:chats.setDraft',
    (
      _e: unknown,
      chatId: string,
      text: string,
      opts?: ComposerDraftOptions,
    ) => {
      if (!chatId) throw new Error('chatId_required')
      const existing = chats.get(chatId)
      if (!existing) return null
      const document=opts?.document?normalizeComposerDocument(opts.document,chatId):undefined
      const body=document?compileComposerDocument(document).content:String(text??'')
      // Draft durability is independent of the current model's sending budget.
      // Structured drafts have schema limits; legacy strings have a transport cap.
      if(!document&&body.length>200000)throw Error('composer_document_too_large')
      const prevDraft = existing.draft || ''
      const prevAt = existing.draftUpdatedAt || 0
      const previousRevision=existing.draftRevision||0
      const previousConflict=existing.draftConflict?.recoveryId
      const chat = chats.setDraft(chatId, body, {
        ...opts,document,
        updatedAt: typeof opts?.updatedAt === 'number' ? opts.updatedAt : Date.now(),
      })
      if (
        chat &&
        ((chat.draft || '') !== prevDraft || (chat.draftUpdatedAt || 0) !== prevAt || (chat.draftRevision||0)!==previousRevision || chat.draftConflict?.recoveryId!==previousConflict || !!chat.draftConflict)
      ) {
        pushChatChanged({ type: 'upsert', chatId })
      }
      return chat
    },
  )

  rpcHandle('navora:chats.saveDraftRecovery',(_e,chatId:string,document:import('../shared/composer-document').ComposerDocument,reason:'conflict'|'send_failed'='send_failed')=>{
    if(!['conflict','send_failed'].includes(reason))throw Error('invalid_draft_recovery')
    chats.recoverDraft(chatId,document,reason);pushChatChanged({type:'upsert',chatId});return chats.get(chatId)
  })
  rpcHandle('navora:chats.dismissDraftRecovery',(_e,chatId:string,id:string)=>{const chat=chats.dismissDraftRecovery(chatId,id);if(chat)pushChatChanged({type:'upsert',chatId});return chat})

  const composerSources=createComposerSources({files,registry,chatExists:id=>!!chats.get(id),annotations:()=>browserAnnotations,caller:event=>{
    if(event===null)return {kind:'remote'}
    if(event.sender.isDestroyed()||event.senderFrame!==event.sender.mainFrame)return {kind:'denied'}
    if(mainWindow&&!mainWindow.isDestroyed()&&event.sender===mainWindow.webContents)return {kind:'main'}
    const host=registry.hosts.hostForSender(event.sender)
    return host&&!host.embedded&&!host.window.isDestroyed()?{kind:'host',hostId:host.id}:{kind:'denied'}
  }})
  rpcHandle('navora:composer.importContextFiles',(event:Electron.IpcMainInvokeEvent|null,chatId:string,input:ComposerImportFile[])=>composerSources.importContextFiles(event,chatId,input))
  rpcHandle('navora:composer.contextExcerpt',(event:Electron.IpcMainInvokeEvent|null,chatId:string,input:ComposerExcerptInput)=>composerSources.contextExcerpt(event,chatId,input))

  const prepareComposerInput=async(chatId:string,input:ComposerSubmitInput):Promise<ComposerSubmitInput>=>{
    if(!chats.get(chatId))throw Error('chat_not_found')
    const modelIdentity=input.modelIdentity||confirmedModelSelection(config.get(),chats.get(chatId)!)
    validateModelSelection(config.get(),modelIdentity)
    const document=input.document?normalizeComposerDocument(input.document,chatId):undefined
    const compiled=document?compileComposerDocument(document):undefined
    const imagePaths=new Set<string>();let imageBytes=0
    for(const {block,content:excerpt} of compiled?.contexts||[]){
      const source=block.source
      if(source.chatId&&source.chatId!==chatId)throw Error('composer_context_wrong_chat')
      if(source.kind==='url'){
        try{const url=new URL(source.url||'');if(!['http:','https:'].includes(url.protocol))throw Error()}catch{throw Error('invalid_composer_url')}
      }
      if(block.mode==='excerpt'){
        if(block.status==='loading')throw Error('composer_context_unavailable')
        if(!excerpt.trim())throw Error('composer_excerpt_empty')
        if(source.kind==='file'||source.kind==='image')makeFileTab(chatId,source.path||'')
        continue
      }
      if(block.status&&block.status!=='ready')throw Error('composer_context_unavailable')
      if(source.kind==='file'||source.kind==='image'){
        if(block.range?.startLine||block.range?.endLine||block.range?.pageStart||block.range?.pageEnd)throw Error('composer_reference_range_requires_excerpt')
        const relative=makeFileTab(chatId,source.path||'').path
        let absolute:string
        try{absolute=await files.resolveExisting(chatId,relative)}catch{throw Error('composer_source_missing')}
        const stat=await fs.promises.stat(absolute)
        if(!stat.isFile())throw Error('composer_source_not_file')
        if(block.mode==='reference'&&block.version!==undefined&&String(block.version)!==String(stat.mtimeMs)+':'+String(stat.size))throw Error('composer_source_changed')
        if(source.kind==='image'&&!imagePaths.has(relative)){
          imagePaths.add(relative);imageBytes+=stat.size
          if(stat.size>12*1024*1024||imageBytes>32*1024*1024)throw Error('composer_images_budget_exceeded')
        }
      }else if(source.kind==='message'){
        if(!source.messageId||!chats.get(chatId)?.messages.some(message=>message.id===source.messageId))throw Error('composer_source_missing')
      }else if(['page','session','annotation'].includes(source.kind)&&!source.browserRef)throw Error('invalid_composer_context')
    }
    const refs=compiled?.refs??(Array.isArray(input.refs)?input.refs:[])
    if(refs.length>100)throw Error('too_many_context_references')
    for(const ref of refs){
      const session=registry.getSessionRecord(ref.sessionId)
      if(!session||session.chatId!==chatId)throw Error('composer_source_missing')
      if(ref.kind==='window'){
        const page=ref.windowId&&registry.getWindowRecord(ref.windowId)
        if(!page||page.chatId!==chatId||page.sessionId!==ref.sessionId)throw Error('composer_source_missing')
      }else if(ref.kind==='annotation'){
        if(!ref.annotationId||!browserAnnotations)throw Error('composer_source_missing')
        const annotation=browserAnnotations.get(chatId,ref.annotationId)
        if(annotation.sessionId!==ref.sessionId)throw Error('composer_context_wrong_chat')
        if(ref.annotationRevision&&annotation.revision!==ref.annotationRevision&&!fs.existsSync(files.resolve(chatId,'browser-annotations/'+ref.annotationId+'-r'+ref.annotationRevision+'.json')))throw Error('composer_source_changed')
      }else if(ref.kind!=='session')throw Error('invalid_composer_context')
    }
    const content=compiled?.content??String(input.content||'')
    const max=Math.min(200000,Math.max(1000,Math.floor(config.get().app.max_composer_chars||16000)))
    if(content.length>max)throw Error('message_too_long')
    // Source reads above can yield while another window edits this connection.
    validateModelSelection(config.get(),modelIdentity)
    return {...input,content,refs,document,modelIdentity}
  }

  const startAgentMessage = async (chatId:string,raw:ComposerSubmitInput) => {
      if (!chatId) throw new Error('chatId_required')
      const payload=await prepareComposerInput(chatId,raw)
      const maxChars = Math.min(
        200000,
        Math.max(1000, Math.floor(config.get().app.max_composer_chars || 16000)),
      )
      let content = (payload?.content || '').trim()
      if (content.length > maxChars) {
        throw new Error(`message_too_long:输入超过上限（${maxChars} 字）`)
      }
      const refs = payload?.refs || []
      if (!content && !refs.length) throw new Error('empty_message')

      // Validate the same root/child quota before accepting the user message.
      if(payload.modelIdentity)validateModelSelection(config.get(),payload.modelIdentity)
      agent.assertCanRun(chatId)

      const userMsg = chats.appendMessage(chatId, {
        role: 'user',
        content: content || '（附带浏览器上下文）',
        meta: {modelIdentity:payload.modelIdentity,...(refs.length?{refs}:{}),...(payload.document?{document:payload.document}:{}),...(payload.clientMessageId?{clientMessageId:payload.clientMessageId}:{})},
      })
      if (userMsg) {
        pushAgentEvent({ type: 'message', chatId, message: userMsg })
        const provisional = chats.setProvisionalTitleFromFirstUser(
          chatId,
          content || userMsg.content,
        )
        if (provisional) {
          pushAgentEvent({ type: 'title', chatId, title: provisional, fromAi: false })
        }
        pushChatChanged({ type: 'upsert', chatId })
      }

      // Fire-and-forget after registration; start-gate errors already thrown above.
      void agent.run({ chatId, userText: content, refs,modelIdentity:payload.modelIdentity }).catch((e) => {
        console.error('[agent.run]', e)
      })
      return chats.get(chatId)
  }
  agentInbox=new AgentInbox({
    get:id=>chats.get(id),save:(id,entries,paused)=>chats.setMessageQueue(id,entries,paused),
    changed:chatId=>pushChatChanged({type:'upsert',chatId}),running:id=>agent.isRunning(id),
    start:startAgentMessage,insert:(id,input)=>agent.insertUserInput(id,input),
    validateIncoming:(id,input)=>{if(input.modelIdentity)assertConfirmedModelSelection(input.modelIdentity,confirmedModelSelection(config.get(),chats.get(id)||{}))},
    prepare:prepareComposerInput,accepted:(id,key,fingerprint)=>chats.rememberAcceptedMessage(id,key,fingerprint),
    maxChars:()=>Math.min(200000,Math.max(1000,Math.floor(config.get().app.max_composer_chars||16000))),
  })
  // Restore drafts of queued work without silently resuming automation on launch.
  for(const chat of chats.list())if(chat.queuedMessages?.length)agentInbox.pause(chat.id)
  rpcHandle('navora:agent.run',async(_e,chatId:string,payload:ComposerSubmitInput)=>{
    const revision=payload.draftRevision??chats.get(chatId)?.draftRevision
    await startAgentMessage(chatId,payload);chats.clearDraftRevision(chatId,revision);pushChatChanged({type:'upsert',chatId});return chats.get(chatId)
  })
  rpcHandle('navora:agent.submit',async(_e,chatId:string,payload:ComposerSubmitInput,mode?:'queue'|'insert')=>{
    const revision=payload.draftRevision??chats.get(chatId)?.draftRevision
    try{
      const accepted=await agentInbox!.submit(chatId,payload,mode==='insert'||mode==='queue'?mode:config.get().app.running_message_mode==='insert'?'insert':'queue')
      const current=chats.get(chatId)?.draftDocument
      const unfinishedClear=!accepted&&payload.document&&current?.id===payload.document.id&&current.revision===payload.document.revision&&JSON.stringify(current.content)===JSON.stringify(payload.document.content)
      if(accepted||unfinishedClear)chats.clearDraftRevision(chatId,revision)
      pushChatChanged({type:'upsert',chatId});return chats.get(chatId)
    }catch(error){
      if(payload.document){try{chats.recoverDraft(chatId,payload.document,'send_failed');pushChatChanged({type:'upsert',chatId})}catch{/* Keep the original submission error. */}}
      throw error
    }
  })
  rpcHandle('navora:agent.queue.edit',async(_e,id:string,messageId:string,content:string,options?:ComposerQueueEditOptions)=>{await agentInbox!.edit(id,messageId,content,options);return chats.get(id)})
  rpcHandle('navora:agent.queue.remove',(_e,id:string,messageId:string)=>{agentInbox!.remove(id,messageId);return chats.get(id)})
  rpcHandle('navora:agent.queue.insert',async(_e,id:string,messageId:string)=>{await agentInbox!.insert(id,messageId);return chats.get(id)})
  rpcHandle('navora:agent.queue.resume',async(_e,id:string)=>{await agentInbox!.resume(id);return chats.get(id)})

  rpcHandle('navora:agent.retry', async (_e: unknown, chatId: string) => {
    if (!chatId) throw new Error('chatId_required')
    agent.assertCanRun(chatId)
    const candidate=chats.get(chatId)?.messages.slice().reverse().find(message=>message.role==='user')
    if(!candidate)throw new Error('nothing_to_retry')
    const retry=await prepareComposerInput(chatId,{content:candidate.content,refs:candidate.meta?.refs,document:candidate.meta?.document})
    agent.assertCanRun(chatId)
    const lastUser = chats.trimAfterLastUser(chatId)
    if (!lastUser) throw new Error('nothing_to_retry')
    const refs = retry.refs || []
    pushChatChanged({ type: 'upsert', chatId })
    void agent
      .run({ chatId, userText: retry.content, refs: refs.length ? refs : undefined,modelIdentity:retry.modelIdentity })
      .catch((e) => {
        console.error('[agent.retry]', e)
      })
    return chats.get(chatId)
  })

  rpcHandle('navora:agent.stop', (_e, chatId: string) => {
    let aborted=false
    for(const id of chats.collectCascadeIds(chatId)){agentInbox?.pause(id);aborted=abortAsksForChat(id)||aborted}
    const ok = agent.stop(chatId)||aborted
    return { ok }
  })

  rpcHandle('navora:agent.isRunning', (_e, chatId: string) => agent.isRunning(chatId))

  rpcHandle('navora:permission.respond', (_e: unknown, id: string, decision: PermissionDecision) => {
    return resolvePerm(id, decision, true)
  })

  rpcHandle(
    'navora:agent.ask.respond',
    (_e: unknown, id: string, response: Omit<AgentAskResponse, 'id'> & { id?: string }) => {
      const payload: AgentAskResponse = {
        id,
        answer: String(response?.answer || ''),
        source: response?.source || 'deny',
      }
      if (resolveAsk(id, payload, true)) return true
      const parked = chats.list().find((c) => c.pendingAsk?.id === id)
      if (!parked?.pendingAsk) return false
      const req = parked.pendingAsk
      const denied = payload.source === 'deny' || !payload.answer.trim()
      if (denied) {
        chats.setPendingAsk(parked.id, null)
        agent.assertCanRun(parked.id)
      void agent.continueAfterPersistedAsk(parked.id, req, payload).catch((e) => {
          console.error('[ask] persist deny', e)
        })
        pushAgentAskCancel(id, 'deny')
        return true
      }
      void agent.continueAfterPersistedAsk(parked.id, req, payload).catch((e) => {
        console.error('[ask] persist resume', e)
      })
      pushAgentAskCancel(id, 'resolved')
      return true
    },
  )

  rpcHandle('navora:browser.annotations.list',(_e,chatId:string)=>{if(!chats.get(chatId))throw Error('chat_not_found');return browserAnnotations?.list(chatId)||[]})
  rpcHandle('navora:browser.tree', (_e, chatId: string) => displayBrowserTree(chatId))
  rpcHandle('navora:browser.treeAll', () => chats.list().flatMap(chat => registry.getTree(chat.id)))
  rpcHandle('navora:browser.windowCounts', () => displayWindowCounts())

  rpcHandle('navora:browser.session.create', (_e: unknown, chatId: string, opts?: { persist?: boolean }) => {
    if (!chatId) throw new Error('chatId_required')
    return registry.createSession(chatId, { persist: opts?.persist === true })
  })

  rpcHandle('navora:browser.session.close', async (_e, sessionId: string) => {
    const ownerChatId = registry.getSessionRecord(sessionId)?.chatId
    const result=await registry.manageSession(sessionId,'delete')
    if(result.deleted){network.disposeSession(sessionId);if(ownerChatId)agent?.notifySessionClosed(ownerChatId,sessionId)}
    return result.deleted
  })
  rpcHandle('navora:browser.session.update',(_e,sessionId:string,patch:BrowserSessionUpdate)=>registry.updateSession(sessionId,patch))
  rpcHandle('navora:browser.session.manage',async(_e,sessionId:string,action:BrowserSessionManageAction)=>{
    const ownerChatId=registry.getSessionRecord(sessionId)?.chatId,result=await registry.manageSession(sessionId,action)
    if(result.deleted){network.disposeSession(sessionId);if(ownerChatId)agent?.notifySessionClosed(ownerChatId,sessionId)}
    return result
  })

  rpcHandle(
    'navora:browser.window.create',
    (_e: unknown, sessionId: string, opts?: { url?: string; show?: boolean }) => {
      return registry.createWindow(sessionId, {
        url: opts?.url || 'https://www.bing.com/',
        show: opts?.show,
      })
    },
  )

  rpcHandle('navora:browser.window.setVisible', (_e, windowId: string, visible: boolean) => {
    registry.setVisible(windowId, visible)
    return true
  })

  rpcHandle('navora:browser.window.close', (_e, windowId: string) => {
    const ownerChatId = registry.getWindowRecord(windowId)?.chatId
    registry.requestCloseWindow(windowId)
    return true
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void createWindow()
  })

  app.whenReady().then(async () => {
    dataRoot = resolveDataRoot()
    ensureDir(dataRoot)
    ensureDir(path.join(dataRoot, 'logs'))
    ensureDir(path.join(dataRoot, 'secrets'))
    ensureDir(path.join(dataRoot, 'workspace'))
    applyUserDataPath(dataRoot)

    config = new ConfigService(dataRoot)
    await configureBrowserAutomation(config.get().browser.automation)
    nativeTheme.on('updated', () => {
      // Native captions and renderer media queries follow the same OS preference.
      pushConfigChanged(config.get())
    })
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('did-finish-load', () => {
        if (!mainWindow || mainWindow.isDestroyed() || win.isDestroyed()) return
        if (win.webContents.getURL().split('#')[0] === mainWindow.webContents.getURL().split('#')[0]) {
          updateWindowAppearance(win, config.get())
        }
      })
    })
    chats = new ChatStore(dataRoot)
    secrets = new SecretsStore(dataRoot)
    skills = new SkillStore(dataRoot)
    skills.onChanged(() => pushSkillsChanged())
    plugins = new PluginStore(dataRoot)
    creators = new CreatorService(dataRoot, {plugins, skills, chats, secrets, getConfig: () => config.get()})
    pluginDevWatch = new PluginDevWatcher(plugins, () => resolvePluginDevMode(config.get()))
    plugins.onChanged(() => {
      pushPluginsChanged()
      pluginDevWatch.sync()
    })
    // Rehydrate session-scoped plugin-dev links from chat records.
    {
      const hydrate: Array<{ scopeChatId: string; path: string }> = []
      for (const c of chats.list()) {
        if (c.kind === 'sub') continue
        for (const link of c.devPluginLinks || []) {
          if (link?.id && link?.path) {
            hydrate.push({ scopeChatId: c.id, path: link.path })
          }
        }
      }
      if (hydrate.length) plugins.hydrateSessionLinks(hydrate)
    }
    pluginDevWatch.sync()
    marketplace = new MarketplaceClient(dataRoot, config, plugins, skills)
    marketplace.onProgress = (p) => pushStoreProgress(p)
    browserDownloads = new BrowserDownloadList()

    browserStart=new BrowserStartStore(path.join(dataRoot,'browser-start.json'))
    registry = new BrowserRegistry(() => config.get(), {
      onVisit:info=>browserStart.visit(info),
      onTreeChanged: (chatId) => pushBrowserTree(chatId),
      onWindowClosedByUser: (info) => {
        pushBrowserTree(info.chatId)
        agent?.notifyWindowClosed(info.chatId, info.windowId)
      },
      onWindowOpened: (info) => {
        if (agent?.isRunning(info.chatId)) {
          agent.pushUserOpLog(info.chatId, logWindowOpened(info.url))
        }
      },
      onUserNavigate: (info) => {
        if (agent?.isRunning(info.chatId)) {
          agent.pushUserOpLog(
            info.chatId,
            logUserNavigated(info.url, info.statusCode, info.statusText),
          )
        }
      },
      onBrowserDownload: (info) => {
        const before=browserDownloads.stateOf(info)
        const entry=browserDownloads.upsert(info)
        pushBrowserDownloadsChanged()
        if(!agent||entry.id.startsWith('ignored_'))return entry
        agent.trackBrowserDownload(entry)
        if(!downloadNeedsLog(before,entry))return entry
        if(entry.state==='started'&&entry.relPath)agent.recordBrowserDownload(entry,logBrowserDownloadStarted(entry.filename,entry.relPath,entry.url))
        if(entry.state==='completed'&&entry.relPath){
          agent.recordBrowserDownload(entry,logBrowserDownloadCompleted(entry.filename,entry.relPath,entry.receivedBytes))
          pushWorkspaceChanged(entry.chatId)
        }
        if(entry.state==='failed'||entry.state==='cancelled')agent.recordBrowserDownload(entry,logBrowserDownloadFailed(entry.filename,entry.error||entry.state,entry.relPath))
        return entry
      },
      bindBrowserDownloadItem: (entryId, item) => {
        browserDownloads.bindItem(entryId, item)
      },
      confirmBrowserDownload: async (info) => {
        if (!agent) return 'reject'
        return agent.promptDownloadConfirm(info)
      },
    })

    network = new BrowserNetworkManager(
      () => config.get(),
      (sessionId) => registry.getSessionRecord(sessionId)?.ses ?? null,
      () => path.join(dataRoot, 'logs'),
    )
    registry.bindNetwork(network)

    files = new WorkspaceFiles(dataRoot, () => config.get(), (chatId) => chats.getWorkspaceRoot(chatId))
    files.setOnChanged((chatId) => pushWorkspaceChanged(chatId))
    // Grandfather existing per-chat workspace roots so restarts keep user picks.
    for (const c of chats.list()) {
      const root = c.workspaceRoot?.trim()
      if (root) files.allowExtraRoot(root)
    }
    registry.bindWorkspaceFiles(files)
    downloads = new FileDownloadService(files, () => config.get())
    workspaceShell = new WorkspaceShell(files, () => config.get())

    gate = new PermissionGate(
      () => config.get(),
      (req: PermissionRequest) =>
        new Promise<PermissionDecision>((resolve) => {
          const timer = setTimeout(() => {
            resolvePerm(req.id, 'deny', true)
          }, req.timeoutMs || 120000)

          pendingPerm.set(req.id, { chatId: req.chatId, request:req, timer, resolve })

          const hasLocal = !!(mainWindow && !mainWindow.isDestroyed())
          const remoteReady = !!(remote?.status().enabled && remote?.status().running)
          if (!hasLocal && !remoteReady) {
            resolvePerm(req.id, 'deny', false)
            return
          }
          if (hasLocal) mainWindow!.show()
          pushAgentEvent({
            type: 'phase',
            chatId: req.chatId,
            phase: 'awaiting_permission',
            detail: `等待授权：${req.capability}`,
          })
          pushPermissionRequest(req)
        }),
      (chatId, capability, detail) => {
        const entry = logPermissionAutoAllow(capability, detail)
        const msg = chats.appendMessage(chatId, {
          role: 'log',
          content: entry.content,
          meta: {
            kind: 'permission_notify',
            summary: entry.summary,
            ...(entry.detail ? { detail: entry.detail } : {}),
          },
        })
        if (msg) pushAgentEvent({ type: 'message', chatId, message: msg })
      },
      (chatId) => chats.getPermissions(chatId),
    )
    registry.bindPermissionGate(gate)

    agent = new AgentRuntime({
      getBrowserDownloads: (chatId)=>browserDownloads.list(chatId),
      getConfig: () => config.get(),
      updateConfig: async (patch) => {
        const prev = JSON.parse(JSON.stringify(config.get())) as AppConfig
        const next = JSON.parse(JSON.stringify(patch)) as AppConfigPatch & {
          remote?: AppConfig['remote'] & { password?: string }
        }
        if (next.remote) {
          const port = Number(next.remote.port)
          if (Number.isFinite(port) && port > 0) next.remote.port = Math.floor(port)
          else delete (next.remote as { port?: number }).port
          remote.applyPasswordFromPatch(next.remote as unknown as Record<string, unknown>)
        }
        const preview = {
          ...prev,
          ...next,
          remote: { ...prev.remote, ...(next.remote || {}) },
        } as AppConfig
        assertRemoteAccessChange(prev.remote, preview.remote)
        const saved = config.update(next)
        await configureBrowserAutomation(saved.browser.automation)
        if ((JSON.stringify(prev.remote) !== JSON.stringify(saved.remote) || (saved.remote.enabled && !remote.status().running))) {
          try { await remote.syncFromConfig() }
          catch (e) { console.warn('[remote] sync after agent settings update failed', e) }
        }
        if (
          prev.browser.log_datadome_telemetry !== saved.browser.log_datadome_telemetry
        ) {
          registry.reapplyNetwork()
        }
        syncEmptyChatsToConfigDefaults(prev, saved)
        pluginDevWatch?.sync()
        const out = JSON.parse(JSON.stringify(config.get())) as AppConfig
        pushConfigChanged(out)
        return out
      },
      chats,
      registry,
      network,
      files,
      downloads,
      shell: workspaceShell,
      gate,
      secrets,
      skills,
      plugins,
      store: marketplace,
      emit: (ev) => pushAgentEvent(ev),
      onChatChanged: (ev) => {
        if (ev.type === 'upsert' || ev.type === 'removed') pushChatChanged(ev)
      },
      askUser: (partial) =>
        new Promise<AgentAskResponse>((resolve) => {
          const cfgNow = config.get()
          const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
          const askChat = chats.get(partial.chatId)
          const req: AgentAskRequest = {
            id,
            chatId: partial.chatId,
            kind: partial.kind,
            question: partial.question,
            options: partial.options || [],
            optionItems: partial.optionItems,
            allowCustom: partial.kind === 'continue_rounds' || partial.kind === 'download_confirm'
              ? false
              : partial.allowCustom !== false,
            timeoutMs:
              typeof partial.timeoutMs === 'number' && Number.isFinite(partial.timeoutMs)
                ? partial.timeoutMs <= 0
                  ? 0
                  : partial.timeoutMs
                : resolveForkDecision(cfgNow).ask_timeout_ms,
            meta: partial.meta,
            evidence: partial.evidence,
            ...(askChat?.kind === 'sub' && askChat.parentChatId
              ? {
                  parentChatId: askChat.parentChatId,
                  subChatTitle: askChat.title || askChat.spawnPurpose || '',
                }
              : {}),
          }

          const timer =
            req.timeoutMs > 0
              ? setTimeout(() => {
                  resolveAsk(id, { id, answer: '', source: 'timeout' })
                }, req.timeoutMs)
              : null

          pendingAsk.set(id, { chatId: req.chatId, request:req, timer, resolve })
          if (req.timeoutMs <= 0 && req.kind === 'user_choice') {
            chats.setPendingAsk(req.chatId, req)
          }

          const hasLocal = !!(mainWindow && !mainWindow.isDestroyed())
          const remoteReady = !!(remote?.status().enabled && remote?.status().running)
          if (!hasLocal && !remoteReady) {
            resolveAsk(id, { id, answer: '', source: 'deny' })
            return
          }

          if (hasLocal) mainWindow!.show()
          pushAgentEvent({
            type: 'phase',
            chatId: req.chatId,
            phase: 'awaiting_user',
            detail: req.question.slice(0, 120),
          })
          pushAgentAsk(req)
        }),
      askSkillReview: (partial) =>
        new Promise<SkillReviewResponse>((resolve) => {
          const id = `skillrev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
          const wait = partial.wait === true
          const canDefer = partial.canDefer === true
          const proposalId = String(partial.proposalId || id)
          const timeoutMs = wait
            ? typeof partial.timeoutMs === 'number' && Number.isFinite(partial.timeoutMs)
              ? partial.timeoutMs <= 0
                ? 0
                : partial.timeoutMs
              : 300000
            : 0

          const draft = partial.draft || {
            name: '',
            description: '',
            body: '',
          }
          skills.upsertProposal({
            id: proposalId,
            chatId: partial.chatId,
            action: partial.action,
            skillId: partial.skillId,
            draft,
            markdown: partial.markdown,
            existing: partial.existing,
          })
          pushSkillProposalsChanged()

          const req: SkillReviewRequest = {
            id: proposalId,
            chatId: partial.chatId,
            action: partial.action,
            skillId: partial.skillId,
            draft,
            markdown: partial.markdown,
            existing: partial.existing,
            timeoutMs,
            wait,
            canDefer,
            proposalId,
          }

          const hasLocal = !!(mainWindow && !mainWindow.isDestroyed())
          const remoteReady = !!(remote?.status().enabled && remote?.status().running)
          if (!hasLocal && !remoteReady) {
            // 无可展示 UI：可搁置且不等待 → 留在待确认；否则取消
            if (!wait && canDefer) {
              resolve({ id: proposalId, source: 'deferred', proposalId })
              return
            }
            skills.removeProposal(proposalId)
            pushSkillProposalsChanged()
            resolve({ id: proposalId, source: 'cancel', proposalId })
            return
          }

          if (hasLocal) mainWindow!.show()

          if (!wait) {
            // Fire-and-forget dialog; agent continues immediately.
            pushSkillReview(req)
            resolve({ id: proposalId, source: 'deferred', proposalId })
            return
          }

          const timer =
            timeoutMs > 0
              ? setTimeout(() => {
                  resolveSkillReview(proposalId, { id: proposalId, source: 'timeout', proposalId })
                }, timeoutMs)
              : null
          pendingSkillReview.set(proposalId, { chatId: req.chatId, timer, resolve })
          pushAgentEvent({
            type: 'phase',
            chatId: req.chatId,
            phase: 'awaiting_skill_review',
            detail: `${req.action} ${req.draft?.name || req.skillId || ''}`.trim(),
          })
          pushSkillReview(req)
        }),
    })

    remote = new RemoteServer(() => config.get(), registry)
    remote.setRpcRegistry(rpc)
    void remote.syncFromConfig().catch((e) => console.warn('[remote] sync', e))

    registerIpc()
    browserAnnotations=registerBrowserWorkspace({registry,files,start:browserStart,getConfig:()=>config.get(),chatExists:id=>!!chats.get(id),getMain:()=>mainWindow,
      preload:path.join(__dirname,'preload.js'),loadHost:(win,id)=>{
        const route=`/browser-host/${id}`
        if(process.env.VITE_DEV_SERVER_URL)void win.loadURL(process.env.VITE_DEV_SERVER_URL+'#'+route)
        else void win.loadFile(path.join(__dirname,'..','dist','index.html'),{hash:route})
      }})

    fileWindows=registerFileWindows({files,getMain:()=>mainWindow,chatExists:id=>!!chats.get(id),browserOwnsChat:(sender,chatId)=>{
      const host=registry.hosts.hostForSender(sender)
      return !!host&&!host.embedded&&[...host.pages].some(id=>registry.hosts.pages.get(id)?.chatId===chatId)
    },preload:path.join(__dirname,'preload.js'),load:win=>{
      const route='/file-host'
      if(process.env.VITE_DEV_SERVER_URL)void win.loadURL(process.env.VITE_DEV_SERVER_URL+'#'+route)
      else void win.loadFile(path.join(__dirname,'..','dist','index.html'),{hash:route})
    }})
    nativeUiService=registerNativeUi({trusted:sender=>{
      const win=BrowserWindow.fromWebContents(sender)
      return win&&!win.isDestroyed()&&win.webContents===sender&&(win===mainWindow||!!registry.hosts.hostForSender(sender)||!!fileWindows?.ownsSender(sender))?win:undefined
    },source:(sender,id)=>{
      const page=registry.hosts.pages.get(id),host=page&&registry.hosts.getHost(page.hostId||'')
      if(!page||page.isDestroyed()||host?.window.webContents!==sender||host.active!==id)throw Error('native_ui_page_wrong_host')
      const wc=page.webContents,epoch=page.automation.snapshot().documentEpoch,hostId=page.hostId
      return {webContents:wc,valid:()=>{const current=registry.hosts.getHost(hostId||'');return !page.isDestroyed()&&page.hostId===hostId&&current?.window.webContents===sender&&current.active===id&&page.automation.snapshot().documentEpoch===epoch}}
    },pageSettings:(source,_url)=>{void settingsNavigation.open(source,'browser')}})
    tray = createAppTray({
      getMainWindow: () => mainWindow,
      createWindow,
      onQuit: () => {
        isQuitting = true
        abortAllAsks({ preservePersistedUnlimited: true })
        agent.stopAll()
        app.quit()
      },
    })

    if (shouldShowMainOnStart(config.get())) {
      await createWindow()
    }

    app.on('activate', () => {
      void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    // close_to_tray=false: quit when last window closes; tray mode keeps process until explicit quit
    const toTray = config?.get().app.close_to_tray !== false
    if (!toTray || isQuitting) app.quit()
  })

  app.on('before-quit', () => {
    nativeUiService?.dispose()
    try{browserStart?.flush()}catch(error){console.warn('[browser-start] quit save failed',error)}
    fileWindows?.dispose()
    plugins.dispose()
    isQuitting = true
    abortAllAsks({ preservePersistedUnlimited: true })
    agent?.stopAll()
    registry?.shutdown()
    try {
      chats?.flushAll()
    } catch (e) {
      console.warn('[chat-store] flush on quit failed', e)
    }
    void remote?.stop()
    tray?.destroy()
  })
}
