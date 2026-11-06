import type {NativeMenuItem,NativePanelContent} from './native-ui'
import {browserAgentControl,type BrowserAgentAction} from './browser-agent-control'
import type {BrowserAutomationConfig,BrowserAutomationState} from './browser-automation'
import type {BrowserDownloadEntry} from './types'
import {downloadProgress} from './workspace-downloads'
import type {BrowserVisit} from './browser-start'

/** Stable IDs survive progress refreshes, URL filtering and list reordering. */
export function browserNativeId(prefix:string,value:string):string {
  let left=0x811c9dc5,right=0x9e3779b9
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index)
    left=Math.imul(left^code,0x01000193)
    right=Math.imul(right^code,0x85ebca6b)
  }
  return `${prefix}-${(left>>>0).toString(36)}-${(right>>>0).toString(36)}`
}
const text=(id:string,value:string,muted=false):NativePanelContent=>({type:'text',id,text:value.slice(0,4000),muted})
const button=(id:string,label:string,disabled=false):NativePanelContent=>({type:'button',id,text:label.slice(0,4000),disabled})
const column=(id:string,children:NativePanelContent[]):NativePanelContent=>({type:'column',id,gap:6,children})

export function browserAgentNativePanel(options:{state?:BrowserAutomationState;pending?:boolean|BrowserAgentAction;selectionBusy?:boolean;selecting?:boolean;pageTitle?:string;settings?:BrowserAutomationConfig;notice?:string}){
  const {state}=options,model=browserAgentControl(state,options.pending)
  const actions=new Map<string,BrowserAgentAction|'settings'>(),children:NativePanelContent[]=[
    {type:'row',id:'agent-header',gap:8,children:[{type:'icon',id:'agent-icon',icon:'robot',width:16,height:16},{...text('agent-heading','Agent'),flex:1,style:{fontWeight:'medium'}},{...button('agent-settings','设置'),variant:'plain',height:28,icon:'sliders',tooltip:'自动化设置'}]},
    {...text('agent-page',options.pageTitle||'当前网页',true),singleLine:true,maxWidth:280,fontSize:11},
    {...text('agent-state',model.title),fontSize:13,style:{fontWeight:'medium'}}
  ]
  if(state?.label&&model.working)children.push(text('agent-task',state.label))
  children.push({...text('agent-hint',options.selecting?'允许 AI 前会退出批注选择。':model.hint,true),fontSize:12})
  if(model.showNativeStatus)children.push({type:'row',id:'agent-native-status',gap:12,children:[{...text('agent-input-protection',`输入保护：${model.protectionText}`,true),flex:1,fontSize:11},{...text('agent-cursor',`光标：${model.cursorText}`,true),fontSize:11}]})
  if(options.notice)children.push(text('agent-notice',options.notice,true))
  const primary=model.fault?model.recoveryAction:model.switchAction
  const controls:NativePanelContent[]=[{...button('agent-primary',model.primaryLabel,!primary||!!options.selectionBusy),icon:model.fault?(model.reload?'arrow-rotate-right':'arrow-right'):state?.owner==='ai'?'cursor':'robot',height:32,flex:1,variant:'default',style:{fontWeight:'medium',radius:6}}]
  if(primary&&!options.selectionBusy)actions.set('agent-primary',primary)
  if(state?.owner==='ai'&&!model.fault){controls.push({...button('agent-pause','暂停',model.busy||!!options.selectionBusy),icon:'pause-circle',height:32,variant:'plain',tooltip:'暂停本页 AI 操作'});if(!model.busy&&!options.selectionBusy)actions.set('agent-pause','pause')}
  actions.set('agent-settings','settings')
  children.push({type:'row',id:'agent-actions',gap:6,padding:2,children:controls})
  return {content:{...column('agent-root',children),width:300,padding:10,gap:8},actions}
}

