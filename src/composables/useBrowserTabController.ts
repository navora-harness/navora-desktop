import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserTabCommandInput,BrowserTabCommandResult,BrowserTabState} from '@shared/browser-workspace'
import {useBrowserTabActions,type BrowserActionTab,type BrowserTabActionRequest} from './useBrowserTabActions'

export type BrowserControllerTab=BrowserActionTab&{pageId?:string;chatId?:string}
export function useBrowserTabController(options:{
  chatId:()=>string;tabs:()=>BrowserControllerTab[];activeId:()=>string;detached:()=>boolean
  busy?:()=>boolean;select:(id:string)=>void;newTab?:(afterId?:string)=>void|Promise<void>
  resolvePageId?:(id:string,chatId:string)=>Promise<string>
  changed?:(result:BrowserTabCommandResult)=>void|Promise<void>;beforeClose?:()=>void
  notify:(message:string)=>void
}){
  const api=window.navora!.browser.workspace,desktop=window.navora?.app.platform!=='web'
  const ownerStates=ref(new Map<string,BrowserTabState>()),state=computed(()=>ownerStates.value.get(options.chatId())||null)
  const requests=new Map<string,number>(),refreshTimers=new Map<string,ReturnType<typeof setTimeout>>()
  let disposed=false,unsubscribe:(()=>void)|undefined,contextId:{value:string|null}|undefined
  const ownerFor=(id?:string|null)=>options.tabs().find(tab=>tab.id===id)?.chatId||options.chatId()
  const contextOwner=()=>ownerFor(contextId?.value||options.activeId())
  const wantedOwners=()=>new Set([options.chatId(),...options.tabs().map(tab=>tab.chatId)].filter((id):id is string=>!!id))
  async function refreshOwner(chatId:string){
    if(!desktop||!chatId||disposed)return
    const request=(requests.get(chatId)||0)+1;requests.set(chatId,request)
    try{const next=await api.tabState(chatId);if(!disposed&&request===requests.get(chatId)&&wantedOwners().has(chatId))ownerStates.value.set(chatId,next)}catch{/* A page can leave this host while its menu is open. */}
  }
  async function refresh(){await Promise.all([...wantedOwners()].map(refreshOwner))}
  const tabs=computed(()=>options.tabs().map(tab=>{
    const owner=tab.chatId||options.chatId(),page=ownerStates.value.get(owner)?.pages.find(page=>page.windowId===(tab.pageId||tab.id)||page.tabKey===tab.id)
    return {...tab,ownerId:owner,pinned:page?.pinned??tab.pinned,muted:page?.muted??tab.muted,audible:page?.audible??tab.audible,movable:tab.movable!==false&&!!page&&!page.annotationSelecting&&!page.automation?.activeOperations&&!page.automation?.nativePending}
  }))
  async function pageId(id:string,chatId=options.chatId()){
    if(options.resolvePageId)return options.resolvePageId(id,chatId)
    const tab=options.tabs().find(tab=>tab.id===id)
    if(!tab)throw Error('browser_page_not_found')
    return tab.pageId||ownerStates.value.get(tab.chatId||chatId)?.pages.find(page=>page.tabKey===id||page.windowId===id)?.windowId||await api.ensure(tab.chatId||chatId,id,tab.url)
  }
  async function run(request:BrowserTabActionRequest){
    if(!desktop)throw Error('browser_desktop_only')
    const viewChatId=options.chatId(),available=options.tabs(),requested=available.find(tab=>tab.id===(request.ids[0]||request.targetId||request.afterId)),chatId=requested?.chatId||viewChatId;if(!chatId)return
    if(request.ids.some(id=>!available.some(tab=>tab.id===id)))throw Error('browser_page_not_found')
    if(request.command==='copy-url'){
      const selected=new Set(request.ids),urls=tabs.value.filter(tab=>selected.has(tab.id)&&/^https?:\/\//i.test(tab.url||'')).map(tab=>tab.url!)
      if(urls.length)await navigator.clipboard.writeText(urls.join('\n'))
      return
    }
    if(request.command==='new'&&options.newTab){await options.newTab(request.afterId);return}
    const owners=new Set(request.ids.map(id=>options.tabs().find(tab=>tab.id===id)?.chatId||chatId))
    if(owners.size>1){
      if(['move-start','move-end','move-new','move-host','attach'].includes(request.command))throw Error('browser_mixed_chat_selection')
      for(const owner of owners)await run({...request,ids:request.ids.filter(id=>(options.tabs().find(tab=>tab.id===id)?.chatId||chatId)===owner),targetId:undefined})
      return
    }
    const restoring=request.command==='reopen'
    const ids=restoring?[]:await Promise.all(request.ids.map(id=>pageId(id,chatId))),after=request.afterId?await pageId(request.afterId,chatId):undefined,target=!restoring&&request.targetId&&(!request.ids.length||request.ids.includes(request.targetId))?await pageId(request.targetId,chatId):undefined
    const commands={new:'new',reopen:'reopen',reload:'reload',duplicate:'duplicate',pin:'setPinned',mute:'setMuted','move-start':'moveFirst','move-end':'moveLast','move-new':'detach','move-host':'moveToWindow',attach:'attach',close:'close'} as const
    const input:BrowserTabCommandInput={chatId,action:commands[request.command],pageId:after||target||ids[0],pageIds:ids.length?ids:undefined,value:request.value,targetHostId:request.hostId}
    if(request.command==='close')options.beforeClose?.()
    const result=await api.tabAction(input)
    if(disposed||options.chatId()!==viewChatId)return
    ownerStates.value.set(chatId,result.state)
    await options.changed?.(result)
    if(result.cancelled?.length)options.notify('网页取消了关闭，剩余标签已保留。')
    await refresh()
  }
  const actions=useBrowserTabActions({tabs:()=>tabs.value,activeId:options.activeId,detached:options.detached,busy:()=>!desktop||!!options.busy?.(),canReopen:()=>!!ownerStates.value.get(contextOwner())?.recentlyClosed.length,
    hosts:()=>{const current=ownerStates.value.get(contextOwner());return current?.compatibleHosts.filter(host=>host.id!==current.hostId&&(!options.detached()||!host.embedded)).map(host=>({id:host.id,label:host.label,count:host.tabCount}))||[]},
    select:options.select,run,onError:message=>{options.notify(message);void refresh()},
  })
  contextId=actions.contextId
  watch(actions.contextId,id=>{if(id)void refreshOwner(ownerFor(id))})
  function canDrag(id:string){const ids=actions.selectedIds.value.includes(id)?actions.selectedIds.value:[id],selected=tabs.value.filter(tab=>ids.includes(tab.id));return selected.length===ids.length&&new Set(selected.map(tab=>tab.ownerId)).size===1&&selected.every(tab=>tab.movable!==false)}
  async function closeTabs(ids:string[],skipPinned=false){
    const targets=skipPinned?ids.filter(id=>!tabs.value.find(tab=>tab.id===id)?.pinned):ids
    if(!targets.length)return
    try{await run({command:'close',ids:targets})}catch(error){options.notify(browserTabError(error));await refresh()}
  }
  async function toggleMute(id:string){const tab=tabs.value.find(tab=>tab.id===id);if(!tab)return;try{await run({command:'mute',ids:[id],value:!tab.muted})}catch(error){options.notify(browserTabError(error))}}
  async function reopen(){try{await run({command:'reopen',ids:[]})}catch(error){options.notify(browserTabError(error))}}
  watch(options.chatId,()=>{actions.clearSelection();actions.closeMenu();void refresh()})
  watch(()=>options.tabs().map(tab=>[tab.id,tab.chatId]),()=>{const wanted=wantedOwners();for(const id of ownerStates.value.keys())if(!wanted.has(id))ownerStates.value.delete(id);for(const id of wanted)if(!ownerStates.value.has(id))void refreshOwner(id)},{deep:true})
  onMounted(()=>{void refresh();if(desktop)unsubscribe=window.navora!.browser.onTreeUpdated(payload=>{if(wantedOwners().has(payload.chatId)){clearTimeout(refreshTimers.get(payload.chatId));refreshTimers.set(payload.chatId,setTimeout(()=>{refreshTimers.delete(payload.chatId);void refreshOwner(payload.chatId)},60))}})})
  onBeforeUnmount(()=>{disposed=true;for(const timer of refreshTimers.values())clearTimeout(timer);refreshTimers.clear();unsubscribe?.()})
  return {...actions,state,tabs,refresh,run,pageId,closeTabs,toggleMute,reopen,canDrag}
}
export function browserTabError(error:unknown){
  const value=String(error)
  if(/wrong_host|not_found|not_live|stale|drag_expired/.test(value))return '标签页已移动或关闭，正在更新列表。'
  if(value.includes('mixed_chat_selection'))return '请选择同一对话的网页后再移动到其它位置或窗口。'
  if(/busy|manual_control|annotation/.test(value))return '页面正在执行操作，请完成后再试。'
  if(/url_not_allowed/.test(value))return '此网址不在允许访问的范围内。'
  if(/desktop_only/.test(value))return '此标签操作需要在桌面端使用。'
  if(/reopen|closed_tab/.test(value))return '当前对话没有可恢复的标签页。'
  return '无法完成标签页操作，请稍后重试。'
}
