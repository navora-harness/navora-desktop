import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { assertRuntimeFiles } from './plugin-package'
import { networkUrlAllowed } from '../../shared/network-url-policy'
import type { PluginManifest } from '../../shared/plugins'
import type { PermissionCapability } from '../../shared/types'

type Scope = { pluginId: string; chatId: string; dir: string; manifest: PluginManifest;
  signal: AbortSignal; capabilities: readonly PermissionCapability[]; allowlist: () => string[] }
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
  private active = new Map<ChildProcess, { pluginId: string; chatId: string }>()
  private stoppers = new Map<ChildProcess, (reason: string) => void>()
  private closed = false
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    for (const name of fs.readdirSync(root)) {
      if (!/^call-[a-zA-Z0-9]+$/.test(name)) continue
      const dir = path.join(root, name)
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')) as { pid: number }
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) continue
        try { process.kill(owner.pid, 0); continue } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') continue }
        fs.rmSync(dir, { recursive: true, force: true })
      } catch { /* Unknown directories are never deleted by inference. */ }
    }
  }
  isActive(pluginId: string): boolean { return [...this.active.values()].some(x => x.pluginId === pluginId) }
  cancel(scope: { pluginId?: string; chatId?: string } = {}): void {
    for (const [child, owner] of this.active) {
      if ((!scope.pluginId || scope.pluginId === owner.pluginId) && (!scope.chatId || scope.chatId === owner.chatId)) this.stoppers.get(child)?.('request_cancelled')
    }
  }
  dispose(): void { this.closed = true; this.cancel() }

  async call(scope: Scope, method: string, input: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return failure('runtime_closed')
    if (scope.signal.aborted) return failure('request_cancelled')
    if (!['status', 'profiles', 'request'].includes(method)) return failure('runtime_method_not_allowed')
    const cap: PermissionCapability = method === 'request' ? 'network.request' : 'compute.local'
    if (!scope.capabilities.includes(cap)) return failure(`plugin_capability_not_declared:${cap}`)
    const runtime = scope.manifest.runtime
    if (runtime?.kind !== 'executable-sidecar' || runtime.adapter !== 'fcurl-cli-v0.2') return failure('runtime_unavailable')
    if (this.active.size >= 16 || [...this.active.values()].filter(x => x.chatId === scope.chatId).length >= 4) return failure('resource_limit')
    let dir: string | undefined
    try {
      assertRuntimeFiles(scope.dir, scope.manifest)
      dir = fs.mkdtempSync(path.join(this.root, 'call-'))
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' })
      const executable = path.join(scope.dir, runtime.executable)
      if (method !== 'request') {
        const args = method === 'status' ? ['--version'] : ['--list-profiles']
        const r = await this.run(scope, executable, args, Buffer.alloc(0), dir, 10_000, 256 * 1024)
        if (r.reason || r.code !== 0) return failure(r.reason || 'runtime_start_failed', { exitCode: r.code })
        if (method === 'status') {
          const version = r.body.toString('utf8').trim()
          if (!version.startsWith(`fcurl ${runtime.binaryVersion} `)) return failure('runtime_version_mismatch')
          return { ok: true, version, artifactId: scope.manifest.artifactId, capabilities: ['profiles', 'request', 'manual_redirect'] }
        }
        const filter = typeof input.filter === 'string' ? input.filter.toLowerCase() : ''
        const profiles = r.body.toString('utf8').trim().split(/\r?\n/).filter(x => x && x.toLowerCase().includes(filter))
        const offset = Number.isInteger(input.offset) && Number(input.offset) >= 0 ? Number(input.offset) : 0
        const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(200, Number(input.limit))) : 50
        return { ok: true, total: profiles.length, profiles: profiles.slice(offset, offset + limit), offset }
      }
      return await this.request(scope, executable, input, dir)
    } catch (e) {
      // Never echo CLI diagnostics, paths, URLs or input values to the model.
      const msg = e instanceof Error ? e.message : ''
      return failure(/^[a-z_]+$/.test(msg) ? msg : 'runtime_validation_failed')
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Retained for startup cleanup if temporarily locked. */ } }
    }
  }

  private async request(scope: Scope, executable: string, input: Record<string, unknown>, dir: string): Promise<unknown> {
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
    const headerFile = path.join(dir, 'headers-in.txt'), dump = path.join(dir, 'headers-out.txt')
    fs.writeFileSync(headerFile, `${headerLines.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
    const args = ['-sS', '--request', method.toUpperCase(), '--header', `@${headerFile}`, '--dump-header', dump,
      '--max-time', String(Number(timeout) / 1000), '--connect-timeout', String(Math.min(10, Number(timeout) / 1000))]
    const fingerprints = ['profile', 'ja3', 'ja4r'].filter(k => input[k] !== undefined)
    if (fingerprints.length > 1) throw new Error('conflicting_fingerprint')
    for (const k of fingerprints) {
      if (typeof input[k] !== 'string' || !input[k] || String(input[k]).length > 64 * 1024 || /[\x00-\x1f]/.test(String(input[k]))) throw new Error('invalid_fingerprint')
      if (k === 'ja4r' && String(input[k]).startsWith('q')) throw new Error('unsupported_http3')
      args.push(`--${k}`, String(input[k]))
    }
    if (input.proxy !== undefined) {
      if (typeof input.proxy !== 'string') throw new Error('invalid_proxy')
      const proxy = new URL(input.proxy)
      if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname && proxy.pathname !== '/') throw new Error('invalid_proxy')
      args.push('--proxy', proxy.href)
    }
    if (modes.length) args.push('--data-binary', '@-')
    args.push('--', url.href)
    const started = Date.now()
    const r = await this.run(scope, executable, args, body, dir, Number(timeout), OUTPUT_LIMIT, dump)
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
      finalUrl: url.href, body: output, bodyEncoding, bodyBytes: r.bytes, truncated, elapsedMs: Date.now() - started, exitCode: r.code }
  }

  private run(scope: Scope, executable: string, args: string[], input: Buffer, cwd: string, timeout: number, max: number, dump?: string): Promise<Capture> {
    return new Promise(resolve => {
      const env: NodeJS.ProcessEnv = {}
      for (const k of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[k]) env[k] = process.env[k]
      const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      this.active.set(child, { pluginId: scope.pluginId, chatId: scope.chatId })
      let bytes = 0, kept = 0, errors = 0, reason: string | undefined
      const chunks: Buffer[] = []
      let hardKill: ReturnType<typeof setTimeout> | undefined
      const stop = (why: string) => {
        reason ||= why
        child.kill()
        hardKill ||= setTimeout(() => child.kill('SIGKILL'), 2000)
      }
      this.stoppers.set(child, stop)
      const initialPolicy = JSON.stringify(scope.allowlist())
      const abort = () => stop('request_cancelled')
      scope.signal.addEventListener('abort', abort, { once: true })
      if (scope.signal.aborted) abort()
      const timer = setTimeout(() => stop('request_timeout'), timeout)
      const watcher = setInterval(() => {
        if (!dump) return
        if (JSON.stringify(scope.allowlist()) !== initialPolicy) { stop('url_policy_changed'); return }
        try { if (fs.statSync(dump).size > 64 * 1024) stop('response_headers_too_large') } catch { /* not yet created */ }
      }, 25)
      child.stdout!.on('data', (b: Buffer) => {
        bytes += b.length
        if (bytes > max) stop('response_too_large')
        const limit = dump ? DISPLAY_LIMIT : max
        if (kept < limit) { const chunk = b.subarray(0, limit - kept); chunks.push(chunk); kept += chunk.length }
      })
      child.stderr!.on('data', (b: Buffer) => { errors += b.length; if (errors > 32 * 1024) stop('diagnostic_limit') })
      child.stdin!.on('error', () => { /* Exit/error determines the outcome, not EPIPE. */ })
      child.on('error', () => { reason ||= 'runtime_start_failed' })
      child.on('close', (code, signal) => {
        clearTimeout(timer); clearInterval(watcher); if (hardKill) clearTimeout(hardKill)
        scope.signal.removeEventListener('abort', abort); this.active.delete(child); this.stoppers.delete(child)
        resolve({ code, signal, reason, bytes, body: Buffer.concat(chunks) })
      })
      child.stdin!.end(input)
    })
  }
}