export type BrowserNativeDownloadAction={action:'clear'|'more'|'previous'|'search'|'folder'}|{action:'pause'|'resume'|'cancel'|'open'|'reveal'|'remove'|'stop'|'menu';id:string;chatId:string}
export function browserDownloadContextMenu(item:BrowserDownloadEntry):NativeMenuItem[]{
  const entries:NativeMenuItem[]=[]
  const add=(id:string,label:string,icon:string)=>entries.push({id,label,icon})
  if(item.state==='completed'){add('open','打开文件','file');add('reveal','在文件夹中显示','folder-open')}
  if(item.state==='started'&&item.canPause)add('pause','暂停','pause-circle')
  if(item.state==='paused'&&item.canResume)add('resume','继续下载','arrow-right')
  if(item.source!=='tool'&&['intercepted','started','paused'].includes(item.state)&&item.canCancel!==false)add('cancel','取消下载','xmark')
  if(item.source==='tool'&&item.state==='started')add('stop','停止此下载所在的任务','stop')
  if(/^https?:\/\//i.test(item.url))add('copy','复制下载链接','link')
  if(item.source!=='tool'||['completed','failed','cancelled'].includes(item.state)){
    if(entries.length)entries.push({id:'separator',label:'',type:'separator'})
    add('remove',['intercepted','started','paused'].includes(item.state)?'取消下载并从列表中删除':'从列表中删除','xmark')
  }
  return entries
}
export function browserDownloadsNativePanel(items:readonly BrowserDownloadEntry[],options:{offset?:number;error?:string;width?:number;fileIcons?:Readonly<Record<string,string>>;searchQuery?:string;folderAvailable?:boolean;selectedId?:string;listHeight?:number}={}){
  const limit=40,offset=Math.max(0,Math.min(Math.max(0,Math.ceil(items.length/limit)-1)*limit,Math.floor((options.offset||0)/limit)*limit)),actions=new Map<string,BrowserNativeDownloadAction>()
  const width=Math.round(Math.max(240,Math.min(384,Number.isFinite(options.width)?options.width!:384)))
  const finished=items.some(item=>['completed','failed','cancelled'].includes(item.state))
  const header:NativePanelContent[]=[{...text('downloads-heading','下载'),flex:1,fontSize:18,style:{fontWeight:'bold'}}]
  const folderAvailable=options.folderAvailable??items.some(item=>item.state==='completed')
  header.push({type:'iconButton',id:'downloads-folder',icon:'folder-open',width:30,height:30,disabled:!folderAvailable,accessibleName:'在文件夹中显示最新下载的文件',tooltip:'在文件夹中显示最新下载的文件',style:{borderless:true,radius:15}},{type:'iconButton',id:'downloads-search',icon:'magnifying-glass',width:30,height:30,accessibleName:'搜索下载',tooltip:'搜索下载',style:{borderless:true,radius:15}})
  if(folderAvailable)actions.set('downloads-folder',{action:'folder'})
  actions.set('downloads-search',{action:'search'})
  if(finished){header.push({type:'iconButton',id:'downloads-clear',icon:'ellipsis',width:30,height:30,accessibleName:'下载更多操作',tooltip:'下载更多操作',style:{borderless:true,radius:15}});actions.set('downloads-clear',{action:'clear'})}
  const children:NativePanelContent[]=[{type:'row',id:'downloads-header',height:48,gap:8,padding:12,children:header},{type:'separator',id:'downloads-divider',height:1}]
  if(options.searchQuery!==undefined)children.push({type:'input',id:'downloads-query',value:options.searchQuery,placeholder:'搜索下载',maxLength:512,height:32})
  if(options.error)children.push({...text('downloads-error',options.error),fontSize:12})
  let listHeight=0
  const rows=items.slice(offset,offset+limit).map<NativePanelContent>(item=>{
    const prefix=browserNativeId('download',item.id),terminal=['completed','failed','cancelled'].includes(item.state),active=['intercepted','started','paused'].includes(item.state)
    const controls:NativePanelContent[]=[]
    function add(action:Exclude<BrowserNativeDownloadAction['action'],'clear'|'more'|'previous'>,icon:string,label:string,disabled=false){const id=`${prefix}-${action}`;controls.push({type:'iconButton',id,icon,hoverOnly:true,accessibleName:label,tooltip:label,width:26,height:28,disabled,style:{borderless:true,radius:6}});if(!disabled)actions.set(id,{action,id:item.id,chatId:item.chatId})}
    if(item.state==='started'&&item.canPause)add('pause','pause-circle','暂停下载')
    if(item.state==='paused')add('resume','arrow-right',item.canResume?'继续下载':'当前无法恢复',!item.canResume)
    if(item.source!=='tool'&&active)add('cancel','xmark',item.canCancel===false?'当前无法取消':'取消下载',item.canCancel===false)
    if(item.state==='completed'){
      actions.set(`${prefix}-row`,{action:'open',id:item.id,chatId:item.chatId})
      add('reveal','folder-open','在文件夹中显示')
    }
    if(item.source==='tool'&&item.state==='started')add('stop','stop','停止此下载所在的任务')
    add('menu','ellipsis','更多操作')
    const copyWidth=Math.max(60,width-96-controls.length*28)
    const copy:NativePanelContent[]=[{...text(`${prefix}-name`,displayText(item.filename)),maxLines:2,maxWidth:copyWidth,fontSize:14,style:{align:'start',lineHeight:18}},{...text(`${prefix}-state`,`${{intercepted:'等待确认',started:'下载中',paused:'已暂停',completed:'已完成',failed:'下载失败',cancelled:'已取消'}[item.state]}${downloadSize(item)?` · ${downloadSize(item)}`:''}${item.source==='tool'?' · 工具':''}`,true),singleLine:true,maxWidth:copyWidth,fontSize:12}]
    if(terminal&&item.error)copy.push({...text(`${prefix}-error`,item.error),singleLine:true,maxWidth:copyWidth,fontSize:11,tooltip:item.error.slice(0,4000)})
    const percent=downloadProgress(item),progress:NativePanelContent[]=['started','paused'].includes(item.state)?[{type:'progress',id:`${prefix}-progress`,height:3,value:percent===null?-1:percent/100,visible:item.state!=='paused'||percent!==null}]:[]
    const minHeight=copy.length>2?78:progress.length?68:60;listHeight+=minHeight+18+2
    return {type:'item' as const,id:`${prefix}-row`,contextMenu:true,selected:options.selectedId===item.id,minHeight,gap:8,padding:8,accessibleName:`${item.filename}，${copy[1]!.text}`,tooltip:[item.filename,item.relPath,item.state==='completed'?'点击打开文件':''].filter(Boolean).join('\n').slice(0,4000),style:{borderless:true,radius:12,align:'start',hoverBackground:'$surfaceHover',selectedBackground:'$surfaceSelected'},children:[
      // NativePanel colors with eight digits use #AARRGGBB (SkColor).
      {type:'column' as const,id:`${prefix}-tile`,width:32,height:32,padding:options.fileIcons?.[item.id]?4:8,style:{radius:8,background:options.fileIcons?.[item.id]?'#00808080':'#12808080'},children:[{type:'icon' as const,id:`${prefix}-icon`,icon:options.fileIcons?.[item.id]||'file',width:options.fileIcons?.[item.id]?24:16,height:options.fileIcons?.[item.id]?24:16}]},
      {type:'column' as const,id:`${prefix}-body`,flex:1,gap:4,children:[
        {type:'row',id:`${prefix}-details`,gap:8,children:[
          {type:'column',id:`${prefix}-copy`,flex:1,gap:2,children:copy},
          ...(controls.length?[{type:'row' as const,id:`${prefix}-actions`,gap:2,children:controls}]:[])
        ]},
        ...progress
      ]}
    ]}
  })
  children.push(items.length?{type:'list',id:'downloads-list',height:Math.min(352,Number.isFinite(options.listHeight)?Math.max(1,Math.ceil(options.listHeight!)):listHeight),gap:2,scrollbarPlacement:'gutter',children:rows}:{type:'column',id:'downloads-empty-state',gap:7,padding:18,style:{align:'center'},children:[{type:'icon',id:'downloads-empty-icon',icon:'download',width:26,height:26},{...text('downloads-empty','暂无下载'),fontSize:13,style:{align:'center'}},{...text('downloads-empty-hint','下载的文件会显示在这里',true),fontSize:11,style:{align:'center'}}]})
  if(offset>0){children.push(button('downloads-previous','较新的下载'));actions.set('downloads-previous',{action:'previous'})}
  if(items.length>offset+limit){children.push(button('downloads-more',`查看更多（${offset+limit} / ${items.length}）`));actions.set('downloads-more',{action:'more'})}
  return {content:{...column('downloads-root',children),width,padding:6,gap:4},actions,offset,rowIds:rows.map(row=>row.id)}
}
function downloadSize(item:BrowserDownloadEntry){
  const bytes=(value:number)=>value<1024?`${Math.floor(value)} B`:value<1024**2?`${(value/1024).toFixed(1)} KB`:value<1024**3?`${(value/1024**2).toFixed(1)} MB`:`${(value/1024**3).toFixed(2)} GB`
  const received=typeof item.receivedBytes==='number'&&Number.isFinite(item.receivedBytes)&&item.receivedBytes>=0?item.receivedBytes:undefined,total=typeof item.totalBytes==='number'&&Number.isFinite(item.totalBytes)&&item.totalBytes>0?item.totalBytes:undefined
  return total!==undefined?(received!==undefined&&['started','paused'].includes(item.state)?`${bytes(received)} / ${bytes(total)}`:bytes(total)):received!==undefined&&received>0?bytes(received):''
}

export type BrowserNativeAddressChoice={url:string;title:string;kind:string;chatId?:string;visitedAt?:number}
/** A visit, rather than just its URL, identifies the row that a user saw. */
export function browserAddressHistoryKey(visit:Pick<BrowserVisit,'chatId'|'url'|'visitedAt'>){return browserNativeId('history-record',JSON.stringify([visit.chatId,visit.url,visit.visitedAt]))}
/** Truncate display labels without leaving a high surrogate at the native limit. */
function displayText(value:string,max=4000){const text=value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,max);return /[\ud800-\udbff]$/.test(text)?text.slice(0,-1):text}
function matchRanges(value:string,query=''){
  const needle=query.trim().toLocaleLowerCase(),folded=value.toLocaleLowerCase(),ranges:{start:number;end:number}[]=[]
  // Native offsets are UTF-16 positions in the original label, not case-folded text.
  if(!needle||folded.length!==value.length)return ranges
  let at=0;while(ranges.length<32&&(at=folded.indexOf(needle,at))!==-1){ranges.push({start:at,end:at+needle.length});at+=needle.length}
  return ranges
}
function shortAddress(value:string){try{const url=new URL(value);return /^https?:$/.test(url.protocol)?`${url.host}${url.pathname==='/'?'':url.pathname}${url.search}`:value}catch{return value}}
function suggestionText(id:string,value:string,query:string,width:number,muted=false):NativePanelContent{return {type:'text',id,text:displayText(value),singleLine:true,maxWidth:width,muted,highlights:matchRanges(displayText(value),query),style:{align:'start'}}}

