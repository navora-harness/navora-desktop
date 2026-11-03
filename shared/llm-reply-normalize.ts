/**
 * Normalize local / OpenAI-compatible model replies that put CoT or tool calls
 * in plain text instead of structured fields.
 *
 * Seen with llama.cpp / small local models (e.g. Bonsai):
 *   <think>...</think>
 *   <tool_call>{"tool":"browser_open","arguments":{...}}</tool_call>
 *   {"name":"browser_open","arguments":{"url":"https://www.mi.com"}}
 *   native tool_calls with function.name === "tool"
 */

import type { ToolCall } from './openai-types.ts'
import type { ModelUsage } from './model-usage'

export type LlmChatReply = {
  usage?: ModelUsage
  content: string | null
  reasoningContent?: string | null
  tool_calls?: ToolCall[]
  finish_reason: string | null
}

const THINK_BLOCK_RE =
  /<\s*(?:think|thinking|reason|reasoning)\b[^>]*>\s*([\s\S]*?)\s*<\s*\/\s*(?:think|thinking|reason|reasoning)\s*>/gi

const TOOL_CALL_BLOCK_RE = /<\s*tool_call\b[^>]*>\s*([\s\S]*?)\s*<\s*\/\s*tool_call\s*>/gi

/** Qwen / Hermes XML fragment inside <tool_call>. */
const QWEN_FUNCTION_RE =
  /<\s*function\s*=\s*([^\s>]+)\s*>([\s\S]*?)<\s*\/\s*function\s*>/i
const QWEN_PARAM_RE =
  /<\s*parameter\s*=\s*([^\s>]+)\s*>\s*([\s\S]*?)\s*<\s*\/\s*parameter\s*>/gi

const PLACEHOLDER_TOOL_NAMES = new Set(['tool', 'function', 'functions', 'call', 'tools'])

function newTextToolCallId(index: number): string {
  return `call_text_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`
}

function stringifyArgs(args: unknown): string {
  if (args == null) return '{}'
  if (typeof args === 'string') {
    const t = args.trim()
    if (!t) return '{}'
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v)
    } catch {
      /* keep raw string below */
    }
    return t
  }
  if (typeof args === 'object' && !Array.isArray(args)) return JSON.stringify(args)
  return JSON.stringify({ value: args })
}

function looksLikeToolName(name: unknown): boolean {
  const n = String(name || '').trim()
  if (!n || PLACEHOLDER_TOOL_NAMES.has(n)) return false
  // Real Navora tools are snake_case with a verb/prefix (browser_open, file_list, …).
  if (!/^[a-zA-Z_][\w.-]*$/.test(n)) return false
  if (n.includes('_')) return true
  // Allow short builtins without underscore (rare).
  return /^(datetime|geolocation|shell|calc)/i.test(n)
}

function toolCallFromNameArgs(name: unknown, args: unknown, index: number): ToolCall | null {
  if (!looksLikeToolName(name)) return null
  return {
    id: newTextToolCallId(index),
    type: 'function',
    function: { name: String(name).trim(), arguments: stringifyArgs(args) },
  }
}

function unwrapNestedArgs(obj: Record<string, unknown>): {
  name: unknown
  args: unknown
} {
  const fn = obj.function
  const fnObj =
    fn && typeof fn === 'object' && !Array.isArray(fn)
      ? (fn as Record<string, unknown>)
      : null
  const name = obj.tool ?? obj.name ?? fnObj?.name
  let args: unknown =
    obj.arguments ??
    obj.parameters ??
    obj.args ??
    obj.input ??
    fnObj?.arguments ??
    fnObj?.parameters

  // {"name":"tool","arguments":{"name":"browser_open","arguments":{...}}}
  if (
    PLACEHOLDER_TOOL_NAMES.has(String(name || '').trim()) &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    const nested = args as Record<string, unknown>
    const nestedName = nested.tool ?? nested.name
    if (looksLikeToolName(nestedName)) {
      return {
        name: nestedName,
        args:
          nested.arguments ??
          nested.parameters ??
          nested.args ??
          nested.input ??
          (() => {
            const { tool: _t, name: _n, function: _f, ...rest } = nested
            return rest
          })(),
      }
    }
  }

  if (args === undefined) {
    const { tool: _t, name: _n, function: _f, ...rest } = obj
    args = Object.keys(rest).length ? rest : {}
  }
  return { name, args }
}

function parseJsonToolPayload(inner: string, index: number): ToolCall | null {
  const trimmed = inner.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    const { name, args } = unwrapNestedArgs(obj)
    return toolCallFromNameArgs(name, args, index)
  } catch {
    return null
  }
}

function parseQwenXmlToolPayload(inner: string, index: number): ToolCall | null {
  const m = inner.match(QWEN_FUNCTION_RE)
  if (!m) return null
  const name = m[1]
  const body = m[2] || ''
  const args: Record<string, string> = {}
  for (const pm of body.matchAll(QWEN_PARAM_RE)) {
    args[String(pm[1] || '').trim()] = String(pm[2] ?? '').trim()
  }
  return toolCallFromNameArgs(name, args, index)
}

