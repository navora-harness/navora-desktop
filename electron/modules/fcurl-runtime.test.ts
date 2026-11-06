import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once, EventEmitter } from 'node:events'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { gzipSync, gunzipSync } from 'node:zlib'
import { FcurlRuntimeManager, parseFcurlHeaders, type FcurlScope, type FcurlRuntimeOptions } from './fcurl-runtime'
import type { PluginManifest, PluginRuntimeReceipt } from '../../shared/plugins'
import { writeRuntimeInventory } from './plugin-package'

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
    await manager.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})


const syntheticManifest = { id: 'fastls', name: 'fixture', version: '0.1.0', description: '',
  runtime: { kind: 'executable-sidecar', adapter: 'fcurl-cli-v0.2', executable: 'bin/fcurl.exe', binaryVersion: '0.2.0' } } as PluginManifest
const syntheticScope = (temp: string): FcurlScope => ({ pluginId: 'fastls', chatId: 'chat-a', dir: temp,
  manifest: syntheticManifest, signal: new AbortController().signal, capabilities: ['network.request', 'compute.local'], allowlist: () => [] })

test('reservations cover preparation, queued invalid input consumes no slot, and dispose closes admission synchronously', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-reservations-'))
  const manager = new FcurlRuntimeManager(temp, { maxConcurrent: 1, maxPerChat: 1, maxQueued: 1, maxQueuedPerChat: 1 })
  const scope = syntheticScope(temp), receipts: PluginRuntimeReceipt[] = []
  const withReceipt = { ...scope, onReceipt: (r: PluginRuntimeReceipt) => { assert.deepEqual(fs.readdirSync(temp), []); receipts.push(r) } }
  try {
    const preparing = manager.call(withReceipt, 'request', { url: 'http://127.0.0.1/first' })
    assert.equal(manager.isActive('fastls'), true)
    const queued = manager.call(withReceipt, 'request', { url: 'http://127.0.0.1/queued' })
    const invalid = manager.call(scope, 'request', { url: 'http://127.0.0.1/', method: 'HEAD', bodyText: 'no' })
    // No await between reservation and close: even preparation must be cancelled
    // without writing files or reaching assertRuntimeFiles/spawn.
    const stopping = manager.dispose()
    assert.equal((await invalid as any).error, 'head_body_not_allowed')
    assert.strictEqual(manager.dispose(), stopping)
    const closed = await manager.call(scope, 'status', {}) as any
    assert.equal(closed.error, 'runtime_closed'); assert.equal(closed.receipt.dispatched, false)
    assert.equal((await preparing as any).error, 'request_cancelled')
    assert.equal((await queued as any).error, 'request_cancelled')
    await stopping
    assert.equal(manager.isActive('fastls'), false)
    assert.equal(receipts.length, 2)
    assert.ok(receipts.every(r => !r.dispatched && !r.attemptId && r.state === 'cancelled'))
    assert.notEqual(receipts[0]!.requestId, receipts[1]!.requestId)
  } finally { await manager.dispose(); fs.rmSync(temp, { recursive: true, force: true }) }
})

test('invalid host certificate environment is diagnosed without changing TLS trust or exposing paths', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-trust-'))
  const previous = process.env.SSL_CERT_FILE
  process.env.SSL_CERT_FILE = path.join(temp, 'private-missing-root.pem')
  const manager = new FcurlRuntimeManager(temp)
  if (previous === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = previous
  try {
    const result = await manager.call(syntheticScope(temp), 'status', {}) as any
    assert.equal(result.error, 'certificate_environment_invalid')
    assert.equal(result.trustSource, 'environment_custom')
    assert.equal(result.receipt.dispatched, false)
    assert.ok(!JSON.stringify(result).includes('private-missing-root'))
    assert.deepEqual(fs.readdirSync(temp), [])
  } finally { await manager.dispose(); fs.rmSync(temp, { recursive: true, force: true }) }
})

