/**
 * Stream downloads into workspace via Electron Session.fetch (Chromium network).
 *
 * CDN anti-leech notes (verified with curl / browser capture):
 * - Many CDNs 403 when Referer is missing or wrong (must be the product/page site that
 *   linked the file — not the CDN file URL itself).
 * - Origin is usually NOT required for top-level navigation downloads; sending Origin
 *   can itself cause 403 on some CDNs (CORS-like check). Prefer omit Origin.
 * - UA / Accept / Sec-Fetch-* help look like a browser, but Referer is often the gate.
 *
 * Working browser-style request shape (navigation download, no Origin):
 *   Accept / Accept-Encoding / Accept-Language
 *   Cache-Control / Pragma: no-cache (optional)
 *   Referer: <page that offered the download>     ← critical for anti-leech
 *   Sec-Fetch-Dest: document
 *   Sec-Fetch-Mode: navigate
 *   Sec-Fetch-Site: cross-site | same-site | …   ← derived from Referer
 *   Sec-Fetch-User: ?1
 *   Upgrade-Insecure-Requests: 1
 *   User-Agent (+ optional sec-ch-ua*)
 *
 * Callers should pass page referer or bind windowId/sessionId on the download page;
 * bare file_download(url) with no Referer → sec-fetch-site:none → often http_403.
 */

import { net, type Session } from 'electron'
import fsp from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AppConfig } from '../../shared/config'
import { resolveUserAgent } from '../../shared/config'
import { isUrlAllowed } from '../../shared/url-allowlist'
import type { WorkspaceFiles } from './workspace-files'

export type DownloadPart = {
  url: string
  headers?: Record<string, string>
  method?: string
  /** Request body (utf-8 text, or base64 when bodyEncoding=base64) */
  body?: string
  bodyEncoding?: 'utf8' | 'base64'
  /** e.g. bytes=0-1048575 */
  range?: string
}

export type DownloadProgress = {
  partIndex: number
  partsTotal: number
  url: string
  /** Bytes received for the current part */
  bytesPart: number
  /** Bytes written across all parts so far */
  bytesTotal: number
  /**
   * Expected size of the current part when the server provides Content-Length
   * or Content-Range total.
   */
  contentLength?: number
}

/**
 * Stream HTTP(S) downloads into workspace files using the Session's Chromium
 * network stack (ses.fetch / net.fetch) — same cookies, proxy, and UA path as
 * browser_session_fetch.
 */
export class FileDownloadService {
  private files: WorkspaceFiles
  private getConfig: () => AppConfig

  constructor(files: WorkspaceFiles, getConfig: () => AppConfig) {
    this.files = files
    this.getConfig = getConfig
  }

