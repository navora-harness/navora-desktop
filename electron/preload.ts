import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppConfig } from '../shared/config'
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
  SkillReviewRequest,
  SkillReviewResponse,
  SkillProposal,
} from '../shared/types'
import type { SkillDetail, SkillImportPreview, SkillRecord, SkillWriteInput } from '../shared/skills'

const api = {
  /**
   * Resolve absolute path for a File from drag-drop / input.
   * Electron removed File.path in renderer; use webUtils.getPathForFile.
   */
  pathForFile: (file: File): string => {
    try {
      const p = webUtils.getPathForFile(file)
      return typeof p === 'string' ? p : ''
    } catch {
      return ''
    }
  },
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('navora:app.info'),
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:app.openExternal', url),
    quit: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('navora:app.quit'),
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('navora:config.get'),
    save: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke('navora:config.save', patch),
    uaPresets: () => ipcRenderer.invoke('navora:config.uaPresets'),
    resolveUa: (): Promise<string> => ipcRenderer.invoke('navora:config.resolveUa'),
    onChanged: (cb: (cfg: AppConfig) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, cfg: AppConfig) => cb(cfg)
      ipcRenderer.on('navora:config.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:config.changed', listener)
      }
    },
  },
  secrets: {
    getApiKey: (ref: string): Promise<{ configured: boolean; preview: string }> =>
      ipcRenderer.invoke('navora:secrets.getApiKey', ref),
    setApiKey: (ref: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:secrets.setApiKey', ref, value),
    clearApiKey: (ref: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:secrets.clearApiKey', ref),
  },
  chats: {
    list: (): Promise<ChatSession[]> => ipcRenderer.invoke('navora:chats.list'),
    get: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke('navora:chats.get', id),
    export: (
      chatId: string,
    ): Promise<{ ok: boolean; path?: string; format?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:chats.export', chatId),
    create: (title?: string): Promise<ChatSession> => ipcRenderer.invoke('navora:chats.create', title),
    setPermissions: (chatId: string, permissions: ChatPermissions): Promise<ChatSession | null> =>
      ipcRenderer.invoke('navora:chats.setPermissions', chatId, permissions),
    setProvider: (
      chatId: string,
      providerId: string | null,
      model?: string | null,
    ): Promise<ChatSession | null> =>
      ipcRenderer.invoke('navora:chats.setProvider', chatId, providerId, model),
    append: (
      chatId: string,
      msg: {
        role: 'user' | 'assistant' | 'system' | 'log'
        content: string
        meta?: { refs?: BrowserContextRef[] }
      },
    ): Promise<ChatSession | null> => ipcRenderer.invoke('navora:chats.append', chatId, msg),
    delete: (chatId: string): Promise<boolean> => ipcRenderer.invoke('navora:chats.delete', chatId),
    setPinned: (chatId: string, pinned: boolean): Promise<ChatSession | null> =>
      ipcRenderer.invoke('navora:chats.setPinned', chatId, pinned),
    setTitle: (chatId: string, title: string): Promise<ChatSession | null> =>
      ipcRenderer.invoke('navora:chats.setTitle', chatId, title),
    setDraft: (
      chatId: string,
      text: string,
      opts?: { updatedAt?: number; maxChars?: number },
    ): Promise<ChatSession | null> => ipcRenderer.invoke('navora:chats.setDraft', chatId, text, opts),
    onChanged: (cb: (ev: ChatChangedEvent) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: ChatChangedEvent) => cb(ev)
      ipcRenderer.on('navora:chats.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:chats.changed', listener)
      }
    },
  },
  agent: {
    run: (
      chatId: string,
      payload: { content: string; refs?: BrowserContextRef[] },
    ): Promise<ChatSession | null> => ipcRenderer.invoke('navora:agent.run', chatId, payload),
    retry: (chatId: string): Promise<ChatSession | null> =>
      ipcRenderer.invoke('navora:agent.retry', chatId),
    stop: (chatId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:agent.stop', chatId),
    isRunning: (chatId: string): Promise<boolean> =>
      ipcRenderer.invoke('navora:agent.isRunning', chatId),
    onEvent: (cb: (ev: AgentEvent) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: AgentEvent) => cb(ev)
      ipcRenderer.on('navora:agent.event', listener)
      return () => {
        ipcRenderer.removeListener('navora:agent.event', listener)
      }
    },
    onAsk: (cb: (req: AgentAskRequest) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, req: AgentAskRequest) => cb(req)
      ipcRenderer.on('navora:agent.ask', listener)
      return () => {
        ipcRenderer.removeListener('navora:agent.ask', listener)
      }
    },
    onAskCancel: (cb: (payload: { id: string; reason?: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, raw: unknown) => {
        if (typeof raw === 'string') {
          cb({ id: raw })
          return
        }
        if (raw && typeof raw === 'object' && 'id' in raw) {
          const o = raw as { id: string; reason?: string }
          cb({ id: String(o.id), reason: o.reason })
          return
        }
      }
      ipcRenderer.on('navora:agent.ask.cancel', listener)
      return () => {
        ipcRenderer.removeListener('navora:agent.ask.cancel', listener)
      }
    },
    respondAsk: (
      id: string,
      response: { answer: string; source: AgentAskResponse['source'] },
    ): Promise<boolean> => ipcRenderer.invoke('navora:agent.ask.respond', id, response),
  },
  permission: {
    respond: (id: string, decision: PermissionDecision): Promise<boolean> =>
      ipcRenderer.invoke('navora:permission.respond', id, decision),
    onRequest: (cb: (req: PermissionRequest) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, req: PermissionRequest) => cb(req)
      ipcRenderer.on('navora:permission.request', listener)
      return () => {
        ipcRenderer.removeListener('navora:permission.request', listener)
      }
    },
    onCancel: (cb: (id: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, id: string) => cb(id)
      ipcRenderer.on('navora:permission.cancel', listener)
      return () => {
        ipcRenderer.removeListener('navora:permission.cancel', listener)
      }
    },
  },
  browser: {
    tree: (chatId: string): Promise<BrowserTreeSession[]> =>
      ipcRenderer.invoke('navora:browser.tree', chatId),
    windowCounts: (): Promise<Record<string, number>> =>
      ipcRenderer.invoke('navora:browser.windowCounts'),
    createSession: (
      chatId: string,
      opts?: { persist?: boolean },
    ): Promise<BrowserTreeSession> =>
      ipcRenderer.invoke('navora:browser.session.create', chatId, opts),
    closeSession: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('navora:browser.session.close', sessionId),
    createWindow: (
      sessionId: string,
      opts?: { url?: string; show?: boolean },
    ): Promise<BrowserTreeWindow> =>
      ipcRenderer.invoke('navora:browser.window.create', sessionId, opts),
    setVisible: (windowId: string, visible: boolean): Promise<boolean> =>
      ipcRenderer.invoke('navora:browser.window.setVisible', windowId, visible),
    closeWindow: (windowId: string): Promise<boolean> =>
      ipcRenderer.invoke('navora:browser.window.close', windowId),
    onTreeUpdated: (
      cb: (payload: {
        chatId: string
        tree: BrowserTreeSession[]
        counts: Record<string, number>
      }) => void,
    ) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: {
          chatId: string
          tree: BrowserTreeSession[]
          counts: Record<string, number>
        },
      ) => cb(payload)
      ipcRenderer.on('navora:browser.treeUpdated', listener)
      return () => {
        ipcRenderer.removeListener('navora:browser.treeUpdated', listener)
      }
    },
  },
  remote: {
    status: (): Promise<{
      enabled: boolean
      running: boolean
      host: string
      port: number
      url: string
      hasPassword: boolean
      requiresPasswordChange: boolean
      username: string
      tokenTtlMs: number
    }> => ipcRenderer.invoke('navora:remote.status'),
    openWindow: (windowId: string): Promise<{ ok: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke('navora:remote.openWindow', windowId),
  },
  workspace: {
    pickDirectory: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('navora:workspace.pickDirectory'),
    info: (
      chatId: string,
    ): Promise<{
      ok: boolean
      absolutePath: string
      source: string
      customRoot: string | null
      builtinRelative: string
    }> => ipcRenderer.invoke('navora:workspace.info', chatId),
    setChatRoot: (
      chatId: string,
      absPath: string | null,
    ): Promise<{ ok: boolean; absolutePath?: string; error?: string }> =>
      ipcRenderer.invoke('navora:workspace.setChatRoot', chatId, absPath),
    readMedia: (
      chatId: string,
      relPath: string,
    ): Promise<{
      ok: boolean
      path?: string
      mime?: string
      base64?: string
      size?: number
      error?: string
    }> => ipcRenderer.invoke('navora:workspace.readMedia', chatId, relPath),
    reveal: (
      chatId: string,
      relPath: string,
    ): Promise<{ ok: boolean; path?: string; action?: string; error?: string }> =>
      ipcRenderer.invoke('navora:workspace.reveal', chatId, relPath),
    open: (
      chatId: string,
      relPath: string,
    ): Promise<{ ok: boolean; path?: string; action?: string; error?: string }> =>
      ipcRenderer.invoke('navora:workspace.open', chatId, relPath),
    list: (
      chatId: string,
      relDir?: string,
    ): Promise<{
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
    }> => ipcRenderer.invoke('navora:workspace.list', chatId, relDir),
    delete: (
      chatId: string,
      relPath: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('navora:workspace.delete', chatId, relPath),
    onChanged: (cb: (payload: { chatId: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: { chatId: string }) => cb(payload)
      ipcRenderer.on('navora:workspace.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:workspace.changed', listener)
      }
    },
  },
  downloads: {
    list: (chatId?: string): Promise<BrowserDownloadEntry[]> =>
      ipcRenderer.invoke('navora:downloads.list', chatId),
    clear: (chatId?: string): Promise<{ ok: true; removed: number }> =>
      ipcRenderer.invoke('navora:downloads.clear', chatId),
    remove: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:downloads.remove', id),
    pause: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:downloads.pause', id),
    resume: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:downloads.resume', id),
    cancel: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:downloads.cancel', id),
    reveal: (id: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('navora:downloads.reveal', id),
    open: (id: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('navora:downloads.open', id),
    onChanged: (cb: (payload: { downloads: BrowserDownloadEntry[] }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { downloads: BrowserDownloadEntry[] },
      ) => cb(payload)
      ipcRenderer.on('navora:downloads.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:downloads.changed', listener)
      }
    },
  },
  plugins: {
    list: (): Promise<import('../shared/plugins').PluginRecord[]> =>
      ipcRenderer.invoke('navora:plugins.list'),
    get: (id: string): Promise<import('../shared/plugins').PluginRecord | null> =>
      ipcRenderer.invoke('navora:plugins.get', id),
    readReadme: (
      id: string,
    ): Promise<{ ok: boolean; markdown?: string; fileName?: string; error?: string }> =>
      ipcRenderer.invoke('navora:plugins.readReadme', id),
    setEnabled: (
      id: string,
      enabled: boolean,
    ): Promise<{
      ok: boolean
      plugin?: import('../shared/plugins').PluginRecord
      error?: string
      disabledConflicts?: Array<{ id: string; name: string }>
    }> => ipcRenderer.invoke('navora:plugins.setEnabled', id, enabled),
    reload: (): Promise<{ ok: boolean; plugins?: import('../shared/plugins').PluginRecord[] }> =>
      ipcRenderer.invoke('navora:plugins.reload'),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:plugins.remove', id),
    removeMany: (
      ids: string[],
    ): Promise<{ ok: boolean; removed?: string[]; failed?: string[]; error?: string }> =>
      ipcRenderer.invoke('navora:plugins.removeMany', ids),
    parsePath: (
      absPath: string,
      opts?: { packageId?: string },
    ): Promise<{
      ok: boolean
      preview?: import('../shared/plugins').PluginImportPreview
      error?: string
    }> => ipcRenderer.invoke('navora:plugins.parsePath', absPath, opts),
    import: (
      absPath: string,
      opts?: { overwrite?: boolean; replaceSuite?: boolean; packageId?: string },
    ): Promise<{
      ok: boolean
      plugin?: import('../shared/plugins').PluginRecord
      error?: string
      suiteConflicts?: import('../shared/plugins').PluginImportPreview['suiteConflicts']
    }> => ipcRenderer.invoke('navora:plugins.import', absPath, opts),
    export: (
      id: string,
    ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:plugins.export', id),
    pickParse: (
      kind?: 'directory' | 'zip',
    ): Promise<{
      ok: boolean
      preview?: import('../shared/plugins').PluginImportPreview
      path?: string
      canceled?: boolean
      error?: string
    }> => ipcRenderer.invoke('navora:plugins.pickParse', kind),
    pickImport: (
      opts?: {
        overwrite?: boolean
        replaceSuite?: boolean
        kind?: 'directory' | 'zip'
        packageId?: string
      },
    ): Promise<{
      ok: boolean
      plugin?: import('../shared/plugins').PluginRecord
      path?: string
      canceled?: boolean
      error?: string
      suiteConflicts?: import('../shared/plugins').PluginImportPreview['suiteConflicts']
    }> => ipcRenderer.invoke('navora:plugins.pickImport', opts),
    onChanged: (cb: (payload: { plugins: import('../shared/plugins').PluginRecord[] }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { plugins: import('../shared/plugins').PluginRecord[] },
      ) => cb(payload)
      ipcRenderer.on('navora:plugins.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:plugins.changed', listener)
      }
    },
    onImportProgress: (cb: (payload: import('../shared/plugins').PluginImportProgress) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: import('../shared/plugins').PluginImportProgress,
      ) => cb(payload)
      ipcRenderer.on('navora:plugins.importProgress', listener)
      return () => {
        ipcRenderer.removeListener('navora:plugins.importProgress', listener)
      }
    },
  },
  store: {
    status: (): Promise<import('../shared/store').StoreStatus> =>
      ipcRenderer.invoke('navora:store.status'),
    list: (opts?: {
      kind?: import('../shared/store').StoreKind | 'all'
      q?: string
    }): Promise<{
      ok: boolean
      products?: import('../shared/store').StoreCatalogProduct[]
      error?: string
    }> => ipcRenderer.invoke('navora:store.list', opts),
    get: (
      productId: string,
      kind?: import('../shared/store').StoreKind,
    ): Promise<{
      ok: boolean
      product?: import('../shared/store').StoreCatalogProduct
      error?: string
    }> => ipcRenderer.invoke('navora:store.get', productId, kind),
    previewInstall: (
      input: import('../shared/store').StorePreviewInstallInput,
    ): Promise<import('../shared/store').StorePreviewInstallResult> =>
      ipcRenderer.invoke('navora:store.previewInstall', input),
    install: (
      input: import('../shared/store').StoreInstallInput,
    ): Promise<import('../shared/store').StoreInstallResult> =>
      ipcRenderer.invoke('navora:store.install', input),
    checkUpdates: (): Promise<{
      ok: boolean
      updates?: Array<{
        kind: import('../shared/store').StoreKind
        packageId: string
        localVersion?: string
        storeVersion: string
        name: string
      }>
      error?: string
    }> => ipcRenderer.invoke('navora:store.checkUpdates'),
    readDocs: (input: {
      kind: import('../shared/store').StoreKind
      packageId: string
      version?: string
    }): Promise<{ ok: boolean; markdown?: string; fileName?: string; error?: string }> =>
      ipcRenderer.invoke('navora:store.readDocs', input),
    onProgress: (cb: (payload: import('../shared/store').StoreInstallProgress) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: import('../shared/store').StoreInstallProgress,
      ) => cb(payload)
      ipcRenderer.on('navora:store.progress', listener)
      return () => {
        ipcRenderer.removeListener('navora:store.progress', listener)
      }
    },
  },
  skills: {
    list: (): Promise<SkillRecord[]> => ipcRenderer.invoke('navora:skills.list'),
    get: (id: string): Promise<SkillDetail | null> => ipcRenderer.invoke('navora:skills.get', id),
    setEnabled: (
      id: string,
      enabled: boolean,
    ): Promise<{ ok: boolean; skill?: SkillRecord; error?: string }> =>
      ipcRenderer.invoke('navora:skills.setEnabled', id, enabled),
    remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('navora:skills.remove', id),
    removeMany: (
      ids: string[],
    ): Promise<{ ok: boolean; removed?: string[]; failed?: string[]; error?: string }> =>
      ipcRenderer.invoke('navora:skills.removeMany', ids),
    create: (
      input: SkillWriteInput,
    ): Promise<{ ok: boolean; skill?: SkillDetail; error?: string }> =>
      ipcRenderer.invoke('navora:skills.create', input),
    update: (
      id: string,
      input: SkillWriteInput,
    ): Promise<{ ok: boolean; skill?: SkillDetail; error?: string }> =>
      ipcRenderer.invoke('navora:skills.update', id, input),
    export: (
      id: string,
    ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('navora:skills.export', id),
    exportMany: (
      ids: string[],
    ): Promise<{
      ok: boolean
      dir?: string
      exported?: Array<{ id: string; path: string; filename: string }>
      failed?: Array<{ id: string; error: string }>
      canceled?: boolean
      error?: string
    }> => ipcRenderer.invoke('navora:skills.exportMany', ids),
    import: (
      absPath: string,
      opts?: { overwrite?: boolean },
    ): Promise<{
      ok: boolean
      skill?: SkillDetail
      error?: string
      path?: string
      existing?: SkillRecord
      incoming?: { name: string; description: string }
    }> => ipcRenderer.invoke('navora:skills.import', absPath, opts),
    importMarkdown: (
      markdown: string,
      opts?: { overwrite?: boolean },
    ): Promise<{
      ok: boolean
      skill?: SkillDetail
      error?: string
      existing?: SkillRecord
      incoming?: { name: string; description: string }
    }> => ipcRenderer.invoke('navora:skills.importMarkdown', markdown, opts),
    pickImport: (
      mode?: 'directory' | 'file',
      opts?: { overwrite?: boolean },
    ): Promise<{
      ok: boolean
      skill?: SkillDetail
      path?: string
      canceled?: boolean
      error?: string
      existing?: SkillRecord
      incoming?: { name: string; description: string }
    }> => ipcRenderer.invoke('navora:skills.pickImport', mode, opts),
    parsePath: (
      absPath: string,
    ): Promise<{
      ok: boolean
      preview?: SkillImportPreview
      previews?: SkillImportPreview[]
      error?: string
    }> => ipcRenderer.invoke('navora:skills.parsePath', absPath),
    parseMarkdown: (
      markdown: string,
      sourceLabel?: string,
    ): Promise<{ ok: boolean; preview?: SkillImportPreview; error?: string }> =>
      ipcRenderer.invoke('navora:skills.parseMarkdown', markdown, sourceLabel),
    getMarkdown: (
      id: string,
    ): Promise<{
      ok: boolean
      markdown?: string
      skill?: { id: string; name: string; description: string }
      error?: string
    }> => ipcRenderer.invoke('navora:skills.getMarkdown', id),
    pickParse: (
      mode?: 'directory' | 'file',
    ): Promise<{
      ok: boolean
      preview?: SkillImportPreview
      previews?: SkillImportPreview[]
      path?: string
      canceled?: boolean
      error?: string
    }> => ipcRenderer.invoke('navora:skills.pickParse', mode),
    onReview: (cb: (req: SkillReviewRequest) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, req: SkillReviewRequest) => cb(req)
      ipcRenderer.on('navora:skill.review.request', listener)
      return () => {
        ipcRenderer.removeListener('navora:skill.review.request', listener)
      }
    },
    onReviewCancel: (cb: (id: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, id: string) => cb(id)
      ipcRenderer.on('navora:skill.review.cancel', listener)
      return () => {
        ipcRenderer.removeListener('navora:skill.review.cancel', listener)
      }
    },
    respondReview: (
      id: string,
      response: {
        source: SkillReviewResponse['source']
        draft?: SkillReviewResponse['draft']
        exportPath?: string
      },
    ): Promise<{ ok: boolean; skill?: SkillReviewResponse['skill']; error?: string }> =>
      ipcRenderer.invoke('navora:skill.review.respond', id, response),
    listProposals: (): Promise<SkillProposal[]> =>
      ipcRenderer.invoke('navora:skills.listProposals'),
    getProposal: (id: string): Promise<SkillProposal | null> =>
      ipcRenderer.invoke('navora:skills.getProposal', id),
    removeProposal: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('navora:skills.removeProposal', id),
    applyProposal: (
      id: string,
      draft?: SkillReviewResponse['draft'],
    ): Promise<{ ok: boolean; skill?: SkillDetail; error?: string; removedId?: string }> =>
      ipcRenderer.invoke('navora:skills.applyProposal', id, draft),
    openProposal: (id: string): Promise<{ ok: boolean; proposalId?: string; error?: string }> =>
      ipcRenderer.invoke('navora:skills.openProposal', id),
    onProposalsChanged: (cb: (payload: { proposals: SkillProposal[] }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { proposals: SkillProposal[] },
      ) => cb(payload)
      ipcRenderer.on('navora:skills.proposalsChanged', listener)
      return () => {
        ipcRenderer.removeListener('navora:skills.proposalsChanged', listener)
      }
    },
    onChanged: (cb: (payload: { skills: SkillRecord[] }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: { skills: SkillRecord[] }) =>
        cb(payload)
      ipcRenderer.on('navora:skills.changed', listener)
      return () => {
        ipcRenderer.removeListener('navora:skills.changed', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('navoraElectron', true)
contextBridge.exposeInMainWorld('navora', api)

export type NavoraApi = typeof api
