import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import {
  createWebToken,
  hashPassword,
  verifyPassword,
  verifyWebToken,
  WEB_TOKEN_TTL_MS,
} from '../../shared/crypto-util'
import type { AppConfig } from '../../shared/config'
import { isDefaultRemotePasswordHash } from '../../shared/config'
import { acceptWebSocket, type WsLiteSocket } from './ws-lite'
import { BridgeRemoteService } from './bridge-remote'
import type { BrowserRegistry } from './browser-registry'
import {
  broadcastRpcEvent,
  invokeForRemote,
  type NavoraRpcRegistry,
} from './remote-rpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type RemoteStatus = {
  enabled: boolean
  running: boolean
  host: string
  port: number
  url: string
  hasPassword: boolean
  /** True when password is still the shipped default — remote start is refused. */
  requiresPasswordChange: boolean
  username: string
  tokenTtlMs: number
}

/**
 * LAN remote: HTTP SPA + WS bridge for Agent window view/control.
 * Enabled via settings (default off).
 */
export class RemoteServer {
  private server: http.Server | null = null
  private startedPort = 0
  private wsClients = new Set<WsLiteSocket>()
  readonly bridge: BridgeRemoteService
  private rpc: NavoraRpcRegistry | null = null

  constructor(
    private getConfig: () => AppConfig,
    private registry: BrowserRegistry,
  ) {
    this.bridge = new BridgeRemoteService((windowId) => {
      const rec = this.registry.getWindowRecord(windowId)
      if (!rec || rec.win.isDestroyed()) return null
      return rec.win
    })
  }

  setRpcRegistry(rpc: NavoraRpcRegistry): void {
    this.rpc = rpc
  }

  /** Push an Electron-style event to all authenticated WS clients. */
  broadcast(event: string, payload: unknown): void {
    broadcastRpcEvent(this.wsClients, event, payload)
  }

  status(): RemoteStatus {
    const cfg = this.getConfig().remote
    const host = cfg.host || '127.0.0.1'
    const port = this.startedPort || cfg.port || 8790
    const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    return {
      enabled: !!cfg.enabled,
      running: !!this.server,
      host,
      port,
      url: `http://${displayHost}:${port}`,
      hasPassword: !!cfg.passwordHash,
      requiresPasswordChange: isDefaultRemotePasswordHash(cfg.passwordHash),
      username: cfg.username || 'admin',
      tokenTtlMs: WEB_TOKEN_TTL_MS,
    }
  }

  /** Issue a short-lived token for opening a remote tab from the desktop app. */
  issueToken(): { ok: boolean; token?: string; exp?: number; url?: string; error?: string } {
    const st = this.status()
    if (!st.enabled) return { ok: false, error: 'remote_disabled' }
    if (!st.running) return { ok: false, error: 'remote_not_running' }
    const cfg = this.getConfig().remote
    if (!cfg.passwordHash) return { ok: false, error: 'remote_no_password' }
    const issued = createWebToken(cfg.username || 'admin', cfg.passwordHash)
    return { ok: true, token: issued.token, exp: issued.exp, url: st.url }
  }

  openWindowUrl(windowId: string): { ok: boolean; url?: string; error?: string } {
    const issued = this.issueToken()
    if (!issued.ok || !issued.token || !issued.url) {
      return { ok: false, error: issued.error || 'token_failed' }
    }
    const id = encodeURIComponent(String(windowId || '').trim())
    if (!id) return { ok: false, error: 'window_id_required' }
    return {
      ok: true,
      url: `${issued.url}/#/remote/${id}?token=${encodeURIComponent(issued.token)}`,
    }
  }

  async syncFromConfig(): Promise<void> {
    const cfg = this.getConfig().remote
    const port = Number(cfg.port)
    if (cfg.enabled && !this.server) await this.start()
    else if (!cfg.enabled && this.server) await this.stop()
    else if (cfg.enabled && this.server && this.startedPort !== port) {
      await this.stop()
      await this.start()
    }
  }

