import type { BrowserTreeSession, ChatSession } from './types'
import { browserSessionLabel } from './browser-session'

export function filterBrowserResourceOwners(chats: readonly ChatSession[], sessions: readonly BrowserTreeSession[], options: {
  currentChatId: string; scope: 'current' | 'all'; includeEmpty: boolean; query: string
}): ChatSession[] {
  const needle = options.query.trim().toLocaleLowerCase()
  const owned = (id: string) => sessions.filter(session => session.chatId === id)
  return chats.filter(chat => options.scope !== 'current' || chat.id === options.currentChatId).filter(chat => {
    const resources = owned(chat.id)
    if (!resources.length && chat.id !== options.currentChatId) return false
    if (needle) return chat.title.toLocaleLowerCase().includes(needle) || resources.some(session =>
      browserSessionLabel(session).toLocaleLowerCase().includes(needle) || session.windows.some(page => (page.title + ' ' + page.url).toLocaleLowerCase().includes(needle)))
    return chat.id === options.currentChatId || resources.some(session => options.includeEmpty || session.windows.length > 0)
  }).sort((a, b) => Number(!owned(a.id).some(session => session.windows.length)) - Number(!owned(b.id).some(session => session.windows.length))
    || Number(b.id === options.currentChatId) - Number(a.id === options.currentChatId))
}