async function runtimeFixture(t: import('node:test').TestContext, options: FcurlRuntimeOptions = {}) {
  if (!fs.existsSync(path.join(dir, 'plugin.json'))) { t.skip('local platform fcurl artifact unavailable'); return }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-lifecycle-'))
  const events = new EventEmitter(), seen: string[] = [], held = new Map<string, http.ServerResponse>()
  const server = http.createServer((req, res) => {
    const route = req.url || '/'
    seen.push(route)
    if (route.startsWith('/hold')) held.set(route, res)
    else if (route.startsWith('/delay')) setTimeout(() => { if (!res.destroyed) res.end('delayed') }, 500)
    else res.end('complete')
    events.emit(route)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as PluginManifest
  const manager = new FcurlRuntimeManager(temp, options)
  const scope: FcurlScope = { ...syntheticScope(temp), dir, manifest, allowlist: () => [origin] }
  const requested = async (route: string) => {
    if (seen.includes(route)) return
    await Promise.race([once(events, route), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`fixture request missing: ${route}`)), 5000); timer.unref() })])
  }
  t.after(async () => { await manager.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(temp, { recursive: true, force: true }) })
  return { temp, manager, origin, scope, seen, held, requested }
}

test('bounded scheduler enforces per-chat and global limits, lets other chats progress, and scoped cancellation awaits cleanup', async t => {
  const f = await runtimeFixture(t, { maxConcurrent: 2, maxPerChat: 1, maxQueued: 2, maxQueuedPerChat: 1 }); if (!f) return
  const { manager, scope, origin, requested, held, temp } = f
  const first = manager.call(scope, 'request', { url: `${origin}/hold-a` })
  await requested('/hold-a')
  const queued = manager.call(scope, 'request', { url: `${origin}/queued-a` })
  const overflow = await manager.call(scope, 'request', { url: `${origin}/overflow-a` }) as any
  assert.equal(overflow.error, 'resource_limit'); assert.equal(overflow.receipt.dispatched, false)
  assert.equal(fs.readdirSync(temp).length, 1)
  const second = manager.call({ ...scope, chatId: 'chat-b' }, 'request', { url: `${origin}/hold-b` })
  await requested('/hold-b')
  const queuedOther = manager.call({ ...scope, chatId: 'chat-c' }, 'request', { url: `${origin}/queued-c` })
  const globalOverflow = await manager.call({ ...scope, chatId: 'chat-d' }, 'request', { url: `${origin}/overflow-d` }) as any
  assert.equal(globalOverflow.error, 'resource_limit')
  await manager.cancelAndWait({ chatId: 'chat-a' })
  assert.equal((await first as any).error, 'request_cancelled')
  assert.equal((await queued as any).receipt.dispatched, false)
  // The freed global reservation can now serve C while B remains live.
  assert.equal((await queuedOther as any).ok, true)
  assert.equal(manager.isActive('fastls'), true)
  assert.equal(fs.readdirSync(temp).length, 1)
  held.get('/hold-b')!.end('second')
  assert.equal((await second as any).ok, true)
  await manager.drain()
  assert.equal(manager.isActive('fastls'), false); assert.deepEqual(fs.readdirSync(temp), [])
  assert.ok(!f.seen.includes('/queued-a') && !f.seen.includes('/overflow-a') && !f.seen.includes('/overflow-d'))
})

test('queue timeout and aborted queued calls never create a process, while closing cancels the live process before resolving', async t => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 }); if (!f) return
  const { manager, scope, origin, requested, seen, temp } = f
  const running = manager.call(scope, 'request', { url: `${origin}/hold-running` })
  await requested('/hold-running')
  const timed = await manager.call(scope, 'request', { url: `${origin}/must-not-dispatch`, timeoutMs: 80 }) as any
  assert.equal(timed.error, 'request_timeout'); assert.equal(timed.receipt.dispatched, false); assert.equal(timed.receipt.attemptId, undefined)
  const controller = new AbortController()
  const queued = manager.call({ ...scope, signal: controller.signal }, 'request', { url: `${origin}/aborted-queue` })
  controller.abort()
  assert.equal((await queued as any).error, 'request_cancelled')
  const closing = manager.dispose()
  assert.equal((await manager.call(scope, 'profiles', {}) as any).error, 'runtime_closed')
  await closing
  const cancelled = await running as any
  assert.equal(cancelled.error, 'request_cancelled'); assert.equal(cancelled.receipt.dispatched, true)
  assert.equal(typeof cancelled.receipt.attemptId, 'string')
  assert.deepEqual(seen, ['/hold-running']); assert.deepEqual(fs.readdirSync(temp), [])
})