  async start(): Promise<void> {
    if (this.server) return
    const cfg = this.getConfig().remote
    if (!cfg.passwordHash) {
      console.warn('[remote] enabled but no passwordHash; refuse to start')
      throw new Error('remote_no_password')
    }
    if (isDefaultRemotePasswordHash(cfg.passwordHash)) {
      console.warn('[remote] default password still in use; starting anyway (settings shows a warning)')
    }
    this.server = http.createServer((req, res) => {
      void this.handle(req, res)
    })
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname === '/ws') {
        this.handleUpgrade(req, socket, head)
        return
      }
      if (process.env.VITE_DEV_SERVER_URL) {
        this.proxyUpgradeToVite(req, socket, head)
        return
      }
      socket.destroy()
    })
    const port = Number(cfg.port)
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`invalid_remote_port:${String(cfg.port)}`)
    }
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, cfg.host || '127.0.0.1', () => resolve())
    })
    this.startedPort = port
    console.log(`[remote] listening http://${cfg.host || '127.0.0.1'}:${port}`)
  }

  async stop(): Promise<void> {
    for (const client of this.wsClients) {
      try {
        this.bridge.dropClient(client)
        client.close()
      } catch {
        /* ignore */
      }
    }
    this.wsClients.clear()
    if (!this.server) return
    const s = this.server
    this.server = null
    this.startedPort = 0
    await new Promise<void>((resolve) => s.close(() => resolve()))
    console.log('[remote] stopped')
  }

  /** Apply plaintext password from settings save patch. */
  applyPasswordFromPatch(patchRemote: Record<string, unknown> | undefined): void {
    if (!patchRemote) return
    const pwd = patchRemote.password
    if (typeof pwd === 'string' && pwd.trim()) {
      patchRemote.passwordHash = hashPassword(pwd.trim())
    }
    delete patchRemote.password
  }

  private getToken(req: http.IncomingMessage): string {
    const auth = req.headers.authorization || ''
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
    const cookie = req.headers.cookie || ''
    const m = cookie.match(/(?:^|;\s*)nv_token=([^;]+)/)
    if (m) return decodeURIComponent(m[1]!)
    try {
      const u = new URL(req.url || '/', 'http://localhost')
      const q = u.searchParams.get('token')
      if (q) return q
    } catch {
      /* ignore */
    }
    return ''
  }

  private authed(req: http.IncomingMessage): boolean {
    const remote = this.getConfig().remote
    return !!verifyWebToken(this.getToken(req), remote.username || 'admin', remote.passwordHash)
  }

  private cookieHeader(token: string, maxAgeSec: number): string {
    return `nv_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`
  }

  private json(res: http.ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    return Buffer.concat(chunks).toString('utf8')
  }

  private handleUpgrade(
    req: http.IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): void {
    if (!this.authed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const client = acceptWebSocket(req, socket, head)
    if (!client) return
    this.wsClients.add(client)
    client.onClose = () => {
      this.wsClients.delete(client)
      this.bridge.dropClient(client)
    }
    client.onMessage = (text) => {
      try {
        const msg = JSON.parse(text) as {
          type?: string
          id?: string
          channel?: string
          args?: unknown[]
          windowId?: string
          fps?: number
          action?: string
          nx?: number
          ny?: number
          deltaY?: number
          buttons?: number
        }
        if (msg.type === 'ping') {
          client.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
          return
        }
        if (msg.type === 'rpc.invoke') {
          void this.handleRpcInvoke(client, msg.id, msg.channel, msg.args)
          return
        }
        if (msg.type === 'bridge.subscribe') {
          this.bridge.subscribe(client, String(msg.windowId || ''), Number(msg.fps) || 8)
          return
        }
        if (msg.type === 'bridge.unsubscribe') {
          this.bridge.unsubscribe(client)
          return
        }
        if (msg.type === 'bridge.input') {
          void this.bridge
            .handleInput({
              windowId: String(msg.windowId || ''),
              action: (msg.action as 'down' | 'move' | 'up' | 'wheel') || 'move',
              nx: Number(msg.nx),
              ny: Number(msg.ny),
              deltaY: msg.deltaY,
              buttons: msg.buttons,
            })
            .then((result) => {
              client.send(JSON.stringify({ type: 'bridge.input_result', ...result }))
            })
            .catch((err) => {
              client.send(
                JSON.stringify({
                  type: 'bridge.input_result',
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                }),
              )
            })
          return
        }
        if (msg.type === 'bridge.status') {
          client.send(
            JSON.stringify({
              type: 'bridge.status',
              ...this.bridge.status(String(msg.windowId || '')),
            }),
          )
        }
      } catch {
        /* ignore bad json */
      }
    }
  }

  private async handleRpcInvoke(
    client: WsLiteSocket,
    id: unknown,
    channel: unknown,
    args: unknown,
  ): Promise<void> {
    const reqId = String(id || '')
    const ch = String(channel || '')
    const argList = Array.isArray(args) ? args : []
    if (!reqId || !ch) {
      client.send(
        JSON.stringify({
          type: 'rpc.result',
          id: reqId,
          ok: false,
          error: 'bad_rpc_request',
        }),
      )
      return
    }
    if (!this.rpc) {
      client.send(
        JSON.stringify({
          type: 'rpc.result',
          id: reqId,
          ok: false,
          error: 'rpc_unavailable',
        }),
      )
      return
    }
    try {
      const result = await invokeForRemote(this.rpc, ch, argList)
      client.send(JSON.stringify({ type: 'rpc.result', id: reqId, ok: true, result }))
    } catch (err) {
      client.send(
        JSON.stringify({
          type: 'rpc.result',
          id: reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname
    const method = (req.method || 'GET').toUpperCase()

    if (pathname === '/api/health') {
      return this.json(res, 200, { ok: true, app: 'navora-remote' })
    }

    if (pathname === '/api/login' && method === 'POST') {
      try {
        const raw = await this.readBody(req)
        const body = JSON.parse(raw || '{}') as { username?: string; password?: string }
        const remote = this.getConfig().remote
        if (
          body.username === remote.username &&
          remote.passwordHash &&
          verifyPassword(String(body.password || ''), remote.passwordHash)
        ) {
          const issued = createWebToken(remote.username, remote.passwordHash)
          const maxAge = Math.floor(WEB_TOKEN_TTL_MS / 1000)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': this.cookieHeader(issued.token, maxAge),
          })
          res.end(
            JSON.stringify({
              ok: true,
              token: issued.token,
              exp: issued.exp,
              ttlMs: WEB_TOKEN_TTL_MS,
            }),
          )
          return
        }
        return this.json(res, 401, { ok: false, error: 'invalid_credentials' })
      } catch {
        return this.json(res, 400, { ok: false, error: 'bad_request' })
      }
    }

    if (pathname === '/api/logout' && method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'nv_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (pathname === '/api/auth/me') {
      if (!this.authed(req)) return this.json(res, 401, { error: 'unauthorized' })
      const remote = this.getConfig().remote
      return this.json(res, 200, { ok: true, username: remote.username })
    }

    if (pathname === '/api/remote/status') {
      return this.json(res, 200, this.status())
    }

    if (pathname === '/api/windows') {
      if (!this.authed(req)) return this.json(res, 401, { error: 'unauthorized' })
      return this.json(res, 200, { ok: true, windows: this.registry.listWindowSummaries() })
    }

    if (pathname.startsWith('/api/')) {
      return this.json(res, 404, { error: 'not_found' })
    }

    await this.serveStatic(req, pathname, res)
  }

  private resolveWebDist(): string | null {
    const candidates = [
      path.join(__dirname, '..', 'dist'),
      path.join(app.getAppPath(), 'dist'),
      path.resolve(process.cwd(), 'dist'),
    ]
    for (const dir of candidates) {
      try {
        if (fs.existsSync(path.join(dir, 'index.html'))) return dir
      } catch {
        /* ignore */
      }
    }
    return null
  }

  private async serveStatic(
    req: http.IncomingMessage,
    pathname: string,
    res: http.ServerResponse,
  ): Promise<void> {
    const devUrl = process.env.VITE_DEV_SERVER_URL?.trim()
    if (devUrl) {
      await this.proxyToVite(req, res, devUrl)
      return
    }
    const dist = this.resolveWebDist()
    if (!dist) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"/><title>Navora Remote</title>
         <p>未找到前端资源（dist/index.html）。请先执行构建。</p>`,
      )
      return
    }
    const safeName = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    let filePath = path.normalize(path.join(dist, safeName))
    const rel = path.relative(dist, filePath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403).end()
      return
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dist, 'index.html')
    }
    const ext = path.extname(filePath)
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  }

  private proxyUpgradeToVite(
    req: http.IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): void {
    const devUrl = process.env.VITE_DEV_SERVER_URL?.trim()
    if (!devUrl) {
      socket.destroy()
      return
    }
    let target: URL
    try {
      target = new URL(req.url || '/', devUrl)
    } catch {
      socket.destroy()
      return
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host }
    const upstream = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: 'GET',
      headers,
    })
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          Object.entries(upRes.headers)
            .map(([k, v]) => {
              if (v == null) return ''
              return Array.isArray(v) ? v.map((x) => `${k}: ${x}`).join('\r\n') : `${k}: ${v}`
            })
            .filter(Boolean)
            .join('\r\n') +
          '\r\n\r\n',
      )
      if (upHead?.length) socket.write(upHead)
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  private proxyToVite(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    devUrl: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let target: URL
      try {
        target = new URL(req.url || '/', devUrl)
      } catch {
        res.writeHead(502).end()
        resolve()
        return
      }
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host }
      const upstream = http.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 80,
          path: target.pathname + target.search,
          method: req.method,
          headers,
        },
        (upRes) => {
          res.writeHead(upRes.statusCode || 502, upRes.headers)
          upRes.pipe(res)
          upRes.on('end', () => resolve())
        },
      )
      upstream.on('error', () => {
        res.writeHead(502).end('vite proxy error')
        resolve()
      })
      req.pipe(upstream)
    })
  }
}
