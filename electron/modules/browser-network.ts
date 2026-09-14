import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import type { AppConfig } from '../../shared/config'
import { sanitizeRequestHeadersForUa } from '../../shared/user-agent'

export type NetworkRuleKind = 'observe' | 'modify' | 'block'

export type NetworkRule = {
  id: string
  kind: NetworkRuleKind
  urlPattern: string
  headers?: Record<string, string>
}

/** Buffered network observation (observe rules + response capture). */
export type NetworkLogEntry = {
  id: string
  ts: number
  url: string
  method: string
  resourceType?: string
  ruleId?: string
  action: string
  /** Present after onBeforeSendHeaders when captured. */
  requestHeaders?: Record<string, string>
  /** HTTP status from onHeadersReceived / onCompleted. */
  statusCode?: number
  /** Response headers (flattened; sensitive values redacted). */
  responseHeaders?: Record<string, string>
  /** true until response headers arrive (observe only). */
  pending?: boolean
}

type UaGuard = {
  ua: string
  initHeader: Record<string, string>
}

type PendingObserve = {
  entryId: string
  ruleId: string
  url: string
  method: string
  resourceType?: string
  ts: number
  requestHeaders?: Record<string, string>
}

type SessionNetState = {
  rules: NetworkRule[]
  log: NetworkLogEntry[]
  /** Electron webRequest id → pending observe capture */
  pending: Map<number, PendingObserve>
  applied: boolean
  uaGuard: UaGuard | null
}

const SENSITIVE_HEADER_RE =
  /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|api-key|x-auth-token|authentication)$/i

/**
 * Per-session: UA onBeforeSendHeaders (electron-api style) + optional Agent network rules.
 * Observe rules also buffer statusCode + response/request headers for Agent lookup.
 */
export class BrowserNetworkManager {
  private bySession = new Map<string, SessionNetState>()
  private getConfig: () => AppConfig
  private getSes: (sessionId: string) => Session | null

  constructor(getConfig: () => AppConfig, getSes: (sessionId: string) => Session | null) {
    this.getConfig = getConfig
    this.getSes = getSes
  }

  list(sessionId: string): NetworkRule[] {
    return [...(this.bySession.get(sessionId)?.rules || [])]
  }

  getLog(
    sessionId: string,
    opts?: {
      limit?: number
      urlContains?: string
      status?: number
      includePending?: boolean
    },
  ): NetworkLogEntry[] {
    const st = this.bySession.get(sessionId)
    if (!st) return []
    let rows = [...st.log]
    if (opts?.includePending) {
      for (const p of st.pending.values()) {
        rows.push({
          id: p.entryId,
          ts: p.ts,
          url: p.url,
          method: p.method,
          resourceType: p.resourceType,
          ruleId: p.ruleId,
          action: 'observe',
          requestHeaders: p.requestHeaders,
          pending: true,
        })
      }
    }
    const needle = String(opts?.urlContains || '')
      .trim()
      .toLowerCase()
    if (needle) {
      rows = rows.filter((e) => e.url.toLowerCase().includes(needle))
    }
    if (typeof opts?.status === 'number' && Number.isFinite(opts.status)) {
      rows = rows.filter((e) => e.statusCode === opts.status)
    }
    rows.sort((a, b) => a.ts - b.ts)
    const limit =
      typeof opts?.limit === 'number' && Number.isFinite(opts.limit)
        ? Math.min(200, Math.max(1, Math.floor(opts.limit)))
        : undefined
    if (limit && rows.length > limit) rows = rows.slice(rows.length - limit)
    return rows.map((e) => ({ ...e, requestHeaders: e.requestHeaders ? { ...e.requestHeaders } : undefined, responseHeaders: e.responseHeaders ? { ...e.responseHeaders } : undefined }))
  }

  clearLog(sessionId: string): void {
    const st = this.ensure(sessionId)
    st.log = []
    st.pending.clear()
  }

