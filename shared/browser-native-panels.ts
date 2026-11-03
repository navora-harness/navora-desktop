import type {NativePanelContent} from './native-ui'
import {browserAgentControl,type BrowserAgentAction} from './browser-agent-control'
import type {BrowserAutomationConfig,BrowserAutomationState} from './browser-automation'
import type {BrowserDownloadEntry} from './types'
import {downloadProgress} from './workspace-downloads'

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

export function browserAgentNativePanel(options:{state?:BrowserAutomationState;pending?:boolean;selectionBusy?:boolean;selecting?:boolean;pageTitle?:string;settings?:BrowserAutomationConfig;notice?:string}){
  const {state,settings}=options,model=browserAgentControl(state,options.pending)
  const actions=new Map<string,BrowserAgentAction|'settings'>(),children:NativePanelContent[]=[text('agent-heading','Agent'),text('agent-page',options.pageTitle||'当前网页',true),text('agent-state',model.title)]
  if(state?.label&&model.working)children.push(text('agent-task',state.label))
  children.push(text('agent-hint',options.selecting?'正在选择批注。恢复 AI 前会先退出选择。':model.hint,true),{type:'separator',id:'agent-divider'},text('agent-input-protection',`网页输入保护：${state?.nativePending?'正在确认':!state?.nativeConfirmed?'尚未确认':state.inputProtected?'已启用':'未启用'}`,true),text('agent-cursor',`虚拟光标：${state?.cursorAvailable===false?'当前内核不支持':state?.cursorImageAvailable===false?'图像不可用':state?.cursorVisible?'图形已启用':state?.cursorEnabled?'图形已隐藏，输入保护中':'未启用'}`,true))
  if(settings)children.push(text('agent-pointer',`移动方式：${settings.smooth_pointer?(settings.pointer_profile==='precise'?'精确':'自然'):'直接移动'} · ${settings.speed_multiplier.toFixed(2)} 倍`,true))
  if(options.notice)children.push(text('agent-notice',options.notice,true))
  const primary=model.fault?model.recoveryAction:model.switchAction
  children.push(button('agent-primary',model.fault?(model.reload?'重新加载页面':'重试解除控制'):model.busy?'正在交还…':!model.known?'正在读取状态…':state?.owner==='ai'?'我来操作':'允许新的 AI 操作',!primary||!!options.selectionBusy))
  if(primary&&!options.selectionBusy)actions.set('agent-primary',primary)
  if(state?.owner==='ai'&&!model.fault){children.push(button('agent-pause','暂停本页 AI 操作',model.busy||!!options.selectionBusy));if(!model.busy&&!options.selectionBusy)actions.set('agent-pause','pause')}
  children.push(button('agent-settings','自动化设置'));actions.set('agent-settings','settings')
  return {content:{...column('agent-root',children),width:328,padding:12},actions}
}

