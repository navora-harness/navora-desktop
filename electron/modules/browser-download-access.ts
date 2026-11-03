import type { BrowserDownloadEntry } from '../../shared/types'

export type DownloadCaller =
  | { kind: 'trusted' }
  | { kind: 'remote' }
  | { kind: 'host'; chatIds: readonly string[] }
  | { kind: 'denied' }

/** Undefined means the existing global application/RPC view, never a detached host. */
export function downloadChatScope(caller: DownloadCaller, chatId?: string | null): ReadonlySet<string> | undefined {
  if (caller.kind === 'denied') throw new Error('download_sender_forbidden')
  // Older remote shims encoded an omitted optional argument as JSON null.
  if (caller.kind === 'remote' && chatId === null) chatId = undefined
  if (chatId !== undefined && (typeof chatId !== 'string' || !chatId.trim())) throw new Error('download_scope_required')
  const id = chatId?.trim()
  if (caller.kind === 'trusted' || caller.kind === 'remote') return id ? new Set([id]) : undefined
  const owned = new Set(caller.chatIds.filter(Boolean))
  if (id && !owned.has(id)) throw new Error('download_scope_mismatch')
  return id ? new Set([id]) : owned
}

export function filterDownloadScope(entries: readonly BrowserDownloadEntry[], scope: ReadonlySet<string> | undefined): BrowserDownloadEntry[] {
  return scope ? entries.filter(entry => scope.has(entry.chatId)) : [...entries]
}

export function assertDownloadScope<T extends BrowserDownloadEntry>(entry: T | null | undefined, scope: ReadonlySet<string> | undefined): T {
  if (!entry) throw new Error('not_found')
  if (scope && !scope.has(entry.chatId)) throw new Error('download_scope_mismatch')
  return entry
}
