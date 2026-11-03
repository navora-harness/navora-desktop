import {computed,onBeforeUnmount,ref,watch} from 'vue'
import type {BrowserTabMenuItem} from '@/components/BrowserTabContextMenu.vue'

/** A host supplies only browser pages; file tabs never enter browser batch actions. */
export type BrowserActionTab={id:string;title:string;url?:string;pinned?:boolean;muted?:boolean;audible?:boolean;loading?:boolean;movable?:boolean;ownerId?:string}
export type BrowserActionHost={id:string;label:string;count:number;disabled?:boolean}
export type BrowserTabActionRequest={
  command:'new'|'reopen'|'reload'|'duplicate'|'pin'|'mute'|'copy-url'|'move-start'|'move-end'|'move-new'|'move-host'|'attach'|'close'
  ids:string[];targetId?:string;afterId?:string;value?:boolean;hostId?:string
}
type MenuHandle={show:(event:MouseEvent|KeyboardEvent)=>void;hide:()=>void}
type BrowserTabActionOptions={
  tabs:()=>BrowserActionTab[];activeId:()=>string;detached:()=>boolean;busy?:()=>boolean
  canReopen?:()=>boolean;hosts?:()=>BrowserActionHost[]
  select:(id:string)=>void;run:(request:BrowserTabActionRequest)=>Promise<void>;onError:(message:string)=>void
}

