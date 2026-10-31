import { extractThinkBlocks, type LlmChatReply } from './llm-reply-normalize'

/** Keep incomplete local-model markup out of the visible answer while streaming. */
export function llmStreamPreview(reply: LlmChatReply): { content: string; reasoning: string } {
  const parsed = extractThinkBlocks(reply.content || '')
  let content = parsed.text
  const thinking = [...parsed.thinking]
  const openThink = /<\s*(?:think|thinking|reason|reasoning)\b[^>]*>/i.exec(content)
  if (openThink) {
    thinking.push(content.slice(openThink.index + openThink[0].length))
    content = content.slice(0, openThink.index)
  }
  // Wait for completion before rendering textual tool protocols / JSON tool payloads.
  const toolStart = /<\s*tool_call\b/i.exec(content)
  if (toolStart) content = content.slice(0, toolStart.index)
  if (/^\s*(?:\{|```(?:json|tool))/i.test(content)) content = ''
  content = content.replace(/<[^>]*$/, '')
  return {
    content,
    reasoning: [reply.reasoningContent, ...thinking].filter(Boolean).join('\n\n'),
  }
}
