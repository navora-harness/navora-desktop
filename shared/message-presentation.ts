import type { ChatMessage } from './types'
import { logKindFromMeta } from './run-logs'

/** Persistent phase wins; old transcripts are inferred from tool boundaries, never wording. */
export function progressMessageIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>()
  let toolAhead = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role === 'user' || message.role === 'system') { toolAhead = false; continue }
    if (message.role === 'tool') { toolAhead = true; continue }
    if (message.role !== 'assistant') continue
    if (message.meta?.phase === 'final') { toolAhead = false; continue }
    if (message.meta?.phase === 'progress' || message.meta?.partial === true || toolAhead) ids.add(message.id)
  }
  return ids
}

export function finalOutputs(messages: readonly ChatMessage[]): ChatMessage[] {
  const progress = progressMessageIds(messages)
  return messages.filter(message => message.role === 'assistant' && !progress.has(message.id) && message.content.trim())
}

export type TranscriptBlock =
  | { type: 'chat' | 'tool' | 'log'; key: string; message: ChatMessage }
  | { type: 'run'; key: string; items: ChatMessage[]; reasoning: string }

/** Presentation only: originals and model context are never rewritten or discarded. */
export function transcriptBlocks(messages: readonly ChatMessage[], options: {
  collapseTools: boolean; collapseLogs: boolean; showLogs: boolean
}): TranscriptBlock[] {
  const progress = progressMessageIds(messages), blocks: TranscriptBlock[] = []
  let pending: ChatMessage[] = []
  const flush = (final?: ChatMessage) => {
    const aggregate = typeof final?.meta?.reasoning === 'string' ? final.meta.reasoning.trim() : ''
    if (aggregate && !pending.length) {
      // Stable identity for a pure reasoning + answer turn, without duplicating its answer.
      pending.push({ ...final!, id: `thought:${final!.id}`, content: '', meta: { phase: 'progress' } })
    }
    if (!pending.length) return
    const reasoning = aggregate || pending.filter(m => m.role === 'assistant')
      .map(m => typeof m.meta?.reasoning === 'string' ? m.meta.reasoning.trim() : '').filter(Boolean).join('\n\n')
    blocks.push({ type: 'run', key: `run:${pending[0]!.id}`, items: pending, reasoning })
    pending = []
  }
  for (const message of messages) {
    if (message.role === 'log') {
      if (!options.showLogs && logKindFromMeta(message.meta?.kind) !== 'error') continue
      if (options.collapseTools || options.collapseLogs) pending.push(message)
      else { flush(); blocks.push({ type: 'log', key: message.id, message }) }
    } else if (message.role === 'tool') {
      if (options.collapseTools) pending.push(message)
      else { flush(); blocks.push({ type: 'tool', key: message.id, message }) }
    } else if (progress.has(message.id)) {
      pending.push(message)
    } else {
      flush(message.role === 'assistant' ? message : undefined)
      blocks.push({ type: 'chat', key: message.id, message })
    }
  }
  flush()
  return blocks
}
