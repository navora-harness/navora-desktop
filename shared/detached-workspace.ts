import type {WorkspaceFileTab} from './file-tabs'
import type {BrowserTreeSession} from './types'

export type DetachedWorkspaceTab =
  | {kind:'browser';key:string;pageId:string;chatId:string}
  | {kind:'file';key:string;chatId:string;file:WorkspaceFileTab;viewerChatId:string}

/** The window owns one tab order and selection, including its DOM file views. */
export type DetachedWorkspaceState = {
  hostId:string
  embedded:boolean
  alwaysOnTop:boolean
  pages:BrowserTreeSession[]
  tabs:DetachedWorkspaceTab[]
  activeKey:string|null
  contextChatId:string|null
}
export type DetachedWorkspaceFileEntry={tab:WorkspaceFileTab;viewerChatId:string}
export const detachedBrowserTabKey=(pageId:string)=>`browser:${pageId}`
export const detachedFileTabKey=(fileKey:string)=>`file:${fileKey}`

/** Keep surviving positions while appending new references only once. */
export function detachedWorkspaceOrder(previous:string[],available:string[],pinned:ReadonlySet<string>=new Set()):string[]{
  const live=new Set(available),next=[...new Set([...previous,...available])].filter(key=>live.has(key))
  return next.sort((a,b)=>Number(pinned.has(b))-Number(pinned.has(a)))
}