  async download(
    chatId: string,
    opts: {
      url: string
      dest: string
      headers?: Record<string, string>
      method?: string
      body?: string
      bodyEncoding?: 'utf8' | 'base64'
      range?: string
      /**
       * Page Referer (from browser window or agent). Omitted when empty.
       * Critical for anti-leech CDNs — use the product/page URL that linked the file,
       * not the CDN file URL. Without it → often 403.
       */
      referer?: string
      /**
       * Optional Origin. Prefer omitting for normal file downloads — browsers do not
       * send Origin on top-level navigation downloads; CDNs often 403 CORS-like Origin.
       * Referer alone is usually enough; Origin not required.
       */
      origin?: string
      /** Prefer Session UA; falls back to app default_ua_preset. */
      userAgent?: string
      session?: Session | null
      signal?: AbortSignal
      onProgress?: (p: DownloadProgress) => void
    },
  ) {
    const cfg = this.getConfig()
    const userAgent =
      String(opts.userAgent || '').trim() ||
      (opts.session && typeof opts.session.getUserAgent === 'function'
        ? String(opts.session.getUserAgent() || '').trim()
        : '') ||
      resolveUserAgent(cfg)
    const acceptLanguage =
      String(cfg.browser.accept_language || '').trim() ||
      'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'

    const pageReferer = String(opts.referer || '').trim() || undefined
    // Do not send Origin by default — navigation downloads don't; CDNs often 403 CORS Origin.
    // Prefer a real page Referer (the site that linked the file); empty → sec-fetch-site:none.
    const firstHeaders = buildBrowserDownloadHeaders({
      url: opts.url,
      base: opts.headers,
      referer: pageReferer,
      omitOrigin: true,
      userAgent,
      acceptLanguage,
    })
    const part = {
      url: opts.url,
      headers: firstHeaders,
      method: opts.method,
      body: opts.body,
      bodyEncoding: opts.bodyEncoding,
      range: opts.range,
    }

    try {
      return await this.compose(chatId, {
        dest: opts.dest,
        parts: [part],
        session: opts.session,
        userAgent,
        signal: opts.signal,
        onProgress: opts.onProgress,
      })
    } catch (e) {
      if (opts.signal?.aborted) throw e
      const msg = e instanceof Error ? e.message : String(e)
      if (
        msg === 'aborted' ||
        msg.startsWith('url_not_allowed') ||
        msg === 'download_too_large' ||
        msg === 'parts_required'
      ) {
        throw e
      }

      // Retry: file URL as Referer only (still no Origin).
      // Note: anti-leech CDNs usually reject the CDN file URL as Referer; they want the
      // product/page site. This retry helps only when self-referer is accepted —
      // callers should still pass the real page referer.
      const fileReferer = String(opts.url || '').trim()
      if (!fileReferer) throw e
      if (headerValue(firstHeaders, 'Referer') === fileReferer) throw e

      const retryHeaders = buildBrowserDownloadHeaders({
        url: opts.url,
        base: opts.headers,
        referer: fileReferer,
        omitOrigin: true,
        userAgent,
        acceptLanguage,
      })
      return await this.compose(chatId, {
        dest: opts.dest,
        parts: [{ ...part, headers: retryHeaders }],
        session: opts.session,
        userAgent,
        signal: opts.signal,
        onProgress: opts.onProgress,
      })
    }
  }

  async compose(
    chatId: string,
    opts: {
      dest: string
      parts: DownloadPart[]
      session?: Session | null
      userAgent?: string
      signal?: AbortSignal
      onProgress?: (p: DownloadProgress) => void
    },
  ): Promise<{
    ok: true
    path: string
    bytes: number
    contentLength?: number
    via: 'session.fetch'
    parts: Array<{
      url: string
      status: number
      bytes: number
      finalUrl: string
      contentLength?: number
    }>
    hint: string
  }> {
    const parts = opts.parts || []
    if (!parts.length) throw new Error('parts_required')
    const cfg = this.getConfig()
    const allowlist = cfg.browser.url_allowlist
    const maxBytes = cfg.files.download_max_bytes || 524_288_000
    const timeoutMs = cfg.files.download_timeout_ms || 600000
    const userAgent =
      String(opts.userAgent || '').trim() ||
      (opts.session && typeof opts.session.getUserAgent === 'function'
        ? String(opts.session.getUserAgent() || '').trim()
        : '') ||
      resolveUserAgent(cfg)
    const acceptLanguage =
      String(cfg.browser.accept_language || '').trim() ||
      'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'

    for (const p of parts) {
      if (!isUrlAllowed(p.url, allowlist)) throw new Error(`url_not_allowed:${p.url}`)
    }

    const destAbs = this.files.resolve(chatId, opts.dest)
    await fsp.mkdir(pathDir(destAbs), { recursive: true })
    const tmp = `${destAbs}.dl.tmp`
    await fsp.writeFile(tmp, Buffer.alloc(0))

    const results: Array<{
      url: string
      status: number
      bytes: number
      finalUrl: string
      contentLength?: number
    }> = []
    let total = 0
    let knownTotal = 0
    let allLengthsKnown = true

    try {
      for (let i = 0; i < parts.length; i++) {
        assertNotAborted(opts.signal)
        const part = parts[i]
        const headers = buildBrowserDownloadHeaders({
          url: part.url,
          base: part.headers,
          omitOrigin: true,
          userAgent,
          acceptLanguage,
        })
        if (part.range) setHeader(headers, 'Range', part.range)

        const got = await streamPartViaSessionFetch(part.url, tmp, {
          session: opts.session || null,
          method: part.method || 'GET',
          headers,
          body: encodeBody(part.body, part.bodyEncoding),
          signal: opts.signal,
          timeoutMs,
          maxBytesRemaining: maxBytes - total,
          append: true,
          onChunk: (partBytes, contentLength) => {
            opts.onProgress?.({
              partIndex: i,
              partsTotal: parts.length,
              url: part.url,
              bytesPart: partBytes,
              bytesTotal: total + partBytes,
              ...(typeof contentLength === 'number' &&
              Number.isFinite(contentLength) &&
              contentLength > 0
                ? { contentLength }
                : {}),
            })
          },
        })
        results.push({
          url: part.url,
          status: got.status,
          bytes: got.bytes,
          finalUrl: got.finalUrl,
          ...(got.contentLength != null ? { contentLength: got.contentLength } : {}),
        })
        total += got.bytes
        if (typeof got.contentLength === 'number' && got.contentLength > 0) {
          knownTotal += got.contentLength
        } else {
          allLengthsKnown = false
        }
        if (total > maxBytes) throw new Error('download_too_large')
      }
      await fsp.rename(tmp, destAbs)
    } catch (e) {
      await fsp.unlink(tmp).catch(() => undefined)
      throw e
    }

    const rel = this.files.toRel(chatId, destAbs)
    return {
      ok: true,
      path: rel,
      bytes: total,
      via: 'session.fetch',
      ...(allLengthsKnown && knownTotal > 0 ? { contentLength: knownTotal } : {}),
      parts: results,
      hint: `下载完成：${rel}（${total} bytes，经 session.fetch）。请直接使用该路径，不要再反复调用 file_list 核对。`,
    }
  }
}

