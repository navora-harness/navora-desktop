import type {NativePanelContent,NativePanelRole} from './native-ui'
import type {WorkspaceResource,WorkspaceResourceSnapshot} from './workspace-resources'
import {searchWorkspaceResources} from './workspace-resources'
import {browserNativeId} from './browser-native-panels'
import type {AnswerSource} from './answer-sources'
export const workspacePickerFilters=[{id:'all',label:'全部'},{id:'artifact',label:'产物'},{id:'image',label:'图片'},{id:'document',label:'文档'},{id:'code',label:'代码'},{id:'file',label:'其它'}]
function preview(text:string){if(text.length<=8192)return text;let end=8192;if(/[\uD800-\uDBFF]/.test(text[end-1]!))end--;return text.slice(0,end)+'…'}
export const dialogText=(id:string,text:string,muted=false):NativePanelContent=>({id,type:'text',text:preview(text),muted})
export const dialogButton=(id:string,text:string,disabled=false):NativePanelContent=>({id,type:'button',text,disabled,variant:'plain'})
export const dialogHeader=(title:string,id='dialog',close=true):NativePanelContent=>({id:`${id}-header`,type:'row',height:30,gap:8,children:[{...dialogText(`${id}-title`,title),flex:1,singleLine:true,style:{fontWeight:'medium'}},...(close?[{id:`${id}-close`,type:'iconButton' as const,icon:'xmark',accessibleName:'关闭',tooltip:'关闭',width:30,height:30}]:[])]})
const line=(id:string,text:string,muted=false,fontSize=13):NativePanelContent=>({...dialogText(id,text,muted),singleLine:true,height:18,fontSize})
const resultLimits:Record<string,number>={'chat-search-results':240,'read-sources-results':360,'workspace-picker-results':300}
/** .9 HWND measurements include a ~29 DIP frame horizontally and ~29 + 2 * inset vertically.
 * Reserve a few extra DIP for native rounding/shadows; search keeps its 10 DIP inset and 24 DIP radius. */