test('one logical budget includes queue waiting and only the remaining budget is dispatched', async t => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 }); if (!f) return
  const { manager, scope, origin, requested, held } = f
  const first = manager.call(scope, 'request', { url: `${origin}/hold-budget` }); await requested('/hold-budget')
  const started = Date.now()
  const second = manager.call(scope, 'request', { url: `${origin}/delay-budget`, timeoutMs: 350 })
  await new Promise(resolve => setTimeout(resolve, 180))
  held.get('/hold-budget')!.end('free')
  await first; await requested('/delay-budget')
  const result = await second as any
  assert.equal(result.error, 'request_timeout'); assert.equal(result.receipt.dispatched, true)
  assert.ok(Date.now() - started < 600, 'queue wait must consume the same budget rather than restart it')
})

test('host admission and current-run identity are rechecked after queueing; receipts cannot contain URL or credentials', async t => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 }); if (!f) return
  const { manager, scope, origin, requested, held, seen } = f
  const blocker = { ok: false, error: 'page_blocker_scope_required', nextAction: 'handoff' }
  const immediate = await manager.call({ ...scope, admission: () => blocker }, 'request', { url: `${origin}/blocked?token=secret` }) as any
  assert.equal(immediate.error, 'page_blocker_scope_required'); assert.equal(immediate.receipt.dispatched, false)
  const first = manager.call(scope, 'request', { url: `${origin}/hold-admission` }); await requested('/hold-admission')
  let blocked = false, current = true
  const receipts: PluginRuntimeReceipt[] = []
  const queued = manager.call({ ...scope, runId: 'run-fixture', toolCallId: 'tool-fixture', admission: () => blocked ? blocker : null, onReceipt: r => receipts.push(r) }, 'request',
    { url: `${origin}/blocked-later?token=secret`, headers: [{ name: 'Authorization', value: 'Bearer private' }] })
  const stale = manager.call({ ...scope, isCurrent: () => current }, 'request', { url: `${origin}/stale-later` })
  blocked = true; current = false; held.get('/hold-admission')!.end('released'); await first
  const rejected = await queued as any
  assert.equal(rejected.error, 'page_blocker_scope_required'); assert.equal(rejected.receipt.dispatched, false)
  assert.equal((await stale as any).error, 'request_stale')
  assert.equal(receipts.length, 1); assert.equal(receipts[0]!.runId, 'run-fixture'); assert.equal(receipts[0]!.toolCallId, 'tool-fixture')
  assert.ok(!JSON.stringify(receipts).includes('token') && !JSON.stringify(receipts).includes('Bearer') && !JSON.stringify(receipts).includes(origin))
  assert.deepEqual(seen, ['/hold-admission'])
  // Local status is intentionally independent from a web-resource admission gate.
  assert.equal((await manager.call({ ...scope, admission: () => blocker }, 'status', {}) as any).ok, true)
})