export function browserAddressNativePanel(choices:readonly BrowserNativeAddressChoice[],selected:number,options:{width?:number;maxHeight?:number;query?:string;contextKey?:string;chatId?:string;deleting?:ReadonlySet<string>;deletionError?:string}={}){
  const actions=new Map<string,string>(),deletions=new Map<string,BrowserVisit>()
  const width=Math.round(Math.max(100,Math.min(900,Number.isFinite(options.width)?options.width!:500))),query=options.query||'',context=options.contextKey?`${browserNativeId('query',options.contextKey)}-`:''
  const seen=new Set<string>(),children:NativePanelContent[]=[]
  choices.slice(0,40).forEach((choice,index)=>{
    const id=browserNativeId('address',`${context}${choice.kind}:${choice.url}`);if(seen.has(id))return;seen.add(id);actions.set(id,choice.url)
    const visit=choice.kind==='history'&&!!options.chatId&&choice.chatId===options.chatId&&!!choice.url.trim()&&Number.isSafeInteger(choice.visitedAt)?{chatId:choice.chatId,url:choice.url,title:choice.title,visitedAt:choice.visitedAt!}:undefined
    const removing=!!visit&&!!options.deleting?.has(browserAddressHistoryKey(visit)),deleteId=`${id}-delete-${visit?browserAddressHistoryKey(visit):''}`
    if(visit&&!removing)deletions.set(deleteId,visit)
    const secondary=choice.kind==='input'?(choice.title.startsWith('搜索 ')?'搜索网页':'打开网页'):shortAddress(choice.url),contentWidth=Math.max(24,width-64-(visit?33:0)),secondaryWidth=width>=280?Math.min(210,Math.round(contentWidth*.42)):0
    children.push({type:'item',id,role:'option',contextMenu:false,selected:index===selected,accessibleName:`${displayText(choice.title)}，${displayText(secondary)}`,height:40,gap:9,padding:8,tooltip:displayText(choice.url,2000),style:{borderless:true,radius:8,align:'center'},children:[
      {type:'icon',id:`${id}-icon`,icon:choice.kind==='input'?'magnifying-glass':choice.kind==='history'?'clock':'globe',width:16,height:16},
      {...suggestionText(`${id}-title`,choice.kind==='input'?choice.title.replace(/^(搜索|访问) /,''):choice.title,query,Math.max(24,contentWidth-secondaryWidth-(secondaryWidth?8:0))),flex:1},
      ...(secondaryWidth?[suggestionText(`${id}-address`,secondary,query,secondaryWidth,true)]:[]),
      ...(visit?[{type:'iconButton' as const,id:deleteId,icon:'xmark',accessibleName:removing?'正在删除此历史记录':'删除此历史记录',tooltip:removing?'正在删除…':'删除此历史记录',width:24,height:24,disabled:removing,style:{borderless:true,radius:5}}]:[])
    ]})
  })
  const maxHeight=Math.max(48,Math.min(360,Number.isFinite(options.maxHeight)?options.maxHeight!:360))
  if(options.deletionError)children.push({...text('address-delete-error',options.deletionError),height:32,fontSize:12})
  return {content:{type:'list' as const,id:'address-suggestions-root',role:'listbox' as const,width,height:Math.min(maxHeight,Math.max(48,children.length*43+12)),padding:6,gap:3,scrollbarPlacement:'gutter' as const,children},actions,deletions}
}

