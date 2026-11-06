import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { assertRuntimeFiles } from './plugin-package'
import { networkUrlAllowed } from '../../shared/network-url-policy'
import type { PluginManifest, PluginRuntimeReceipt } from '../../shared/plugins'
import type { PermissionCapability } from '../../shared/types'

export type FcurlScope = { pluginId: string; chatId: string; dir: string; manifest: PluginManifest;
  signal: AbortSignal; capabilities: readonly PermissionCapability[]; allowlist: () => string[];
  /** Host-generated identity, never accepted from plugin request input. */
  runId?: string; toolCallId?: string; isCurrent?: () => boolean;
  admission?: () => Record<string, unknown> | null; onReceipt?: (receipt: PluginRuntimeReceipt) => void }
type Scope = FcurlScope
type Owner = { pluginId?: string; chatId?: string }
type Invocation = { id: string; scope: Scope; deadline: number; state: 'queued' | 'running';
  reason?: string; stop?: (reason: string) => void; admit: (accepted: boolean) => void;
  done: Promise<void>; finish: () => void; processStarted: boolean; processClosed: boolean; attemptId?: string }
type PreparedRequest = { url: URL; method: string; body: Buffer; headerLines: string[];
  timeout: number; responseMode: string; extraArgs: string[] }
export type FcurlRuntimeOptions = { maxConcurrent?: number; maxPerChat?: number; maxQueued?: number; maxQueuedPerChat?: number }
type Capture = { code: number | null; signal: string | null; reason?: string; bytes: number; body: Buffer }
const INPUT_LIMIT = 1024 * 1024, OUTPUT_LIMIT = 8 * 1024 * 1024, DISPLAY_LIMIT = 64 * 1024
const known = new Set(['url', 'method', 'headers', 'query', 'bodyText', 'bodyBase64', 'json', 'form', 'profile', 'ja3', 'ja4r', 'proxy', 'timeoutMs', 'responseMode'])
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const failure = (error: string, extra: Record<string, unknown> = {}) => ({ ok: false, error, ...extra })
const codeErrors: Record<number, string> = { 1: 'unsupported_scheme', 2: 'invalid_request', 3: 'invalid_url', 5: 'proxy_dns_failed', 6: 'dns_failed', 7: 'connection_failed', 23: 'output_failed', 26: 'input_failed', 28: 'request_timeout', 35: 'tls_error', 47: 'redirect_limit', 56: 'receive_failed', 60: 'certificate_failed', 77: 'ca_failed', 130: 'request_cancelled' }

export function parseFcurlHeaders(raw: string): { status: number; httpVersion: string; headers: Array<{ name: string; value: string }> } {
  const blocks = raw.split(/\r?\n\r?\n/).map(x => x.trim()).filter(Boolean)
  let result: ReturnType<typeof parseFcurlHeaders> | undefined
  for (const block of blocks) {
    const [line, ...lines] = block.split(/\r?\n/)
    const match = /^HTTP\/(\d(?:\.\d)?) (\d{3})(?: |$)/.exec(line || '')
    if (!match) throw new Error('response_parse_failed')
    const status = Number(match[2])
    if (status < 100 || status > 599) throw new Error('response_parse_failed')
    const headers = lines.map(line => {
      const colon = line.indexOf(':')
      if (colon <= 0 || !token.test(line.slice(0, colon))) throw new Error('response_parse_failed')
      return { name: line.slice(0, colon), value: line.slice(colon + 1).trim() }
    })
    if (status >= 200) result = { status, httpVersion: match[1]!, headers }
  }
  if (!result) throw new Error('response_parse_failed')
  return result
}

