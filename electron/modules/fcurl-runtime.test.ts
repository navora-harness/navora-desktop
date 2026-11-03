import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import net from 'node:net'
import { gzipSync, gunzipSync } from 'node:zlib'
import { FcurlRuntimeManager, parseFcurlHeaders } from './fcurl-runtime'
import type { PluginManifest } from '../../shared/plugins'

test('fcurl response parser selects final status and preserves repeated headers', () => {
  const p = parseFcurlHeaders('HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200 OK\r\nX-Test: one\r\nX-Test: two\r\n\r\n')
  assert.equal(p.status, 200); assert.equal(p.headers.length, 2)
  assert.throws(() => parseFcurlHeaders('no status'), /response_parse_failed/)
})

const dir = path.resolve('../navora-plugins/fastls/dist/fastls', `${process.platform}-${process.arch}`)
test('installed fcurl supports bounded requests, permission isolation, redirects, cancellation and private inputs', { skip: !fs.existsSync(path.join(dir, 'plugin.json')) }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-test-'))
  const manager = new FcurlRuntimeManager(temp)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as PluginManifest
  let requests = 0
  const server = http.createServer(async (req, res) => {
    requests++
    if (req.url === '/slow') { setTimeout(() => { if (!res.destroyed) res.end('late') }, 1000); return }
    if (req.url === '/big') { res.end(Buffer.alloc(9 * 1024 * 1024)); return }
    if (req.url === '/display') { res.end(Buffer.alloc(100 * 1024, 97)); return }
    if (req.url === '/encoded') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(gzipSync('encoded fixture')); return }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok' }); res.end('redirect'); return }
    const chunks: Buffer[] = []
    for await (const b of req) chunks.push(Buffer.from(b))
    res.writeHead(req.url === '/404' ? 404 : 200, { 'Content-Type': 'application/json', 'X-Repeat': ['one', 'two'] })
    res.end(JSON.stringify({ method: req.method, input: Buffer.concat(chunks).toString(), authorization: req.headers.authorization }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const scope = { pluginId: 'fastls', chatId: 'chat-a', dir, manifest, signal: new AbortController().signal,
    capabilities: ['network.request', 'compute.local'] as const, allowlist: () => [origin] }
  const call = async (args: Record<string, unknown>) => await manager.call(scope, 'request', args) as Record<string, any>
  try {
    assert.equal((await manager.call(scope, 'status', {}) as any).ok, true)
    assert.ok((await manager.call(scope, 'profiles', { limit: 3 }) as any).profiles.length === 3)
    const r = await call({ url: `${origin}/ok`, responseMode: 'json', headers: [{ name: 'Authorization', value: 'Bearer fixture' }] })
    assert.equal(r.ok, true); assert.equal(r.body.authorization, 'Bearer fixture')
    assert.equal(r.headers.filter((h: any) => h.name.toLowerCase() === 'x-repeat').length, 2)
    const posted = await call({ url: `${origin}/ok`, json: { chinese: '正文' }, responseMode: 'json' })
    assert.equal(posted.body.method, 'POST'); assert.deepEqual(JSON.parse(posted.body.input), { chinese: '正文' })
    const missing = await call({ url: `${origin}/404` }); assert.equal(missing.ok, true); assert.equal(missing.httpOk, false)
    const redirect = await call({ url: `${origin}/redirect` }); assert.equal(redirect.status, 302)
    const encoded = await call({ url: `${origin}/encoded` })
    assert.equal(encoded.bodyEncoding, 'base64'); assert.equal(gunzipSync(Buffer.from(encoded.body, 'base64')).toString(), 'encoded fixture')
    const display = await call({ url: `${origin}/display`, responseMode: 'base64' })
    assert.equal(display.truncated, true); assert.ok(display.body.length <= 64 * 1024)
    const proxy = http.createServer()
    const sockets = new Set<import('node:stream').Duplex>()
    proxy.on('connect', (_req, socket, head) => {
      const upstream = net.connect((server.address() as import('node:net').AddressInfo).port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head)
        socket.pipe(upstream); upstream.pipe(socket)
      })
      sockets.add(upstream); sockets.add(socket)
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
    })
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
    try {
      const proxied = await call({ url: `${origin}/ok`, proxy: `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`, responseMode: 'json' })
      assert.equal(proxied.ok, true); assert.equal(proxied.body.method, 'GET')
    } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => proxy.close(() => resolve())) }
    const before = requests
    assert.equal((await manager.call({ ...scope, capabilities: [] }, 'request', { url: `${origin}/ok` }) as any).ok, false)
    assert.equal((await manager.call({ ...scope, allowlist: () => ['https://example.com'] }, 'request', { url: `${origin}/ok` }) as any).error, 'url_not_allowed')
    assert.equal(requests, before)
    assert.equal((await call({ url: `${origin}/slow`, timeoutMs: 75 })).error, 'request_timeout')
    const controller = new AbortController()
    const cancelled = manager.call({ ...scope, signal: controller.signal }, 'request', { url: `${origin}/slow` })
    setTimeout(() => controller.abort(), 50)
    assert.equal((await cancelled as any).error, 'request_cancelled')
    let rules = [origin]
    const policyChange = manager.call({ ...scope, allowlist: () => rules }, 'request', { url: `${origin}/slow` })
    setTimeout(() => { rules = ['https://example.com'] }, 40)
    assert.equal((await policyChange as any).error, 'url_policy_changed')
    assert.equal((await call({ url: `${origin}/big` })).error, 'response_too_large')
    assert.equal(manager.isActive('fastls'), false)
    assert.deepEqual(fs.readdirSync(temp), [])
  } finally {
    manager.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
