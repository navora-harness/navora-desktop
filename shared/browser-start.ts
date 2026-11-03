import {browserAddress} from './browser-workspace'

export type BrowserQuickLink={id:string;title:string;url:string}
export type BrowserVisit={chatId:string;url:string;title:string;visitedAt:number}
export type BrowserStartState={links:BrowserQuickLink[];history:BrowserVisit[]}
export const browserRecommendations=[
  {title:'Bing',url:'https://www.bing.com/',icon:'magnifying-glass'},
  {title:'GitHub',url:'https://github.com/',icon:'code'},
  {title:'MDN',url:'https://developer.mozilla.org/zh-CN/',icon:'book'},
  {title:'Wikipedia',url:'https://www.wikipedia.org/',icon:'globe'},
] as const

/** Searching is explicit UI behavior; tool navigation continues to require a URL. */
export function browserInputTarget(input:string):string{
  const value=input.trim()
  if(!value||value.length>8192)throw Error('invalid_browser_address')
  if(value==='about:blank')return value
  if(/^[a-z][a-z\d+.-]*:\/\//i.test(value)||/^(javascript|data|file|about|chrome|devtools|vbscript):/i.test(value))return browserAddress(value)
  if(!/\s/.test(value)&&(/^(localhost|127\.0\.0\.1|\[[a-f\d:]+\])([:/?#]|$)/i.test(value)||/^[^/?#\s]+\.[^/?#\s]+/.test(value)))return browserAddress(value)
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`
}
export function browserSiteLabel(url:string):string{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}}
export function browserDisplayAddress(url:string):string{return url==='about:blank'?'':url.replace(/^https?:\/\//,'').replace(/\/$/,'')}
export function browserSuggestions(state:BrowserStartState,query:string){
  const needle=query.trim().toLocaleLowerCase(),seen=new Set<string>()
  return [...state.links.map(link=>({...link,kind:'link' as const})),...state.history.map(visit=>({...visit,kind:'history' as const}))]
    .filter(row=>{if(seen.has(row.url)||needle&&!`${row.title} ${row.url}`.toLocaleLowerCase().includes(needle))return false;seen.add(row.url);return true}).slice(0,6)
}