test('each runtime call gets distinct host identities and stale/old abort callbacks cannot affect a later invocation', async t => {
  const f = await runtimeFixture(t); if (!f) return
  const { manager, scope, origin, requested, held, temp } = f
  const receipts: PluginRuntimeReceipt[] = [], controller = new AbortController()
  const owned = { ...scope, runId: 'run-one', toolCallId: 'tool-many', onReceipt: (r: PluginRuntimeReceipt) => { assert.deepEqual(fs.readdirSync(temp), []); receipts.push(r) } }
  const first = manager.call({ ...owned, signal: controller.signal }, 'request', { url: `${origin}/hold-old` }); await requested('/hold-old')
  controller.abort(); assert.equal((await first as any).error, 'request_cancelled')
  const second = await manager.call(owned, 'request', { url: `${origin}/ok` }) as any
  assert.equal(second.ok, true); assert.notEqual(receipts[0]!.requestId, receipts[1]!.requestId); assert.notEqual(receipts[0]!.attemptId, receipts[1]!.attemptId)
  assert.equal(receipts[1]!.state, 'completed'); assert.equal(receipts[1]!.httpStatus, 200)
  let current = true
  const late = manager.call({ ...scope, isCurrent: () => current }, 'request', { url: `${origin}/hold-stale` }); await requested('/hold-stale')
  current = false; held.get('/hold-stale')!.end('old-run-output')
  const stale = await late as any
  assert.equal(stale.error, 'request_stale'); assert.equal(stale.receipt.dispatched, true)
  assert.equal(stale.body, undefined)
})


test('unlaunchable verified Windows artifact releases its reservation and staging before another request', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(dir, 'plugin.json')) }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-start-failure-'))
  const packageDir = path.join(temp, 'fixture-package'), runtimeDir = path.join(temp, 'runtime')
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as PluginManifest
  const executable = path.join(packageDir, manifest.runtime!.kind === 'executable-sidecar' ? manifest.runtime!.executable : '')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'plugin.json'), JSON.stringify(manifest))
  // Intact inventory and matching PE architecture, but no valid image to load.
  // This exercises the actual OS spawn failure, rather than faking a process.
  const invalidImage = Buffer.alloc(512)
  invalidImage.write('MZ'); invalidImage.writeUInt32LE(128, 60); invalidImage.writeUInt32LE(0x4550, 128); invalidImage.writeUInt16LE(0x8664, 132)
  fs.writeFileSync(executable, invalidImage); writeRuntimeInventory(packageDir)
  const manager = new FcurlRuntimeManager(runtimeDir, { maxConcurrent: 1, maxPerChat: 1 })
  const scope = { ...syntheticScope(temp), dir: packageDir, manifest }
  try {
    const failed = await manager.call(scope, 'status', {}) as any
    assert.equal(failed.error, 'runtime_start_failed'); assert.equal(failed.receipt.dispatched, false); assert.equal(failed.receipt.attemptId, undefined)
    assert.equal(manager.isActive('fastls'), false); assert.deepEqual(fs.readdirSync(runtimeDir), [])
    const good = await manager.call({ ...scope, dir }, 'status', {}) as any
    assert.equal(good.ok, true); assert.equal(good.receipt.dispatched, true)
    await manager.drain(); assert.deepEqual(fs.readdirSync(runtimeDir), [])
  } finally { await manager.dispose(); fs.rmSync(temp, { recursive: true, force: true }) }
})


test('a failed cleanup keeps admission closed and a later dispose retries after the lock is released', async t => {
  const f = await runtimeFixture(t); if (!f) return
  const { manager, scope, temp } = f
  let locked = true
  const original = fs.promises.rm
  t.mock.method(fs.promises, 'rm', async (target: fs.PathLike, options: fs.RmOptions) => {
    if (locked && String(target).startsWith(path.join(temp, 'call-'))) throw Object.assign(new Error('fixture sharing violation'), { code: 'EPERM' })
    return original(target, options)
  })
  const result = await manager.call(scope, 'status', {}) as any
  assert.equal(result.error, 'runtime_cleanup_failed'); assert.equal(result.receipt.dispatched, true)
  assert.equal(fs.readdirSync(temp).length, 1)
  // A different owner must not be blocked by this invocation's retained files.
  await manager.drain({ pluginId: 'another-plugin' })
  await manager.drain({ chatId: 'another-chat' })
  const firstClosing = manager.dispose()
  await assert.rejects(firstClosing, /runtime_cleanup_failed/)
  assert.equal((await manager.call(scope, 'status', {}) as any).error, 'runtime_closed')
  locked = false
  const retry = manager.dispose()
  assert.notStrictEqual(retry, firstClosing)
  await retry
  assert.deepEqual(fs.readdirSync(temp), [])
})

