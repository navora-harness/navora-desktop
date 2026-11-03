import type { BrowserDownloadEntry } from './types'

export type WorkspaceTreeEntry = {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
  download?: BrowserDownloadEntry
  /** This row has not yet been found on disk. Never pass it to file operations. */
  virtual?: boolean
  activeDownloads?: number
}

export function activeDownload(item: BrowserDownloadEntry): boolean {
  return item.state === 'started' || item.state === 'paused' || item.state === 'intercepted'
}

export function downloadRelativePath(item: BrowserDownloadEntry): string | null {
  const value = item.relPath?.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!value || value.startsWith('/') || /[:\x00]/.test(value)) return null
  const parts = value.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.includes('..')) return null
  return parts.join('/')
}

export function downloadProgress(item: BrowserDownloadEntry): number | null {
  const { receivedBytes: received, totalBytes: total } = item
  if (!Number.isFinite(received) || !Number.isFinite(total) || total! <= 0 || received! < 0) return null
  // Receiving every byte still does not mean the file has been finalized.
  return item.state === 'completed' ? 100 : Math.min(99, Math.floor(received! / total! * 100))
}

export function downloadStatus(item: BrowserDownloadEntry): string {
  const labels = { intercepted: '待确认', started: '下载中', paused: '已暂停', completed: '已完成', failed: '下载失败', cancelled: '已取消' }
  return labels[item.state]
}

function bytes(value: number): string {
  if (value < 1024) return `${Math.floor(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function downloadDetail(item: BrowserDownloadEntry): string {
  const received = item.receivedBytes, total = item.totalBytes
  const size = Number.isFinite(received) && received! >= 0 ? bytes(received!) : ''
  const progress = Number.isFinite(total) && total! > 0 ? `${size || '0 B'} / ${bytes(total!)}` : size
  return [downloadStatus(item), progress, item.error].filter(Boolean).join(' · ')
}

/** Merge a directory listing with live downloads, preserving the actual file path as row identity. */
export function mergeWorkspaceDownloads(
  entries: WorkspaceTreeEntry[], directory: string, chatId: string, downloads: BrowserDownloadEntry[],
  awaitingDisk: ReadonlySet<string> = new Set(), recursive = false,
): WorkspaceTreeEntry[] {
  const prefix = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') + '/' : ''
  const byPath = new Map<string, BrowserDownloadEntry>()
  for (const item of downloads) {
    if (item.chatId !== chatId) continue
    const rel = downloadRelativePath(item) || `:download/${item.id}`
    const previous = byPath.get(rel)
    if (!previous || item.updatedAt > previous.updatedAt || (item.updatedAt === previous.updatedAt && item.createdAt > previous.createdAt)) byPath.set(rel, item)
  }
  const partials = new Set([...byPath].filter(([, item]) => activeDownload(item) || awaitingDisk.has(item.id)).map(([rel]) => `${rel}.crdownload`))
  const rows = new Map(entries.filter(entry => !partials.has(entry.path.replace(/\\/g, '/'))).map(entry => [entry.path.replace(/\\/g, '/'), { ...entry }]))
  for (const [rel, item] of byPath) {
    if (rel.startsWith(':download/')) {
      if (!directory && item.state !== 'completed') rows.set(rel, { path: rel, name: item.filename || '未命名下载', type: 'file', virtual: true, download: item })
      continue
    }
    if (!rel.startsWith(prefix)) continue
    const remaining = rel.slice(prefix.length), parts = remaining.split('/')
    const name = recursive ? parts.at(-1)! : parts[0]!, rest = recursive ? [] : parts.slice(1)
    if (!name) continue
    const childPath = recursive ? rel : prefix + name
    let row = rows.get(childPath)
    // Completed files deleted from disk must not be resurrected by old download records.
    const canCreate = item.state !== 'completed' || awaitingDisk.has(item.id)
    if (!row && canCreate) {
      row = { path: childPath, name, type: rest.length ? 'dir' : 'file', virtual: true }
      rows.set(childPath, row)
    }
    if (!row) continue
    if (rest.length && row.type === 'dir' && activeDownload(item)) row.activeDownloads = (row.activeDownloads || 0) + 1
    else if (!rest.length && row.type === 'file') row.download = item
  }
  return [...rows.values()].sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1)
}
