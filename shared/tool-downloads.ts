import type { AgentEvent, BrowserDownloadEntry } from './types'

/** View adapter only: tool downloads keep their original streaming service. */
export class ToolDownloadList {
  private entries = new Map<string, BrowserDownloadEntry>()
  private hidden = new Set<string>()
  observe(event: AgentEvent): boolean {
    if ((event.type === 'status' && !event.running) || event.type === 'error') {
      let changed = false
      for (const row of this.entries.values()) {
        if (row.chatId === event.chatId && row.state === 'started') {
          row.state = event.type === 'error' ? 'failed' : 'cancelled'
          row.updatedAt = Date.now()
          changed = true
        }
      }
      if (changed) this.trimFinished()
      return changed
    }
    if (event.type !== 'message' && event.type !== 'message_update') return false
    const m = event.message
    if (m.role !== 'tool' || !['file_download', 'file_download_compose'].includes(String(m.meta?.toolName))) return false
    const id = `tool:${event.chatId}:${m.id}`
    if (this.hidden.has(id)) return false
    const args = m.meta?.args as Record<string, unknown> | undefined
    const result = m.meta?.result as Record<string, unknown> | undefined
    const progress = m.meta?.downloadProgress as Record<string, unknown> | undefined
    const previous = this.entries.get(id)
    const relPath = String(result?.dest || result?.path || args?.dest || progress?.dest || previous?.relPath || '')
    const status = String(m.meta?.status || '')
    const state = status === 'running' ? 'started' : status === 'aborted' ? 'cancelled' : status === 'error' ? 'failed' : 'completed'
    const now = Date.now()
    this.entries.set(id, {
      ...previous, id, source: 'tool', chatId: event.chatId, sessionId: '', state,
      url: String(args?.url || ''), filename: relPath.split(/[/\\]/).at(-1) || '文件下载', relPath,
      receivedBytes: Number(progress?.bytesTotal ?? result?.bytes ?? previous?.receivedBytes) || undefined,
      totalBytes: Number(progress?.partsTotal) === 1 ? Number(progress?.contentLength) || undefined : previous?.totalBytes,
      error: state === 'failed' ? '下载失败，可在对话中查看详情' : undefined,
      canPause: false, canResume: false, canCancel: false, createdAt: previous?.createdAt || now, updatedAt: now,
    })
    // Keep active downloads; trim the oldest completed rows only.
    this.trimFinished()
    return true
  }
  list(chatId?: string): BrowserDownloadEntry[] {
    return [...this.entries.values()].filter(e => !chatId || e.chatId === chatId).sort((a,b) => b.createdAt - a.createdAt)
  }
  get(id: string) { return this.entries.get(id) }
  remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, error: 'not_found' }
    if (entry.state === 'started') return { ok: false, error: 'still_running' }
    this.entries.delete(id); this.hidden.add(id)
    if (this.hidden.size > 1000) this.hidden.delete(this.hidden.values().next().value!)
    return { ok: true }
  }
  clear(chatId?: string) { for (const e of this.list(chatId)) if (e.state !== 'started') this.remove(e.id) }
  private trimFinished() {
    if (this.entries.size <= 100) return
    for (const [id, row] of this.entries) {
      if (row.state !== 'started') this.remove(id)
      if (this.entries.size <= 100) break
    }
  }
}
