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

/**
 * In-memory list of browser-triggered (will-download) downloads for the UI panel.
 * Not persisted across app restarts.
 */
export class BrowserDownloadList {
  private entries: BrowserDownloadEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 100) {
    this.maxEntries = Math.max(10, maxEntries)
  }

  list(chatId?: string): BrowserDownloadEntry[] {
    const id = String(chatId || '').trim()
    const rows = id ? this.entries.filter((e) => e.chatId === id) : this.entries
    return rows.map((e) => ({ ...e }))
  }

  upsert(info: BrowserDownloadUpsert): BrowserDownloadEntry {
    const now = Date.now()
    const key = matchKey(info)
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
      return { ...next }
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
      this.entries.length = this.maxEntries
    }
    return { ...entry }
  }

  clear(chatId?: string): { ok: true; removed: number } {
    const id = String(chatId || '').trim()
    if (!id) {
      const n = this.entries.length
      this.entries = []
      return { ok: true, removed: n }
    }
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.chatId !== id)
    return { ok: true, removed: before - this.entries.length }
  }

  remove(entryId: string): { ok: boolean } {
    const id = String(entryId || '').trim()
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    return { ok: this.entries.length < before }
  }

  get(entryId: string): BrowserDownloadEntry | null {
    const id = String(entryId || '').trim()
    const hit = this.entries.find((e) => e.id === id)
    return hit ? { ...hit } : null
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
