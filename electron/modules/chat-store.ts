import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  ChatPermissions,
  ChatSession,
  SubChatSpawnStatus,
} from '../../shared/types'
import { ensureDir } from '../data-root'

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
        if (chat?.id) this.chats.set(chat.id, chat)
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
    chat.updatedAt = Date.now()
    this.persist(chat, 'immediate')
    return chat
  }

  getPermissions(chatId: string): ChatPermissions | null {
    const p = this.chats.get(chatId)?.permissions
    if (!p?.modes) return null
    return { preset: p.preset || 'custom', modes: { ...p.modes } }
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
    let t = (userText || '').trim().replace(/\s+/g, ' ')
    if (!t) {
      const first = chat.messages.find((m) => m.role === 'user')
      t = (first?.content || '').trim().replace(/\s+/g, ' ')
    }
    if (!t) return null
    t = t.split(/\r?\n/)[0]?.trim() || t
    // Keep longer text; sidebar truncates with CSS ellipsis.
    if (t.length > 80) t = t.slice(0, 80)
    this.setTitle(chatId, t)
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
    if (patch.content !== undefined) msg.content = patch.content
    if (patch.meta !== undefined) msg.meta = { ...msg.meta, ...patch.meta }
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

  /**
   * Persist unsent composer draft. Does not bump `updatedAt` (list order unchanged).
   * Empty string clears the draft fields.
   */
  setDraft(chatId: string, text: string, opts?: { updatedAt?: number }): ChatSession | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    const next = String(text ?? '')
    const at =
      typeof opts?.updatedAt === 'number' && Number.isFinite(opts.updatedAt)
        ? Math.floor(opts.updatedAt)
        : Date.now()
    const prev = chat.draft || ''
    const prevAt = chat.draftUpdatedAt || 0
    if (next === prev && (next === '' || at <= prevAt)) {
      return chat
    }
    // Remote last-write-wins: ignore older writes.
    if (at < prevAt && next !== prev) {
      return chat
    }
    if (next) {
      chat.draft = next
      chat.draftUpdatedAt = at
    } else {
      delete chat.draft
      delete chat.draftUpdatedAt
    }
    // Draft keystrokes are high-frequency — always debounce.
    this.persist(chat, 'defer')
    return chat
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
    const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, 80)
    // Empty title = no change (keep current).
    if (!cleaned) return chat
    chat.title = cleaned
    // User rename and AI polish both lock out further auto-title.
    if (opts?.fromAi || opts?.fromUser) chat.titleGenerated = true
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
