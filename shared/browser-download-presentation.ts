import type { BrowserDownloadEntry } from './types'

/** A local download entry always belongs to one confirmed conversation. */
export function downloadsForChat(entries: readonly BrowserDownloadEntry[], chatId: string): BrowserDownloadEntry[] {
  if (!chatId.trim()) return []
  return sortDownloads(entries.filter(entry => entry.chatId === chatId))
}

export function sortDownloads(entries: readonly BrowserDownloadEntry[]): BrowserDownloadEntry[] {
  return [...entries].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
}

export function summarizeDownloads(entries: readonly BrowserDownloadEntry[]) {
  const progressing = entries.filter(entry => entry.state === 'started' || entry.state === 'paused')
  const activeCount = entries.filter(entry => entry.state === 'intercepted' || entry.state === 'started' || entry.state === 'paused').length
  const allPaused = progressing.length > 0 && progressing.every(entry => entry.state === 'paused')
  let progressPercent: number | null = null
  if (progressing.length && progressing.every(entry => Number.isFinite(entry.totalBytes) && entry.totalBytes! > 0 && Number.isFinite(entry.receivedBytes) && entry.receivedBytes! >= 0)) {
    // Scale by the largest total before adding, so valid large totals cannot overflow.
    const scale = progressing.reduce((maximum, entry) => Math.max(maximum, entry.totalBytes!), 0)
    const total = progressing.reduce((sum, entry) => sum + entry.totalBytes! / scale, 0)
    const received = progressing.reduce((sum, entry) => sum + Math.min(entry.receivedBytes!, entry.totalBytes!) / scale, 0)
    progressPercent = Math.min(99, Math.max(0, Math.floor(received / total * 100)))
  }
  return { activeCount, progressCount: progressing.length, allPaused, progressPercent }
}

type SnapshotTicket = { generation: number; eventVersion: number; request: number }

/** Reject stale list replies after a scope change, newer request, push or mutation. */
export class DownloadSnapshotGate {
  private generation = 0
  private eventVersion = 0
  private request = 0
  private instanceId: string | undefined
  private revision = -1
  reset() { this.generation++; this.eventVersion++; this.request++; this.instanceId = undefined; this.revision = -1 }
  changed() { this.eventVersion++ }
  acceptPush(payload: { revision?: number; instanceId?: string }): boolean {
    if (payload.instanceId && payload.instanceId !== this.instanceId) {
      // A remote renderer can survive a host restart, whose revision starts again at zero.
      this.reset()
      this.instanceId = payload.instanceId
    }
    if (typeof payload.revision === 'number' && Number.isFinite(payload.revision)) {
      if (payload.revision < this.revision) return false
      this.revision = payload.revision
    }
    this.changed()
    return true
  }
  begin(): SnapshotTicket { return { generation: this.generation, eventVersion: this.eventVersion, request: ++this.request } }
  accepts(ticket: SnapshotTicket): boolean {
    return ticket.generation === this.generation && ticket.eventVersion === this.eventVersion && ticket.request === this.request
  }
}
