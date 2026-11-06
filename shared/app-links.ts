export type AppLinkMode = 'window' | 'tab' | 'external'
export type AppLinkRequest = {url:string;chatId?:string;mode?:AppLinkMode}
export type AppLinkResult = {ok:boolean;error?:string;pageId?:string}

export function appLinkUrl(value:unknown):string {
  if(typeof value!=='string'||value.length>16384||/[\u0000-\u001f\u007f]/.test(value))throw Error('invalid_link')
  const url=new URL(value)
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw Error('unsupported_link_protocol')
  return url.href
}

export function appLinkMode(value:unknown):AppLinkMode {
  return value==='tab'||value==='external'?value:'window'
}

export function appLinkError(error:unknown):string {
  const value=String(error)
  if(value.includes('chat_required'))return '请先选择一个对话，再打开链接'
  if(value.includes('url_not_allowed'))return '此网址不在允许访问的范围内'
  if(value.includes('max_windows_total'))return '浏览器页面数量已达上限，请先关闭不需要的页面'
  if(value.includes('invalid_link')||value.includes('unsupported_link_protocol'))return '无法打开此链接'
  if(value.includes('local_only'))return '请在桌面端打开此链接'
  return '链接暂时无法打开，请重试'
}