export function useBrowserTabActions(options:BrowserTabActionOptions){
  const menuRef=ref<MenuHandle>(),contextId=ref<string|null>(null),selectedIds=ref<string[]>([]),pending=ref(false)
  let anchorId=''
  const tabs=computed(()=>options.tabs()),busy=computed(()=>pending.value||!!options.busy?.())
  const ordered=(ids:Iterable<string>)=>{const selected=new Set(ids);return tabs.value.filter(tab=>selected.has(tab.id)).map(tab=>tab.id)}
  const contextIds=computed(()=>{
    const id=contextId.value
    if(!id||!tabs.value.some(tab=>tab.id===id))return []
    return selectedIds.value.includes(id)?ordered(selectedIds.value):[id]
  })
  const targets=computed(()=>{const ids=new Set(contextIds.value);return tabs.value.filter(tab=>ids.has(tab.id))})
  const closeMenu=()=>{menuRef.value?.hide();contextId.value=null}
  function clearSelection(){selectedIds.value=[];anchorId=''}
  function selectAll(){selectedIds.value=tabs.value.map(tab=>tab.id);anchorId=options.activeId()||selectedIds.value[0]||''}
  function selectTab(id:string,event?:MouseEvent){
    if(busy.value||!tabs.value.some(tab=>tab.id===id))return
    if(event?.shiftKey){
      const ids=tabs.value.map(tab=>tab.id),from=ids.indexOf(anchorId||options.activeId()),to=ids.indexOf(id)
      const range=from<0?[id]:ids.slice(Math.min(from,to),Math.max(from,to)+1)
      selectedIds.value=ordered(event.ctrlKey||event.metaKey?[...selectedIds.value,...range]:range)
      if(!anchorId)anchorId=options.activeId()||id
      return
    }
    if(event?.ctrlKey||event?.metaKey){
      const base=selectedIds.value.length?selectedIds.value:tabs.value.some(tab=>tab.id===options.activeId())?[options.activeId()]:[]
      selectedIds.value=ordered(base.includes(id)?base.filter(value=>value!==id):[...base,id])
      anchorId=id;return
    }
    selectedIds.value=[id];anchorId=id;options.select(id)
  }
  function showMenu(event:MouseEvent|KeyboardEvent,id:string|null){
    if(id&&!tabs.value.some(tab=>tab.id===id))return
    contextId.value=id
    window.dispatchEvent(new Event('navora:tab-hover-dismiss'))
    menuRef.value?.show(event)
  }
  const isContextTarget=(id:string)=>contextIds.value.includes(id)
  const closeCandidates=(kind:'left'|'right'|'others')=>{
    const selected=new Set(contextIds.value),positions=tabs.value.flatMap((tab,index)=>selected.has(tab.id)?[index]:[])
    if(!positions.length)return []
    const first=Math.min(...positions),last=Math.max(...positions)
    return tabs.value.filter((tab,index)=>!tab.pinned&&!selected.has(tab.id)&&(kind==='others'||(kind==='left'?index<first:index>last))).map(tab=>tab.id)
  }
  const menuItems=computed<BrowserTabMenuItem[]>(()=>{
    const many=targets.value.length>1,count=targets.value.length,suffix=many?`所选 ${count} 个标签页`:'标签页',disabled=busy.value
    const items:BrowserTabMenuItem[]=[
      {id:'new',label:count?'在右侧新建标签页':'新建标签页',icon:'plus',shortcut:!contextId.value||contextId.value===options.activeId()?'Ctrl+T':undefined,disabled},
      {id:'reopen',label:'重新打开关闭的标签页',icon:'clock',shortcut:'Ctrl+Shift+T',disabled:disabled||!options.canReopen?.(),reason:options.canReopen?.()?undefined:'此对话暂无可恢复的关闭记录'},
    ]
    if(!count){items.push({id:'select-all',label:'选择本窗口全部浏览器标签',icon:'checkbox-checked',separatorBefore:true,disabled:disabled||!tabs.value.length});return items}
    const allPinned=targets.value.every(tab=>tab.pinned),allMuted=targets.value.every(tab=>tab.muted)
    items.push(
      {id:'reload',label:many?`重新加载${suffix}`:'重新加载',icon:'arrow-rotate-right',separatorBefore:true,disabled},
      {id:'duplicate',label:many?`复制${suffix}`:'复制标签页',icon:'copy',disabled},
      {id:'pin',label:`${allPinned?'取消固定':'固定'}${many?suffix:''}`,icon:'thumbtack',disabled},
      {id:'mute',label:`${allMuted?'取消静音':'静音'}${many?suffix:''}`,icon:allMuted?'tab-muted':'tab-audio',disabled},
      {id:'copy-url',label:many?'复制所选标签页网址':'复制网址',icon:'link',disabled:disabled||!targets.value.some(tab=>isPageUrl(tab.url)),reason:targets.value.some(tab=>isPageUrl(tab.url))?undefined:'空白新标签页没有可复制的网址'},
    )
    const mixedOwners=new Set(targets.value.map(tab=>tab.ownerId).filter(Boolean)).size>1
    const moveDisabled=disabled||mixedOwners||targets.value.some(tab=>tab.movable===false)
    const moves:BrowserTabMenuItem[]=[
      {id:'move-start',label:'移至最前',icon:'angles-left',disabled:moveDisabled},
      {id:'move-end',label:'移至最后',icon:'angles-right',disabled:moveDisabled},
      {id:'move-new',label:'移至新窗口',icon:'arrow-up-right-from-square',separatorBefore:true,disabled:moveDisabled},
      ...(options.hosts?.()||[]).map(host=>({id:`move-host:${host.id}`,label:`${host.label}（${host.count}）`,icon:host.id==='embedded'?'workspace':'browser',disabled:moveDisabled||host.disabled})),
      ...(options.detached()?[{id:'attach',label:'移回工作区',icon:'workspace-attach',disabled:moveDisabled}]:[]),
    ]
    items.push(
      {id:'move',label:many?`移动${suffix}`:'移动标签页',icon:'arrow-right',children:moves,separatorBefore:true,disabled:moveDisabled,reason:mixedOwners?'请选择同一对话的网页后再移动。':moveDisabled&&!disabled?'页面当前正在执行任务，暂时无法移动':undefined},
      {id:'select-all',label:'选择本窗口全部浏览器标签',icon:'checkbox-checked',disabled:disabled||!tabs.value.length,separatorBefore:true},
      {id:'close',label:many?`关闭所选 ${count} 个标签页`:'关闭标签页',icon:'xmark',shortcut:!many&&contextId.value===options.activeId()?'Ctrl+W':undefined,disabled},
      {id:'close-multiple',label:'关闭多个标签页',icon:'list-ul',disabled,children:[
        {id:'close-left',label:'关闭左侧浏览器标签页',disabled:disabled||!closeCandidates('left').length},
        {id:'close-right',label:'关闭右侧浏览器标签页',disabled:disabled||!closeCandidates('right').length},
        {id:'close-others',label:'关闭其他浏览器标签页',disabled:disabled||!closeCandidates('others').length},
      ]},
    )
    return items
  })
  const findItem=(id:string,items=menuItems.value):BrowserTabMenuItem|undefined=>{
    for(const item of items){if(item.id===id)return item;const nested=item.children&&findItem(id,item.children);if(nested)return nested}
  }
  async function execute(action:string){
    const item=findItem(action)
    if(busy.value||!item||item.disabled||item.children)return
    if(action==='select-all'){selectAll();closeMenu();return}
    const ids=[...contextIds.value],request:BrowserTabActionRequest={command:'close',ids,targetId:contextId.value||undefined}
    if(action==='new'){request.command='new';request.afterId=contextId.value||options.activeId()||undefined}
    else if(action==='reopen')request.command='reopen'
    else if(action==='pin'){request.command='pin';request.value=!targets.value.every(tab=>tab.pinned)}
    else if(action==='mute'){request.command='mute';request.value=!targets.value.every(tab=>tab.muted)}
    else if(action==='close-left'||action==='close-right'||action==='close-others'){request.ids=closeCandidates(action==='close-left'?'left':action==='close-right'?'right':'others');request.targetId=undefined}
    else if(action.startsWith('move-host:')){request.command='move-host';request.hostId=action.slice('move-host:'.length)}
    else if(['reload','duplicate','copy-url','move-start','move-end','move-new','attach','close'].includes(action))request.command=action as BrowserTabActionRequest['command']
    else return
    if(!request.ids.length&&!['new','reopen'].includes(request.command))return
    closeMenu();pending.value=true
    try{await options.run(request)}catch(error){options.onError(actionError(error))}finally{pending.value=false}
  }
  watch(()=>tabs.value.map(tab=>tab.id),()=>{
    selectedIds.value=ordered(selectedIds.value)
    if(anchorId&&!tabs.value.some(tab=>tab.id===anchorId))anchorId=options.activeId()
    if(contextId.value&&!tabs.value.some(tab=>tab.id===contextId.value))closeMenu()
  })
  onBeforeUnmount(closeMenu)
  return {menuRef,menuItems,contextId,contextIds,selectedIds,pending,busy,selectTab,showMenu,closeMenu,execute,isContextTarget,selectAll,clearSelection}
}

function isPageUrl(url?:string){return !!url&&/^https?:\/\//i.test(url)}
function actionError(error:unknown){
  const message=String(error)
  if(message.includes('mixed_chat_selection'))return '请选择同一对话的网页后再移动。'
  if(/wrong_host|not_found|not_live|stale/.test(message))return '标签页已移动或关闭，请在当前窗口重新操作。'
  if(/busy|manual_control|annotation/.test(message))return '页面当前正在执行任务，请完成后再操作。'
  if(/cancel|beforeunload/.test(message))return '网页取消了关闭操作。'
  return '无法完成标签页操作，请稍后重试。'
}