  /**
   * Install session.webRequest.onBeforeSendHeaders UA sanitization
   * (same logic as electron-api view.setUserAgent).
   */
  setUaGuard(
    sessionId: string,
    ua: string,
    initHeader: Record<string, string> = {},
  ): void {
    const st = this.ensure(sessionId)
    st.uaGuard = {
      ua: String(ua || '').trim(),
      initHeader: { ...(initHeader || {}) },
    }
    this.reapply(sessionId)
  }

  clear(sessionId: string): void {
    const st = this.ensure(sessionId)
    st.rules = []
    st.pending.clear()
    this.reapply(sessionId)
  }

  remove(sessionId: string, ruleId: string): boolean {
    const st = this.ensure(sessionId)
    const n = st.rules.length
    st.rules = st.rules.filter((r) => r.id !== ruleId)
    if (st.rules.length === n) return false
    this.reapply(sessionId)
    return true
  }

  add(
    sessionId: string,
    rule: Omit<NetworkRule, 'id'> & { id?: string },
  ): NetworkRule {
    const st = this.ensure(sessionId)
    const full: NetworkRule = {
      id: rule.id || `nr_${randomUUID().slice(0, 8)}`,
      kind: rule.kind,
      urlPattern: rule.urlPattern,
      headers: rule.headers,
    }
    st.rules.push(full)
    this.reapply(sessionId)
    return full
  }

  disposeSession(sessionId: string): void {
    const ses = this.getSes(sessionId)
    if (ses) {
      try {
        ses.webRequest.onBeforeRequest(null as never)
        ses.webRequest.onBeforeSendHeaders(null as never)
        ses.webRequest.onHeadersReceived(null as never)
        ses.webRequest.onCompleted(null as never)
        ses.webRequest.onErrorOccurred(null as never)
      } catch {
        /* ignore */
      }
    }
    this.bySession.delete(sessionId)
  }

  private ensure(sessionId: string): SessionNetState {
    let st = this.bySession.get(sessionId)
    if (!st) {
      st = { rules: [], log: [], pending: new Map(), applied: false, uaGuard: null }
      this.bySession.set(sessionId, st)
    }
    return st
  }

  private pushLog(sessionId: string, entry: NetworkLogEntry) {
    const st = this.ensure(sessionId)
    const max = this.getConfig().browser.network_log_buffer || 200
    st.log.push(entry)
    if (st.log.length > max) st.log.splice(0, st.log.length - max)
  }

  private finalizeObserve(
    sessionId: string,
    electronId: number,
    patch: {
      statusCode?: number
      responseHeaders?: Record<string, string | string[]>
      error?: string
    },
  ) {
    const st = this.ensure(sessionId)
    const pending = st.pending.get(electronId)
    if (!pending) return
    st.pending.delete(electronId)
    this.pushLog(sessionId, {
      id: pending.entryId,
      ts: pending.ts,
      url: pending.url,
      method: pending.method,
      resourceType: pending.resourceType,
      ruleId: pending.ruleId,
      action: patch.error ? 'observe_error' : 'observe',
      requestHeaders: pending.requestHeaders,
      statusCode: patch.statusCode,
      responseHeaders: patch.responseHeaders
        ? redactHeaders(flattenHeaders(patch.responseHeaders))
        : undefined,
      pending: false,
    })
  }