export class FcurlRuntimeManager {
  // Reservations exist before verification, staging and spawn, so asynchronous
  // preparation cannot bypass the same limits enforced for live processes.
  private calls = new Map<string, Invocation>()
  private queue: Invocation[] = []
  private closed = false
  private disposing?: Promise<void>
  private cleanupFailures = new Map<string, { pluginId: string; chatId: string }>()
  private readonly limits: Required<FcurlRuntimeOptions>
  private readonly certificateEnv: NodeJS.ProcessEnv = {}
  private readonly trustSource: 'system' | 'environment_custom'
  private certificateEnvironmentValid = true
  constructor(private root: string, options: FcurlRuntimeOptions = {}) {
    this.limits = { maxConcurrent: options.maxConcurrent ?? 16, maxPerChat: options.maxPerChat ?? 4,
      maxQueued: options.maxQueued ?? 32, maxQueuedPerChat: options.maxQueuedPerChat ?? 8 }
    if (Object.values(this.limits).some(n => !Number.isInteger(n) || n < 1)) throw new Error('invalid_runtime_limits')
    this.trustSource = process.env.SSL_CERT_FILE || process.env.SSL_CERT_DIR ? 'environment_custom' : 'system'
    for (const name of ['SSL_CERT_FILE', 'SSL_CERT_DIR'] as const) {
      const value = process.env[name]
      if (!value) continue
      this.certificateEnv[name] = value
      // These are host startup settings, never plugin/model-selected paths.
      // Refuse invalid configuration explicitly instead of silently using a
      // different trust store or weakening certificate verification.
      for (const entry of name === 'SSL_CERT_DIR' ? value.split(path.delimiter) : [value]) {
        try {
          if (!path.isAbsolute(entry) || entry.includes('\0')) throw new Error('invalid_certificate_environment')
          const stat = fs.statSync(entry)
          if (name === 'SSL_CERT_FILE' ? !stat.isFile() : !stat.isDirectory()) throw new Error('invalid_certificate_environment')
        } catch { this.certificateEnvironmentValid = false }
      }
    }
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    for (const name of fs.readdirSync(root)) {
      if (!/^call-[a-zA-Z0-9]+$/.test(name)) continue
      const dir = path.join(root, name)
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')) as { pid: number; childPid?: number; processClosed?: boolean }
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) continue
        try { process.kill(owner.pid, 0); continue } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') continue }
        // A dead parent does not prove that its child has stopped. Legacy or
        // half-written ownership without close/child identity is retained.
        if (owner.processClosed !== true) {
          if (!Number.isInteger(owner.childPid) || Number(owner.childPid) <= 0) continue
          try { process.kill(owner.childPid!, 0); continue } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') continue }
        }
        fs.rmSync(dir, { recursive: true, force: true })
      } catch { /* Unknown directories are never deleted by inference. */ }
    }
  }
  private matches(call: Invocation, scope: Owner): boolean {
    return (!scope.pluginId || scope.pluginId === call.scope.pluginId) && (!scope.chatId || scope.chatId === call.scope.chatId)
  }
  isActive(pluginId: string): boolean { return [...this.calls.values()].some(x => x.scope.pluginId === pluginId) }
  cancel(scope: Owner = {}): void {
    for (const call of this.calls.values()) if (this.matches(call, scope)) this.stopCall(call, 'request_cancelled')
  }
  async drain(scope: Owner = {}): Promise<void> {
    await Promise.all([...this.calls.values()].filter(call => this.matches(call, scope)).map(call => call.done))
    // A transient Windows lock can outlast close. Retry known private staging
    // directories; never report a successful drain with an unremoved call dir.
    for (const [dir, owner] of [...this.cleanupFailures]) {
      if ((scope.pluginId && scope.pluginId !== owner.pluginId) || (scope.chatId && scope.chatId !== owner.chatId)) continue
      try { await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }); this.cleanupFailures.delete(dir) }
      catch { throw new Error('runtime_cleanup_failed') }
    }
  }
  cancelAndWait(scope: Owner = {}): Promise<void> { this.cancel(scope); return this.drain(scope) }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.closed = true
    const draining = this.cancelAndWait().catch(error => { this.disposing = undefined; throw error })
    return this.disposing = draining
  }
  private stopCall(call: Invocation, reason: string): void {
    call.reason ||= reason
    if (call.state === 'queued') {
      this.queue = this.queue.filter(x => x !== call)
      call.admit(false)
    } else call.stop?.(call.reason)
  }
  private pump(): void {
    if (this.closed) return
    const running = [...this.calls.values()].filter(x => x.state === 'running')
    let available = this.limits.maxConcurrent - running.length
    const perChat = new Map<string, number>()
    for (const call of running) perChat.set(call.scope.chatId, (perChat.get(call.scope.chatId) || 0) + 1)
    // Preserve arrival order within a chat while allowing another chat past a
    // blocked chat's head, rather than consuming an otherwise idle global slot.
    for (const call of [...this.queue]) {
      if (available <= 0) break
      if (call.reason) continue
      if (performance.now() >= call.deadline) { this.stopCall(call, 'request_timeout'); continue }
      const count = perChat.get(call.scope.chatId) || 0
      if (count >= this.limits.maxPerChat) continue
      this.queue = this.queue.filter(x => x !== call)
      call.state = 'running'; perChat.set(call.scope.chatId, count + 1); available--
      call.admit(true)
    }
  }

  async call(scope: Scope, method: string, input: Record<string, unknown>): Promise<unknown> {
    if (method !== 'status' && method !== 'profiles' && method !== 'request') return { ...failure('runtime_method_not_allowed'), trustSource: this.trustSource }
    const requestId = randomUUID(), startedAt = Date.now(), startedTick = performance.now()
    let invocation: Invocation | undefined
    const withReceipt = (result: Record<string, unknown>) => {
      const dispatched = invocation?.processStarted ?? false
      const error = typeof result.error === 'string' ? result.error : undefined
      const receipt: PluginRuntimeReceipt = { version: 1, requestId,
        ...(invocation?.attemptId ? { attemptId: invocation.attemptId } : {}),
        pluginId: scope.pluginId, chatId: scope.chatId,
        ...(scope.runId ? { runId: scope.runId } : {}), ...(scope.toolCallId ? { toolCallId: scope.toolCallId } : {}), method,
        state: result.ok === true ? 'completed' : error === 'request_cancelled' ? 'cancelled' : dispatched ? 'failed' : 'rejected',
        dispatched, startedAt, finishedAt: Date.now(),
        ...(typeof result.status === 'number' ? { httpStatus: result.status } : {}),
        ...(typeof result.bodyBytes === 'number' ? { bytes: result.bodyBytes } : {}), ...(error ? { error } : {}) }
      // Final host receipt is delivered only after process close and staging
      // cleanup. A plugin returning a forged JSON result cannot replace it.
      scope.onReceipt?.({ ...receipt })
      return { ...result, elapsedMs: performance.now() - startedTick, trustSource: this.trustSource, receipt }
    }
    if (this.closed) return withReceipt(failure('runtime_closed'))
    if (scope.signal.aborted) return withReceipt(failure('request_cancelled'))
    if (scope.isCurrent && !scope.isCurrent()) return withReceipt(failure('request_stale'))
    const cap: PermissionCapability = method === 'request' ? 'network.request' : 'compute.local'
    if (!scope.capabilities.includes(cap)) return withReceipt(failure(`plugin_capability_not_declared:${cap}`))
    const runtime = scope.manifest.runtime
    if (runtime?.kind !== 'executable-sidecar' || runtime.adapter !== 'fcurl-cli-v0.2') return withReceipt(failure('runtime_unavailable'))
    if (!this.certificateEnvironmentValid) return withReceipt(failure('certificate_environment_invalid'))
    let prepared: PreparedRequest | undefined
    try { if (method === 'request') prepared = this.prepareRequest(scope, input) }
    catch (e) { return withReceipt(this.safeFailure(e)) }
    const admission = method === 'request' ? scope.admission?.() : null
    if (admission) return withReceipt(admission)
    const filter = typeof input.filter === 'string' ? input.filter.toLowerCase() : ''
    const offset = Number.isInteger(input.offset) && Number(input.offset) >= 0 ? Number(input.offset) : 0
    const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(200, Number(input.limit))) : 50
    // Validation precedes queueing; its result is an immutable, bounded request
    // snapshot. No temp file or process is created for invalid/overflow input.
    const running = [...this.calls.values()].filter(x => x.state === 'running')
    const willQueue = running.length >= this.limits.maxConcurrent || running.filter(x => x.scope.chatId === scope.chatId).length >= this.limits.maxPerChat
    if (willQueue && (this.queue.length >= this.limits.maxQueued || this.queue.filter(x => x.scope.chatId === scope.chatId).length >= this.limits.maxQueuedPerChat)) return withReceipt(failure('resource_limit'))
    let admit!: (accepted: boolean) => void, finish!: () => void
    const admitted = new Promise<boolean>(resolve => { admit = resolve })
    const done = new Promise<void>(resolve => { finish = resolve })
    invocation = { id: requestId, scope, deadline: performance.now() + (prepared?.timeout ?? 10_000), state: 'queued', admit, done, finish,
      processStarted: false, processClosed: false }
    const call = invocation
    this.calls.set(call.id, call); this.queue.push(call)
    const abort = () => this.stopCall(call, 'request_cancelled')
    scope.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => this.stopCall(call, 'request_timeout'), Math.max(1, call.deadline - performance.now()))
    if (scope.signal.aborted) abort()
    this.pump()
    let dir: string | undefined, result: Record<string, unknown>
    try {
      if (!await admitted || call.reason) result = failure(call.reason || 'request_cancelled')
      else {
        const afterQueue = this.checkAdmission(call, method)
        if (afterQueue) result = afterQueue
        else {
          assertRuntimeFiles(scope.dir, scope.manifest)
          if (call.reason || performance.now() >= call.deadline) result = failure(call.reason || 'request_timeout')
          else {
            dir = fs.mkdtempSync(path.join(this.root, 'call-'))
            fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, requestId, processClosed: true }), { mode: 0o600, flag: 'wx' })
            const executable = path.join(scope.dir, runtime.executable)
            if (prepared) result = await this.request(call, executable, prepared, dir)
            else {
              const args = method === 'status' ? ['--version'] : ['--list-profiles']
              const r = await this.run(call, executable, args, Buffer.alloc(0), dir, 256 * 1024)
              if (r.reason || r.code !== 0) result = failure(r.reason || 'runtime_start_failed', { exitCode: r.code })
              else if (method === 'status') {
                const version = r.body.toString('utf8').trim()
                result = !version.startsWith(`fcurl ${runtime.binaryVersion} `) ? failure('runtime_version_mismatch') :
                  { ok: true, version, artifactId: scope.manifest.artifactId, capabilities: ['profiles', 'request', 'manual_redirect'],
                    trustSource: this.trustSource, trustConfiguration: this.trustSource === 'system' ? 'system_default' : 'host_environment',
                    processCleanup: 'direct_child_close', parentDeathCleanup: false }
              } else {
                const profiles = r.body.toString('utf8').trim().split(/\r?\n/).filter(x => x && x.toLowerCase().includes(filter))
                result = { ok: true, total: profiles.length, profiles: profiles.slice(offset, offset + limit), offset }
              }
            }
          }
        }
      }
    } catch (e) { result = this.safeFailure(e) }
    finally {
      scope.signal.removeEventListener('abort', abort)
      if (dir) {
        try { await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }) }
        catch { this.cleanupFailures.set(dir, { pluginId: scope.pluginId, chatId: scope.chatId }); result = failure('runtime_cleanup_failed') }
      }
      clearTimeout(timer)
      this.queue = this.queue.filter(x => x !== call); this.calls.delete(call.id)
      call.finish(); this.pump()
    }
    if (!call.reason && performance.now() >= call.deadline) call.reason = 'request_timeout'
    if (call.reason && result!.error !== 'runtime_cleanup_failed') result = failure(call.reason)
    if (!call.reason && !['request_cancelled', 'runtime_cleanup_failed'].includes(String(result!.error))
      && scope.isCurrent && !scope.isCurrent()) result = failure('request_stale')
    return withReceipt(result!)
  }
  private checkAdmission(call: Invocation, method: string): Record<string, unknown> | null {
    if (call.scope.signal.aborted || call.reason) return failure(call.reason || 'request_cancelled')
    if (call.scope.isCurrent && !call.scope.isCurrent()) return failure('request_stale')
    return method === 'request' ? call.scope.admission?.() || null : null
  }
  private safeFailure(error: unknown): Record<string, unknown> {
    // Never echo CLI diagnostics, paths, URLs or input values to the model.
    const msg = error instanceof Error ? error.message : ''
    return failure(/^[a-z_]+$/.test(msg) ? msg : 'runtime_validation_failed')
  }
  private prepareRequest(scope: Scope, input: Record<string, unknown>): PreparedRequest {
    if (Object.keys(input).some(k => !known.has(k))) throw new Error('unknown_request_field')
    if (typeof input.url !== 'string') throw new Error('invalid_url')
    const url = new URL(input.url)
    if (input.query !== undefined) {
      if (!Array.isArray(input.query)) throw new Error('invalid_query')
      for (const p of input.query) {
        if (!p || typeof p.name !== 'string' || typeof p.value !== 'string') throw new Error('invalid_query')
        url.searchParams.append(p.name, p.value)
      }
    }
    url.hash = ''
    if (!networkUrlAllowed(input.url, scope.allowlist()) || !networkUrlAllowed(url.href, scope.allowlist())) throw new Error('url_not_allowed')
    const modes = ['bodyText', 'bodyBase64', 'json', 'form'].filter(k => Object.hasOwn(input, k))
    if (modes.length > 1) throw new Error('conflicting_request_body')
    let body = Buffer.alloc(0), contentType: string | undefined
    if (modes[0] === 'json') { body = Buffer.from(JSON.stringify(input.json)); contentType = 'application/json' }
    else if (modes[0] === 'form') {
      if (!Array.isArray(input.form)) throw new Error('invalid_form')
      const data = new URLSearchParams()
      for (const item of input.form) {
        if (!item || typeof item.name !== 'string' || typeof item.value !== 'string') throw new Error('invalid_form')
        data.append(item.name, item.value)
      }
      body = Buffer.from(data.toString()); contentType = 'application/x-www-form-urlencoded'
    } else if (modes[0]) {
      const raw = input[modes[0]]
      if (typeof raw !== 'string') throw new Error('invalid_request_body')
      if (modes[0] === 'bodyBase64' && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))) throw new Error('invalid_base64')
      body = Buffer.from(raw, modes[0] === 'bodyBase64' ? 'base64' : 'utf8')
    }
    if (body.length > INPUT_LIMIT) throw new Error('request_too_large')
    const method = input.method ?? (modes.length ? 'POST' : 'GET')
    if (typeof method !== 'string' || !token.test(method) || method.length > 32) throw new Error('invalid_method')
    if (method.toUpperCase() === 'HEAD' && modes.length) throw new Error('head_body_not_allowed')
    const timeout = input.timeoutMs ?? 30_000
    if (!Number.isInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 120_000) throw new Error('invalid_timeout')
    const responseMode = input.responseMode ?? 'text'
    if (!['text', 'json', 'base64'].includes(String(responseMode))) throw new Error('invalid_response_mode')
    const headerLines: string[] = [], names = new Set<string>()
    if (input.headers !== undefined && !Array.isArray(input.headers)) throw new Error('invalid_headers')
    for (const h of (input.headers || []) as Array<{ name: string; value?: string; remove?: boolean }>) {
      if (!h || typeof h.name !== 'string' || !token.test(h.name) || (h.value !== undefined && typeof h.value !== 'string')
        || /[\x00-\x08\x0a-\x1f\x7f]/.test(h.value || '')) throw new Error('invalid_headers')
      const name = h.name.toLowerCase()
      if (['content-length', 'transfer-encoding', 'trailer', 'proxy-authorization', 'host'].includes(name)) throw new Error('reserved_header')
      names.add(name)
      headerLines.push(h.remove ? `${h.name}:` : h.value ? `${h.name}: ${h.value}` : `${h.name};`)
    }
    if (contentType && !names.has('content-type')) headerLines.push(`Content-Type: ${contentType}`)
    if (modes[0] === 'json' && !names.has('accept')) headerLines.push('Accept: application/json')
    if (!names.has('accept-encoding')) headerLines.push('Accept-Encoding: identity')
    if (Buffer.byteLength(headerLines.join('\n')) > 32 * 1024) throw new Error('headers_too_large')
    const extraArgs: string[] = []
    const fingerprints = ['profile', 'ja3', 'ja4r'].filter(k => input[k] !== undefined)
    if (fingerprints.length > 1) throw new Error('conflicting_fingerprint')
    for (const k of fingerprints) {
      if (typeof input[k] !== 'string' || !input[k] || String(input[k]).length > 64 * 1024 || /[\x00-\x1f]/.test(String(input[k]))) throw new Error('invalid_fingerprint')
      if (k === 'ja4r' && String(input[k]).startsWith('q')) throw new Error('unsupported_http3')
      extraArgs.push(`--${k}`, String(input[k]))
    }
    if (input.proxy !== undefined) {
      if (typeof input.proxy !== 'string') throw new Error('invalid_proxy')
      const proxy = new URL(input.proxy)
      if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname && proxy.pathname !== '/') throw new Error('invalid_proxy')
      extraArgs.push('--proxy', proxy.href)
    }
    if (modes.length) extraArgs.push('--data-binary', '@-')
    return { url, method: method.toUpperCase(), body, headerLines, timeout: Number(timeout), responseMode: String(responseMode), extraArgs }
  }

  private async request(call: Invocation, executable: string, prepared: PreparedRequest, dir: string): Promise<Record<string, unknown>> {
    const { url, method, body, headerLines, responseMode, extraArgs } = prepared
    const admission = this.checkAdmission(call, 'request')
    if (admission) return admission
    const remaining = call.deadline - performance.now()
    if (call.reason || remaining <= 0) return failure(call.reason || 'request_timeout')
    if (!networkUrlAllowed(url.href, call.scope.allowlist())) return failure('url_not_allowed')
    const headerFile = path.join(dir, 'headers-in.txt'), dump = path.join(dir, 'headers-out.txt')
    fs.writeFileSync(headerFile, `${headerLines.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
    const args = ['-sS', '--request', method, '--header', `@${headerFile}`, '--dump-header', dump,
      '--max-time', String(remaining / 1000), '--connect-timeout', String(Math.min(10, remaining / 1000)), ...extraArgs, '--', url.href]
    const dispatchAdmission = this.checkAdmission(call, 'request')
    if (dispatchAdmission) return dispatchAdmission
    const scope = call.scope
    const r = await this.run(call, executable, args, body, dir, OUTPUT_LIMIT, dump)
    if (r.reason || r.code !== 0) return failure(r.reason || codeErrors[r.code || -1] || 'cli_failed', { exitCode: r.code })
    if (!networkUrlAllowed(url.href, scope.allowlist())) return failure('url_not_allowed')
    const raw = fs.readFileSync(dump)
    if (raw.length > 64 * 1024) return failure('response_headers_too_large')
    const parsed = parseFcurlHeaders(raw.toString('latin1'))
    const encoded = parsed.headers.some(h => h.name.toLowerCase() === 'content-encoding' && h.value.toLowerCase() !== 'identity')
    const bodyEncoding = encoded || responseMode === 'base64' ? 'base64' : 'utf8'
    const display = bodyEncoding === 'base64' ? r.body.subarray(0, DISPLAY_LIMIT * 3 / 4) : r.body
    const truncated = r.bytes > display.length
    let output: unknown = bodyEncoding === 'base64' ? display.toString('base64') : new TextDecoder().decode(display, { stream: truncated })
    if (responseMode === 'json' && !encoded && !truncated) {
      try { output = JSON.parse(String(output)) } catch { return failure('invalid_response_json', { status: parsed.status }) }
    }
    return { ok: true, httpOk: parsed.status >= 200 && parsed.status < 300, ...parsed,
      headers: parsed.headers.map(h => /^(set-cookie|authorization|proxy-authorization)$/i.test(h.name) ? { ...h, value: '[redacted]' } : h),
      finalUrl: url.href, body: output, bodyEncoding, bodyBytes: r.bytes, truncated, exitCode: r.code }
  }

  private run(call: Invocation, executable: string, args: string[], input: Buffer, cwd: string, max: number, dump?: string): Promise<Capture> {
    if (call.reason || performance.now() >= call.deadline) return Promise.resolve({ code: null, signal: null, reason: call.reason || 'request_timeout', bytes: 0, body: Buffer.alloc(0) })
    let initialPolicy: string
    try { initialPolicy = JSON.stringify(call.scope.allowlist()) } catch { return Promise.resolve({ code: null, signal: null, reason: 'url_policy_changed', bytes: 0, body: Buffer.alloc(0) }) }
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {}
      // Fixed, validated host trust settings; no arbitrary process/plugin env.
      for (const k of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) if (process.env[k]) env[k] = process.env[k]
      Object.assign(env, this.certificateEnv)
      let child: ReturnType<typeof spawn>
      // Mark the spawn gap as unknown: a restart must never infer that a dead
      // parent means no child was started before its PID could be persisted.
      try { fs.writeFileSync(path.join(cwd, 'owner.json'), JSON.stringify({ pid: process.pid, requestId: call.id, processClosed: false }), { mode: 0o600 }) }
      catch { reject(new Error('runtime_ownership_failed')); return }
      try { child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) }
      catch { reject(new Error('runtime_start_failed')); return }
      let bytes = 0, kept = 0, errors = 0, reason: string | undefined, closed = false
      const chunks: Buffer[] = []
      let hardKill: ReturnType<typeof setTimeout> | undefined
      const stop = (why: string) => {
        if (closed) return
        reason ||= why
        child.kill()
        hardKill ||= setTimeout(() => { if (!closed) child.kill('SIGKILL') }, 2000)
      }
      call.stop = stop
      const watcher = setInterval(() => {
        if (!dump) return
        try { if (JSON.stringify(call.scope.allowlist()) !== initialPolicy) { stop('url_policy_changed'); return } }
        catch { stop('url_policy_changed'); return }
        try { if (fs.statSync(dump).size > 64 * 1024) stop('response_headers_too_large') } catch { /* not yet created */ }
      }, 25)
      child.on('spawn', () => {
        call.processStarted = true; call.attemptId = randomUUID()
        try { fs.writeFileSync(path.join(cwd, 'owner.json'), JSON.stringify({ pid: process.pid, requestId: call.id, childPid: child.pid, processClosed: false }), { mode: 0o600 }) }
        catch { stop('runtime_ownership_failed') }
        if (call.reason) stop(call.reason)
      })
      child.stdout?.on('data', (b: Buffer) => {
        bytes += b.length
        if (bytes > max) stop('response_too_large')
        const limit = dump ? DISPLAY_LIMIT : max
        if (kept < limit) { const chunk = b.subarray(0, limit - kept); chunks.push(chunk); kept += chunk.length }
      })
      child.stderr?.on('data', (b: Buffer) => { errors += b.length; if (errors > 32 * 1024) stop('diagnostic_limit') })
      child.stdin?.on('error', () => { /* Exit/error determines the outcome, not EPIPE. */ })
      child.on('error', () => { reason ||= 'runtime_start_failed' })
      child.on('close', (code, signal) => {
        closed = true; call.processClosed = true; call.stop = undefined
        try { fs.writeFileSync(path.join(cwd, 'owner.json'), JSON.stringify({ pid: process.pid, requestId: call.id, childPid: child.pid, processClosed: true }), { mode: 0o600 }) }
        catch { reason ||= 'runtime_ownership_failed' }
        clearInterval(watcher); if (hardKill) clearTimeout(hardKill)
        resolve({ code, signal, reason: call.reason || reason, bytes, body: Buffer.concat(chunks) })
      })
      if (call.reason) stop(call.reason)
      try { child.stdin?.end(input) } catch { stop('input_failed') }
    })
  }
}
