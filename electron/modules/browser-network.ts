import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import type { AppConfig } from '../../shared/config'
import { sanitizeRequestHeadersForUa } from '../../shared/user-agent'
import {isUrlAllowed} from '../../shared/url-allowlist'
import {BrowserNetworkScopes,FETCH_SCOPE_HEADER,type NetworkScopeOptions,type NetworkRequestOwner} from './browser-network-scope'
import {
  appendDatadomeTelemetry,
  bodyFromUploadData,
  isDatadomeUrl,
  type UploadChunk,
} from './datadome-telemetry'

export type NetworkRuleKind = 'observe' | 'modify' | 'block'

export type NetworkRule = {
  id: string
  kind: NetworkRuleKind
  urlPattern: string
  headers?: Record<string, string>
  chatId?:string
}

/** Buffered network observation (observe rules + response capture). */
export type NetworkLogEntry = {
  chatId?:string
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
  /** Request body snippet (DataDome telemetry / observe). */
  requestBodyText?: string
  requestBodyBytes?: number
  /** true until response headers arrive (observe only). */
  pending?: boolean
}

type UaGuard = {
  ua: string
  initHeader: Record<string, string>
}

type PendingObserve = {
  chatId?:string
  entryId: string
  ruleId: string
  url: string
  method: string
  resourceType?: string
  ts: number
  requestHeaders?: Record<string, string>
  requestBodyText?: string
  requestBodyBytes?: number
  requestBodyBase64?: string
  bodyTruncated?: boolean
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
 * When browser.log_datadome_telemetry is on, also mirrors DD traffic to logs/datadome-telemetry.jsonl.
 */
export class BrowserNetworkManager {
  private bySession = new Map<string, SessionNetState>()
  private getConfig: () => AppConfig
  private getSes: (sessionId: string) => Session | null
  private getLogDir: () => string
  private scopes:BrowserNetworkScopes

  constructor(
    getConfig: () => AppConfig,
    getSes: (sessionId: string) => Session | null,
    getLogDir: () => string = () => '',
    options:NetworkScopeOptions={},
  ) {
    this.getConfig = getConfig
    this.getSes = getSes
    this.getLogDir = getLogDir
    this.scopes=new BrowserNetworkScopes(options)
  }

  /** Ensure listeners applied (e.g. right after session create for DD telemetry). */
  touch(sessionId: string): void {
    this.ensure(sessionId)
    this.reapply(sessionId)
  }

  /** Re-bind webRequest for every known session (e.g. after toggling DD telemetry). */
  reapplyAll(): void {
    for (const sessionId of this.bySession.keys()) {
      this.reapply(sessionId)
    }
  }

  list(sessionId: string,chatId?:string): NetworkRule[] {
    const scope=this.apiScope(sessionId,chatId)
    if(scope===null)return[]
    return (this.bySession.get(sessionId)?.rules || []).filter(rule=>(rule.chatId||'')===scope).map(rule=>({...rule,headers:rule.headers?{...rule.headers}:undefined}))
  }

  getLog(
    sessionId: string,
    opts?: {
      limit?: number
      urlContains?: string
      status?: number
      includePending?: boolean
    },
    chatId?:string,
  ): NetworkLogEntry[] {
    const scope=this.apiScope(sessionId,chatId)
    if(scope===null)return[]
    const st = this.bySession.get(sessionId)
    if (!st) return []
    let rows = st.log.filter(entry=>(entry.chatId||'')===scope)
    if (opts?.includePending) {
      for (const p of st.pending.values()) {
        if((p.chatId||'')!==scope)continue
        rows.push({
          chatId:p.chatId,
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

  clearLog(sessionId: string,chatId?:string): void {
    const scope=this.apiScope(sessionId,chatId,true)!
    const st = this.ensure(sessionId)
    st.log=st.log.filter(entry=>(entry.chatId||'')!==scope)
    for(const [id,entry] of st.pending)if((entry.chatId||'')===scope)st.pending.delete(id)
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
    const trimmed = String(ua || '').trim()
    st.uaGuard = trimmed
      ? {
          ua: trimmed,
          initHeader: { ...(initHeader || {}) },
        }
      : null
    this.reapply(sessionId)
  }

  clear(sessionId: string,chatId?:string): void {
    const scope=this.apiScope(sessionId,chatId,true)!
    const st = this.ensure(sessionId)
    st.rules=st.rules.filter(rule=>(rule.chatId||'')!==scope)
    for(const [id,entry] of st.pending)if((entry.chatId||'')===scope)st.pending.delete(id)
    this.reapply(sessionId)
  }

  remove(sessionId: string, ruleId: string,chatId?:string): boolean {
    const scope=this.apiScope(sessionId,chatId,true)!
    const st = this.ensure(sessionId)
    const n = st.rules.length
    st.rules = st.rules.filter((r) => r.id !== ruleId||(r.chatId||'')!==scope)
    if (st.rules.length === n) return false
    this.reapply(sessionId)
    return true
  }

  add(
    sessionId: string,
    rule: Omit<NetworkRule, 'id'> & { id?: string },
    chatId?:string,
  ): NetworkRule {
    const scope=this.apiScope(sessionId,chatId,true)!
    const st = this.ensure(sessionId)
    const full: NetworkRule = {
      id: rule.id || `nr_${randomUUID().slice(0, 8)}`,
      kind: rule.kind,
      urlPattern: rule.urlPattern,
      headers: rule.headers?{...rule.headers}:undefined,
      ...(scope?{chatId:scope}:{}),
    }
    st.rules.push(full)
    this.reapply(sessionId)
    return full
  }

  disposeSession(sessionId: string): void {
    this.scopes.dispose(sessionId)
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

  async withFetchScope<T>(sessionId:string,chatId:string,url:string,method:string,signal:AbortSignal|undefined,action:(headers:Record<string,string>,signal:AbortSignal)=>Promise<T>):Promise<T>{
    this.touch(sessionId)
    if(!this.getSes(sessionId))throw Error('browser_session_not_found')
    if(!this.fetchUrlAllowed(url))throw Error('url_not_allowed')
    if(this.ensure(sessionId).rules.some(rule=>rule.chatId===chatId&&rule.kind==='block'&&matchLoose(url,rule.urlPattern)))throw Error('network_rule_blocked')
    return this.scopes.withFetchScope(sessionId,chatId,url,method,signal,action)
  }

  async withSharedManagement<T>(sessionId:string,signal:AbortSignal|undefined,action:()=>Promise<T>,timeoutMs=3000):Promise<T>{
    this.touch(sessionId)
    if(!this.getSes(sessionId))throw Error('browser_session_not_found')
    return this.scopes.withManagement(sessionId,signal,action,timeoutMs)
  }

  cancelChat(sessionId:string,chatId:string){this.scopes.cancelChat(sessionId,chatId)}

  removeChatScope(sessionId:string,chatId:string){
    if(!chatId)throw Error('network_scope_required')
    this.scopes.cancelChat(sessionId,chatId)
    this.clear(sessionId,chatId)
    this.clearLog(sessionId,chatId)
  }

  coverage(sessionId:string){
    const scoped=this.scopes.scoped||this.scopes.isShared(sessionId),dedicated=this.scopes.hasDedicatedPrincipalContract(sessionId)
    return {scope:scoped?'chat':'legacy-session',
      sources:scoped?['owned-page','scoped-fetch',...(dedicated?['registered-dedicated-session-principal']:[])]:['legacy-session'],
      unattributed:!scoped?'legacy-session-rules':dedicated?'registered-session-owner-only-when-webContentsId-absent':'application-baseline-only-no-chat-rules-or-logs',
      baseline:'application-url-allowlist',complete:false}
  }

  private apiScope(sessionId:string,chatId?:string,write=false):string|null {
    if(chatId)return chatId
    if(this.scopes.scoped||this.scopes.isShared(sessionId)){
      if(write)throw Error('network_scope_required')
      return null
    }
    return ''
  }

  private rulesFor(state:SessionNetState,owner:NetworkRequestOwner|null) {
    if(owner)return state.rules.filter(rule=>rule.chatId===owner.chatId)
    if(this.scopes.scoped)return[]
    return state.rules.filter(rule=>!rule.chatId)
  }

  private fetchUrlAllowed(url:string){
    try{if(!['http:','https:'].includes(new URL(url).protocol))return false}catch{return false}
    return isUrlAllowed(url,this.getConfig().browser.url_allowlist)
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
    const entry: NetworkLogEntry = {
      chatId:pending.chatId,
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
      requestBodyText: pending.requestBodyText,
      requestBodyBytes: pending.requestBodyBytes,
      pending: false,
    }
    this.pushLog(sessionId, entry)

    if (
      this.getConfig().browser.log_datadome_telemetry &&
      (pending.ruleId === 'datadome_auto' || isDatadomeUrl(pending.url))
    ) {
      const logDir = this.getLogDir()
      if (logDir) {
        appendDatadomeTelemetry(logDir, {
          ts: new Date(pending.ts).toISOString(),
          sessionId,
          chatId:pending.chatId,
          url: pending.url,
          method: pending.method,
          resourceType: pending.resourceType,
          statusCode: patch.statusCode,
          error: patch.error,
          requestHeaders: pending.requestHeaders,
          bodyText: pending.requestBodyText,
          bodyBase64: pending.requestBodyBase64,
          bodyBytes: pending.requestBodyBytes,
          truncated: pending.bodyTruncated,
        })
        const preview = (pending.requestBodyText || '').slice(0, 120)
        console.log(
          `[datadome-telemetry] ${pending.method} ${patch.statusCode ?? patch.error ?? ''} ${pending.url.slice(0, 100)} ${preview}`,
        )
      }
    }
  }

  private reapply(sessionId: string): void {
    const ses = this.getSes(sessionId)
    if (!ses) return
    const st = this.ensure(sessionId)
    // Rules/settings are read at each callback. Rebinding a live Session would
    // discard in-flight identity and observe state, especially during redirects.
    if(st.applied)return
    const capture=(details:{id:number;url:string;method:string;resourceType:string;uploadData?:UploadChunk[]},owner:NetworkRequestOwner|null)=>{
      if(!owner&&(this.scopes.scoped||this.scopes.isShared(sessionId)))return
      const rules=this.rulesFor(st,owner),observe=rules.find(rule=>rule.kind==='observe'&&matchLoose(details.url,rule.urlPattern))
      const telemetry=this.getConfig().browser.log_datadome_telemetry&&isDatadomeUrl(details.url)
      if(!observe&&!telemetry)return
      const existing=st.pending.get(details.id)
      if(existing&&existing.url===details.url)return
      const body=bodyFromUploadData(details.uploadData)
      st.pending.set(details.id,{entryId:`obs_${details.id}_${randomUUID().slice(0,6)}`,ruleId:observe?.id||'datadome_auto',url:details.url,method:details.method,resourceType:details.resourceType,ts:Date.now(),
        ...(owner?{chatId:owner.chatId}:{}),requestBodyText:body.bodyText,requestBodyBytes:body.bodyBytes,requestBodyBase64:body.bodyBase64,bodyTruncated:body.truncated})
    }
    const block=(details:{id:number;url:string;method:string;resourceType:string},owner:NetworkRequestOwner|null)=>{
      const rule=this.rulesFor(st,owner).find(item=>item.kind==='block'&&matchLoose(details.url,item.urlPattern))
      if(!rule)return false
      this.pushLog(sessionId,{id:`blk_${details.id}`,ts:Date.now(),url:details.url,method:details.method,resourceType:details.resourceType,ruleId:rule.id,action:'block',...(owner?{chatId:owner.chatId}:{})})
      return true
    }
    ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
      if(!isUrlAllowed(details.url,this.getConfig().browser.url_allowlist)){callback({cancel:true});return}
      const request=this.scopes.start(sessionId,details)
      if(request.cancel||block(details,request.owner)){callback({cancel:true});return}
      capture(details,request.owner)
      callback({})
    })
    ses.webRequest.onBeforeSendHeaders((details,callback)=>{
      const headers={...details.requestHeaders}
      let request:{cancel:boolean;owner:NetworkRequestOwner|null}
      try{request=this.scopes.beforeHeaders(sessionId,details,headers)}catch{callback({cancel:true,requestHeaders:stripScopeHeaders(headers)});return}
      if(request.cancel||!isUrlAllowed(details.url,this.getConfig().browser.url_allowlist)||block(details,request.owner)){callback({cancel:true,requestHeaders:stripScopeHeaders(headers)});return}
      // A host fetch is identified only now; check every hop, not just the
      // original URL, before any scoped header modification reaches the server.
      if(request.owner?.source==='host'&&!this.fetchUrlAllowed(details.url)){
        callback({cancel:true,requestHeaders:stripScopeHeaders(headers)});return
      }
      if(st.uaGuard?.ua)sanitizeRequestHeadersForUa(headers,st.uaGuard.ua,st.uaGuard.initHeader)
      const rule=this.rulesFor(st,request.owner).find(item=>item.kind==='modify'&&matchLoose(details.url,item.urlPattern))
      if(rule?.headers){
        for(const [key,value] of Object.entries(rule.headers))headers[key]=value
        stripScopeHeaders(headers)
        this.pushLog(sessionId,{id:`mod_${details.id}_${randomUUID().slice(0,6)}`,ts:Date.now(),url:details.url,method:details.method,resourceType:details.resourceType,ruleId:rule.id,action:'modify',requestHeaders:redactHeaders(headers),...(request.owner?{chatId:request.owner.chatId}:{})})
      }
      stripScopeHeaders(headers)
      capture(details,request.owner)
      const pending=st.pending.get(details.id)
      if(pending)pending.requestHeaders=redactHeaders(headers)
      callback({requestHeaders:headers})
    })
    ses.webRequest.onHeadersReceived({urls:['<all_urls>']},(details,callback)=>{
      this.finalizeObserve(sessionId,details.id,{statusCode:details.statusCode,responseHeaders:details.responseHeaders as Record<string,string|string[]>})
      callback({cancel:false,responseHeaders:details.responseHeaders})
    })
    ses.webRequest.onCompleted({urls:['<all_urls>']},details=>{
      this.finalizeObserve(sessionId,details.id,{statusCode:details.statusCode})
      this.scopes.finish(sessionId,details.id)
    })
    ses.webRequest.onErrorOccurred({urls:['<all_urls>']},details=>{
      this.finalizeObserve(sessionId,details.id,{error:details.error||'net_error'})
      this.scopes.finish(sessionId,details.id)
    })
    st.applied=true
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

function stripScopeHeaders(headers:Record<string,string>){
  for(const key of Object.keys(headers))if(key.toLowerCase()===FETCH_SCOPE_HEADER)delete headers[key]
  return headers
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
