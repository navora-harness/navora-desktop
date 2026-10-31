import type { ChatMessage } from './types'
import { logKindFromMeta } from './run-logs'

/** Persistent phase wins; old transcripts are inferred from tool boundaries, never wording. */
export function progressMessageIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>()
  let toolAhead = false
  let toolRunId: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role === 'user' || message.role === 'system') { toolAhead = false; toolRunId = undefined; continue }
    if (message.role === 'tool') { toolAhead = true; toolRunId = message.meta?.runId; continue }
    if (message.role !== 'assistant') continue
    if (message.meta?.phase === 'final') { toolAhead = false; toolRunId = undefined; continue }
    if (toolRunId && message.meta?.runId !== toolRunId) { toolAhead = false; toolRunId = undefined }
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

/** Old manual-close notifications are UI state changes, not execution history. */
export function isQuietResourceLog(message: ChatMessage): boolean {
  if (message.role !== 'log' || message.meta?.kind !== 'user_op') return false
  const summary = String(message.meta?.summary || message.content.split(/\r?\n/, 1)[0] || '').trim()
  return ['你关闭了一个浏览器窗口', '你关闭了一个浏览器会话', '你关闭了一个 Session'].includes(summary)
}

/** Counts describe recorded operations, never imply that every attempted call succeeded. */
export function executionSummary(items: readonly ChatMessage[], options: {
  live?: boolean; runningLabel?: string; status?: (message: ChatMessage) => string
} = {}): string {
  const tools = items.filter(message => message.role === 'tool')
  const status = options.status || ((message: ChatMessage) => String(message.meta?.status || 'done'))
  const failed = tools.filter(message => status(message) === 'error').length
  const logs = items.filter(message => message.role === 'log' && !isQuietResourceLog(message))
  const terminalError = logs.some(message => message.meta?.kind === 'agent_error')
  const stopped = logs.some(message => message.meta?.kind === 'agent_stop') || tools.some(message => status(message) === 'aborted')
  const limited = logs.some(message => message.meta?.kind === 'round_limit')
  const label = options.live ? (options.runningLabel ? `正在${options.runningLabel}` : '执行中')
    : terminalError ? '执行中断' : stopped ? '已停止' : limited ? '已达轮次上限' : '执行记录'
  return [label, tools.length ? `${tools.length} 次调用` : '', logs.length ? `${logs.length} 条日志` : '',
    failed ? `${failed} 次调用失败` : ''].filter(Boolean).join(' · ')
}

/** Presentation only: originals and model context are never rewritten or discarded. */
export function transcriptBlocks(messages: readonly ChatMessage[], options: {
  collapseTools: boolean; collapseLogs: boolean; showLogs: boolean
}): TranscriptBlock[] {
  const progress = progressMessageIds(messages), blocks: TranscriptBlock[] = []
  let pending: ChatMessage[] = []
  let trailingRun: Extract<TranscriptBlock, {type: 'run'}> | undefined
  let answerIndex: number | undefined
  const knownRuns = new Map<string, Extract<TranscriptBlock, {type:'run'}>>()
  const runId = (message?: ChatMessage) => typeof message?.meta?.runId === 'string' ? message.meta.runId : undefined
  const flush = (final?: ChatMessage) => {
    const aggregate = typeof final?.meta?.reasoning === 'string' ? final.meta.reasoning.trim() : ''
    const existing = knownRuns.get(runId(final) || '')
    if (existing && !pending.length) {
      if (aggregate) existing.reasoning = aggregate
      return existing
    }
    if (aggregate && !pending.length) {
      // Stable identity for a pure reasoning + answer turn, without duplicating its answer.
      pending.push({ ...final!, id: `thought:${final!.id}`, content: '', meta: { phase: 'progress', runId:runId(final) } })
    }
    if (!pending.length) return undefined
    const reasoning = aggregate || pending.filter(m => m.role === 'assistant')
      .map(m => typeof m.meta?.reasoning === 'string' ? m.meta.reasoning.trim() : '').filter(Boolean).join('\n\n')
    const block: Extract<TranscriptBlock, {type: 'run'}> = { type: 'run', key: `run:${pending[0]!.id}`, items: pending, reasoning }
    blocks.push(block)
    const id = runId(pending[0])
    if (id) knownRuns.set(id,block)
    pending = []
    return block
  }
  const appendKnown = (message: ChatMessage): boolean => {
    const id = runId(message)
    if (!id) return false
    if (pending.length && runId(pending[0]) !== id) flush()
    const existing = knownRuns.get(id)
    if (existing) { existing.items.push(message); return true }
    // A second run may start without another user message (resume/retry). Its
    // bookkeeping must not attach to the preceding run's answer.
    if (trailingRun && runId(trailingRun.items[0]) !== id) trailingRun = undefined
    const answer = answerIndex === undefined ? undefined : blocks[answerIndex]
    if (answer?.type === 'chat' && runId(answer.message) !== id) answerIndex = undefined
    return false
  }
  for (const message of messages) {
    if (message.role === 'log') {
      if (isQuietResourceLog(message)) continue
      if (!options.showLogs && logKindFromMeta(message.meta?.kind) !== 'error' && !['agent_stop','round_limit'].includes(String(message.meta?.kind))) continue
      if (options.collapseTools || options.collapseLogs) {
        if (appendKnown(message)) continue
        // Bookkeeping often arrives after the answer. Keep it in that execution's
        // existing disclosure, without changing stored order or crossing a new turn.
        if (pending.length) pending.push(message)
        else if (trailingRun) trailingRun.items.push(message)
        else if (answerIndex !== undefined) {
          trailingRun = {type:'run',key:`run:${message.id}`,items:[message],reasoning:''}
          blocks.splice(answerIndex, 0, trailingRun)
          const id = runId(message)
          if (id) knownRuns.set(id,trailingRun)
          answerIndex++
        } else pending.push(message)
      }
      else { flush(); blocks.push({ type: 'log', key: message.id, message }) }
    } else if (message.role === 'tool') {
      if (options.collapseTools && appendKnown(message)) continue
      trailingRun = undefined; answerIndex = undefined
      if (options.collapseTools) pending.push(message)
      else { flush(); blocks.push({ type: 'tool', key: message.id, message }) }
    } else if (progress.has(message.id)) {
      if (appendKnown(message)) continue
      trailingRun = undefined; answerIndex = undefined
      pending.push(message)
    } else {
      trailingRun = flush(message.role === 'assistant' ? message : undefined)
      answerIndex = message.role === 'assistant' ? blocks.length : undefined
      blocks.push({ type: 'chat', key: message.id, message })
    }
  }
  flush()
  return blocks
}
