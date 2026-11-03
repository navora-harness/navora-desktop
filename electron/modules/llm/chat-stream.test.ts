import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type ServerResponse } from 'node:http'
import { readChatStream, type ChatReply } from './chat-stream'
import { OpenAICompatibleClient } from './openai-compatible'

const chunk = (delta: object, finish_reason: string | null = null, index = 0) =>
  `data: ${JSON.stringify({ choices: [{ index, delta, finish_reason }] })}\r\n\r\n`
const response = (value: string, byteSize = 1) => {
  const bytes = new TextEncoder().encode(value)
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += byteSize) controller.enqueue(bytes.slice(i, i + byteSize))
      controller.close()
    },
  }))
}

test('SSE preserves Chinese split across bytes, CRLF, reasoning, content and usage chunks', async () => {
  const updates: ChatReply[] = []
  const reply = await readChatStream(response(
    ': heartbeat\r\n\r\n' + chunk({ reasoning_content: '正在思考' }) +
    chunk({ content: '你' }) + chunk({ content: '好' }) +
    chunk({ content: 'wrong choice' }, null, 1) + chunk({}, 'stop') +
    'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10,"prompt_tokens_details":{"cached_tokens":2}}}\r\n\r\ndata: [DONE]\r\n\r\n',
  ), reply => updates.push(reply))
  assert.equal(reply.content, '你好')
  assert.equal(reply.reasoningContent, '正在思考')
  assert.equal(reply.finish_reason, 'stop')
  assert.equal(updates[0].content, null)
  assert.equal(updates[1].content, '你')
  assert.deepEqual(reply.usage, { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 2 })
  assert.equal(updates.at(-1)?.usage?.totalTokens, 10)
  assert.equal(updates[0].usage, undefined)
})

test('missing and malformed stream usage never becomes a fabricated zero', async () => {
  const reply = await readChatStream(response(chunk({ content: 'ok' }) + chunk({}, 'stop') + 'data: {"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":2}}\n\ndata: [DONE]\n\n'))
  assert.equal(reply.usage, undefined)
})

test('interleaved parallel tools assemble by index without mutating earlier updates', async () => {
  const updates: ChatReply[] = []
  const reply = await readChatStream(response(
    chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'browser_get', arguments: '{"win' } }] }) +
    chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'browser_open', arguments: '{"url":' } }] }) +
    chunk({ tool_calls: [{ index: 1, function: { arguments: 'dowId":"1"}' } }, { index: 0, function: { arguments: '"https://example.com"}' } }] }) +
    chunk({}, 'tool_calls') + 'data: [DONE]\n\n', 7,
  ), reply => updates.push(reply))
  assert.deepEqual(reply.tool_calls?.map(c => c.id), ['a', 'b'])
  assert.deepEqual(JSON.parse(reply.tool_calls![1].function.arguments), { windowId: '1' })
  assert.equal(updates[0].tool_calls![0].function.arguments, '{"win')
})

test('finish_reason allows EOF without DONE and final SSE event without blank line', async () => {
  const reply = await readChatStream(response(chunk({ content: 'ok' }) + chunk({}, 'stop').trimEnd()))
  assert.equal(reply.content, 'ok')
})

test('broken streams and provider errors never return executable partial tools', async () => {
  await assert.rejects(readChatStream(response(chunk({ content: 'partial' }))), /llm_stream_incomplete/)
  await assert.rejects(readChatStream(response('data: {bad}\n\n')), /llm_invalid_stream_json/)
  await assert.rejects(readChatStream(response('data: {"error":{"message":"quota"}}\n\n')), /llm_stream_error:quota/)
  await assert.rejects(readChatStream(response('data: [DONE]\n\n')), /llm_empty_choices/)
  await assert.rejects(readChatStream(response(chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }) + chunk({}, 'tool_calls'))), /incomplete_tool_call/)
})

async function withServer(
  handler: (body: Record<string, unknown>, res: ServerResponse) => void,
  run: (client: OpenAICompatibleClient) => Promise<void>,
) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => handler(JSON.parse(body), res))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    await run(new OpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'mimo-test', apiKey: '', timeoutMs: 1000 }))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test('interactive client receives updates before response completes; helper calls use JSON', async () => {
  let release: (() => void) | undefined
  await withServer((body, res) => {
    if (!body.stream) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'helper' }, finish_reason: 'stop' }] }))
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    release = () => res.end(chunk({ content: 'final' }, 'stop') + 'data: [DONE]\n\n')
    res.write(chunk({ reasoning_content: 'live reasoning' }))
  }, async client => {
    let observed = false
    const reply = await client.chat([{ role: 'user', content: 'hi' }], [], undefined, {
      onUpdate: update => {
        if (update.reasoningContent && !observed) { observed = true; release!() }
      },
    })
    assert.equal(observed, true)
    assert.equal(reply.content, 'final')
    assert.equal((await client.chat([], [])).content, 'helper')
  })
})

test('stream request tolerates a server returning complete JSON', async () => {
  await withServer((body, res) => {
    assert.equal(body.stream, true)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: 'answer', reasoning_content: 'thought' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }))
  }, async client => {
    const reply = await client.chat([], [], undefined, { onUpdate: () => {} })
    assert.equal(reply.content, 'answer')
    assert.equal(reply.reasoningContent, 'thought')
    assert.deepEqual(reply.usage, { inputTokens: 20, outputTokens: 4, totalTokens: 24 })
  })
})

test('cancel interrupts reading the response body', async () => {
  await withServer((_body, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(chunk({ reasoning_content: 'thinking' }))
  }, async client => {
    const ctrl = new AbortController()
    await assert.rejects(client.chat([], [], ctrl.signal, { onUpdate: () => ctrl.abort() }), /^Error: aborted$/)
  })
})

test('timeout remains active during a stalled stream', async () => {
  await withServer((_body, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(chunk({ reasoning_content: 'thinking' }))
  }, async client => {
    await assert.rejects(client.chat([], [], undefined, { onUpdate: () => {} }), /llm_timeout/)
  })
})
