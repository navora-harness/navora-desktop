import type {BrowserTreeSession,BrowserTreeWindow,ChatSession} from './types'
import {browserSessionLabel,DEFAULT_BROWSER_SESSION_ID,publicBrowserSession} from './browser-session'

export const isPublicBrowserSession=(session:BrowserTreeSession)=>session.scope==='default'||session.sessionId===DEFAULT_BROWSER_SESSION_ID
export const browserPageChatId=(session:BrowserTreeSession,page:BrowserTreeWindow)=>page.chatId||session.chatId
export function browserPagesByChat(tree:readonly BrowserTreeSession[]){
  const groups=new Map<string,BrowserTreeWindow[]>()
  for(const session of tree)for(const page of session.windows){const owner=browserPageChatId(session,page);if(owner)groups.set(owner,[...(groups.get(owner)||[]),page])}
  return groups
}

/** A chat event contains only its public pages; it must not erase other owners. */
export function mergeBrowserResourceSessions(previous:readonly BrowserTreeSession[],chatId:string,incoming:readonly BrowserTreeSession[]):BrowserTreeSession[]{
  const owners=new Set([chatId,...incoming.filter(session=>!isPublicBrowserSession(session)).map(session=>session.chatId)])
  const before=previous.find(isPublicBrowserSession),next=incoming.find(isPublicBrowserSession)
  const pages=new Map<string,BrowserTreeWindow>()
  for(const page of before?.windows||[])if(!owners.has(browserPageChatId(before!,page)))pages.set(page.windowId,page)
  for(const session of incoming.filter(isPublicBrowserSession))for(const page of session.windows)pages.set(page.windowId,page)
  const shared={...(next||before||publicBrowserSession()),windows:[...pages.values()]}
  return [shared,...previous.filter(session=>!isPublicBrowserSession(session)&&!owners.has(session.chatId)),...incoming.filter(session=>!isPublicBrowserSession(session))]
}

/** Session-first projection: storage identity stays global, visible pages follow scope. */
export function browserResourceSessions(chats:readonly Pick<ChatSession,'id'|'title'>[],tree:readonly BrowserTreeSession[],options:{currentChatId:string;scope:'current'|'all';includeEmpty:boolean;query:string}){
  const names=new Map(chats.map(chat=>[chat.id,chat.title])),needle=options.query.trim().toLocaleLowerCase(),current=options.scope==='current'&&!!options.currentChatId
  const shared=tree.filter(isPublicBrowserSession),publicPages=new Map<string,BrowserTreeWindow>()
  for(const session of shared)for(const page of session.windows)publicPages.set(page.windowId,page)
  const sessions=[{...(shared[0]||publicBrowserSession()),windows:[...publicPages.values()]},...tree.filter(session=>!isPublicBrowserSession(session))]
  let matched=0,hiddenEmpty=0
  const visible:BrowserTreeSession[]=[]
  for(const session of sessions){
    const common=isPublicBrowserSession(session)
    if(!common&&current&&session.chatId!==options.currentChatId)continue
    const scoped=session.windows.filter(page=>!current||browserPageChatId(session,page)===options.currentChatId)
    const label=browserSessionLabel(session),sessionMatches=!!needle&&`${label}${common?' 默认会话 公共会话':''}`.toLocaleLowerCase().includes(needle)
    const ownerMatches=!common&&!!needle&&(names.get(session.chatId)||'').toLocaleLowerCase().includes(needle)
    const pages=!needle||sessionMatches||ownerMatches?scoped:scoped.filter(page=>`${page.title} ${page.url} ${names.get(browserPageChatId(session,page))||''}`.toLocaleLowerCase().includes(needle))
    const matches=!needle||sessionMatches||ownerMatches||pages.length>0
    if(!common&&!matches)continue
    if(!common&&!needle&&!scoped.length&&!options.includeEmpty){hiddenEmpty++;continue}
    if(matches)matched++
    visible.push({...session,windows:pages})
  }
  return {sessions:visible,matched,hiddenEmpty,pages:visible.reduce((sum,session)=>sum+session.windows.length,0)}
}