/** Invoke-style: browser_open({"url":"..."}) or browser_open { ... } */
function parseInvokeStyleToolPayload(inner: string, index: number): ToolCall | null {
  const trimmed = inner.trim()
  const m = trimmed.match(/^([a-zA-Z_][\w.-]*)\s*(\(|\{)([\s\S]*)/)
  if (!m) return null
  const name = m[1]
  const open = m[2]
  let rest = m[3]
  if (open === '(') {
    const close = rest.lastIndexOf(')')
    if (close >= 0) rest = rest.slice(0, close)
  }
  rest = rest.trim()
  if (rest.startsWith('{')) {
    try {
      return toolCallFromNameArgs(name, JSON.parse(rest), index)
    } catch {
      return toolCallFromNameArgs(name, {}, index)
    }
  }
  return toolCallFromNameArgs(name, {}, index)
}

export function parseTextToolCallBlock(inner: string, index = 0): ToolCall | null {
  return (
    parseJsonToolPayload(inner, index) ||
    parseQwenXmlToolPayload(inner, index) ||
    parseInvokeStyleToolPayload(inner, index)
  )
}

export function extractThinkBlocks(text: string): { text: string; thinking: string[] } {
  const thinking: string[] = []
  const out = String(text || '').replace(THINK_BLOCK_RE, (_full, body: string) => {
    const t = String(body || '').trim()
    if (t) thinking.push(t)
    return '\n'
  })
  return { text: out, thinking }
}

function extractFencedOrBareJsonToolCalls(text: string): {
  text: string
  toolCalls: ToolCall[]
} {
  const toolCalls: ToolCall[] = []
  let out = text
  let index = 0

  out = out.replace(/```(?:json|tool|tools)?\s*([\s\S]*?)```/gi, (full, body: string) => {
    const call = parseJsonToolPayload(String(body || ''), index)
    if (!call) return full
    index += 1
    toolCalls.push(call)
    return '\n'
  })

  if (!toolCalls.length) {
    const trimmed = out.trim()
    // Whole message is a single tool JSON object.
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const call = parseJsonToolPayload(trimmed, 0)
      if (call) {
        toolCalls.push(call)
        out = ''
      }
    } else {
      // Leading/trailing prose around one JSON object.
      const m = trimmed.match(/(\{[\s\S]*\})/)
      if (m && /"(?:name|tool|function)"\s*:/.test(m[1])) {
        const call = parseJsonToolPayload(m[1], 0)
        if (call) {
          toolCalls.push(call)
          out = trimmed.replace(m[1], '\n')
        }
      }
    }
  }

  return { text: out, toolCalls }
}

export function extractTextToolCalls(text: string): {
  text: string
  toolCalls: ToolCall[]
} {
  const toolCalls: ToolCall[] = []
  let index = 0
  let out = String(text || '').replace(TOOL_CALL_BLOCK_RE, (_full, body: string) => {
    const call = parseTextToolCallBlock(String(body || ''), index)
    index += 1
    if (call) toolCalls.push(call)
    return '\n'
  })

  if (!toolCalls.length) {
    const bare = extractFencedOrBareJsonToolCalls(out)
    out = bare.text
    toolCalls.push(...bare.toolCalls)
  }

  return { text: out, toolCalls }
}

/** Rewrite native OpenAI tool_calls when models use placeholder name "tool". */
export function rewriteNativeToolCalls(calls: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!calls?.length) return calls
  let changed = false
  const out = calls.map((c, i) => {
    const n = String(c.function?.name || '').trim()
    if (!PLACEHOLDER_TOOL_NAMES.has(n)) return c
    try {
      const raw = c.function.arguments || '{}'
      const obj = (JSON.parse(raw) || {}) as Record<string, unknown>
      // Prefer the real name inside arguments; do NOT overwrite it with "tool".
      let { name, args } = unwrapNestedArgs(obj)
      if (!looksLikeToolName(name)) {
        ;({ name, args } = unwrapNestedArgs({ ...obj, name: n }))
      }
      const fixed = toolCallFromNameArgs(name, args, i)
      if (!fixed) return c
      changed = true
      return {
        ...c,
        id: c.id || fixed.id,
        function: fixed.function,
      }
    } catch {
      return c
    }
  })
  return changed ? out : calls
}

function mergeReasoning(
  existing: string | null | undefined,
  extra: string[],
): string | null {
  const parts = [
    ...(normalizeWhitespace(existing) ? [normalizeWhitespace(existing)] : []),
    ...extra.map((s) => s.trim()).filter(Boolean),
  ]
  if (!parts.length) return existing == null ? null : String(existing)
  return parts.join('\n\n')
}

function normalizeWhitespace(s: unknown): string {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Lift `<think>` into reasoningContent and text `<tool_call>` / bare JSON into
 * tool_calls when the provider did not return structured tool_calls.
 */
export function normalizeLlmReply(reply: LlmChatReply): LlmChatReply {
  const rewrittenNative = rewriteNativeToolCalls(reply.tool_calls)
  const rawContent = reply.content == null ? '' : String(reply.content)

  if (!rawContent) {
    if (rewrittenNative === reply.tool_calls) return reply
    return { ...reply, tool_calls: rewrittenNative }
  }

  const think = extractThinkBlocks(rawContent)
  const tools = extractTextToolCalls(think.text)
  const cleaned = normalizeWhitespace(tools.text)

  const hasNative = Array.isArray(rewrittenNative) && rewrittenNative.length > 0
  const tool_calls = hasNative
    ? rewrittenNative
    : tools.toolCalls.length
      ? tools.toolCalls
      : rewrittenNative

  const reasoningContent = mergeReasoning(reply.reasoningContent, think.thinking)

  if (
    cleaned === normalizeWhitespace(rawContent) &&
    reasoningContent === (reply.reasoningContent ?? null) &&
    tool_calls === reply.tool_calls
  ) {
    return reply
  }

  return {
    ...reply,
    content: cleaned || null,
    reasoningContent,
    tool_calls,
  }
}