export function nativeDialogMetrics(role?:NativePanelRole){const search=role==='search';return {width:32,height:search?56:52,contentInset:search?10:8,radius:search?24:12}}
function contentHeight(node:NativePanelContent):number{
  if(node.visible===false)return 0
  if(node.height!==undefined)return node.height
  const children=node.children?.filter(child=>child.visible!==false)||[],padding=(node.padding||0)*2
  if(node.type==='row'||node.type==='item')return padding+Math.max(0,...children.map(contentHeight))
  if(node.type==='column'||node.type==='list')return padding+children.reduce((sum,child)=>sum+contentHeight(child),0)+Math.max(0,children.length-1)*(node.gap||0)
  return node.type==='text'?18:node.type==='icon'?16:30
}
function resultList(id:string,rows:NativePanelContent[],limit:number,gap:number):NativePanelContent{
  return {id,type:'list',role:'listbox',height:Math.min(limit,rows.reduce((sum,row)=>sum+contentHeight(row),0)+Math.max(0,rows.length-1)*gap),gap,scrollbarPlacement:'gutter',children:rows}
}
const textWidth=(value:string,fontSize=13)=>Array.from(value).reduce((width,char)=>width+(char.charCodeAt(0)>255?fontSize:/[ilI.,'\s]/.test(char)?fontSize*.3:fontSize*.58),0)
function summaryLines(value:string,width:number):string[]{
  const chars=Array.from(preview(value).replace(/\s+/g,' ').trim()),lines:string[]=[]
  let start=0
  for(let row=0;row<2&&start<chars.length;row++){
    let end=start,used=0
    while(end<chars.length&&used+textWidth(chars[end]!,12)<=Math.max(12,width-(row===1?12:0))){used+=textWidth(chars[end]!,12);end++}
    if(end===start)end++
    lines.push(chars.slice(start,end).join('').trim()+(row===1&&end<chars.length?'…':''));start=end
  }
  return lines
}
function summary(id:string,value:string,width:number):NativePanelContent{
  return {id,type:'column',gap:0,tooltip:preview(value),children:summaryLines(value,width).map((text,index)=>({...line(`${id}-${index}`,text,true,12),maxWidth:Math.max(1,width)}))}
}
/** Fit the actual native tree, including text budgets and the scrollable result area. */
export function fitNativeDialogContent(content:NativePanelContent,dimensions:{width:number;maxHeight:number}){
  const width=Math.max(1,Math.floor(dimensions.width)),maxHeight=Math.max(1,Math.floor(dimensions.maxHeight))
  if(!['chat-search-root','read-sources-root','workspace-picker-root'].includes(content.id))return {content:{...content,width},height:contentHeight(content)}
  function fit(node:NativePanelContent,available:number):NativePanelContent{
    const inner=Math.max(1,available-(node.padding||0)*2),next={...node,...(node.width!==undefined?{width:Math.min(node.width,available)}:{})}
    if(node.type==='text')return {...next,maxWidth:Math.max(1,Math.min(node.maxWidth??available,available))}
    if(node.type==='column'&&node.id.endsWith('-snippet')&&node.tooltip)return summary(node.id,node.tooltip,inner)
    if(!node.children)return next
    const children=node.children
    if(node.type==='row'||node.type==='item'){
      const fixed=(child:NativePanelContent)=>child.width??(child.type==='iconButton'?30:child.type==='icon'?16:child.type==='text'?Math.min(child.maxWidth??inner,textWidth(child.text||'',child.fontSize)):child.type==='button'?textWidth(child.text||'')+24:0)
      const flexible=children.filter(child=>!!child.flex),weight=flexible.reduce((sum,child)=>sum+(child.flex||0),0),space=Math.max(1,inner-Math.max(0,children.length-1)*(node.gap||0)-children.filter(child=>!child.flex).reduce((sum,child)=>sum+fixed(child),0))
      next.children=children.map(child=>fit(child,child.flex?Math.max(1,space*child.flex/weight):Math.min(inner,fixed(child)||inner)))
    }else next.children=children.map(child=>fit(child,inner-(node.type==='list'?16:0)))
    if(node.type==='list')next.height=Math.min(resultLimits[node.id]??maxHeight,(next.children||[]).reduce((sum,child)=>sum+contentHeight(child),0)+Math.max(0,children.length-1)*(node.gap||0))
    return next
  }
  const fitted=fit({...content,width},width),list=fitted.children?.find(child=>child.type==='list')
  if(list?.id==='chat-search-results')list.height=Math.min(list.height||1,Math.max(1,Math.floor(maxHeight*.45)))
  if(list){const fixedHeight=contentHeight(fitted)-(list.height||0);if(fixedHeight<maxHeight)list.height=Math.max(1,Math.min(list.height||1,maxHeight-fixedHeight))}
  // Very short windows can be smaller than the header/filter controls themselves.
  if(contentHeight(fitted)>maxHeight)return {content:{...fitted,type:'list' as const,height:maxHeight,scrollbarPlacement:'gutter' as const},height:maxHeight}
  return {content:fitted,height:contentHeight(fitted)}
}
export function chatSearchPanel(hits:readonly {id:string;title:string;snippet:string;relative:string}[],query:string,activeId:string|null,includeValue=false){
  const actions=new Map<string,string>(),children:NativePanelContent[]=[{id:'chat-search-header',type:'row',gap:6,height:34,children:[{id:'chat-search-icon',type:'icon',icon:'magnifying-glass',width:20,height:20},{id:'chat-search-query',type:'input',flex:1,placeholder:'搜索对话标题或消息内容…',accessibleName:'搜索对话',...(hits.length?{navigationTarget:'chat-search-results'}:{}),style:{borderless:true},...(includeValue?{value:query}:{})},{id:'chat-search-close',type:'iconButton',icon:'xmark',accessibleName:'关闭搜索',tooltip:'关闭搜索',width:30,height:30}]}]
  if(!query.trim())children.push(line('chat-search-hint','最近对话 · 输入关键词搜索标题或消息',true,12))
  else if(!hits.length)children.push(line('chat-search-empty','没有匹配的对话',true,12))
  if(hits.length)children.push(resultList('chat-search-results',hits.map(hit=>{
    const id=browserNativeId('chat-search-hit',hit.id);actions.set(id,hit.id)
    return {id,type:'item',role:'option',contextMenu:false,selected:activeId===hit.id,padding:8,accessibleName:preview(hit.title),tooltip:preview(hit.title),children:[{id:`${id}-copy`,type:'column',gap:3,flex:1,children:[{id:`${id}-heading`,type:'row',gap:8,height:18,children:[{...line(`${id}-title`,hit.title),flex:1,style:{fontWeight:'medium'}},{...line(`${id}-time`,hit.relative,true,11),maxWidth:88}]},...(hit.snippet?[line(`${id}-snippet`,hit.snippet,true,12)]:[])]}]} as NativePanelContent
  }),resultLimits['chat-search-results']!,2))
  return {content:{id:'chat-search-root',type:'column' as const,width:580,padding:2,gap:8,children},actions}
}
export function readSourcesPanel(sources:readonly AnswerSource[],context:string,page=0){
  const size=30,current=Math.max(0,Math.min(page,Math.max(0,Math.ceil(sources.length/size)-1))),actions=new Map<string,string>(),children:NativePanelContent[]=[dialogHeader('引用来源','read-sources'),line('read-sources-count',`${sources.length} 个来源`,true,12)]
  const rows=sources.slice(current*size,(current+1)*size).map((source,index)=>{
    const id=browserNativeId('read-source',JSON.stringify([context,index+current*size,source.url]));actions.set(id,source.url)
    let host=source.url;try{host=new URL(source.url).host}catch{/* Preserve the source label while rejecting its open action later. */}
    const identity=(text:string)=>text.trim().toLocaleLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'')
    const title=source.title?.trim()||source.siteName?.trim()||host,site=source.siteName?.trim()||host,showSite=identity(site)!==identity(title),snippet=source.snippet?.trim(),showSnippet=!!snippet&&![title,site,source.url].some(text=>identity(text)===identity(snippet))
    return {id,type:'item' as const,role:'option' as const,contextMenu:false,padding:8,gap:8,tooltip:preview(source.url),accessibleName:preview(title),children:[{id:`${id}-icon`,type:'icon' as const,icon:'globe',width:16,height:16},{id:`${id}-copy`,type:'column' as const,gap:3,flex:1,children:[{...line(`${id}-title`,title),style:{fontWeight:'medium' as const}},...(showSite?[line(`${id}-site`,site,true,11)]:[]),...(showSnippet?[summary(`${id}-snippet`,snippet!,446)]:[])]}]}
  })
  if(rows.length)children.push(resultList('read-sources-results',rows,360,3))
  if(sources.length>size)children.push({id:'read-sources-pages',type:'row',gap:8,children:[dialogButton('read-sources-previous','上一页',current===0),{...dialogText('read-sources-range',`${current*size+1}–${Math.min((current+1)*size,sources.length)} / ${sources.length}`,true),flex:1},dialogButton('read-sources-next','下一页',(current+1)*size>=sources.length)]})
  return {content:{id:'read-sources-root',type:'column' as const,width:520,padding:4,gap:9,children},actions,page:current}
}
export type WorkspacePickerNativeAction={kind:'open'|'locate';path:string;resourceId:string;revision:string;messageId?:string}
export function workspacePickerPanel(options:{title:string;chatId:string;query:string;kind:string;entries:readonly WorkspaceResource[];loading:boolean;error:boolean;snapshot:WorkspaceResourceSnapshot|null;page:number;showLocate:boolean;includeValue?:boolean}){
  const matches=searchWorkspaceResources(options.entries.filter(entry=>entry.ownerChatId===options.chatId&&(options.kind==='all'||(options.kind==='artifact'?!!entry.evidence:entry.kind===options.kind))),options.query)
  const pageSize=30,page=Math.max(0,Math.min(options.page,Math.max(0,Math.ceil(matches.length/pageSize)-1))),visible=matches.slice(page*pageSize,(page+1)*pageSize),actions=new Map<string,WorkspacePickerNativeAction>()
  const rows=visible.map(entry=>{
    const id=browserNativeId('workspace-file',JSON.stringify([options.chatId,entry.id,entry.path,entry.revision])),evidence=entry.evidence,messageId=evidence?.answerId||evidence?.turnId||evidence?.messageId
    const action:WorkspacePickerNativeAction={kind:'open',path:entry.path,resourceId:entry.id,revision:entry.revision};actions.set(id,action)
    const children:NativePanelContent[]=[{id:`${id}-icon`,type:'icon',icon:entry.kind==='image'?'image':entry.kind==='code'?'code':'file-lines',width:16,height:16},{id:`${id}-copy`,type:'column',flex:1,gap:2,children:[line(`${id}-name`,entry.name),line(`${id}-path`,entry.path,true,11)]}]
    if(options.showLocate&&messageId){const key=`${id}-locate`;actions.set(key,{...action,kind:'locate',messageId});children.push({id:key,type:'iconButton',icon:'arrow-up-right-from-square',accessibleName:`定位相关对话：${entry.name}`,tooltip:'定位相关对话',width:28,height:28})}
    return {id,type:'item' as const,role:'option' as const,contextMenu:false,padding:7,gap:8,tooltip:entry.path,accessibleName:`打开 ${entry.path}`,children}
  })
  const unavailable=!!options.snapshot?.unavailable,retry=options.error||unavailable,status=options.loading?options.entries.length?'正在刷新…':'正在读取…':options.error?options.entries.length?'刷新失败，已保留现有文件':'无法读取文件，请重试':unavailable?options.entries.length?'部分目录无法读取，已显示可用文件':'部分目录无法读取，请重试':!matches.length?options.query?'没有匹配文件':options.kind==='all'?'暂无文件':'暂无此类文件':''
  const refreshLabel=retry?'重试读取文件':'刷新文件索引'
  const children:NativePanelContent[]=[dialogHeader(options.title,'workspace-picker',false),{id:'workspace-picker-search',type:'row',height:32,gap:6,children:[{id:'workspace-picker-query',type:'input',placeholder:'搜索文件名或路径',accessibleName:'搜索文件名或路径',...(rows.length?{navigationTarget:'workspace-picker-results'}:{}),flex:1,...(options.includeValue?{value:options.query}:{})},{id:'workspace-picker-refresh',type:'iconButton',icon:'arrow-rotate-right',accessibleName:refreshLabel,tooltip:refreshLabel,disabled:options.loading,width:30,height:30},{id:'workspace-picker-close',type:'iconButton',icon:'xmark',accessibleName:'关闭文件选择',tooltip:'关闭文件选择',width:30,height:30}]},{id:'workspace-picker-kind',type:'option',height:30,value:options.kind,items:workspacePickerFilters}]
  if(status)children.push({...line('workspace-picker-status',status,true,12),tooltip:status})
  if(rows.length)children.push(resultList('workspace-picker-results',rows,300,2))
  if(matches.length>pageSize)children.push({id:'workspace-picker-pages',type:'row',gap:6,children:[dialogButton('workspace-picker-previous','上一页',page===0),{...dialogText('workspace-picker-range',`${page*pageSize+1}–${Math.min((page+1)*pageSize,matches.length)} / ${matches.length}`,true),flex:1},dialogButton('workspace-picker-next','下一页',(page+1)*pageSize>=matches.length)]})
  if(options.snapshot?.truncated)children.push(line('workspace-picker-truncated','索引未涵盖全部文件',true,12))
  return {content:{id:'workspace-picker-root',type:'column' as const,width:460,padding:4,gap:8,children},actions,matches,page}
}