export type BrowserNativeTabChoice={id:string;title:string;url?:string;pinned?:boolean;icon?:string;description?:string}
export function browserTabsNativePanel(tabs:readonly BrowserNativeTabChoice[],activeId:string,query:string,options:{includeQueryValue?:boolean;contextKey?:string;listHeight?:number}={}){
  const folded=query.trim().toLocaleLowerCase(),matches=tabs.filter(tab=>!folded||`${tab.title} ${tab.description||''} ${tab.url||''}`.toLocaleLowerCase().includes(folded)),visible=matches.slice(0,180),actions=new Map<string,string>(),scope=browserNativeId('tab-query',`${options.contextKey||''}:${query}`)
  const children:NativePanelContent[]=visible.map(tab=>{
    const id=browserNativeId('tab-choice',`${scope}:${tab.id}`);actions.set(id,tab.id)
    const title=displayText(tab.title||'新标签页'),secondary=displayText(shortAddress(tab.url||'')||tab.description||'空白新标签页')
    return {id,type:'item',role:'option',contextMenu:false,selected:tab.id===activeId,accessibleName:[title,secondary,tab.pinned?'已固定':''].filter(Boolean).join('，'),height:52,padding:8,gap:9,style:{borderless:true,radius:8,align:'start'},children:[
      {id:`${id}-icon`,type:'icon',icon:tab.pinned?'thumbtack':tab.icon||'globe',width:16,height:16},
      {id:`${id}-labels`,type:'column',flex:1,gap:3,children:[suggestionText(`${id}-title`,title,query,286),suggestionText(`${id}-address`,secondary,query,286,true)]}
    ]}
  })
  return {content:{id:'tab-list-root',type:'column' as const,width:360,padding:8,gap:6,children:[
    {id:'tab-list-query',type:'input' as const,...(options.includeQueryValue?{value:query}:{}),placeholder:'搜索标题、路径或网址',accessibleName:'搜索标签页',navigationTarget:'tab-list-results',maxLength:512},
    {id:'tab-list-results',type:'list' as const,role:'listbox' as const,scrollbarPlacement:'gutter' as const,height:Math.min(Math.max(48,Math.min(380,Number.isFinite(options.listHeight)?options.listHeight!:380)),Math.max(48,visible.length*55)),gap:3,children:children.length?children:[{id:'tab-list-empty',type:'text' as const,text:'没有匹配的标签页',muted:true}]},
    ...(matches.length>visible.length?[{id:'tab-list-more',type:'text' as const,text:`共 ${matches.length} 项，请搜索以缩小范围`,muted:true}]:[])
  ]},actions,matches}
}

