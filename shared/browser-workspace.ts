export type BrowserRect = {x:number;y:number;width:number;height:number;scrollLeft?:number;scrollTop?:number}
export type BrowserLayoutResult={
  status:'applied'|'deferred'|'stale';pageId:string|null;owner:string;generation:number;hostGeneration:number
  visible:boolean;reason?:'busy'|'inactive'|'owner'|'generation'|'unavailable'|'apply-failed'
}
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
export type BrowserTabAction='new'|'close'|'next'|'previous'|'reopen'|'last'|'address'|'reload'|'reloadIgnoringCache'|'mute'|`index${1|2|3|4|5|6|7|8}`
export type BrowserTabCommand='new'|'reopen'|'reload'|'duplicate'|'setPinned'|'setMuted'|'activate'|'reorder'|'moveFirst'|'moveLast'|'moveToWindow'|'detach'|'attach'|'close'|'closeOthers'|'closeLeft'|'closeRight'
export type BrowserTabCommandInput={
  chatId:string;action:BrowserTabCommand;pageId?:string;pageIds?:string[];value?:boolean
  beforeId?:string|null;targetHostId?:string;closedId?:string;key?:string;url?:string;background?:boolean;skipPinned?:boolean
}
export type BrowserTabHost={id:string;label:string;embedded:boolean;tabCount:number}
export type BrowserClosedTab={id:string;title:string;url:string;closedAt:number;hostId:string}
export type BrowserTabState={
  chatId:string;hostId:string;embedded:boolean;revision:number;order:string[];activeId:string|null
  pages:import('./types').BrowserTreeWindow[];compatibleHosts:BrowserTabHost[];recentlyClosed:BrowserClosedTab[]
}
export type BrowserTabCommandResult={pageId?:string;pageIds?:string[];closed?:string[];cancelled?:string[];state:BrowserTabState}
export type BrowserEditCommand='undo'|'redo'|'cut'|'copy'|'paste'|'pastePlain'|'delete'|'selectAll'
export type BrowserEditState=Record<BrowserEditCommand,boolean>
export function browserTabShortcut(input:{key:string;control?:boolean;meta?:boolean;shift?:boolean;alt?:boolean;isComposing?:boolean;isAutoRepeat?:boolean}):BrowserTabAction|undefined {
  if(input.alt||input.isComposing||input.isAutoRepeat)return
  const key=input.key.toLowerCase()
  if(key==='f5')return input.shift||input.control||input.meta?'reloadIgnoringCache':'reload'
  if(!input.control&&!input.meta)return
  if(key==='tab')return input.shift?'previous':'next'
  if(input.shift&&key==='t')return 'reopen'
  if(!input.shift&&key==='t')return 'new'
  if(!input.shift&&key==='w')return 'close'
  if(!input.shift&&/^[1-8]$/.test(key))return `index${key}` as BrowserTabAction
  if(!input.shift&&key==='9')return 'last'
  if(key==='r')return input.shift?'reloadIgnoringCache':'reload'
  if(!input.shift&&key==='l')return 'address'
  if(!input.shift&&key==='m')return 'mute'
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
  documentId:string;url:string;title:string;kind:'point'|'element'|'region';rect:BrowserRect
  viewport:{width:number;height:number;scrollX:number;scrollY:number;dpr:number}
  selector?:string;text?:string
  formatVersion?:2;targetId?:string;frameScope?:'top'|'embedded-container';point?:{x:number;y:number}
  visualViewport?:{offsetLeft:number;offsetTop:number;scale:number;width:number;height:number}
}
export type BrowserAnnotation = {
  id:string;chatId:string;sessionId:string;pageId:string;createdAt:number;updatedAt:number
  revision:number;comment:string;selection:BrowserSelection;screenshotPath:string
  taskState:'draft'|'pending'|'review'|'resolved';anchorState:'valid'|'stale'
  sourceTargetId?:string
}
export type BrowserAnnotationComparison = {
  currentUrl:string;currentTitle:string;urlChanged:boolean;titleChanged:boolean
  anchor:'point'|'region'|'matched'|'missing'|'ambiguous'|'text-changed'|'invalid-selector'
}
export type BrowserAnnotationDraft = {
  annotationId:string;text:string;baseComment:string;baseRevision:number
  version:number;editorId:string;sequence:number;updatedAt:number;deleted:boolean
}
export type BrowserDraftInput = Pick<BrowserAnnotationDraft,'text'|'baseComment'|'baseRevision'|'editorId'|'sequence'|'deleted'>
export type BrowserDraftCopy = BrowserAnnotationDraft & {id:string}
export type BrowserDraftIssue = {fileName:string;annotationId?:string}
export type BrowserDraftRecovery = {copies:BrowserDraftCopy[];issues:BrowserDraftIssue[]}
export type BrowserAnnotationPhase='armed'|'dragging'|'target-ready'|'passthrough'|'saving'|'stale'
export type BrowserAnnotationTarget={id:string;chatId:string;pageId:string;sessionId:string;selection:BrowserSelection;screenshotPath:string;comment:string;version:number;editorId:string;sequence:number;createdAt:number;updatedAt:number;conflictOf?:string}
export type BrowserAnnotationResult = {annotation?:BrowserAnnotation;target?:BrowserAnnotationTarget;phase?:BrowserAnnotationPhase;annotationSessionId?:string;cancelled?:boolean;manualControl?:boolean;restored?:boolean}
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
  layout:(pageId:string|null,bounds:BrowserRect|null,owner?:string,generation?:number)=>Promise<BrowserLayoutResult>
  state:()=>Promise<{hostId:string;embedded:boolean;pages:import('./types').BrowserTreeSession[]}>
  tabState:(chatId:string)=>Promise<BrowserTabState>
  tabAction:(input:BrowserTabCommandInput)=>Promise<BrowserTabCommandResult>
  editState:(pageId:string)=>Promise<BrowserEditState>
  edit:(pageId:string,command:BrowserEditCommand)=>Promise<void>
  openSettings:(pageId:string)=>Promise<void>
  onOpenSettings:(cb:(payload:{section:'browser';pageId:string;sourceHostId:string})=>void)=>()=>void
  onApplicationMenu:(cb:(payload:{menu?:import('./app-commands').AppMenuId;command?:import('./app-commands').AppCommandId;pageId:string})=>void)=>()=>void
  command:(pageId:string,command:'navigate'|'back'|'forward'|'reload'|'reloadIgnoringCache'|'stop'|'zoom'|'viewport'|'resume'|'takeControl'|'pause'|'retryAutomation'|'focus',value?:unknown)=>Promise<void>
  detach:(pageId:string)=>Promise<void>
  attach:(pageId:string)=>Promise<void>
  beginDrag:(pageId:string,pageIds?:string[])=>Promise<string>
  endDrag:(token:string,outside:boolean,point?:{x:number;y:number})=>Promise<void>
  drop:(token:string)=>Promise<string>
  dropTabs:(token:string)=>Promise<{pageId:string;pageIds:string[]}>
  beginAnnotation:(chatId:string,pageId:string,kind:'auto'|'element'|'region')=>Promise<void>
  collectAnnotation:(chatId:string,pageId:string)=>Promise<BrowserAnnotationResult>
  cancelAnnotation:(chatId:string,pageId:string)=>Promise<boolean>
  annotationMode:(chatId:string,pageId:string,mode:'armed'|'passthrough')=>Promise<void>
  annotationTargets:(chatId:string,pageId:string)=>Promise<BrowserAnnotationTarget[]>
  writeAnnotationTarget:(chatId:string,id:string,version:number,input:{text:string;editorId:string;sequence:number})=>Promise<BrowserAnnotationTarget>
  commitAnnotationTarget:(chatId:string,pageId:string,id:string,version:number)=>Promise<BrowserAnnotation>
  discardAnnotationTarget:(chatId:string,pageId:string,id:string,version:number)=>Promise<void>
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
/** Renderer CSS coordinates become native content-area DIP using UI zoom only. */
export function browserLayoutRect(value:unknown,zoom=1):BrowserRect {
  const b=value as BrowserRect
  if(!b||!['x','y','width','height'].every(k=>typeof b[k as keyof BrowserRect]==='number'&&Number.isFinite(b[k as keyof BrowserRect]))||b.width<=0||b.height<=0||!Number.isFinite(zoom)||zoom<=0)throw Error('invalid_browser_bounds')
  return browserRect({x:b.x*zoom,y:b.y*zoom,width:b.width*zoom,height:b.height*zoom,scrollLeft:(b.scrollLeft||0)*zoom,scrollTop:(b.scrollTop||0)*zoom})
}
