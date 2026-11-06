import type { BrowserSessionCreateOptions, BrowserSessionScope, BrowserSessionUpdate, BrowserTreeSession } from './types'

export const DEFAULT_BROWSER_SESSION_ID = 'sess_default'
export const DEFAULT_BROWSER_PARTITION = 'persist:navora-public-browser-v1'
export const DEFAULT_BROWSER_SESSION_LABEL = '默认浏览会话'

/** Explicit legacy persist flags retain their original isolation semantics. */
export function browserSessionScope(value: BrowserSessionCreateOptions = {}): BrowserSessionScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_browser_session_options')
  if (value.persist !== undefined && typeof value.persist !== 'boolean') throw Error('invalid_browser_session_persist')
  if (value.ua !== undefined && (typeof value.ua !== 'string' || !value.ua.trim() || value.ua.length>2048 || /[\r\n\0]/.test(value.ua))) throw Error('invalid_browser_session_user_agent')
  if (value.scope !== undefined && !['default','temporary','persistent'].includes(value.scope)) throw Error('invalid_browser_session_scope')
  if (value.scope !== undefined && value.persist !== undefined && (value.scope === 'default' || (value.scope === 'persistent') !== value.persist)) throw Error('browser_session_scope_conflict')
  if (value.scope === 'default' && value.ua !== undefined) throw Error('public_session_user_agent_requires_management')
  return value.scope ?? (value.persist !== undefined ? value.persist ? 'persistent' : 'temporary' : value.ua !== undefined ? 'temporary' : 'default')
}

export function publicBrowserSession(initialized = false): BrowserTreeSession {
  return { sessionId:DEFAULT_BROWSER_SESSION_ID,chatId:'',sessionIndex:0,scope:'default',initialized,partition:DEFAULT_BROWSER_PARTITION,persist:true,name:DEFAULT_BROWSER_SESSION_LABEL,isDefault:true,windows:[] }
}

export function browserSessionLabel(session: Pick<BrowserTreeSession, 'name' | 'sessionIndex'> & Partial<Pick<BrowserTreeSession,'scope'|'sessionId'|'displayIndex'>>): string {
  if(session.scope==='default'||session.sessionId===DEFAULT_BROWSER_SESSION_ID)return DEFAULT_BROWSER_SESSION_LABEL
  if(session.name?.trim())return session.name.trim()
  const index=session.displayIndex??session.sessionIndex
  const number=String(index).padStart(2,'0')
  // Old snapshots may lack a profile-wide number; the identity suffix still distinguishes owners.
  const suffix=session.displayIndex===undefined&&session.sessionId?` · ${session.sessionId.replace(/^sess_/,'').slice(0,6)}`:''
  return `独立会话 ${number}${suffix}`
}

export function normalizeBrowserSessionUpdate(value: unknown): BrowserSessionUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid_browser_session_update')
  const patch = value as Record<string, unknown>
  if (Object.keys(patch).some(key => key !== 'name' && key !== 'isDefault')) throw new TypeError('invalid_browser_session_update')
  const normalized: BrowserSessionUpdate = {}
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(patch.name)) throw new TypeError('invalid_browser_session_name')
    normalized.name = patch.name.trim()
  }
  if (patch.isDefault !== undefined) {
    if (typeof patch.isDefault !== 'boolean') throw new TypeError('invalid_browser_session_default')
    normalized.isDefault = patch.isDefault
  }
  return normalized
}
