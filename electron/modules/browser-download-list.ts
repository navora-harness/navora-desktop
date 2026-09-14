import fs from 'node:fs'
import type { DownloadItem } from 'electron'
import type { BrowserDownloadEntry, BrowserDownloadState } from '../../shared/types'

export type BrowserDownloadUpsert = {
  chatId: string
  sessionId: string
  windowId?: string
  state: BrowserDownloadState
  url: string
  filename: string
  savePath?: string
  relPath?: string
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

const ACTIVE_STATES = new Set<BrowserDownloadState>(['intercepted', 'started', 'paused'])
const FINISHED_STATES = new Set<BrowserDownloadState>(['completed', 'failed', 'cancelled'])

/**
 * In-memory list of browser-triggered (will-download) downloads for the UI panel.
 * Holds live Electron DownloadItem refs for pause / resume / cancel.
 * Not persisted across app restarts.
 */
export class BrowserDownloadList {
  private entries: BrowserDownloadEntry[] = []
  private readonly live = new Map<string, DownloadItem>()
  /** Match keys removed from the UI while a DownloadItem may still emit terminal events. */
  private readonly ignoredKeys = new Set<string>()
  private readonly maxEntries: number

  constructor(maxEntries = 100) {
    this.maxEntries = Math.max(10, maxEntries)
  }

  list(chatId?: string): BrowserDownloadEntry[] {
    const id = String(chatId || '').trim()
    const rows = id ? this.entries.filter((e) => e.chatId === id) : this.entries
    return rows.map((e) => this.withCapabilities(e))
  }

  upsert(info: BrowserDownloadUpsert): BrowserDownloadEntry {
    const now = Date.now()
    const key = matchKey(info)
    if (key && this.ignoredKeys.has(key)) {
      if (FINISHED_STATES.has(info.state)) this.ignoredKeys.delete(key)
      return {
        id: `ignored_${now.toString(36)}`,
        chatId: info.chatId,
        sessionId: info.sessionId,
        windowId: info.windowId,
        state: info.state,
        url: info.url,
        filename: info.filename,
        savePath: info.savePath,
        relPath: info.relPath,
        receivedBytes: info.receivedBytes,
        totalBytes: info.totalBytes,
        error: info.error,
        createdAt: now,
        updatedAt: now,
      }
    }

    const idx = key ? this.entries.findIndex((e) => matchKey(e) === key) : -1
    if (idx >= 0) {
      const prev = this.entries[idx]
      const next: BrowserDownloadEntry = {
        ...prev,
        sessionId: info.sessionId || prev.sessionId,
        windowId: info.windowId ?? prev.windowId,
        state: info.state,
        url: info.url || prev.url,
        filename: info.filename || prev.filename,
        savePath: info.savePath ?? prev.savePath,
        relPath: info.relPath ?? prev.relPath,
        receivedBytes:
          typeof info.receivedBytes === 'number' ? info.receivedBytes : prev.receivedBytes,
        totalBytes: typeof info.totalBytes === 'number' ? info.totalBytes : prev.totalBytes,
        error: info.error ?? (info.state === 'completed' ? undefined : prev.error),
        updatedAt: now,
      }
      this.entries.splice(idx, 1)
      this.entries.unshift(next)
      return this.withCapabilities(next)
    }

    const entry: BrowserDownloadEntry = {
      id: `dl_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      chatId: info.chatId,
      sessionId: info.sessionId,
      windowId: info.windowId,
      state: info.state,
      url: info.url,
      filename: info.filename,
      savePath: info.savePath,
      relPath: info.relPath,
      receivedBytes: info.receivedBytes,
      totalBytes: info.totalBytes,
      error: info.error,
      createdAt: now,
      updatedAt: now,
    }
    this.entries.unshift(entry)
    if (this.entries.length > this.maxEntries) {
      const dropped = this.entries.splice(this.maxEntries)
      for (const d of dropped) this.releaseLive(d.id)
    }
    return this.withCapabilities(entry)
  }

  /** Attach the Chromium DownloadItem so pause/resume/cancel can reach it. */
  bindItem(entryId: string, item: DownloadItem): void {
    const id = String(entryId || '').trim()
    if (!id || id.startsWith('ignored_')) return
    this.releaseLive(id)
    this.live.set(id, item)
    item.once('done', () => {
      this.releaseLive(id)
    })
  }

  pause(entryId: string): { ok: boolean; error?: string } {
    const entry = this.find(entryId)
    if (!entry) return { ok: false, error: 'not_found' }
    if (entry.state !== 'started') return { ok: false, error: 'not_downloading' }
    const item = this.live.get(entry.id)
    if (!item) return { ok: false, error: 'not_active' }
    try {
      if (!item.isPaused()) item.pause()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.patchState(entry.id, {
      state: 'paused',
      receivedBytes: safeReceived(item, entry.receivedBytes),
      totalBytes: safeTotal(item, entry.totalBytes),
    })
    return { ok: true }
  }

  resume(entryId: string): { ok: boolean; error?: string } {
    const entry = this.find(entryId)
    if (!entry) return { ok: false, error: 'not_found' }
    if (entry.state !== 'paused') return { ok: false, error: 'not_paused' }
    const item = this.live.get(entry.id)
    if (!item) return { ok: false, error: 'not_active' }
    if (!item.canResume() && !item.isPaused()) {
      return { ok: false, error: 'cannot_resume' }
    }
    try {
      item.resume()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.patchState(entry.id, {
      state: 'started',
      receivedBytes: safeReceived(item, entry.receivedBytes),
      totalBytes: safeTotal(item, entry.totalBytes),
      error: undefined,
    })
    return { ok: true }
  }

  cancel(entryId: string): { ok: boolean; error?: string } {
    const entry = this.find(entryId)
    if (!entry) return { ok: false, error: 'not_found' }
    if (!ACTIVE_STATES.has(entry.state)) return { ok: false, error: 'already_finished' }
    const item = this.live.get(entry.id)
    if (item) {
      try {
        item.cancel()
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    // Patch immediately so the panel updates before Chromium's done event.
    this.patchState(entry.id, { state: 'cancelled', error: 'user_cancelled' })
    // Intercepted items may not have done-handlers yet; clean up the empty save path.
    if (entry.state === 'intercepted' || !item) {
      try {
        if (entry.savePath && fs.existsSync(entry.savePath)) fs.unlinkSync(entry.savePath)
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  }

  /**
   * Remove from the panel. Active downloads are cancelled first and ignored
   * so late `done` events do not re-insert the row.
   */
  remove(entryId: string): { ok: boolean } {
    const entry = this.find(entryId)
    if (!entry) return { ok: false }
    const key = matchKey(entry)
    if (key) this.ignoredKeys.add(key)
    if (ACTIVE_STATES.has(entry.state)) {
      const item = this.live.get(entry.id)
      if (item) {
        try {
          item.cancel()
        } catch {
          /* ignore */
        }
      }
    }
    this.releaseLive(entry.id)
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== entry.id)
    return { ok: this.entries.length < before }
  }

  /**
   * Clear panel rows. By default only finished rows; pass `all: true` to cancel
   * actives and clear everything (optionally scoped by chatId).
   */
  clear(chatId?: string, opts?: { all?: boolean }): { ok: true; removed: number } {
    const id = String(chatId || '').trim()
    const all = opts?.all === true
    const match = (e: BrowserDownloadEntry) => (!id || e.chatId === id) && (all || FINISHED_STATES.has(e.state))
    const targets = this.entries.filter(match)
    for (const e of targets) {
      const key = matchKey(e)
      if (key) this.ignoredKeys.add(key)
      if (ACTIVE_STATES.has(e.state)) {
        const item = this.live.get(e.id)
        if (item) {
          try {
            item.cancel()
          } catch {
            /* ignore */
          }
        }
      }
      this.releaseLive(e.id)
    }
    const removeIds = new Set(targets.map((e) => e.id))
    const before = this.entries.length
    this.entries = this.entries.filter((e) => !removeIds.has(e.id))
    return { ok: true, removed: before - this.entries.length }
  }

  get(entryId: string): BrowserDownloadEntry | null {
    const hit = this.find(entryId)
    return hit ? this.withCapabilities(hit) : null
  }

  private find(entryId: string): BrowserDownloadEntry | undefined {
    const id = String(entryId || '').trim()
    return this.entries.find((e) => e.id === id)
  }

  private patchState(
    entryId: string,
    patch: Partial<Pick<BrowserDownloadEntry, 'state' | 'receivedBytes' | 'totalBytes' | 'error'>>,
  ): void {
    const idx = this.entries.findIndex((e) => e.id === entryId)
    if (idx < 0) return
    const prev = this.entries[idx]
    const next: BrowserDownloadEntry = {
      ...prev,
      ...patch,
      error: patch.error === undefined && patch.state === 'completed' ? undefined : patch.error ?? prev.error,
      updatedAt: Date.now(),
    }
    this.entries.splice(idx, 1)
    this.entries.unshift(next)
  }

  private releaseLive(entryId: string): void {
    this.live.delete(entryId)
  }

  private withCapabilities(e: BrowserDownloadEntry): BrowserDownloadEntry {
    const item = this.live.get(e.id)
    const live = Boolean(item)
    return {
      ...e,
      canPause: e.state === 'started' && live,
      canResume: e.state === 'paused' && live && (item!.canResume() || item!.isPaused()),
      canCancel: ACTIVE_STATES.has(e.state) && (live || e.state === 'intercepted'),
    }
  }
}

function matchKey(info: {
  chatId: string
  savePath?: string
  relPath?: string
  filename?: string
}): string {
  const save = String(info.savePath || '').trim()
  if (save) return `p:${save}`
  const rel = String(info.relPath || '').trim()
  if (rel) return `r:${info.chatId}:${rel}`
  const name = String(info.filename || '').trim()
  return name ? `n:${info.chatId}:${name}` : ''
}

function safeReceived(item: DownloadItem, fallback?: number): number | undefined {
  try {
    const n = item.getReceivedBytes()
    return typeof n === 'number' ? n : fallback
  } catch {
    return fallback
  }
}

function safeTotal(item: DownloadItem, fallback?: number): number | undefined {
  try {
    const n = item.getTotalBytes()
    return n > 0 ? n : fallback
  } catch {
    return fallback
  }
}
