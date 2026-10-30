import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { OpenAICompatibleClient } from './openai-compatible'

test('request carries configured token parameter, mapped reasoning value and image content; abort releases pending fetch', async () => {
  const bodies: any[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    bodies.push(body)
    if (body.messages[0].content === 'wait') return
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '2' }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const client = new OpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: '', model: 'qwen38-turbo-q6', timeoutMs: 10000, maxOutputTokens: 81920, contextWindow: 524288, reasoningEffort: 'xhigh', supportsImages: true, outputTokenParam: 'max_tokens' })
  try {
    const reply = await client.chat([{ role: 'user', content: [{ type: 'text', text: '1+1?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] }], [])
    assert.equal(reply.content, '2')
    assert.equal(bodies[0].max_tokens, 81920)
    assert.equal(bodies[0].reasoning_effort, 'xhigh')
    assert.equal(bodies[0].messages[0].content[1].type, 'image_url')
    const ctrl = new AbortController()
    const pending = client.chat([{ role: 'user', content: 'wait' }], [], ctrl.signal)
    setTimeout(() => ctrl.abort(), 40)
    await assert.rejects(pending, /aborted/)
    const alternate = new OpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: '', model: 'custom', timeoutMs: 10000, outputTokenParam: 'max_completion_tokens', maxOutputTokens: 2000 })
    await alternate.chat([{ role: 'user', content: '2?' }], [], undefined, { maxTokens: 100 })
    assert.equal(bodies.at(-1).max_completion_tokens, 100)
    assert.equal(bodies.at(-1).max_tokens, undefined)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