function pathDir(p: string) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : '.'
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('aborted')
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) delete headers[k]
  }
  headers[name] = value
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) delete headers[k]
  }
}

function registrableSite(host: string): string {
  const h = host.replace(/^www\./i, '').toLowerCase()
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 2) return h
  return parts.slice(-2).join('.')
}

function secFetchSite(url: string, referer?: string): string {
  if (!referer) return 'none'
  try {
    const dest = new URL(url)
    const src = new URL(referer)
    if (dest.origin === src.origin) return 'same-origin'
    if (registrableSite(dest.hostname) === registrableSite(src.hostname)) return 'same-site'
    return 'cross-site'
  } catch {
    return 'cross-site'
  }
}

import {
  NAVIGATION_HEADER_ORDER,
} from './navigation-headers'

export { NAVIGATION_HEADER_ORDER } from './navigation-headers'

/**
 * Headers that look like a browser navigation download (clicking <a href>),
 * not a page-script CORS fetch. CDNs often 403 the latter.
 *
 * Insertion order matches NAVIGATION_HEADER_ORDER so session.fetch (with
 * header-order-preserving Electron) does not alphabetize Sec-Fetch-* ahead of UA.
 */
function buildBrowserDownloadHeaders(opts: {
  url: string
  base?: Record<string, string>
  referer?: string
  /** When set, include Origin. When omitOrigin, strip any Origin from base. */
  origin?: string
  omitOrigin?: boolean
  userAgent: string
  acceptLanguage: string
}): Record<string, string> {
  const base: Record<string, string> = { ...(opts.base || {}) }
  if (opts.omitOrigin || !opts.origin) {
    deleteHeader(base, 'Origin')
  }

  const referer = opts.referer || headerValue(base, 'Referer') || undefined
  const accept =
    headerValue(base, 'Accept') ||
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
  const ua = headerValue(base, 'User-Agent') || opts.userAgent
  const al = headerValue(base, 'Accept-Language') || opts.acceptLanguage

  // Rebuild in navigation order (object key insertion order).
  const headers: Record<string, string> = {}
  setHeader(headers, 'Upgrade-Insecure-Requests', headerValue(base, 'Upgrade-Insecure-Requests') || '1')
  if (ua) setHeader(headers, 'User-Agent', ua)
  setHeader(headers, 'Accept', accept)
  setHeader(headers, 'Sec-Fetch-Site', headerValue(base, 'Sec-Fetch-Site') || secFetchSite(opts.url, referer))
  setHeader(headers, 'Sec-Fetch-Mode', headerValue(base, 'Sec-Fetch-Mode') || 'navigate')
  setHeader(headers, 'Sec-Fetch-User', headerValue(base, 'Sec-Fetch-User') || '?1')
  setHeader(headers, 'Sec-Fetch-Dest', headerValue(base, 'Sec-Fetch-Dest') || 'document')
  if (referer) setHeader(headers, 'Referer', referer)
  if (opts.origin && !opts.omitOrigin) setHeader(headers, 'Origin', opts.origin)
  if (al) setHeader(headers, 'Accept-Language', al)

  // Preserve any extra caller headers (Range, Cookie overrides, etc.) after the nav block.
  for (const [k, v] of Object.entries(base)) {
    if (!headerValue(headers, k)) setHeader(headers, k, v)
  }

  return headers
}