export const BROWSER_ZOOM_STEPS=[.25,.33,.5,.67,.75,.8,.9,1,1.1,1.25,1.5,1.75,2,2.5,3] as const
export function browserZoomTarget(factor:number,action:string){if(!Number.isFinite(factor)||factor<=0)return undefined;if(action==='reset')return 1;return action==='out'?[...BROWSER_ZOOM_STEPS].reverse().find(step=>step<factor-.001)??.25:action==='in'?BROWSER_ZOOM_STEPS.find(step=>step>factor+.001)??3:undefined}
export function browserZoomNativeMenuItem(factor:number,disabled=false):NativeMenuItem{
  const valid=Number.isFinite(factor)&&factor>0,zoom=valid?factor:1
  return {id:'zoom',label:'缩放',enabled:true,controls:[
    {id:'out',type:'button',label:'−',accessibleName:'缩小网页',enabled:valid&&!disabled&&zoom>.25,closeOnClick:false,group:1},
    {id:'value',type:'label',label:valid?`${Math.round(zoom*100)}%`:'—',accessibleName:'当前网页缩放比例',group:1},
    {id:'in',type:'button',label:'＋',accessibleName:'放大网页',enabled:valid&&!disabled&&zoom<3,closeOnClick:false,group:1},
    {id:'reset',type:'button',icon:'arrow-rotate-right',accessibleName:'重置网页缩放',enabled:valid&&!disabled&&Math.abs(zoom-1)>.001,closeOnClick:false}
  ]}
}
