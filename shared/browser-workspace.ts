export type BrowserRect = {x:number;y:number;width:number;height:number;scrollLeft?:number;scrollTop?:number}
export type BrowserPresentation = 'embedded' | 'detached'
export type BrowserLoadError = {code:number;url:string;description:string}
export type BrowserFindResult = {pageId:string;token:string;requestId:number;matches:number;activeMatchOrdinal:number;finalUpdate:boolean}
export function browserLoadFailureHint(code?:number):string {
  if(code===-106)return '网络连接已断开，请检查连接后重试。'
  if(code===-105)return '未找到这个网站，请检查网址或网络连接。'
  if(code===-102)return '网站拒绝了连接，请确认服务已启动或稍后重试。'
  if(code===-118)return '网站响应超时，请稍后重试。'
  if(code!==undefined&&code<=-200&&code>=-299)return '网站的安全证书有问题，请联系网站管理员或返回上一页。'
  return '请检查网址和网络连接，然后重新加载页面。'
}
export type BrowserTabAction='new'|'close'|'next'|'previous'
export function browserTabShortcut(input:{key:string;control?:boolean;meta?:boolean;shift?:boolean;alt?:boolean;isComposing?:boolean;isAutoRepeat?:boolean}):BrowserTabAction|undefined {
  if((!input.control&&!input.meta)||input.alt||input.isComposing||input.isAutoRepeat)return
  const key=input.key.toLowerCase()
  if(key==='tab')return input.shift?'previous':'next'
  if(!input.shift&&key==='t')return 'new'
  if(!input.shift&&key==='w')return 'close'
}
export function stableBrowserTabOrder(order:string[],live:string[]):string[]{
  const available=new Set(live),result=[...new Set(order)].filter(id=>available.has(id)),known=new Set(result)
  return [...result,...[...available].filter(id=>!known.has(id))]
}
export function browserTabAfterRemoval(previous:string[],active:string,remaining:string[]):string {
  if(remaining.includes(active))return active
  const at=previous.indexOf(active),available=new Set(remaining)
  return (at<0?undefined:previous.slice(at+1).find(id=>available.has(id))||previous.slice(0,at).reverse().find(id=>available.has(id)))||remaining[0]||''
}
export type BrowserSelection = {
  documentId:string;url:string;title:string;kind:'element'|'region';rect:BrowserRect
  viewport:{width:number;height:number;scrollX:number;scrollY:number;dpr:number}
  selector?:string;text?:string
}
export type BrowserAnnotation = {
  id:string;chatId:string;sessionId:string;pageId:string;createdAt:number;updatedAt:number
  revision:number;comment:string;selection:BrowserSelection;screenshotPath:string
  taskState:'draft'|'pending'|'review'|'resolved';anchorState:'valid'|'stale'
}
export type BrowserAnnotationComparison = {
  currentUrl:string;currentTitle:string;urlChanged:boolean;titleChanged:boolean
  anchor:'region'|'matched'|'missing'|'ambiguous'|'text-changed'|'invalid-selector'
}
export type BrowserAnnotationDraft = {
  annotationId:string;text:string;baseComment:string;baseRevision:number
  version:number;editorId:string;sequence:number;updatedAt:number;deleted:boolean
}
export type BrowserDraftInput = Pick<BrowserAnnotationDraft,'text'|'baseComment'|'baseRevision'|'editorId'|'sequence'|'deleted'>
export type BrowserDraftCopy = BrowserAnnotationDraft & {id:string}
export type BrowserDraftIssue = {fileName:string;annotationId?:string}
export type BrowserDraftRecovery = {copies:BrowserDraftCopy[];issues:BrowserDraftIssue[]}
export type BrowserAnnotationResult = {annotation?:BrowserAnnotation;cancelled?:boolean;manualControl?:boolean}
export type BrowserWorkspaceApi={
  startPage:(chatId:string)=>Promise<import('./browser-start').BrowserStartState>
  saveQuickLink:(chatId:string,input:{id?:string;title:string;url:string})=>Promise<import('./browser-start').BrowserQuickLink>
  removeQuickLink:(chatId:string,id:string)=>Promise<void>
  clearBrowserHistory:(chatId:string,url?:string)=>Promise<void>
  onStartChanged:(cb:(chatId?:string)=>void)=>()=>void
  annotationDrafts:(chatId:string)=>Promise<BrowserAnnotationDraft[]>
  writeAnnotationDraft:(chatId:string,id:string,version:number,input:BrowserDraftInput)=>Promise<BrowserAnnotationDraft>
  annotationDraftRecovery:(chatId:string)=>Promise<BrowserDraftRecovery>
  resolveAnnotationDraft:(chatId:string,id:string,version:number,input:BrowserDraftInput,copy:{id:string;sequence:number})=>Promise<BrowserAnnotationDraft>
  find:(pageId:string,text:string,options:{token:string;forward?:boolean;next?:boolean})=>Promise<void>
  stopFind:(pageId:string,token:string)=>Promise<void>
  onFindResult:(cb:(result:BrowserFindResult)=>void)=>()=>void
  onFindShortcut:(cb:(value:{pageId:string;action:'open'|'close'})=>void)=>()=>void
  preview:(pageId:string)=>Promise<string|null>
  ensure:(chatId:string,key:string,url?:string)=>Promise<string>
  claimLayout:(pageId:string)=>Promise<string>
  layout:(pageId:string|null,bounds:BrowserRect|null,owner?:string)=>Promise<void>
  state:()=>Promise<{hostId:string;embedded:boolean;pages:import('./types').BrowserTreeSession[]}>
  command:(pageId:string,command:'navigate'|'back'|'forward'|'reload'|'stop'|'zoom'|'viewport'|'resume'|'takeControl'|'focus',value?:unknown)=>Promise<void>
  detach:(pageId:string)=>Promise<void>
  attach:(pageId:string)=>Promise<void>
  beginDrag:(pageId:string)=>Promise<string>
  endDrag:(token:string,outside:boolean,point?:{x:number;y:number})=>Promise<void>
  drop:(token:string)=>Promise<string>
  beginAnnotation:(chatId:string,pageId:string,kind:'element'|'region')=>Promise<void>
  collectAnnotation:(chatId:string,pageId:string)=>Promise<BrowserAnnotationResult>
  cancelAnnotation:(chatId:string,pageId:string)=>Promise<boolean>
  annotations:(chatId:string)=>Promise<BrowserAnnotation[]>
  updateAnnotation:(chatId:string,id:string,revision:number,patch:{comment?:string;taskState?:BrowserAnnotation['taskState']})=>Promise<BrowserAnnotation>
  removeAnnotation:(chatId:string,id:string)=>Promise<void>
  presentAnnotation:(chatId:string,id:string)=>Promise<import('./types').BrowserContextRef>
  locateAnnotation:(chatId:string,id:string)=>Promise<boolean>
  compareAnnotation:(chatId:string,id:string)=>Promise<BrowserAnnotationComparison>
  onPresent:(cb:(value:{chatId:string;pageId:string;hidden?:boolean;annotation?:import('./types').BrowserContextRef})=>void)=>()=>void
  onAddressFocus:(cb:(pageId:string)=>void)=>()=>void
  onTabShortcut:(cb:(payload:{pageId:string;action:BrowserTabAction})=>void)=>()=>void
}
export function browserAddress(input:string):string {
  const value=input.trim()
  if(value==='about:blank')return value
  if(!value||value.length>8192)throw Error('invalid_browser_address')
  const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^[^/:\s]+:\d+([/?#]|$)/i.test(value)?value:`${/^(localhost|127\.0\.0\.1)(:\d+)?([/]|$)/i.test(value)?'http':'https'}://${value}`)
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('invalid_browser_address')
  return url.href
}
export function browserRect(value:unknown):BrowserRect {
  const b=value as BrowserRect
  if(!b||!['x','y','width','height'].every(k=>typeof b[k as keyof BrowserRect]==='number'&&Number.isFinite(b[k as keyof BrowserRect])))throw Error('invalid_browser_bounds')
  return {scrollLeft:Math.max(0,Math.min(7680,Number(b.scrollLeft)||0)),scrollTop:Math.max(0,Math.min(4320,Number(b.scrollTop)||0)),x:Math.max(0,Math.round(b.x)),y:Math.max(0,Math.round(b.y)),width:Math.max(1,Math.min(7680,Math.round(b.width))),height:Math.max(1,Math.min(4320,Math.round(b.height)))}
}