export type BrowserNativeDownloadAction={action:'clear'|'more'|'previous'}|{action:'pause'|'resume'|'cancel'|'open'|'reveal'|'remove'|'stop';id:string;chatId:string}
export function browserDownloadsNativePanel(items:readonly BrowserDownloadEntry[],options:{offset?:number;error?:string}={}){
  const limit=40,offset=Math.max(0,Math.min(Math.max(0,Math.ceil(items.length/limit)-1)*limit,Math.floor((options.offset||0)/limit)*limit)),actions=new Map<string,BrowserNativeDownloadAction>()
  const children:NativePanelContent[]=[text('downloads-heading','下载列表'),text('downloads-caption','浏览器与工具下载',true),button('downloads-clear','清除已结束记录',!items.some(item=>['completed','failed','cancelled'].includes(item.state)))]
  if(items.some(item=>['completed','failed','cancelled'].includes(item.state)))actions.set('downloads-clear',{action:'clear'})
  if(options.error)children.push(text('downloads-error',options.error))
  const rows=items.slice(offset,offset+limit).map(item=>{
    const prefix=browserNativeId('download',item.id),terminal=['completed','failed','cancelled'].includes(item.state),active=['intercepted','started','paused'].includes(item.state)
    const row:NativePanelContent[]=[text(`${prefix}-name`,item.filename),text(`${prefix}-state`,`${item.source==='tool'?'工具':'浏览器'} · ${{intercepted:'待确认',started:'下载中',paused:'已暂停',completed:'已完成',failed:'失败',cancelled:'已取消'}[item.state]}${downloadSize(item)?` · ${downloadSize(item)}`:''}`,true)]
    if(item.relPath)row.push(text(`${prefix}-path`,item.relPath,true))
    if(terminal&&item.error)row.push(text(`${prefix}-error`,item.error))
    if(['started','paused'].includes(item.state)){const percent=downloadProgress(item);row.push({type:'progress',id:`${prefix}-progress`,value:percent===null?-1:percent/100,visible:item.state!=='paused'||percent!==null})}
    const controls:NativePanelContent[]=[]
    function add(action:Exclude<BrowserNativeDownloadAction['action'],'clear'|'more'|'previous'>,label:string,disabled=false){const id=`${prefix}-${action}`;controls.push(button(id,label,disabled));if(!disabled)actions.set(id,{action,id:item.id,chatId:item.chatId})}
    if(item.state==='started'&&item.canPause)add('pause','暂停')
    if(item.state==='paused')add('resume','继续',!item.canResume)
    if(item.source!=='tool'&&active)add('cancel','取消',item.canCancel===false)
    if(item.state==='completed'){add('open','打开');add('reveal','在文件夹中显示')}
    if(item.source==='tool'&&item.state==='started')add('stop','停止任务')
    if(item.source!=='tool'||terminal)add('remove',active?'取消并移除':'从列表移除')
    if(controls.length)row.push({type:'row',id:`${prefix}-actions`,gap:4,children:controls})
    return {...column(`${prefix}-row`,row),padding:8}
  })
  children.push(items.length?{type:'list',id:'downloads-list',height:340,gap:4,children:rows}:text('downloads-empty','暂无下载',true))
  if(offset>0){children.push(button('downloads-previous','较新的下载'));actions.set('downloads-previous',{action:'previous'})}
  if(items.length>offset+limit){children.push(button('downloads-more',`较早的下载（${offset+limit} / ${items.length}）`));actions.set('downloads-more',{action:'more'})}
  return {content:{...column('downloads-root',children),width:400,padding:12},actions,offset}
}
function downloadSize(item:BrowserDownloadEntry){
  const bytes=(value:number)=>value<1024?`${Math.floor(value)} B`:value<1024**2?`${(value/1024).toFixed(1)} KB`:value<1024**3?`${(value/1024**2).toFixed(1)} MB`:`${(value/1024**3).toFixed(2)} GB`
  const received=typeof item.receivedBytes==='number'&&Number.isFinite(item.receivedBytes)&&item.receivedBytes>=0?item.receivedBytes:undefined,total=typeof item.totalBytes==='number'&&Number.isFinite(item.totalBytes)&&item.totalBytes>0?item.totalBytes:undefined
  return total!==undefined?(received!==undefined&&['started','paused'].includes(item.state)?`${bytes(received)} / ${bytes(total)}`:bytes(total)):received!==undefined&&received>0?bytes(received):''
}

export type BrowserNativeAddressChoice={url:string;title:string;kind:string}
export function browserAddressNativePanel(choices:readonly BrowserNativeAddressChoice[],selected:number){
  const actions=new Map<string,string>()
  const children=choices.slice(0,40).map((choice,index)=>{
    const id=browserNativeId('address',`${choice.kind}:${choice.url}`);actions.set(id,choice.url)
    return {...button(id,`${index===selected?'› ':''}${choice.kind==='history'?'历史 · ':choice.kind==='input'?'打开 · ':''}${choice.title}`),tooltip:choice.url.slice(0,2000)}
  })
  return {content:{type:'list' as const,id:'address-suggestions-root',width:500,height:Math.min(360,Math.max(48,children.length*38)),padding:6,gap:3,children},actions}
}