function encodeBody(body?: string, encoding?: 'utf8' | 'base64'): Buffer | undefined {
  if (body == null || body === '') return undefined
  if (encoding === 'base64') return Buffer.from(body, 'base64')
  return Buffer.from(body, 'utf8')
}

function parseExpectedLength(headers: Headers): number | undefined {
  const rawLen = headers.get('content-length')
  const parsedLen = rawLen != null ? Number(rawLen) : NaN
  if (Number.isFinite(parsedLen) && parsedLen > 0) return parsedLen

  const cr = String(headers.get('content-range') || '')
  const m = cr.match(/\/(\d+)\s*$/)
  if (m) {
    const total = Number(m[1])
    if (Number.isFinite(total) && total > 0) return total
  }
  return undefined
}

async function electronFetch(
  ses: Session | null,
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: Buffer
    signal?: AbortSignal
    redirect?: 'follow' | 'error' | 'manual'
  },
): Promise<Response> {
  const fetchInit = {
    method: init.method,
    headers: init.headers,
    body: init.body,
    redirect: init.redirect || 'follow',
    // Include session cookies when bound to an Agent Session.
    credentials: 'include' as RequestCredentials,
    signal: init.signal,
    // Avoid custom protocol.handle intercepting downloads.
    bypassCustomProtocolHandlers: true,
    // Prefer navigation-like wire order (requires Electron net-fetch that honors headerOrder).
    headerOrder: [...NAVIGATION_HEADER_ORDER],
  }

  if (ses) {
    const sesFetch = (ses as Session & { fetch?: typeof fetch }).fetch
    if (typeof sesFetch === 'function') {
      return sesFetch.call(ses, url, fetchInit as RequestInit)
    }
    return net.fetch(url, { ...fetchInit, session: ses } as never)
  }

  // No Agent Session: still use Chromium default session (not Node http).
  return net.fetch(url, fetchInit as never)
}

async function streamPartViaSessionFetch(
  url: string,
  destPath: string,
  opts: {
    session: Session | null
    method: string
    headers: Record<string, string>
    body?: Buffer
    signal?: AbortSignal
    timeoutMs: number
    maxBytesRemaining: number
    append: boolean
    onChunk?: (n: number, contentLength?: number) => void
  },
): Promise<{ status: number; bytes: number; finalUrl: string; contentLength?: number }> {
  assertNotAborted(opts.signal)

  const ac = new AbortController()
  const onAbort = () => ac.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), Math.max(1, opts.timeoutMs))

  try {
    const res = await electronFetch(opts.session, url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: ac.signal,
      redirect: 'follow',
    })

    if (res.status >= 400) {
      const hint =
        res.status === 403
          ? 'CDN/站点拒绝了请求。已尽量模拟浏览器下载头（UA/Accept/Sec-Fetch，默认不带 Origin）。请绑定 sessionId/windowId 并带页面 referer 重试。'
          : undefined
      throw new Error(hint ? `http_${res.status}:${hint}` : `http_${res.status}`)
    }

    const contentLength = parseExpectedLength(res.headers)
    // Kick the UI immediately (headers received) before body bytes arrive.
    opts.onChunk?.(0, contentLength)

    const bytes = await writeFetchBodyToFile(res, destPath, {
      append: opts.append,
      maxBytesRemaining: opts.maxBytesRemaining,
      contentLength,
      signal: opts.signal,
      abortSignal: ac.signal,
      onChunk: opts.onChunk,
    })

    return {
      status: res.status,
      bytes,
      finalUrl: res.url || url,
      ...(contentLength != null ? { contentLength } : {}),
    }
  } catch (e) {
    if (ac.signal.aborted || opts.signal?.aborted) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/aborted|AbortError/i.test(msg) || msg === 'aborted') throw new Error('aborted')
      if (!opts.signal?.aborted) throw new Error('download_timeout')
      throw new Error('aborted')
    }
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

