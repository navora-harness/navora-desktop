import type {BrowserTreeWindow} from './types'

export type BrowserPageAddressContext={chatId:string;pageId:string;hostId:string;documentEpoch:number;kind:'current'|'failed';url:string}
export type BrowserPageAddressAction='copy'|'external'
export type BrowserPageAddressState={visible:boolean;label:string;copyLabel:string;reason?:string;context?:BrowserPageAddressContext}

/** A desired address or an address-field draft never identifies a committed page. */
export function browserHttpAddress(value:unknown):string|undefined{
  if(typeof value!=='string'||!value.trim()||value.length>8192)return
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;return url.href}catch{return}
}
export function browserPageAddressState(page:Pick<BrowserTreeWindow,'windowId'|'url'|'loading'|'crashed'|'loadError'|'hostWindowId'|'automation'|'chatId'>|null|undefined,chatId?:string):BrowserPageAddressState{
  const failed=!!page?.loadError,label=failed?'在外部浏览器中尝试打开此网址':'在外部浏览器中打开',copyLabel=failed?'复制访问失败的网址':'复制网址'
  const url=browserHttpAddress(failed?page?.loadError?.url:page?.url)
  const result:BrowserPageAddressState={visible:!!url,label,copyLabel}
  if(!url){result.reason='当前页面没有可用的 HTTP 或 HTTPS 网址';return result}
  if(page?.crashed){result.reason='页面已退出，请先重新加载';return result}
  if(page?.loading){result.reason='正在访问网页，请等待网址确认';return result}
  const owner=page?.chatId||chatId,epoch=page?.automation?.documentEpoch
  if(!owner||!page?.windowId||!page.hostWindowId||typeof epoch!=='number'||!Number.isSafeInteger(epoch)||epoch<0){result.reason='正在读取网页状态，请稍后重试';return result}
  result.context={chatId:owner,pageId:page.windowId,hostId:page.hostWindowId,documentEpoch:epoch!,kind:failed?'failed':'current',url}
  return result
}
export function sameBrowserPageAddress(a:BrowserPageAddressContext|undefined,b:BrowserPageAddressContext|undefined){return !!a&&!!b&&a.chatId===b.chatId&&a.pageId===b.pageId&&a.hostId===b.hostId&&a.documentEpoch===b.documentEpoch&&a.kind===b.kind&&a.url===b.url}
export function browserPageAddressError(error:unknown){
  const value=String(error)
  if(/external_open_failed/.test(value))return '无法在外部浏览器中打开，请检查系统默认浏览器设置后重试。'
  if(/url_not_allowed/.test(value))return '此网址不在允许访问的范围内。'
  if(/desktop_only|browser_ui_only/.test(value))return '请在桌面端打开此网页。'
  return '网页已变化、移动或关闭，请重新打开菜单后再试。'
}
