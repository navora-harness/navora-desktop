import type { BrowserSessionUpdate, BrowserTreeSession } from './types'

export function browserSessionLabel(session: Pick<BrowserTreeSession, 'name' | 'sessionIndex'>): string {
  return session.name?.trim() || `会话 ${session.sessionIndex}`
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