  private reapply(sessionId: string): void {
    const ses = this.getSes(sessionId)
    if (!ses) return
    const st = this.ensure(sessionId)

    ses.webRequest.onBeforeRequest(null as never)
    ses.webRequest.onBeforeSendHeaders(null as never)
    ses.webRequest.onHeadersReceived(null as never)
    ses.webRequest.onCompleted(null as never)
    ses.webRequest.onErrorOccurred(null as never)
    st.pending.clear()

    const blocks = st.rules.filter((r) => r.kind === 'block')
    const observes = st.rules.filter((r) => r.kind === 'observe')
    const modifies = st.rules.filter((r) => r.kind === 'modify')

    if (blocks.length || observes.length) {
      const urls = [...blocks, ...observes].map((r) => r.urlPattern)
      ses.webRequest.onBeforeRequest({ urls }, (details, callback) => {
        const block = blocks.find((r) => matchLoose(details.url, r.urlPattern))
        if (block) {
          this.pushLog(sessionId, {
            id: `blk_${details.id}`,
            ts: Date.now(),
            url: details.url,
            method: details.method,
            resourceType: details.resourceType,
            ruleId: block.id,
            action: 'block',
          })
          callback({ cancel: true })
          return
        }
        const obs = observes.find((r) => matchLoose(details.url, r.urlPattern))
        if (obs) {
          st.pending.set(details.id, {
            entryId: `obs_${details.id}_${randomUUID().slice(0, 6)}`,
            ruleId: obs.id,
            url: details.url,
            method: details.method,
            resourceType: details.resourceType,
            ts: Date.now(),
          })
        }
        callback({})
      })
    }

    const needSendHeaders = Boolean(st.uaGuard || modifies.length || observes.length)
    if (needSendHeaders) {
      const filter =
        observes.length && !st.uaGuard && !modifies.length
          ? { urls: observes.map((r) => r.urlPattern) }
          : undefined
      const handler = (
        details: {
          id: number
          url: string
          method: string
          resourceType: string
          requestHeaders: Record<string, string>
        },
        callback: (response: { requestHeaders?: Record<string, string> }) => void,
      ) => {
        const headers = { ...(details.requestHeaders as Record<string, string>) }
        if (st.uaGuard?.ua) {
          sanitizeRequestHeadersForUa(headers, st.uaGuard.ua, st.uaGuard.initHeader)
        }
        const rule = modifies.find((r) => matchLoose(details.url, r.urlPattern))
        if (rule?.headers) {
          for (const [k, v] of Object.entries(rule.headers)) {
            headers[k] = v
          }
          this.pushLog(sessionId, {
            id: `mod_${details.id}_${randomUUID().slice(0, 6)}`,
            ts: Date.now(),
            url: details.url,
            method: details.method,
            resourceType: details.resourceType,
            ruleId: rule.id,
            action: 'modify',
            requestHeaders: redactHeaders(headers),
          })
        }
        const pending = st.pending.get(details.id)
        if (pending) {
          pending.requestHeaders = redactHeaders(headers)
        }
        callback({ requestHeaders: headers })
      }
      if (filter) ses.webRequest.onBeforeSendHeaders(filter, handler)
      else ses.webRequest.onBeforeSendHeaders(handler)
    }

    if (observes.length) {
      const urls = observes.map((r) => r.urlPattern)
      ses.webRequest.onHeadersReceived({ urls }, (details, callback) => {
        if (st.pending.has(details.id)) {
          this.finalizeObserve(sessionId, details.id, {
            statusCode: details.statusCode,
            responseHeaders: details.responseHeaders as Record<string, string | string[]>,
          })
        }
        callback({ cancel: false, responseHeaders: details.responseHeaders })
      })

      // Fallback if headers listener missed (rare); still record status.
      ses.webRequest.onCompleted({ urls }, (details) => {
        if (!st.pending.has(details.id)) return
        this.finalizeObserve(sessionId, details.id, {
          statusCode: details.statusCode,
        })
      })

      ses.webRequest.onErrorOccurred({ urls }, (details) => {
        if (!st.pending.has(details.id)) return
        this.finalizeObserve(sessionId, details.id, {
          error: details.error || 'net_error',
        })
      })
    }

    st.applied = true
  }
}

function flattenHeaders(raw: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw || {})) {
    if (Array.isArray(v)) out[k] = v.join('\n')
    else if (v != null) out[k] = String(v)
  }
  return out
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (SENSITIVE_HEADER_RE.test(k)) {
      const s = String(v || '')
      out[k] = s.length <= 8 ? '[redacted]' : `[redacted:${s.length}chars]`
    } else {
      out[k] = String(v)
    }
  }
  return out
}

function matchLoose(url: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true
  try {
    const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${esc}$`, 'i').test(url)
  } catch {
    return url.includes(pattern.replace(/\*/g, ''))
  }
}
