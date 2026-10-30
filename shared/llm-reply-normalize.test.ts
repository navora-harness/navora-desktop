import assert from 'node:assert/strict'
import {
  extractTextToolCalls,
  extractThinkBlocks,
  normalizeLlmReply,
  parseTextToolCallBlock,
} from './llm-reply-normalize.ts'

const sample = `<think>
用户要求访问小米官网。用 browser_open。
</think>

<tool_call>
{"tool": "browser_open", "arguments": {"url": "https://www.mi.com/"}}
</tool_call>`

const think = extractThinkBlocks(sample)
assert.match(think.thinking.join('\n'), /小米官网/)
assert.doesNotMatch(think.text, /<think>/i)

const tools = extractTextToolCalls(think.text)
assert.equal(tools.toolCalls.length, 1)
assert.equal(tools.toolCalls[0].function.name, 'browser_open')
assert.equal(JSON.parse(tools.toolCalls[0].function.arguments).url, 'https://www.mi.com/')
assert.doesNotMatch(tools.text, /tool_call/i)

const normalized = normalizeLlmReply({
  content: sample,
  reasoningContent: null,
  finish_reason: 'stop',
})
assert.equal(normalized.content, null)
assert.match(String(normalized.reasoningContent), /小米官网/)
assert.equal(normalized.tool_calls?.length, 1)
assert.equal(normalized.tool_calls?.[0].function.name, 'browser_open')

const greeting = normalizeLlmReply({
  content: `<think>\n问候\n</think>\n\n你好！有什么可以帮忙的？`,
  finish_reason: 'stop',
})
assert.equal(greeting.content, '你好！有什么可以帮忙的？')
assert.match(String(greeting.reasoningContent), /问候/)
assert.equal(greeting.tool_calls, undefined)

const nativeKept = normalizeLlmReply({
  content: `<think>x</think>\n\n<tool_call>{"tool":"browser_open","arguments":{"url":"https://a.test"}}</tool_call>`,
  tool_calls: [
    {
      id: 'call_native',
      type: 'function',
      function: { name: 'browser_get', arguments: '{}' },
    },
  ],
  finish_reason: 'tool_calls',
})
assert.equal(nativeKept.tool_calls?.[0].function.name, 'browser_get')
assert.equal(nativeKept.content, null)

assert.equal(
  parseTextToolCallBlock(
    '<function=browser_navigate>\n<parameter=url>https://www.mi.com/</parameter>\n</function>',
  )?.function.name,
  'browser_navigate',
)

assert.equal(
  parseTextToolCallBlock('browser_open({"url":"https://www.mi.com/"})')?.function.name,
  'browser_open',
)

assert.equal(
  parseTextToolCallBlock(
    '{"name":"file_list","parameters":{"path":"."}}',
  )?.function.name,
  'file_list',
)

// Bare JSON content (Bonsai after failed placeholder "tool" call)
const bare = normalizeLlmReply({
  content:
    '{"name":"browser_open","arguments":{"url":"https://www.mi.com","title":"小米官网"}}',
  finish_reason: 'stop',
})
assert.equal(bare.tool_calls?.[0].function.name, 'browser_open')
assert.equal(
  JSON.parse(bare.tool_calls?.[0].function.arguments || '{}').url,
  'https://www.mi.com',
)
assert.equal(bare.content, null)

// Native placeholder name "tool" with nested real call
const nestedNative = normalizeLlmReply({
  content: null,
  tool_calls: [
    {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'tool',
        arguments: JSON.stringify({
          name: 'browser_open',
          arguments: { url: 'https://www.mi.com' },
        }),
      },
    },
  ],
  finish_reason: 'tool_calls',
})
assert.equal(nestedNative.tool_calls?.[0].function.name, 'browser_open')
assert.equal(
  JSON.parse(nestedNative.tool_calls?.[0].function.arguments || '{}').url,
  'https://www.mi.com',
)

console.log('llm-reply-normalize tests ok')
