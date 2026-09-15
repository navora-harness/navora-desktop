import type { NavoraApi } from '../electron/preload'
import type {
  AgentAskRequest,
  AgentAskResponse,
  AgentEvent,
  AppInfo,
  BrowserContextRef,
  BrowserDownloadEntry,
  BrowserTreeSession,
  BrowserTreeWindow,
  ChatChangedEvent,
  ChatPermissions,
  ChatSession,
  PermissionDecision,
  PermissionRequest,
} from '../shared/types'
import type { AppConfig } from '../shared/config'
import type { SkillDetail, SkillImportPreview, SkillRecord, SkillWriteInput } from '../shared/skills'
import { parseBridgeFrame } from '../shared/bridge-frame'
import { getStoredToken } from './remote-token'

type RpcResultMsg = {
  type: 'rpc.result'
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

type RpcEventMsg = {
  type: 'rpc.event'
  event: string
  payload: unknown
}

type StatusHandler = (msg: Record<string, unknown>) => void
type FrameHandler = (frame: {
  contentW: number
  contentH: number
  imageW: number
  imageH: number
  blobUrl: string
}) => void

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/**
 * Shared authenticated WS for remote RPC + Agent bridge frames/input.
 */
class RemoteWsSession {
  private ws: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private seq = 0
  private pending = new Map<string, Pending>()
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  private statusHandlers = new Set<StatusHandler>()
  private frameHandlers = new Set<FrameHandler>()
  private lastBlobUrl = ''
  private bridgeWindowId = ''

  get ready(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  async ensureConnected(token = getStoredToken()): Promise<void> {
    if (!token) throw new Error('remote_token_required')
    if (this.ready) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const fail = (err: Error) => {
        this.connecting = null
        this.rejectAll(err)
        reject(err)
      }

      ws.onopen = () => {
        this.connecting = null
        resolve()
      }
      ws.onerror = () => fail(new Error('ws_connect_failed'))
      ws.onclose = () => {
        this.ws = null
        this.connecting = null
        this.rejectAll(new Error('ws_closed'))
      }
      ws.onmessage = (ev) => this.onMessage(ev)
    })

    return this.connecting
  }

  disconnect(): void {
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.connecting = null
    this.rejectAll(new Error('ws_disconnected'))
    if (this.lastBlobUrl) {
      URL.revokeObjectURL(this.lastBlobUrl)
      this.lastBlobUrl = ''
    }
  }

  async invoke(channel: string, args: unknown[] = []): Promise<unknown> {
    await this.ensureConnected()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws_not_connected')
    }
    const id = `rpc_${Date.now().toString(36)}_${++this.seq}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify({ type: 'rpc.invoke', id, channel, args }))
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`rpc_timeout:${channel}`))
      }, 120000)
    })
  }

  onEvent(event: string, cb: (payload: unknown) => void): () => void {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }

  addStatusHandler(cb: StatusHandler): () => void {
    this.statusHandlers.add(cb)
    return () => this.statusHandlers.delete(cb)
  }

  addFrameHandler(cb: FrameHandler): () => void {
    this.frameHandlers.add(cb)
    return () => this.frameHandlers.delete(cb)
  }

  sendBridge(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  setBridgeWindowId(windowId: string): void {
    this.bridgeWindowId = windowId
  }

  getBridgeWindowId(): string {
    return this.bridgeWindowId
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>
        if (msg.type === 'rpc.result') {
          const r = msg as unknown as RpcResultMsg
          const p = this.pending.get(r.id)
          if (!p) return
          this.pending.delete(r.id)
          if (r.ok) p.resolve(r.result)
          else p.reject(new Error(r.error || 'rpc_failed'))
          return
        }
        if (msg.type === 'rpc.event') {
          const e = msg as unknown as RpcEventMsg
          const set = this.eventListeners.get(e.event)
          if (set) for (const cb of set) cb(e.payload)
          return
        }
        for (const cb of this.statusHandlers) cb(msg)
      } catch {
        /* ignore */
      }
      return
    }

    const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null
    if (!buf) return
    const parsed = parseBridgeFrame(buf)
    if (!parsed) return
    if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl)
    const jpegCopy = new Uint8Array(parsed.jpeg.byteLength)
    jpegCopy.set(parsed.jpeg)
    const blob = new Blob([jpegCopy], { type: 'image/jpeg' })
    const blobUrl = URL.createObjectURL(blob)
    this.lastBlobUrl = blobUrl
    const frame = {
      contentW: parsed.contentW,
      contentH: parsed.contentH,
      imageW: parsed.imageW,
      imageH: parsed.imageH,
      blobUrl,
    }
    for (const cb of this.frameHandlers) cb(frame)
  }
}

let session: RemoteWsSession | null = null

export function getRemoteWsSession(): RemoteWsSession {
  if (!session) session = new RemoteWsSession()
  return session
}

function createRemoteNavoraApi(ws: RemoteWsSession): NavoraApi {
  const invoke = <T>(channel: string, ...args: unknown[]) =>
    ws.invoke(channel, args) as Promise<T>

  const on = <T>(event: string, cb: (payload: T) => void) =>
    ws.onEvent(event, (payload) => cb(payload as T))

  return {
    pathForFile: () => '',
    app: {
      info: () => invoke<AppInfo>('navora:app.info'),
      openExternal: (url: string) => invoke<{ ok: boolean }>('navora:app.openExternal', url),
      quit: () => invoke<{ ok: boolean }>('navora:app.quit'),
    },
    config: {
      get: () => invoke<AppConfig>('navora:config.get'),
      save: (patch: Partial<AppConfig>) => invoke<AppConfig>('navora:config.save', patch),
      uaPresets: () => invoke('navora:config.uaPresets'),
      resolveUa: () => invoke<string>('navora:config.resolveUa'),
      onChanged: (cb: (cfg: AppConfig) => void) => on<AppConfig>('navora:config.changed', cb),
    },
    secrets: {
      getApiKey: (ref: string) =>
        invoke<{ configured: boolean; preview: string }>('navora:secrets.getApiKey', ref),
      setApiKey: (ref: string, value: string) =>
        invoke<{ ok: boolean }>('navora:secrets.setApiKey', ref, value),
      clearApiKey: (ref: string) => invoke<{ ok: boolean }>('navora:secrets.clearApiKey', ref),
    },
    chats: {
      list: () => invoke<ChatSession[]>('navora:chats.list'),
      get: (id: string) => invoke<ChatSession | null>('navora:chats.get', id),
      export: (chatId: string) =>
        invoke<{ ok: boolean; path?: string; format?: string; canceled?: boolean; error?: string }>(
          'navora:chats.export',
          chatId,
        ),
      create: (title?: string) => invoke<ChatSession>('navora:chats.create', title),
      setPermissions: (chatId: string, permissions: ChatPermissions) =>
        invoke<ChatSession | null>('navora:chats.setPermissions', chatId, permissions),
      setProvider: (chatId: string, providerId: string | null, model?: string | null) =>
        invoke<ChatSession | null>('navora:chats.setProvider', chatId, providerId, model),
      append: (
        chatId: string,
        msg: {
          role: 'user' | 'assistant' | 'system' | 'log'
          content: string
          meta?: { refs?: BrowserContextRef[] }
        },
      ) => invoke<ChatSession | null>('navora:chats.append', chatId, msg),
      delete: (chatId: string) => invoke<boolean>('navora:chats.delete', chatId),
      setPinned: (chatId: string, pinned: boolean) =>
        invoke<ChatSession | null>('navora:chats.setPinned', chatId, pinned),
      setTitle: (chatId: string, title: string) =>
        invoke<ChatSession | null>('navora:chats.setTitle', chatId, title),
      setDraft: (chatId: string, text: string, opts?: { updatedAt?: number; maxChars?: number }) =>
        invoke<ChatSession | null>('navora:chats.setDraft', chatId, text, opts),
      onChanged: (cb: (ev: ChatChangedEvent) => void) =>
        on<ChatChangedEvent>('navora:chats.changed', cb),
    },
    agent: {
      run: (chatId: string, payload: { content: string; refs?: BrowserContextRef[] }) =>
        invoke<ChatSession | null>('navora:agent.run', chatId, payload),
      retry: (chatId: string) => invoke<ChatSession | null>('navora:agent.retry', chatId),
      stop: (chatId: string) => invoke<{ ok: boolean }>('navora:agent.stop', chatId),
      isRunning: (chatId: string) => invoke<boolean>('navora:agent.isRunning', chatId),
      onEvent: (cb: (ev: AgentEvent) => void) => on<AgentEvent>('navora:agent.event', cb),
      onAsk: (cb: (req: AgentAskRequest) => void) => on<AgentAskRequest>('navora:agent.ask', cb),
      onAskCancel: (cb: (payload: { id: string; reason?: string }) => void) =>
        on<unknown>('navora:agent.ask.cancel', (raw) => {
          if (typeof raw === 'string') {
            cb({ id: raw })
            return
          }
          if (raw && typeof raw === 'object' && 'id' in (raw as object)) {
            const o = raw as { id: string; reason?: string }
            cb({ id: String(o.id), reason: o.reason })
          }
        }),
      respondAsk: (
        id: string,
        response: { answer: string; source: AgentAskResponse['source'] },
      ) => invoke<boolean>('navora:agent.ask.respond', id, response),
    },
    permission: {
      respond: (id: string, decision: PermissionDecision) =>
        invoke<boolean>('navora:permission.respond', id, decision),
      onRequest: (cb: (req: PermissionRequest) => void) =>
        on<PermissionRequest>('navora:permission.request', cb),
      onCancel: (cb: (id: string) => void) => on<string>('navora:permission.cancel', cb),
    },
    browser: {
      tree: (chatId: string) => invoke<BrowserTreeSession[]>('navora:browser.tree', chatId),
      windowCounts: () => invoke<Record<string, number>>('navora:browser.windowCounts'),
      createSession: (chatId: string, opts?: { persist?: boolean }) =>
        invoke<BrowserTreeSession>('navora:browser.session.create', chatId, opts),
      closeSession: (sessionId: string) =>
        invoke<boolean>('navora:browser.session.close', sessionId),
      createWindow: (sessionId: string, opts?: { url?: string; show?: boolean }) =>
        invoke<BrowserTreeWindow>('navora:browser.window.create', sessionId, opts),
      setVisible: (windowId: string, visible: boolean) =>
        invoke<boolean>('navora:browser.window.setVisible', windowId, visible),
      closeWindow: (windowId: string) =>
        invoke<boolean>('navora:browser.window.close', windowId),
      onTreeUpdated: (
        cb: (payload: {
          chatId: string
          tree: BrowserTreeSession[]
          counts: Record<string, number>
        }) => void,
      ) => on('navora:browser.treeUpdated', cb),
    },
    remote: {
      status: () =>
        invoke<{
          enabled: boolean
          running: boolean
          host: string
          port: number
          url: string
          hasPassword: boolean
          requiresPasswordChange: boolean
          username: string
          tokenTtlMs: number
        }>('navora:remote.status'),
      openWindow: async (windowId: string) => {
        const res = await invoke<{
          ok: boolean
          windowId?: string
          route?: string
          error?: string
        }>('navora:remote.openWindow', windowId)
        if (res.ok && res.route) {
          const hash = `#${res.route}`
          if (location.hash !== hash) location.hash = hash
          return { ok: true, url: res.route }
        }
        return { ok: false, error: res.error || 'open_failed' }
      },
    },
    workspace: {
      pickDirectory: () =>
        invoke<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>(
          'navora:workspace.pickDirectory',
        ),
      info: (chatId: string) =>
        invoke<{
          ok: boolean
          absolutePath: string
          source: string
          customRoot: string | null
          builtinRelative: string
        }>('navora:workspace.info', chatId),
      setChatRoot: (chatId: string, absPath: string | null) =>
        invoke<{ ok: boolean; absolutePath?: string; error?: string }>(
          'navora:workspace.setChatRoot',
          chatId,
          absPath,
        ),
      readMedia: (chatId: string, relPath: string) =>
        invoke<{
          ok: boolean
          path?: string
          mime?: string
          base64?: string
          size?: number
          error?: string
        }>('navora:workspace.readMedia', chatId, relPath),
      reveal: (chatId: string, relPath: string) =>
        invoke<{ ok: boolean; path?: string; action?: string; error?: string }>(
          'navora:workspace.reveal',
          chatId,
          relPath,
        ),
      open: (chatId: string, relPath: string) =>
        invoke<{ ok: boolean; path?: string; action?: string; error?: string }>(
          'navora:workspace.open',
          chatId,
          relPath,
        ),
      list: (chatId: string, relDir?: string) =>
        invoke<{
          ok: boolean
          root?: string
          absoluteRoot?: string
          entries?: Array<{
            path: string
            name: string
            type: 'file' | 'dir'
            size?: number
            mtimeMs?: number
          }>
          truncated?: boolean
          error?: string
        }>('navora:workspace.list', chatId, relDir),
      delete: (chatId: string, relPath: string) =>
        invoke<{ ok: boolean; path?: string; error?: string }>(
          'navora:workspace.delete',
          chatId,
          relPath,
        ),
      onChanged: (cb: (payload: { chatId: string }) => void) =>
        on<{ chatId: string }>('navora:workspace.changed', cb),
    },
    downloads: {
      list: (chatId?: string) =>
        invoke<BrowserDownloadEntry[]>('navora:downloads.list', chatId),
      clear: (chatId?: string) =>
        invoke<{ ok: true; removed: number }>('navora:downloads.clear', chatId),
      remove: (id: string) => invoke<{ ok: boolean }>('navora:downloads.remove', id),
      pause: (id: string) =>
        invoke<{ ok: boolean; error?: string }>('navora:downloads.pause', id),
      resume: (id: string) =>
        invoke<{ ok: boolean; error?: string }>('navora:downloads.resume', id),
      cancel: (id: string) =>
        invoke<{ ok: boolean; error?: string }>('navora:downloads.cancel', id),
      reveal: (id: string) =>
        invoke<{ ok: boolean; path?: string; error?: string }>('navora:downloads.reveal', id),
      open: (id: string) =>
        invoke<{ ok: boolean; path?: string; error?: string }>('navora:downloads.open', id),
      onChanged: (cb: (payload: { downloads: BrowserDownloadEntry[] }) => void) =>
        on<{ downloads: BrowserDownloadEntry[] }>('navora:downloads.changed', cb),
    },
    plugins: {
      list: () => invoke<import('../shared/plugins').PluginRecord[]>('navora:plugins.list'),
      get: (id: string) =>
        invoke<import('../shared/plugins').PluginRecord | null>('navora:plugins.get', id),
      readReadme: (id: string) =>
        invoke<{ ok: boolean; markdown?: string; fileName?: string; error?: string }>(
          'navora:plugins.readReadme',
          id,
        ),
      setEnabled: (id: string, enabled: boolean) =>
        invoke<{
          ok: boolean
          plugin?: import('../shared/plugins').PluginRecord
          error?: string
          disabledConflicts?: Array<{ id: string; name: string }>
        }>('navora:plugins.setEnabled', id, enabled),
      reload: () =>
        invoke<{ ok: boolean; plugins?: import('../shared/plugins').PluginRecord[] }>(
          'navora:plugins.reload',
        ),
      remove: (id: string) =>
        invoke<{ ok: boolean; error?: string }>('navora:plugins.remove', id),
      removeMany: (ids: string[]) =>
        invoke<{ ok: boolean; removed?: string[]; failed?: string[]; error?: string }>(
          'navora:plugins.removeMany',
          ids,
        ),
      parsePath: (absPath: string, opts?: { packageId?: string }) =>
        invoke<{
          ok: boolean
          preview?: import('../shared/plugins').PluginImportPreview
          error?: string
        }>('navora:plugins.parsePath', absPath, opts),
      import: (
        absPath: string,
        opts?: { overwrite?: boolean; replaceSuite?: boolean; packageId?: string },
      ) =>
        invoke<{
          ok: boolean
          plugin?: import('../shared/plugins').PluginRecord
          error?: string
          suiteConflicts?: import('../shared/plugins').PluginImportPreview['suiteConflicts']
        }>('navora:plugins.import', absPath, opts),
      export: (id: string) =>
        invoke<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>(
          'navora:plugins.export',
          id,
        ),
      pickParse: (kind?: 'directory' | 'zip') =>
        invoke<{
          ok: boolean
          preview?: import('../shared/plugins').PluginImportPreview
          path?: string
          canceled?: boolean
          error?: string
        }>('navora:plugins.pickParse', kind),
      pickImport: (opts?: {
        overwrite?: boolean
        replaceSuite?: boolean
        kind?: 'directory' | 'zip'
        packageId?: string
      }) =>
        invoke<{
          ok: boolean
          plugin?: import('../shared/plugins').PluginRecord
          path?: string
          canceled?: boolean
          error?: string
          suiteConflicts?: import('../shared/plugins').PluginImportPreview['suiteConflicts']
        }>('navora:plugins.pickImport', opts),
      onChanged: (cb: (payload: { plugins: import('../shared/plugins').PluginRecord[] }) => void) =>
        on<{ plugins: import('../shared/plugins').PluginRecord[] }>('navora:plugins.changed', cb),
      onImportProgress: (cb: (payload: import('../shared/plugins').PluginImportProgress) => void) =>
        on<import('../shared/plugins').PluginImportProgress>('navora:plugins.importProgress', cb),
    },
    store: {
      status: () => invoke<import('../shared/store').StoreStatus>('navora:store.status'),
      list: (opts?: { kind?: import('../shared/store').StoreKind | 'all'; q?: string }) =>
        invoke<{
          ok: boolean
          products?: import('../shared/store').StoreCatalogProduct[]
          error?: string
        }>('navora:store.list', opts),
      get: (productId: string, kind?: import('../shared/store').StoreKind) =>
        invoke<{
          ok: boolean
          product?: import('../shared/store').StoreCatalogProduct
          error?: string
        }>('navora:store.get', productId, kind),
      previewInstall: (input: import('../shared/store').StorePreviewInstallInput) =>
        invoke<import('../shared/store').StorePreviewInstallResult>(
          'navora:store.previewInstall',
          input,
        ),
      install: (input: import('../shared/store').StoreInstallInput) =>
        invoke<import('../shared/store').StoreInstallResult>('navora:store.install', input),
      checkUpdates: () =>
        invoke<{
          ok: boolean
          updates?: Array<{
            kind: import('../shared/store').StoreKind
            packageId: string
            localVersion?: string
            storeVersion: string
            name: string
          }>
          error?: string
        }>('navora:store.checkUpdates'),
      readDocs: (input: {
        kind: import('../shared/store').StoreKind
        packageId: string
        version?: string
      }) =>
        invoke<{ ok: boolean; markdown?: string; fileName?: string; error?: string }>(
          'navora:store.readDocs',
          input,
        ),
      onProgress: (cb: (payload: import('../shared/store').StoreInstallProgress) => void) =>
        on<import('../shared/store').StoreInstallProgress>('navora:store.progress', cb),
    },
    skills: {
      list: () => invoke<SkillRecord[]>('navora:skills.list'),
      get: (id: string) => invoke<SkillDetail | null>('navora:skills.get', id),
      setEnabled: (id: string, enabled: boolean) =>
        invoke<{ ok: boolean; skill?: SkillRecord; error?: string }>(
          'navora:skills.setEnabled',
          id,
          enabled,
        ),
      remove: (id: string) => invoke<{ ok: boolean }>('navora:skills.remove', id),
      removeMany: (ids: string[]) =>
        invoke<{ ok: boolean; removed?: string[]; failed?: string[]; error?: string }>(
          'navora:skills.removeMany',
          ids,
        ),
      create: (input: SkillWriteInput) =>
        invoke<{ ok: boolean; skill?: SkillDetail; error?: string }>('navora:skills.create', input),
      update: (id: string, input: SkillWriteInput) =>
        invoke<{ ok: boolean; skill?: SkillDetail; error?: string }>(
          'navora:skills.update',
          id,
          input,
        ),
      export: (id: string) =>
        invoke<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>(
          'navora:skills.export',
          id,
        ),
      exportMany: (ids: string[]) =>
        invoke<{
          ok: boolean
          dir?: string
          exported?: Array<{ id: string; path: string; filename: string }>
          failed?: Array<{ id: string; error: string }>
          canceled?: boolean
          error?: string
        }>('navora:skills.exportMany', ids),
      import: (absPath: string, opts?: { overwrite?: boolean }) =>
        invoke<{
          ok: boolean
          skill?: SkillDetail
          error?: string
          path?: string
          existing?: SkillRecord
          incoming?: { name: string; description: string }
        }>('navora:skills.import', absPath, opts),
      importMarkdown: (markdown: string, opts?: { overwrite?: boolean }) =>
        invoke<{
          ok: boolean
          skill?: SkillDetail
          error?: string
          existing?: SkillRecord
          incoming?: { name: string; description: string }
        }>('navora:skills.importMarkdown', markdown, opts),
      pickImport: (mode?: 'directory' | 'file', opts?: { overwrite?: boolean }) =>
        invoke<{
          ok: boolean
          skill?: SkillDetail
          path?: string
          canceled?: boolean
          error?: string
          existing?: SkillRecord
          incoming?: { name: string; description: string }
        }>('navora:skills.pickImport', mode, opts),
      parsePath: (absPath: string) =>
        invoke<{
          ok: boolean
          preview?: SkillImportPreview
          previews?: SkillImportPreview[]
          error?: string
        }>('navora:skills.parsePath', absPath),
      parseMarkdown: (markdown: string, sourceLabel?: string) =>
        invoke<{ ok: boolean; preview?: SkillImportPreview; error?: string }>(
          'navora:skills.parseMarkdown',
          markdown,
          sourceLabel,
        ),
      getMarkdown: (id: string) =>
        invoke<{
          ok: boolean
          markdown?: string
          skill?: { id: string; name: string; description: string }
          error?: string
        }>('navora:skills.getMarkdown', id),
      pickParse: (mode?: 'directory' | 'file') =>
        invoke<{
          ok: boolean
          preview?: SkillImportPreview
          previews?: SkillImportPreview[]
          path?: string
          canceled?: boolean
          error?: string
        }>('navora:skills.pickParse', mode),
      onReview: (cb: (req: import('../shared/types').SkillReviewRequest) => void) =>
        on('navora:skill.review.request', cb),
      onReviewCancel: (cb: (id: string) => void) => on('navora:skill.review.cancel', cb),
      respondReview: (
        id: string,
        response: {
          source: import('../shared/types').SkillReviewResponse['source']
          draft?: import('../shared/types').SkillReviewResponse['draft']
          exportPath?: string
        },
      ) =>
        invoke<{ ok: boolean; error?: string }>('navora:skill.review.respond', id, response),
      listProposals: () =>
        invoke<import('../shared/types').SkillProposal[]>('navora:skills.listProposals'),
      getProposal: (id: string) =>
        invoke<import('../shared/types').SkillProposal | null>('navora:skills.getProposal', id),
      removeProposal: (id: string) =>
        invoke<{ ok: boolean }>('navora:skills.removeProposal', id),
      applyProposal: (id: string, draft?: import('../shared/types').SkillReviewDraft) =>
        invoke<{ ok: boolean; skill?: SkillDetail; error?: string }>(
          'navora:skills.applyProposal',
          id,
          draft,
        ),
      openProposal: (id: string) =>
        invoke<{ ok: boolean; proposalId?: string; error?: string }>(
          'navora:skills.openProposal',
          id,
        ),
      onProposalsChanged: (
        cb: (payload: { proposals: import('../shared/types').SkillProposal[] }) => void,
      ) => on('navora:skills.proposalsChanged', cb),
      onChanged: (cb: (payload: { skills: SkillRecord[] }) => void) =>
        on<{ skills: SkillRecord[] }>('navora:skills.changed', cb),
    },
  }
}

let installed = false

/** Install window.navora backed by WS RPC (web remote only). */
export async function ensureRemoteNavora(token?: string): Promise<NavoraApi> {
  const ws = getRemoteWsSession()
  await ws.ensureConnected(token || getStoredToken())
  if (!installed || !window.navora) {
    window.navora = createRemoteNavoraApi(ws)
    installed = true
  }
  return window.navora
}

export function uninstallRemoteNavora(): void {
  getRemoteWsSession().disconnect()
  if (installed) {
    delete window.navora
    installed = false
  }
}
