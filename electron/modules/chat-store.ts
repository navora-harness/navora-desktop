import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentAskRequest,
  ChatMessage,
  ChatPermissions,
  ChatSession,
  SubChatSpawnStatus,
  SubChatRun,
} from '../../shared/types'
import {interruptedSubchatRun} from '../../shared/subchat-runtime'
import { ensureDir } from '../data-root'
import { localChatTitle } from '../../shared/chat-title'
import {composerDocumentFromLegacy,compileComposerDocument,normalizeComposerDocument,createComposerDocument,type ComposerDocument,type ComposerDraftOptions} from '../../shared/composer-document'

/** Coalesce frequent chat writes (agent tool cards, drafts) off the main hot path. */
const PERSIST_DEBOUNCE_MS = 100

export class ChatStore {
  private dir: string
  private chats = new Map<string, ChatSession>()
  private dirty = new Set<string>()
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(dataRoot: string) {
    this.dir = path.join(dataRoot, 'chats')
    ensureDir(this.dir)
    this.loadAll()
  }

  private fileOf(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  private loadAll(): void {
    if (!fs.existsSync(this.dir)) return
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = fs.readFileSync(path.join(this.dir, name), 'utf8')
        const chat = JSON.parse(raw) as ChatSession
        if (chat?.id) {
          chat.queuedMessages=(Array.isArray(chat.queuedMessages)?chat.queuedMessages:[])
            .filter(entry=>entry&&typeof entry.id==='string'&&typeof entry.content==='string'&&entry.content.length<=200000).slice(0,80)
          try{
            const retained=chat.draftUnsupportedDocument
            chat.draftDocument=retained!==undefined?normalizeComposerDocument(retained,chat.id):chat.draftDocument?normalizeComposerDocument(chat.draftDocument,chat.id):composerDocumentFromLegacy(chat.id,chat.draft||'')
            delete chat.draftUnsupportedDocument
            chat.draftRevision=Math.max(chat.draftRevision||0,chat.draftDocument.revision)
            chat.draftDocument.revision=chat.draftRevision
            chat.draftUpdatedAt=chat.draftUpdatedAt||chat.draftDocument.updatedAt
          }catch{if(chat.draftUnsupportedDocument===undefined&&chat.draftDocument!==undefined)chat.draftUnsupportedDocument=chat.draftDocument;delete chat.draftDocument;chat.draftRevision=Math.max(0,chat.draftRevision||0)}
          const retainedRecoveries:unknown[]=[],recoveries=[...(Array.isArray(chat.draftUnsupportedRecoveries)?chat.draftUnsupportedRecoveries:[]),...(Array.isArray(chat.draftRecoveries)?chat.draftRecoveries:[])]
          chat.draftRecoveries=recoveries.flatMap(value=>{const entry=value as NonNullable<ChatSession['draftRecoveries']>[number];try{return [{...entry,document:normalizeComposerDocument(entry.document,chat.id)}]}catch{retainedRecoveries.push(value);return []}}).slice(-20)
          if(retainedRecoveries.length)chat.draftUnsupportedRecoveries=retainedRecoveries;else delete chat.draftUnsupportedRecoveries
          chat.acceptedClientMessageIds=(Array.isArray(chat.acceptedClientMessageIds)?chat.acceptedClientMessageIds:[]).filter(entry=>entry&&typeof entry.id==='string'&&typeof entry.acceptedAt==='number').slice(-200)
          for(const entry of chat.queuedMessages)if(entry.document){try{entry.document=normalizeComposerDocument(entry.document,chat.id)}catch{entry.error='invalid_composer_document';chat.queuePaused=true}}
          // Only migrate unmistakable unlocked first-message titles. Legacy
          // locked/renamed titles have no provenance and must be preserved.
          const firstAsk = chat.messages?.find(m => m.role === 'user')?.content || ''
          if (!chat.titleSource && !chat.titleGenerated && firstAsk &&
              [firstAsk.trim().replace(/\s+/g, ' ').slice(0, 80), localChatTitle(firstAsk)].includes(chat.title)) {
            chat.titleSource = 'auto'
          }
          // Timed asks cannot be resumed after restart; drop them.
          if (chat.pendingAsk && !(chat.pendingAsk.timeoutMs <= 0 && chat.pendingAsk.kind === 'user_choice')) {
            delete chat.pendingAsk
          }
          if(chat.kind==='sub'&&!Number.isSafeInteger(chat.subchatMessageVersion))chat.subchatMessageVersion=chat.messages.length
          this.chats.set(chat.id, chat)
          const interrupted=interruptedSubchatRun(chat,Date.now())
          if(interrupted){chat.subchatRun=interrupted;chat.spawnStatus='failed';if(!chat.spawnResult)chat.spawnResult={runId:interrupted.id,status:'failed',summary:interrupted.summary||'运行中断'};chat.subchatRevision=(chat.subchatRevision||0)+1;this.writeNow(chat)}
        }
      } catch (e) {
        console.warn('[chat-store] skip', name, e)
      }
    }
  }

  /** Compact JSON (no pretty-print) — much cheaper for long sessions. */
  private writeNow(chat: ChatSession): void {
    fs.writeFileSync(this.fileOf(chat.id), JSON.stringify(chat), 'utf8')
  }

  private clearPersistTimer(chatId: string): void {
    const t = this.persistTimers.get(chatId)
    if (t) {
      clearTimeout(t)
      this.persistTimers.delete(chatId)
    }
  }

  private schedulePersist(chatId: string): void {
    this.dirty.add(chatId)
    if (this.persistTimers.has(chatId)) return
    const timer = setTimeout(() => {
      this.persistTimers.delete(chatId)
      this.flushChat(chatId)
    }, PERSIST_DEBOUNCE_MS)
    // Don't keep the event loop alive solely for debounce.
    timer.unref?.()
    this.persistTimers.set(chatId, timer)
  }

  /** Sync write one chat (cancels pending debounce). */
  flushChat(chatId: string): void {
    this.clearPersistTimer(chatId)
    this.dirty.delete(chatId)
    const chat = this.chats.get(chatId)
    if (!chat) return
    try {
      this.writeNow(chat)
    } catch (e) {
      console.error('[chat-store] persist failed', chatId, e)
    }
  }

  /** Flush all dirty chats — call on app quit. */
  flushAll(): void {
    const ids = new Set<string>([...this.dirty, ...this.persistTimers.keys()])
    for (const id of ids) this.flushChat(id)
  }

  private persist(chat: ChatSession, mode: 'defer' | 'immediate' = 'defer'): void {
    if(chat.kind==='sub')chat.subchatRevision=(chat.subchatRevision||0)+1
    if (mode === 'immediate') this.flushChat(chat.id)
    else this.schedulePersist(chat.id)
  }

  list(): ChatSession[] {
    return [...this.chats.values()].sort((a, b) => {
      const ap = a.pinned ? 1 : 0
      const bp = b.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      if (ap && bp) return (b.pinnedAt || 0) - (a.pinnedAt || 0)
      return b.updatedAt - a.updatedAt
    })
  }

  get(id: string): ChatSession | null {
    return this.chats.get(id) ?? null
  }

  create(
    title = '新对话',
    opts?: {
      permissions?: ChatPermissions
      providerId?: string
      model?: string
      reasoningLevel?: string
      executionMode?: ChatSession['executionMode']
      kind?: 'main' | 'sub'
      parentChatId?: string
      parentToolCallId?: string
      spawnPurpose?: string
      spawnStatus?: SubChatSpawnStatus
      titleGenerated?: boolean
    },
  ): ChatSession {
    const now = Date.now()
    const kind = opts?.kind === 'sub' ? 'sub' : 'main'
    const chat: ChatSession = {
      id: `chat_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      ...(opts?.permissions
        ? {
            permissions: {
              preset: opts.permissions.preset,
              modes: { ...opts.permissions.modes },
            },
          }
        : {}),
      ...(opts?.providerId ? { providerId: opts.providerId } : {}),
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.reasoningLevel ? {reasoningLevel:opts.reasoningLevel}:{}),
      ...(opts?.executionMode ? {executionMode:opts.executionMode}:{}),
      ...(kind === 'sub'
        ? {
            kind: 'sub' as const,
            parentChatId: opts?.parentChatId,
            parentToolCallId: opts?.parentToolCallId,
            spawnPurpose: opts?.spawnPurpose,
            spawnStatus: opts?.spawnStatus || 'running',
            titleGenerated: opts?.titleGenerated !== false,
          }
        : {}),
    }
    this.chats.set(chat.id, chat)
    this.persist(chat, 'immediate')
    return chat
  }

  /** Direct child sub-chats of a parent (non-recursive). */
  listChildren(parentChatId: string): ChatSession[] {
    return [...this.chats.values()]
      .filter((c) => c.kind === 'sub' && c.parentChatId === parentChatId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Parent + all nested sub-chats (BFS). Parent first, then descendants. */
  collectCascadeIds(chatId: string): string[] {
    const out: string[] = []
    const queue = [chatId]
    const seen = new Set<string>()
    while (queue.length) {
      const id = queue.shift()!
      if (seen.has(id) || !this.chats.has(id)) continue
      seen.add(id)
      out.push(id)
      for (const child of this.listChildren(id)) queue.push(child.id)
    }
    return out
  }

  setSpawnStatus(chatId: string, status: SubChatSpawnStatus): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    chat.spawnStatus = status
    chat.updatedAt = Date.now()
    this.persist(chat, 'defer')
    return chat
  }

  setPermissions(chatId: string, permissions: ChatPermissions): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    chat.permissions = {
      preset: permissions.preset,
      modes: { ...permissions.modes },
    }
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  setProvider(
    chatId: string,
    providerId: string | null,
    model?: string | null,
    reasoningLevel?: string | null,
  ): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    if (providerId && providerId.trim()) {
      chat.providerId = providerId.trim()
    } else {
      delete chat.providerId
    }
    if (model && model.trim()) {
      chat.model = model.trim()
    } else if (model === null || model === '') {
      delete chat.model
    }
    if (reasoningLevel === null || reasoningLevel === '') delete chat.reasoningLevel
    else if (reasoningLevel !== undefined) chat.reasoningLevel = reasoningLevel.trim()
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  getPermissions(chatId: string): ChatPermissions | null {
    const p = this.chats.get(chatId)?.permissions
    if (!p?.modes) return null
    return { preset: p.preset || 'custom', modes: { ...p.modes } }
  }

  beginSubchatRun(chatId:string,runId:string):SubChatRun|undefined{
    const chat=this.chats.get(chatId);if(chat?.kind!=='sub')return
    if(!chat.spawnResult&&!chat.subchatRun&&chat.spawnStatus&&chat.spawnStatus!=='running')chat.spawnResult={runId:`legacy:${chat.id}`,status:chat.spawnStatus,summary:chat.messages.filter(m=>m.role==='assistant').at(-1)?.content.slice(0,2000)||''}
    const run:SubChatRun={id:runId,attempt:(chat.subchatRun?.attempt||0)+1,status:'running',startedAt:Date.now()}
    chat.subchatRun=run;chat.spawnStatus='running';chat.updatedAt=run.startedAt!;this.persist(chat,'immediate');return run
  }
  finishSubchatRun(chatId:string,runId:string,status:Exclude<SubChatSpawnStatus,'running'>,summary:string,reason?:string):{chat:ChatSession;firstResult:boolean}|null{
    const chat=this.chats.get(chatId),run=chat?.subchatRun
    // A late completion from an old attempt must never overwrite a newer run.
    if(!chat||chat.kind!=='sub'||!run||run.id!==runId||run.status!=='running')return null
    const finishedAt=Date.now(),firstResult=!chat.spawnResult
    chat.subchatRun={...run,status,finishedAt,summary,reason};chat.spawnStatus=status;chat.updatedAt=finishedAt
    if(firstResult)chat.spawnResult={runId,status,finishedAt,summary}
    this.persist(chat,'immediate');return {chat,firstResult}
  }

  setMessageQueue(chatId:string, queuedMessages:NonNullable<ChatSession['queuedMessages']>, paused:boolean):void {
    const chat=this.chats.get(chatId)
    if(!chat)throw new Error('chat_not_found')
    chat.queuedMessages=queuedMessages
    chat.queuePaused=paused
    this.persist(chat,'immediate')
  }

  setExecutionMode(chatId: string, mode: 'auto' | 'chat' | 'agent'): ChatSession | null {
    if (!['auto', 'chat', 'agent'].includes(mode)) throw new Error('invalid_execution_mode')
    const chat = this.chats.get(chatId)
    if (!chat) return null
    chat.executionMode = mode
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  appendMessage(chatId: string, msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }): ChatMessage | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    const full: ChatMessage = {
      id: msg.id || `m_${randomUUID()}`,
      role: msg.role,
      content: msg.content,
      createdAt: Date.now(),
      meta: msg.meta,
    }
    if(chat.kind==='sub'){chat.subchatMessageVersion=(chat.subchatMessageVersion||chat.messages.length)+1;full.meta={...full.meta,subchatVersion:chat.subchatMessageVersion}}
    chat.messages.push(full)
    chat.updatedAt = full.createdAt
    this.persist(chat, 'defer')
    return full
  }

  /**
   * Drop messages after the last user turn (failed tools / assistant / error logs)
   * so a retry can continue from that prompt without duplicating the user message.
   */
  trimAfterLastUser(chatId: string): ChatMessage | null {
    const chat = this.chats.get(chatId)
    if (!chat?.messages?.length) return null
    let lastUserIdx = -1
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i]?.role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return null
    if (lastUserIdx < chat.messages.length - 1) {
      chat.messages = chat.messages.slice(0, lastUserIdx + 1)
      if(chat.kind==='sub')chat.subchatMessageVersion=(chat.subchatMessageVersion||0)+1
      chat.updatedAt = Date.now()
      this.persist(chat, 'defer')
    }
    return chat.messages[lastUserIdx] || null
  }

  /**
   * Fill sidebar title from the first user message immediately (not AI-marked).
   * Returns the new title when applied.
   */
  setProvisionalTitleFromFirstUser(chatId: string, userText: string): string | null {
    const chat = this.chats.get(chatId)
    if (!chat || chat.titleGenerated || (chat.title !== '新对话' && chat.title !== '新 Chat')) return null
    const userTurns = chat.messages.filter((m) => m.role === 'user').length
    if (userTurns !== 1) return null
    let t = localChatTitle(userText)
    if (!t) {
      const first = chat.messages.find((m) => m.role === 'user')
      t = localChatTitle(first?.content || '')
    }
    if (!t) return null
    this.setTitle(chatId, t)
    chat.titleSource = 'auto'
    return t
  }

  updateMessage(
    chatId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'meta'>>,
    opts?: { persist?: boolean },
  ): ChatMessage | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    const msg = chat.messages.find((m) => m.id === messageId)
    if (!msg) return null
    const transcriptChanged=patch.content!==undefined&&patch.content!==msg.content||patch.meta!==undefined&&JSON.stringify({...msg.meta,...patch.meta})!==JSON.stringify(msg.meta)
    if (patch.content !== undefined) msg.content = patch.content
    if (patch.meta !== undefined) msg.meta = { ...msg.meta, ...patch.meta }
    if(chat.kind==='sub'&&transcriptChanged){chat.subchatMessageVersion=(chat.subchatMessageVersion||chat.messages.length)+1;msg.meta={...msg.meta,subchatVersion:chat.subchatMessageVersion}}
    chat.updatedAt = Date.now()
    if (opts?.persist !== false) this.persist(chat, 'defer')
    return msg
  }

  /** Cascade delete: caller must destroy browser resources first. */
  delete(chatId: string): boolean {
    if (!this.chats.has(chatId)) return false
    this.clearPersistTimer(chatId)
    this.dirty.delete(chatId)
    this.chats.delete(chatId)
    const f = this.fileOf(chatId)
    if (fs.existsSync(f)) fs.unlinkSync(f)
    return true
  }

  setPinned(chatId: string, pinned: boolean): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    if (pinned) {
      chat.pinned = true
      chat.pinnedAt = Date.now()
    } else {
      delete chat.pinned
      delete chat.pinnedAt
    }
    this.persist(chat, 'immediate')
    return chat
  }

  /** Persist a parked choice without changing the chat's list order. */
  setPendingAsk(chatId: string, req: AgentAskRequest | null): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    if (req && req.kind === 'user_choice' && req.timeoutMs <= 0) {
      chat.pendingAsk = req
    } else {
      delete chat.pendingAsk
    }
    this.persist(chat, 'immediate')
    return chat
  }

  /** Versioned draft writes retain empty tombstones and never change chat list order. */
  setDraft(chatId: string, text: string, opts?: ComposerDraftOptions): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    if(chat.draftUnsupportedDocument!==undefined)throw Error('composer_document_version')
    const incoming=opts?.document?normalizeComposerDocument(opts.document,chatId):composerDocumentFromLegacy(chatId,String(text??''))
    const next=compileComposerDocument(incoming).content
    const at =
      typeof opts?.updatedAt === 'number' && Number.isFinite(opts.updatedAt)
        ? Math.floor(opts.updatedAt)
        : Date.now()
    const prev = chat.draft || ''
    const prevAt = chat.draftUpdatedAt || 0
    const revision=chat.draftRevision||0
    if(opts?.baseRevision!==undefined&&(!Number.isSafeInteger(opts.baseRevision)||opts.baseRevision<0))throw Error('invalid_draft_revision')
    if(chat.draftDocument&&incoming.revision<=revision&&JSON.stringify(chat.draftDocument.content)===JSON.stringify(incoming.content)&&chat.draftDocument.id===incoming.id){
      if(chat.draftConflict&&opts?.baseRevision===revision){delete chat.draftConflict;this.persist(chat,'defer')}
      return chat
    }
    const followsClear=opts?.baseRevision===chat.draftClearedFromRevision&&!prev&&(incoming.id!==chat.draftDocument?.id||incoming.revision>(opts?.baseRevision??-1))
    if((opts?.baseRevision!==undefined&&opts.baseRevision!==revision&&!followsClear)||(opts?.baseRevision===undefined&&at<prevAt&&next!==prev)){
      const recovery=this.recoverDraft(chatId,incoming,'conflict')
      if(recovery)chat.draftConflict={recoveryId:recovery.id,expectedRevision:opts?.baseRevision??revision,actualRevision:revision}
      this.persist(chat,'immediate')
      return chat
    }
    const document={...incoming,revision:Math.max(revision+1,incoming.revision),updatedAt:at}
    chat.draftDocument=document;chat.draftRevision=document.revision;chat.draftUpdatedAt=at
    if(next)chat.draft=next;else delete chat.draft
    delete chat.draftConflict;delete chat.draftClearedFromRevision
    // Draft keystrokes are high-frequency — always debounce.
    this.persist(chat, 'defer')
    return chat
  }

  recoverDraft(chatId:string,document:ComposerDocument,reason:'conflict'|'send_failed'){
    const chat=this.chats.get(chatId);if(!chat)return null
    const normalized=normalizeComposerDocument(document,chatId),existing=chat.draftRecoveries?.find(entry=>entry.document.id===normalized.id&&entry.document.revision===normalized.revision&&JSON.stringify(entry.document.content)===JSON.stringify(normalized.content))
    if(existing)return existing
    const recovery={id:randomUUID(),document:normalized,createdAt:Date.now(),reason}
    chat.draftRecoveries=[...(chat.draftRecoveries||[]),recovery].slice(-20)
    this.persist(chat,'immediate');return recovery
  }
  dismissDraftRecovery(chatId:string,id:string){
    const chat=this.chats.get(chatId);if(!chat)return null
    chat.draftRecoveries=(chat.draftRecoveries||[]).filter(entry=>entry.id!==id)
    if(chat.draftConflict?.recoveryId===id)delete chat.draftConflict
    this.persist(chat,'immediate');return chat
  }
  clearDraftRevision(chatId:string,revision:number|undefined){
    const chat=this.chats.get(chatId);if(!chat||revision===undefined||revision!==(chat.draftRevision||0))return chat||null
    const document=createComposerDocument(chatId)
    if(chat.draftDocument)document.id=chat.draftDocument.id
    document.revision=revision+1
    this.setDraft(chatId,'',{document,baseRevision:revision,updatedAt:Date.now()})
    chat.draftClearedFromRevision=revision;this.persist(chat,'immediate');return chat
  }
  rememberAcceptedMessage(chatId:string,id:string,fingerprint?:string){
    const chat=this.chats.get(chatId);if(!chat)return
    if(!chat.acceptedClientMessageIds?.some(entry=>entry.id===id))chat.acceptedClientMessageIds=[...(chat.acceptedClientMessageIds||[]),{id,acceptedAt:Date.now(),...(fingerprint?{fingerprint}:{})}].slice(-200)
    this.persist(chat,'immediate')
  }

  setWorkspaceRoot(chatId: string, absPath: string | null): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    const trimmed = absPath?.trim() || ''
    if (trimmed) chat.workspaceRoot = path.resolve(trimmed)
    else delete chat.workspaceRoot
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  /**
   * Lock auto-title without changing the current title.
   * @returns true if this call acquired the lock (caller may generate once).
   */
  tryLockTitle(chatId: string): boolean {
    const chat = this.chats.get(chatId)
    if (!chat || chat.titleGenerated) return false
    chat.titleGenerated = true
    this.persist(chat, 'defer')
    return true
  }

  setTitle(
    chatId: string,
    title: string,
    opts?: { fromAi?: boolean; fromUser?: boolean },
  ): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    if (opts?.fromAi && chat.titleSource === 'user') return chat
    const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, 80)
    // Empty title = no change (keep current).
    if (!cleaned) return chat
    chat.title = cleaned
    // Optional model polish runs once; manual names also block topic refresh.
    if (opts?.fromAi || opts?.fromUser) chat.titleGenerated = true
    if (opts?.fromUser) chat.titleSource = 'user'
    else if (opts?.fromAi) chat.titleSource = 'auto'
    chat.updatedAt = Date.now()
    this.persist(chat, 'defer')
    return chat
  }

  getWorkspaceRoot(chatId: string): string | undefined {
    const v = this.chats.get(chatId)?.workspaceRoot?.trim()
    return v || undefined
  }

  /**
   * Walk sub → parent until a main chat; used for session-scoped plugin links.
   */
  resolvePluginScopeChatId(chatId: string): string {
    let id = String(chatId || '').trim()
    if (!id) return id
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const c = this.chats.get(id)
      if (!c?.parentChatId || c.kind !== 'sub') return id
      id = c.parentChatId
    }
    return id
  }

  getDevPluginLinks(chatId: string): Array<{ id: string; path: string }> {
    const scope = this.resolvePluginScopeChatId(chatId)
    const chat = this.chats.get(scope)
    const links = chat?.devPluginLinks
    if (!Array.isArray(links)) return []
    return links
      .map((l) => ({
        id: String(l?.id || '').trim(),
        path: path.resolve(String(l?.path || '').trim()),
      }))
      .filter((l) => l.id && l.path)
  }

  /** Replace session-scoped plugin links on the root chat (immediate persist). */
  setDevPluginLinks(
    chatId: string,
    links: Array<{ id: string; path: string }>,
  ): ChatSession | null {
    const scope = this.resolvePluginScopeChatId(chatId)
    const chat = this.chats.get(scope)
    if (!chat) return null
    const cleaned = links
      .map((l) => ({
        id: String(l?.id || '').trim(),
        path: path.resolve(String(l?.path || '').trim()),
      }))
      .filter((l) => l.id && l.path)
    if (cleaned.length) chat.devPluginLinks = cleaned
    else delete chat.devPluginLinks
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  upsertDevPluginLink(chatId: string, link: { id: string; path: string }): ChatSession | null {
    const id = String(link.id || '').trim()
    const abs = path.resolve(String(link.path || '').trim())
    if (!id || !abs) return null
    const existing = this.getDevPluginLinks(chatId).filter((l) => l.id !== id)
    existing.push({ id, path: abs })
    return this.setDevPluginLinks(chatId, existing)
  }

  removeDevPluginLink(chatId: string, pluginId: string): ChatSession | null {
    const id = String(pluginId || '').trim()
    if (!id) return null
    return this.setDevPluginLinks(
      chatId,
      this.getDevPluginLinks(chatId).filter((l) => l.id !== id),
    )
  }
}
