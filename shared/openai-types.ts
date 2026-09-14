/** Minimal OpenAI Chat Completions types used by Navora. */

export type ChatCompletionTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessageParam =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ChatCompletionRequest = {
  model: string
  messages: ChatMessageParam[]
  tools?: ChatCompletionTool[]
  tool_choice?: 'auto' | 'none'
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

export type ChatCompletionChoice = {
  index: number
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: ToolCall[]
    /** Some models (e.g. mimo) put chain-of-thought here and leave content empty until budget remains. */
    reasoning_content?: string | null
  }
  finish_reason: string | null
}

export type ChatCompletionResponse = {
  id: string
  choices: ChatCompletionChoice[]
}
