<template>
  <main class="browser-host-page" :aria-busy="!!busy" @keydown="hostKey">
    <DetachedWindowBar class="browser-host-tabs" @dragover="drag.over" @dragleave="drag.leave" @drop="drag.drop($event)">
      <BrowserTabStrip ref="tabStrip" class="browser-host-tablist" :count="pages.length" :pinned-count="pages.filter(p=>p.pinned).length" :active-key="active" @keydown="tabKey" @contextmenu="blankTabMenu">
        <WorkspaceTabItem v-for="p in pages" :key="p.windowId" class="browser-host-tab" :class="{'has-ai-operation':p.automation&&p.automation.activeOperations>0&&(p.automation.activity==='acting'||p.automation.activity==='waiting'),'has-control-warning':p.automation?.activity==='error','is-user-controlled':p.automation?.owner==='user'}" :tab-id="`browser-tab-${p.windowId}`" :page-id="p.windowId" :controls="`browser-panel-${p.windowId}`" kind="browser" :label="tabLabel(p)" :label-suffix="presentation(p).suffix" :full-title="presentation(p).fullTitle" :mute-reason="p.muteReason" :manual-muted="p.manualMuted" :title="tabDescription(p)" :aria-label="tabDescription(p)" :hover-url="p.desiredUrl||p.url" :failure="p.loadError?.description||(p.crashed?'页面意外退出':undefined)" :favicon-url="p.faviconUrl" :loading="p.loading" :selected="p.windowId===active" :pinned="p.pinned" :muted="p.muted" :audible="p.audible" :multi-selected="multiSelected.length>1&&multiSelected.includes(p.windowId)" :context-target="contextTargets.includes(p.windowId)" :draggable="!busy&&!menuPending&&tabController.canDrag(p.windowId)" :close-disabled="!!busy||menuPending" @pointerdown="prepareDrag($event,p.windowId)" @dragstart="drag.start($event,p.windowId)" @dragend="drag.end" @drop="drag.drop($event,p.windowId)" @auxclick="middleClose($event,p.windowId)" @contextmenu.stop="tabController.showMenu($event,p.windowId)" @keydown="contextKey($event,p.windowId)" @select="tabController.selectTab(p.windowId,$event)" @toggle-mute="tabController.toggleMute(p.windowId)" @close="close(p.windowId)" />
      </BrowserTabStrip>
      <button type="button" class="ui-icon-button browser-host-new-tab" :disabled="!!busy||menuPending" aria-label="新建浏览器标签页" :title="busy || '新建浏览器标签页（Ctrl/⌘ T）'" @click="create()"><AppIcon :icon="busy?'circle-notch':'plus'" :spin="!!busy" /></button>
      <BrowserTabList :available="!!tabStrip?.overflowing" :tabs="tabController.tabs.value" :active-id="active" @select="select" />
      <span class="browser-host-drag-space" aria-hidden="true" @contextmenu="blankTabMenu" />
      <span class="browser-host-controls-divider" aria-hidden="true" />
      <button type="button" class="ui-icon-button browser-host-restore" :disabled="!!busy" :aria-label="attachLabel" :title="busy || attachLabel" @mousedown.prevent.stop @click.stop="attachAll"><AppIcon icon="workspace-attach" /></button>
      <span class="browser-host-status" role="status">{{ busy }}</span>
    </DetachedWindowBar>
    <ApplicationMenuBar mode="detached" :command-state="applicationMenuState" :handlers="applicationMenuHandlers" :context-key="`${owner(active)}:${active}`" :app-version="appVersion" :capture-target="applicationEditing.capture" :restore-target="applicationEditing.restore" @error="error=$event" />
    <BrowserTabContextMenu ref="browserMenu" :items="browserMenuItems" @action="tabController.execute" @closed="tabController.closeMenu" />
    <div v-if="error" class="browser-host-error" role="alert"><span>{{ error }}</span><button type="button" class="ui-icon-button" aria-label="关闭窗口操作提示" @click="error='' "><AppIcon icon="xmark" /></button></div>
    <BrowserTabPanel v-for="p in pages" v-show="p.windowId===active" :id="`browser-panel-${p.windowId}`" :key="p.windowId" role="tabpanel" :aria-labelledby="`browser-tab-${p.windowId}`" :chat-id="owner(p.windowId)" :page-id="p.windowId" :active="p.windowId===active" :automation-state="p.automation" detached />
  </main>