async function writeFetchBodyToFile(
  res: Response,
  destPath: string,
  opts: {
    append: boolean
    maxBytesRemaining: number
    contentLength?: number
    signal?: AbortSignal
    abortSignal: AbortSignal
    onChunk?: (n: number, contentLength?: number) => void
  },
): Promise<number> {
  let bytes = 0
  let lastReportAt = 0
  let lastReportBytes = 0
  const report = (n: number, force = false) => {
    const now = Date.now()
    if (!force && now - lastReportAt < 100 && n - lastReportBytes < 32 * 1024) return
    lastReportAt = now
    lastReportBytes = n
    opts.onChunk?.(n, opts.contentLength)
  }

  const writeChunk = async (out: ReturnType<typeof createWriteStream>, buf: Buffer) => {
    bytes += buf.length
    if (bytes > opts.maxBytesRemaining) throw new Error('download_too_large')
    await new Promise<void>((resolve, reject) => {
      out.write(buf, (err: Error | null | undefined) => (err ? reject(err) : resolve()))
    })
    report(bytes, false)
  }

  const finish = async (out: ReturnType<typeof createWriteStream>) => {
    await new Promise<void>((resolve, reject) => {
      out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()))
    })
    report(bytes, true)
  }

  const body = res.body

  // Prefer WHATWG getReader — more reliable with Electron session.fetch / net.fetch.
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const out = createWriteStream(destPath, { flags: opts.append ? 'a' : 'w' })
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        if (opts.signal?.aborted || opts.abortSignal.aborted) throw new Error('aborted')
        const { done, value } = await reader.read()
        if (done) break
        if (value?.byteLength) await writeChunk(out, Buffer.from(value))
      }
      await finish(out)
      return bytes
    } catch (e) {
      out.destroy()
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      throw e
    }
  }

  // Fallback: Node pipeline via fromWeb
  if (body) {
    try {
      const out = createWriteStream(destPath, { flags: opts.append ? 'a' : 'w' })
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          bytes += buf.length
          if (bytes > opts.maxBytesRemaining) {
            cb(new Error('download_too_large'))
            return
          }
          report(bytes, false)
          cb(null, buf)
        },
      })
      const nodeIn = Readable.fromWeb(body as import('node:stream/web').ReadableStream)
      await pipeline(nodeIn, counter, out)
      report(bytes, true)
      return bytes
    } catch (e) {
      if (opts.abortSignal.aborted || opts.signal?.aborted) throw new Error('aborted')
      const msg = e instanceof Error ? e.message : String(e)
      if (!/ReadableStream|fromWeb|Expected|not.*stream/i.test(msg)) throw e
      bytes = 0
    }
  }

  // Last resort: buffer whole body, write in slices with progress ticks.
  const ab = await res.arrayBuffer()
  const full = Buffer.from(ab)
  if (full.length > opts.maxBytesRemaining) throw new Error('download_too_large')
  const out = createWriteStream(destPath, { flags: opts.append ? 'a' : 'w' })
  const slice = 256 * 1024
  for (let off = 0; off < full.length; off += slice) {
    if (opts.signal?.aborted || opts.abortSignal.aborted) throw new Error('aborted')
    await writeChunk(out, full.subarray(off, Math.min(off + slice, full.length)))
  }
  await finish(out)
  return bytes
}