test('queue budgets and reported elapsed time use a monotonic clock across wall-clock adjustments', async t => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 }); if (!f) return
  const { manager, scope, origin, requested } = f
  const running = manager.call(scope, 'request', { url: `${origin}/hold-clock` }); await requested('/hold-clock')
  let wall = Date.now()
  t.mock.method(Date, 'now', () => wall)
  const queued = manager.call(scope, 'request', { url: `${origin}/never-clock`, timeoutMs: 100 })
  // A backwards system-clock correction must not extend/shorten the deadline.
  wall -= 24 * 60 * 60 * 1000
  const result = await queued as any
  assert.equal(result.error, 'request_timeout'); assert.equal(result.receipt.dispatched, false)
  assert.ok(result.elapsedMs >= 70 && result.elapsedMs < 1000)
  assert.ok(result.receipt.finishedAt < result.receipt.startedAt)
  await manager.cancelAndWait(); assert.equal((await running as any).error, 'request_cancelled')
})


test('startup cleanup retains a possible live orphan and unknown legacy ownership after the parent has exited', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-fcurl-restart-owner-'))
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true })
  assert.equal(child.status, 0); assert.ok(child.pid > 0)
  const owner = (name: string, metadata: Record<string, unknown>) => {
    const callDir = path.join(temp, `call-${name}`); fs.mkdirSync(callDir)
    fs.writeFileSync(path.join(callDir, 'owner.json'), JSON.stringify({ pid: child.pid, ...metadata }))
  }
  owner('Orphan', { childPid: process.pid, processClosed: false })
  owner('Unknown', { processClosed: false })
  owner('Legacy', {})
  owner('Closed', { processClosed: true })
  owner('DeadChild', { childPid: child.pid, processClosed: false })
  const manager = new FcurlRuntimeManager(temp)
  try { assert.deepEqual(fs.readdirSync(temp).sort(), ['call-Legacy', 'call-Orphan', 'call-Unknown']) }
  finally { await manager.dispose(); fs.rmSync(temp, { recursive: true, force: true }) }
})


test('an aborted Agent scope keeps cancellation rather than being overwritten by stale-run classification', async t => {
  const f = await runtimeFixture(t); if (!f) return
  const controller = new AbortController()
  const scope = { ...f.scope, signal: controller.signal, isCurrent: () => !controller.signal.aborted }
  const running = f.manager.call(scope, 'request', { url: `${f.origin}/hold-cancel-current` })
  await f.requested('/hold-cancel-current')
  controller.abort()
  const result = await running as any
  assert.equal(result.error, 'request_cancelled'); assert.equal(result.receipt.state, 'cancelled'); assert.equal(result.receipt.dispatched, true)
  await f.manager.drain(); assert.deepEqual(fs.readdirSync(f.temp), [])
})

test('a staging cleanup failure remains visible when the host run becomes stale during cleanup', async t => {
  const f = await runtimeFixture(t); if (!f) return
  let current = true, failOnce = true
  const original = fs.promises.rm
  t.mock.method(fs.promises, 'rm', async (target: fs.PathLike, options: fs.RmOptions) => {
    if (failOnce && String(target).startsWith(path.join(f.temp, 'call-'))) {
      failOnce = false; current = false
      throw Object.assign(new Error('fixture cleanup failure'), { code: 'EPERM' })
    }
    return original(target, options)
  })
  const result = await f.manager.call({ ...f.scope, isCurrent: () => current }, 'status', {}) as any
  assert.equal(result.error, 'runtime_cleanup_failed'); assert.equal(result.receipt.state, 'failed')
  await f.manager.drain(); assert.deepEqual(fs.readdirSync(f.temp), [])
})