</template>
<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import WorkspaceTabItem from '@/components/WorkspaceTabItem.vue'
import BrowserTabStrip from '@/components/BrowserTabStrip.vue'
import BrowserTabContextMenu from '@/components/BrowserTabContextMenu.vue'
import BrowserTabList from '@/components/BrowserTabList.vue'
import ApplicationMenuBar from '@/components/ApplicationMenuBar.vue'
import {useApplicationEditTarget} from '@/composables/useApplicationEditTarget'
import type {AppCommandHandlers,AppCommandId,AppCommandStateMap} from '@shared/app-commands'
import type {BrowserEditCommand} from '@shared/browser-workspace'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {browserTabShortcut,stableBrowserTabOrder,type BrowserTabAction} from '@shared/browser-workspace'
import {BrowserHostSelection} from '@shared/browser-host-selection'
import type {BrowserTreeSession,BrowserTreeWindow} from '@shared/types'
import {workspaceTabPresentation} from '@shared/workspace-tab-presentation'
import type {WorkspaceBrowserTab} from '@shared/file-tabs'
import DetachedWindowBar from '@/components/DetachedWindowBar.vue'
import BrowserTabPanel from '@/components/BrowserTabPanel.vue'
import {useBrowserDrag} from '@/composables/useBrowserDrag'
import {useBrowserTabController,browserTabError} from '@/composables/useBrowserTabController'
const tree=ref<BrowserTreeSession[]>([]),active=ref(''),error=ref(''),order=ref<string[]>([]),busy=ref(''),tabStrip=ref<InstanceType<typeof BrowserTabStrip>|null>(null)
const tabBar=computed(()=>tabStrip.value?.element||null)
const pages=computed(()=>{
  const list=tree.value.flatMap(s=>s.windows),byId=new Map(list.map(p=>[p.windowId,p]))
  return stableBrowserTabOrder(order.value,list.map(p=>p.windowId)).map(id=>byId.get(id)!).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(a.order??list.indexOf(a))-(b.order??list.indexOf(b)))
})
const attachLabel=computed(()=>pages.value.length>1?`将此窗口全部标签页移回工作区（${pages.value.length} 个）`:'移回工作区')
const api=window.navora!.browser.workspace,drag=useBrowserDrag(message=>error.value=browserTabError(message),(id,before,ids)=>reorder(id,before,ids),refresh,id=>multiSelected.value.includes(id)?multiSelected.value:[id])
const tabController=useBrowserTabController({chatId:()=>owner(active.value)||tree.value[0]?.chatId||'',tabs:()=>pages.value.map(p=>({id:p.windowId,pageId:p.windowId,chatId:owner(p.windowId),title:tabLabel(p),url:p.desiredUrl||p.url,pinned:p.pinned,muted:p.muted,audible:p.audible,loading:p.loading})),activeId:()=>active.value,detached:()=>true,busy:()=>!!busy.value,select,changed:async()=>{await refresh()},beforeClose:()=>tabStrip.value?.freezeForClose(),notify:message=>error.value=message})
const {menuRef:browserMenu,menuItems:browserMenuItems,selectedIds:multiSelected,contextIds:contextTargets,pending:menuPending}=tabController
const appVersion=ref(''),editCommands:BrowserEditCommand[]=['undo','redo','cut','copy','paste','pastePlain','delete','selectAll']
const applicationEditing=useApplicationEditTarget({nativePage:()=>{const page=pages.value.find(page=>page.windowId===active.value);return page&&!page.loadError&&/^https?:\/\//i.test(page.desiredUrl||page.url)?page.windowId:undefined},preview:()=>[...document.querySelectorAll<HTMLElement>('.browser-start-page')].find(element=>element.checkVisibility())||null})
const applicationMenuState=computed<AppCommandStateMap>(()=>{
  const available=!!active.value&&!busy.value&&!menuPending.value,state:AppCommandStateMap={
    'browser.new':{enabled:!!tree.value[0]?.chatId&&!busy.value},'browser.reopen':{enabled:!!tabController.state.value?.recentlyClosed.length&&!busy.value,reason:'当前对话没有可恢复的浏览器标签页。'},
    'content.close':{enabled:available},'workspace.attach':{enabled:available,label:attachLabel.value},
    'browser.reload':{enabled:available},'browser.reloadIgnoringCache':{enabled:available},'browser.mute':{enabled:available,label:pages.value.find(page=>page.windowId===active.value)?.muted?'取消当前页面静音':'静音当前页面',checked:!!pages.value.find(page=>page.windowId===active.value)?.muted},
  }
  for(const command of editCommands)state[`edit.${command}` as AppCommandId]={enabled:available&&applicationEditing.state.value[command],reason:'当前目标不支持此编辑操作。'}
  return state
})
const applicationMenuHandlers=computed<AppCommandHandlers>(()=>{
  const handlers:AppCommandHandlers={
    'browser.new':()=>create(),'browser.reopen':()=>tabController.reopen(),'content.close':()=>close(active.value),'workspace.attach':()=>attachAll(),
    'browser.reload':()=>api.command(active.value,'reload'),'browser.reloadIgnoringCache':()=>api.command(active.value,'reloadIgnoringCache'),'browser.mute':()=>tabController.toggleMute(active.value),
  }
  for(const command of editCommands)handlers[`edit.${command}` as AppCommandId]=context=>applicationEditing.execute(command,context.target)
  return handlers
})
let disposed=false,unsub:(()=>void)|undefined,presentUnsub:(()=>void)|undefined,shortcutUnsub:(()=>void)|undefined
const selection=new BrowserHostSelection()
const knownChats=new Set<string>()
function owner(id:string){return tree.value.find(s=>s.windows.some(p=>p.windowId===id))?.chatId||''}
const presentationTab=(p:BrowserTreeWindow):WorkspaceBrowserTab=>({kind:"browser",key:p.windowId,pageId:p.windowId,chatId:owner(p.windowId),path:p.title,fullTitle:p.title,url:p.url,desiredUrl:p.desiredUrl})
const presentation=(p:BrowserTreeWindow)=>workspaceTabPresentation(presentationTab(p),pages.value.map(presentationTab))
const tabLabel=(p:BrowserTreeWindow)=>presentation(p).label
function tabDescription(page:BrowserTreeWindow){
  const state=page.automation
  const detail=state?.activity==='error'?'控制状态待确认':state?.activity==='handoff'||state?.nativePending?'正在交还控制':state?.owner==='user'?'你正在操作':state?.owner==='paused'?'浏览器操作已暂停':state&&state.activeOperations>0&&(state.activity==='acting'||state.activity==='waiting')?'AI 正在操作':''
  return [presentation(page).description,detail].filter(Boolean).join('，')
}
function friendlyError(e:unknown){const text=e instanceof Error?e.message:String(e);return text.includes('browser_busy_finish_action_first')?'请先退出批注或恢复 AI 操作，再移动页面。':text.includes('browser_chat_mismatch')?'不同对话的页面不能合并到同一窗口。':text.includes('browser_busy_wait_for_current_action')?'页面正在执行操作，请稍后重试。':/browser_page_wrong_host|browser_page_not_found|browser_drag_stale/.test(text)?'标签页已移动或关闭，正在更新列表。':text}
async function refresh(){
  const current=selection.beginRefresh()
  try{
    const state=await api.state()
    if(disposed||!selection.acceptsRefresh(current))return
    const previous=pages.value.map(p=>p.windowId),live=state.pages.flatMap(s=>s.windows).map(p=>p.windowId)
    order.value=stableBrowserTabOrder(order.value,live);tree.value=state.pages
    for(const session of state.pages)knownChats.add(session.chatId)
    active.value=selection.activeId(state.pages.flatMap(s=>s.windows).find(p=>p.hostActive)?.windowId,active.value,previous,order.value)
  }catch(e){if(!disposed&&selection.acceptsRefresh(current))error.value=friendlyError(e)}
}
async function perform(label:string,run:()=>Promise<void>){if(busy.value)return;busy.value=label;error.value='';try{await run()}catch(e){if(!disposed)error.value=friendlyError(e)}finally{if(!disposed)busy.value=''}}
function focusSelected(){void nextTick(()=>tabStrip.value?.focusSelected())}
function select(id:string){
  const chatId=owner(id);if(!chatId||disposed)return
  const intent=selection.beginSelection(id)
  active.value=id
  void api.tabAction({chatId,action:'activate',pageId:id}).catch(e=>{if(!disposed&&selection.isCurrentSelection(intent))error.value=browserTabError(e)}).finally(()=>{if(!disposed&&selection.settleSelection(intent))void refresh()})
}
function prepareDrag(event:PointerEvent,id:string){if(!busy.value&&!menuPending.value&&tabController.canDrag(id)&&event.button===0&&!(event.target as Element)?.closest('.workspace-tab-close,.workspace-tab-audio'))void drag.prepare(id)}
function blankTabMenu(event:MouseEvent){if((event.target as Element)?.closest('.workspace-tab-item,button'))return;tabController.showMenu(event,null)}
function contextKey(event:KeyboardEvent,id:string){if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();tabController.showMenu(event,id)}}
async function reorder(id:string,before?:string,group?:string[]){const chatId=owner(id)||tree.value[0]?.chatId;if(!chatId)return;try{const ids=group?.length?group:multiSelected.value.includes(id)&&multiSelected.value.length>1?[...multiSelected.value]:[id];if(before&&ids.includes(before))return;await api.tabAction({chatId,action:'reorder',pageIds:ids,beforeId:before||null});await refresh()}catch(e){error.value=browserTabError(e);await refresh()}}
async function close(id:string){
  const restore=!!tabBar.value?.contains(document.activeElement)
  await perform('正在关闭标签页…',async()=>{await tabController.closeTabs([id]);await refresh();if(restore)focusSelected()})
}
async function create(){
  await perform('正在新建标签页…',async()=>{
    const chatId=owner(active.value)||tree.value[0]?.chatId;if(!chatId)return
    const result=await api.tabAction({chatId,action:'new',pageId:active.value||undefined});await refresh();if(result.pageId)active.value=result.pageId;await nextTick()
    const panel=[...document.querySelectorAll<HTMLElement>('.browser-tab-panel')].find(p=>p.checkVisibility())
    panel?.querySelector<HTMLInputElement>('[aria-label="浏览器地址"]')?.focus()
  })
}
async function attachAll(){await perform('正在移回工作区…',async()=>{const chatId=owner(active.value)||tree.value[0]?.chatId;if(chatId)await api.tabAction({chatId,action:'attach',pageId:active.value,pageIds:pages.value.map(page=>page.windowId)})})}
async function shortcut(action:BrowserTabAction,pageId=active.value,fromPage=false){
  if(!pages.value.some(p=>p.windowId===pageId)||busy.value)return
  if(action==='new'){await create();return}
  if(action==='reopen'){await tabController.reopen();return}
  if(action==='address'){await nextTick();const input=[...document.querySelectorAll<HTMLInputElement>('[aria-label="浏览器地址"]')].find(input=>input.checkVisibility());input?.focus();input?.select();return}
  if(action==='mute'){await tabController.toggleMute(pageId);return}
  if(action==='reload'||action==='reloadIgnoringCache'){try{await api.command(pageId,action)}catch(e){error.value=browserTabError(e)}return}
  if(action==='close'){await close(pageId);return}
  const ids=pages.value.map(p=>p.windowId),at=ids.indexOf(pageId)
  const next=action==='last'?ids.at(-1):action.startsWith('index')?ids[Number(action.slice(5))-1]:ids[(at+(action==='next'?1:-1)+ids.length)%ids.length]
  if(!next)return
  select(next)
  if(fromPage){await nextTick();try{await api.command(active.value,'focus')}catch(e){error.value=friendlyError(e)}}else focusSelected()
}
function hostKey(e:KeyboardEvent){
  if(e.defaultPrevented||document.querySelector('.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])'))return
  const action=browserTabShortcut({key:e.key,control:e.ctrlKey,meta:e.metaKey,shift:e.shiftKey,alt:e.altKey,isComposing:e.isComposing,isAutoRepeat:e.repeat})
  if(action){e.preventDefault();e.stopPropagation();void shortcut(action)}
}
function middleClose(e:MouseEvent,id:string){if(e.button===1){e.preventDefault();if(!pages.value.find(p=>p.windowId===id)?.pinned)void close(id)}}
function tabKey(e:KeyboardEvent){
  if(!(e.target as Element).matches('[role=tab]')||!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(e.key)||!pages.value.length)return
  e.preventDefault();e.stopPropagation()
  const focused=(e.target as HTMLElement).dataset.pageId||active.value
  if(e.key==='Delete'){void close(focused);return}
  const at=pages.value.findIndex(p=>p.windowId===focused),next=e.key==='Home'?0:e.key==='End'?pages.value.length-1:(at+(e.key==='ArrowRight'?1:-1)+pages.value.length)%pages.value.length
  select(pages.value[next]!.windowId);focusSelected()
}
watch(active,()=>void nextTick(()=>tabBar.value?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'})))
onMounted(()=>{
  void window.navora!.app.info().then(info=>{if(!disposed)appVersion.value=info.version}).catch(()=>{})
  // Present notifications can arrive after a newer activation. Their pageId is
  // not a new selection intent; replaying it after refresh creates an activate
  // / present feedback loop between old and new panels.
  presentUnsub=api.onPresent(()=>void refresh())
  shortcutUnsub=api.onTabShortcut(payload=>void shortcut(payload.action,payload.pageId,true))
  void refresh();unsub=window.navora!.browser.onTreeUpdated(payload=>{
    if(!knownChats.size||knownChats.has(payload.chatId))void refresh()
  })
})
onBeforeUnmount(()=>{disposed=true;selection.invalidate();unsub?.();presentUnsub?.();shortcutUnsub?.()})
</script>
<style scoped>
.browser-host-page{height:100dvh;display:flex;flex-direction:column;background:var(--navora-surface);min-width:0}
.browser-host-page button,.browser-host-page .ui-action-menu button{cursor:default}
.browser-host-tabs{min-width:0;position:relative;gap:4px;background:var(--navora-chrome,var(--navora-background));border-bottom-color:var(--navora-stroke)}
.browser-host-tabs :is(button,[role=tab],.workspace-tab-item){-webkit-app-region:no-drag;pointer-events:auto}
.browser-host-tablist .browser-host-tab.has-ai-operation{border-bottom-color:var(--navora-accent)}
.browser-host-tablist .browser-host-tab.has-control-warning{border-bottom-color:var(--control-danger,#b65045)}
.browser-host-tablist .browser-host-tab.is-user-controlled{border-bottom-color:var(--navora-muted)}
.browser-host-drag-space{flex:1 0 36px;min-width:36px;align-self:stretch;-webkit-app-region:drag}
.browser-host-controls-divider{position:absolute;right:calc(var(--detached-caption-width,138px) + 46px);top:13px;height:18px;width:1px;background:var(--navora-stroke);pointer-events:none}
.browser-host-tabs:not(.platform-win) .browser-host-controls-divider{position:static;flex:0 0 1px;align-self:center}
.browser-host-tablist::-webkit-scrollbar{display:none}
.browser-host-new-tab{position:relative;z-index:1;width:32px;height:32px;min-height:32px;flex:0 0 32px;margin:0;padding:0;border:1px solid transparent;border-radius:7px;color:#52677e;-webkit-app-region:no-drag}
.browser-host-new-tab:hover:not(:disabled){border-color:#d5dce5;background:#e7ebf0;color:#263b55}
.browser-host-new-tab:focus-visible{outline:2px solid #6487b1;outline-offset:-2px}
.browser-host-new-tab>.app-icon{width:17px;height:17px;font-size:17px}
.browser-host-restore{position:absolute;right:var(--detached-caption-width,138px);top:2px;width:46px;height:40px;min-height:40px;padding:0;border:0;border-radius:0;background:transparent;color:#52677e;z-index:5;-webkit-app-region:no-drag}
.browser-host-restore>.app-icon{width:19px;height:19px;font-size:19px}
.browser-host-restore:hover:not(:disabled){background:#e7ebf0;color:#263b55}
.browser-host-restore:disabled{opacity:.45}
.browser-host-tabs.platform-mac .browser-host-restore{left:80px;right:auto;top:4px;width:36px;height:36px;min-height:36px;border-radius:7px}
.browser-host-tabs:not(.platform-win):not(.platform-mac) .browser-host-restore{position:relative;top:auto;right:auto;margin-left:auto}
.browser-host-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.browser-host-error{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:13px;color:var(--control-danger);border-bottom:1px solid var(--navora-stroke)}
.browser-host-error>span{flex:1}
</style>
