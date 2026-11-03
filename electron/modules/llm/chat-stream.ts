import type { ToolCall } from '../../../shared/openai-types'
import { normalizeModelUsage, type ModelUsage } from '../../../shared/model-usage'

export type ChatReply = {
  usage?: ModelUsage
  content: string | null
  reasoningContent?: string | null
  tool_calls?: ToolCall[]
  finish_reason: string | null
}

type StreamChunk = {
  usage?: unknown
  error?: { message?: string }
  choices?: Array<{
    index?: number
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

/** Decode SSE independently of network/UTF-8 boundaries; execute tools only after completion. */
export async function readChatStream(
  response: Response,
  onUpdate?: (reply: ChatReply) => void,
): Promise<ChatReply> {
  if (!response.body) throw new Error('llm_empty_stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  let content = ''
  let reasoningContent = ''
  let finishReason: string | null = null
  let done = false
  let sawChoice = false
  let usage: ModelUsage | undefined
  const calls = new Map<number, ToolCall>()
  const snapshot = (): ChatReply => ({
    content: content || null,
    reasoningContent: reasoningContent || null,
    tool_calls: calls.size ? [...calls].sort(([a], [b]) => a - b).map(([, c]) => ({ ...c, function: { ...c.function } })) : undefined,
    finish_reason: finishReason,
    ...(usage ? { usage: { ...usage } } : {}),
  })
  const dispatch = () => {
    if (!data.length || done) return
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') { done = true; return }
    let chunk: StreamChunk
    try { chunk = JSON.parse(payload) as StreamChunk } catch { throw new Error('llm_invalid_stream_json') }
    if (chunk.error) throw new Error(`llm_stream_error:${chunk.error.message || '模型返回流错误'}`)
    const reported = normalizeModelUsage(chunk.usage)
    if (reported) usage = reported
    const choice = chunk.choices?.find(c => (c.index ?? 0) === 0)
    if (!choice) { if (reported) onUpdate?.(snapshot()); return }
    sawChoice = true
    const delta = choice.delta
    if (typeof delta?.content === 'string') content += delta.content
    if (typeof delta?.reasoning_content === 'string') reasoningContent += delta.reasoning_content
    for (const part of delta?.tool_calls || []) {
      if (!Number.isInteger(part.index) || part.index < 0) throw new Error('llm_invalid_stream_tool_index')
      const call = calls.get(part.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
      if (part.id) call.id += part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
      calls.set(part.index, call)
    }
    if (choice.finish_reason != null) finishReason = choice.finish_reason
    if (delta?.content || delta?.reasoning_content || delta?.tool_calls?.length) onUpdate?.(snapshot())
  }
  const line = (value: string) => {
    if (!value) dispatch()
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    while (!done) {
      const next = await reader.read()
      pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true })
      // Keep a trailing CR until the next read, in case CRLF spans network chunks.
      let match: RegExpExecArray | null
      const newline = /\r\n|\r(?!$)|\n/g
      let consumed = 0
      while ((match = newline.exec(pending))) {
        line(pending.slice(consumed, match.index))
        consumed = match.index + match[0].length
        if (done) break
      }
      pending = pending.slice(consumed)
      if (next.done) {
        if (pending) line(pending.replace(/\r$/, ''))
        dispatch()
        break
      }
    }
    if (!sawChoice) throw new Error('llm_empty_choices')
    if (!done && !finishReason) throw new Error('llm_stream_incomplete:模型响应流提前断开，请重试。')
    if ([...calls.values()].some(c => !c.id || !c.function.name)) throw new Error('llm_stream_incomplete_tool_call')
    return snapshot()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
