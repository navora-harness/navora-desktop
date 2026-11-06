<template>
  <main class="browser-host-page" :data-chat-id="selectedContent?.chatId||contextChatId||undefined" :aria-busy="!!busy" @keydown="hostKey" @dblclick="stopTabDoubleClick">
    <DetachedWindowBar class="browser-host-tabs" @dragover="dragOver" @dragleave="dragLeave" @drop="dropTab($event)">
      <button type="button" class="ui-icon-button browser-host-new-tab browser-host-restore" :disabled="!!busy||!tabs.length" :aria-label="attachLabel" :title="busy||attachLabel" @mousedown.prevent.stop @click.stop="attachAll()"><AppIcon icon="workspace-attach" /></button>
      <button type="button" class="ui-icon-button browser-host-new-tab browser-host-pin" :class="{'is-pinned':alwaysOnTop}" :disabled="pinPending" :aria-pressed="alwaysOnTop" :aria-label="alwaysOnTop?'取消窗口置顶':'置顶窗口'" :title="alwaysOnTop?'取消窗口置顶':'置顶窗口'" @mousedown.prevent.stop @click.stop="toggleWindowPin"><AppIcon icon="thumbtack" /></button>
      <button type="button" class="ui-icon-button browser-host-new-tab" :disabled="fullscreenPending" :aria-pressed="fullscreen" :aria-label="fullscreen?'退出全屏（F11）':'进入全屏（F11）'" :title="fullscreen?'退出全屏（F11）':'进入全屏（F11）'" @mousedown.prevent.stop @click.stop="toggleFullscreen"><AppIcon :icon="fullscreen?'window-restore':'window-maximize'" /></button>
      <BrowserTabStrip ref="tabStrip" class="browser-host-tablist" :count="tabs.length" :pinned-count="pages.filter(page=>page.pinned).length" :active-key="active" aria-label="工作区标签" @keydown="tabKey" @contextmenu="blankTabMenu">
        <WorkspaceTabItem v-for="tab in displayTabs" :key="tab.key" class="browser-host-tab" :class="{'has-ai-operation':tab.page?.automation&&tab.page.automation.activeOperations>0&&(tab.page.automation.activity==='acting'||tab.page.automation.activity==='waiting'),'has-control-warning':tab.page?.automation?.activity==='error','is-user-controlled':tab.page?.automation?.owner==='user'}" :tab-id="tabDomId(tab.key)" :file-key="tab.key" :page-id="tab.kind==='browser'?tab.pageId:undefined" :controls="tab.kind==='browser'?'browser-panel-'+tab.pageId:'file-host-content'" :kind="tab.kind" :label="tab.presentation.label" :label-suffix="tab.presentation.suffix" :full-title="tab.presentation.fullTitle" :icon="tab.kind==='file'?tab.presentation.icon:undefined" :description="tab.description" :aria-label="tab.description" :hover-url="tab.page?.desiredUrl||tab.page?.url" :failure="tab.page?.loadError?.description||(tab.page?.crashed?'页面意外退出':undefined)" :favicon-url="tab.page?.faviconUrl" :loading="tab.page?.loading" :selected="tab.key===active" :pinned="tab.page?.pinned" :muted="tab.page?.muted" :manual-muted="tab.page?.manualMuted" :mute-reason="tab.page?.muteReason" :audible="tab.page?.audible" :multi-selected="tab.kind==='browser'&&multiSelected.length>1&&multiSelected.includes(tab.pageId)" :context-target="tab.kind==='browser'&&contextTargets.includes(tab.pageId)" :draggable="!busy&&!menuPending&&(tab.kind==='file'||tabController.canDrag(tab.pageId))" :close-disabled="!!busy||menuPending" @pointerenter="prepareFileDrag(tab)" @pointerdown="prepareDrag($event,tab)" @dragstart="startDrag($event,tab)" @dragend="endDrag($event,tab)" @drop="dropTab($event,tab.key)" @auxclick="middleClose($event,tab)" @contextmenu.stop="tabMenu($event,tab)" @keydown="contextKey($event,tab)" @select="selectTab(tab,$event)" @toggle-mute="tab.kind==='browser'&&tabController.toggleMute(tab.pageId)" @close="close(tab.key)" />
      </BrowserTabStrip>
      <button type="button" class="ui-icon-button browser-host-new-tab" :disabled="!!busy||menuPending||!currentChat()" aria-label="新建浏览器标签页" :title="busy||'新建浏览器标签页（Ctrl/⌘ T）'" @click="create()"><AppIcon :icon="busy?'circle-notch':'plus'" :spin="!!busy" /></button>
      <BrowserTabList :available="!!tabStrip?.overflowing" scope-label="工作区" :tabs="overflowTabs" :active-id="active" @select="selectContent" />
      <span class="browser-host-drag-space" aria-hidden="true" @contextmenu="blankTabMenu" />
      <span class="browser-host-controls-divider" aria-hidden="true" />
      <span class="browser-host-status" role="status">{{ busy }}</span>
    </DetachedWindowBar>
    <ApplicationMenuBar mode="detached" :command-state="applicationMenuState" :handlers="applicationMenuHandlers" :context-key="`${currentHostId}:${active}`" :app-version="appVersion" :capture-target="captureApplicationTarget" :restore-target="restoreApplicationTarget" @error="error=$event" />
    <BrowserTabContextMenu ref="browserMenu" :items="browserMenuItems" @action="tabController.execute" @closed="tabController.closeMenu" />
    <div v-if="error" class="browser-host-error" role="alert"><span>{{ error }}</span><button type="button" class="ui-icon-button" aria-label="关闭窗口操作提示" @click="error='' "><AppIcon icon="xmark" /></button></div>
    <div v-show="!!selectedFile" ref="fileToolbar" class="browser-host-file-toolbar" aria-label="文件工具栏" />
    <div class="browser-host-content">
      <BrowserTabPanel v-for="page in pages" v-show="selectedBrowser?.pageId===page.windowId" :id="'browser-panel-'+page.windowId" :key="page.windowId" role="tabpanel" :aria-labelledby="tabDomId(detachedBrowserTabKey(page.windowId))" :chat-id="owner(page.windowId)" :page-id="page.windowId" :active="selectedBrowser?.pageId===page.windowId" :automation-state="page.automation" detached />
      <div v-show="!!selectedFile" id="file-host-content" class="browser-host-file-content" role="tabpanel" :aria-labelledby="selectedFile?tabDomId(selectedFile.key):undefined">
        <KeepAlive :max="6"><FilePreviewPanel v-if="selectedFile" :key="selectedFile.key" ref="filePreview" embedded tabbed window-toolbar :active="true" :chat-id="selectedFile.file.chatId" :path="selectedFile.file.path" :width="width" :toolbar-target="fileToolbar" @close="close(selectedFile.key)" @open-file="openOwnedFile" @notify="error=$event" /></KeepAlive>
      </div>
    </div>
  </main>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import WorkspaceTabItem from '@/components/WorkspaceTabItem.vue'
import BrowserTabStrip from '@/components/BrowserTabStrip.vue'
import BrowserTabContextMenu from '@/components/BrowserTabContextMenu.vue'
import BrowserTabList from '@/components/BrowserTabList.vue'
import ApplicationMenuBar from '@/components/ApplicationMenuBar.vue'
import DetachedWindowBar from '@/components/DetachedWindowBar.vue'
import BrowserTabPanel from '@/components/BrowserTabPanel.vue'
import FilePreviewPanel from '@/components/FilePreviewPanel.vue'
import {useApplicationEditTarget} from '@/composables/useApplicationEditTarget'
import {useBrowserDrag} from '@/composables/useBrowserDrag'
import {fileTabMime,useFileDrag} from '@/composables/useFileDrag'
import {useWorkspaceFileActions} from '@/composables/useWorkspaceFileActions'
import {useBrowserTabController,browserTabError} from '@/composables/useBrowserTabController'
import {openWindowFind} from '@/composables/useWindowFind'
import {hasVisibleUi} from '@/utils/visible-ui'
import type {AppCommandContext,AppCommandHandlers,AppCommandId,AppCommandStateMap} from '@shared/app-commands'
import {browserPageAddressState,browserPageAddressError,type BrowserPageAddressContext,type BrowserPageAddressAction} from '@shared/browser-page-address'
import {browserTabShortcut,type BrowserEditCommand,type BrowserTabAction} from '@shared/browser-workspace'
import {BrowserHostSelection} from '@shared/browser-host-selection'
import type {BrowserTreeSession} from '@shared/types'
import {makeFileTab,type FileTab,type WorkspaceBrowserTab,type WorkspaceFileTab} from '@shared/file-tabs'
import {detachedBrowserTabKey,detachedFileTabKey,type DetachedWorkspaceState,type DetachedWorkspaceTab} from '@shared/detached-workspace'
import {workspaceTabPresentation} from '@shared/workspace-tab-presentation'
import {fileWindowError} from '@shared/file-windows'

type BrowserContent=Extract<DetachedWorkspaceTab,{kind:'browser'}>
type FileContent=Extract<DetachedWorkspaceTab,{kind:'file'}>
const api=window.navora!.browser.workspace,fileApi=window.navora!.fileTabs
const tree=ref<BrowserTreeSession[]>([]),tabs=ref<DetachedWorkspaceTab[]>([]),active=ref(''),contextChatId=ref<string|null>(null),error=ref(''),busy=ref(''),currentHostId=ref('')
const owners=ref<Record<string,string>>({}),width=ref(innerWidth),fileToolbar=ref<HTMLElement>(),filePreview=ref<InstanceType<typeof FilePreviewPanel>>(),tabStrip=ref<InstanceType<typeof BrowserTabStrip>|null>(null)
const tabBar=computed(()=>tabStrip.value?.element||null),selectedContent=computed(()=>tabs.value.find(tab=>tab.key===active.value))
const selectedBrowser=computed(()=>selectedContent.value?.kind==='browser'?selectedContent.value:undefined),selectedFile=computed(()=>selectedContent.value?.kind==='file'?selectedContent.value:undefined)
const pageMap=computed(()=>new Map(tree.value.flatMap(session=>session.windows).map(page=>[page.windowId,page])))
const pages=computed(()=>tabs.value.flatMap(tab=>tab.kind==='browser'&&pageMap.value.has(tab.pageId)?[pageMap.value.get(tab.pageId)!]:[]))
const selection=new BrowserHostSelection(),knownChats=new Set<string>()
const alwaysOnTop=ref(false),pinPending=ref(false),fullscreen=ref(false),fullscreenPending=ref(false),appVersion=ref('')
const attachLabel=computed(()=>tabs.value.length>1?`将此窗口全部标签页移回工作区（${tabs.value.length} 个）`:'移回工作区')
let disposed=false,dragFileViewer='',unsub:(()=>void)|undefined,presentUnsub:(()=>void)|undefined,shortcutUnsub:(()=>void)|undefined,pinUnsub:(()=>void)|undefined,fullscreenUnsub:(()=>void)|undefined,workspaceUnsub:(()=>void)|undefined,filesUnsub:(()=>void)|undefined
function owner(id:string){return tabs.value.find((tab):tab is BrowserContent=>tab.kind==='browser'&&tab.pageId===id)?.chatId||''}
function currentChat(){return contextChatId.value||selectedContent.value?.chatId||tabs.value[0]?.chatId||''}
function tabDomId(key:string){return `workspace-tab-${encodeURIComponent(key)}`}
const ownerLabel=(id:string)=>owners.value[id]||'对话文件'
function presentationTab(tab:DetachedWorkspaceTab):FileTab{
  if(tab.kind==='file')return tab.file
  const page=pageMap.value.get(tab.pageId)
  return {kind:'browser',key:tab.key,pageId:tab.pageId,chatId:tab.chatId,path:page?.title||'',fullTitle:page?.title,url:page?.url,desiredUrl:page?.desiredUrl} as WorkspaceBrowserTab
}
const displayTabs=computed(()=>{
  const values=tabs.value.map(presentationTab)
  return tabs.value.map(tab=>{
    const presentation=workspaceTabPresentation(presentationTab(tab),values,ownerLabel),page=tab.kind==='browser'?pageMap.value.get(tab.pageId):undefined,state=page?.automation
    const control=state?.activity==='error'?'控制状态待确认':state?.activity==='handoff'||state?.nativePending?'正在交还控制':state?.owner==='user'?'你正在操作':state?.owner==='paused'?'浏览器操作已暂停':state&&state.activeOperations>0&&(state.activity==='acting'||state.activity==='waiting')?'AI 正在操作':''
    return {...tab,page,presentation,description:[presentation.description,control].filter(Boolean).join('，')}
  })
})
const overflowTabs=computed(()=>displayTabs.value.map(tab=>({id:tab.key,title:[tab.presentation.label,tab.presentation.suffix].filter(Boolean).join(' · '),url:tab.kind==='file'?tab.file.path:tab.page?.url,description:tab.description,icon:tab.presentation.icon,pinned:tab.page?.pinned})))
const browserDrag=useBrowserDrag(message=>error.value=browserTabError(message),reorderBrowsers,refresh,id=>multiSelected.value.includes(id)?multiSelected.value:[id])
const fileDrag=useFileDrag(message=>error.value=message,()=>dragFileViewer||contextChatId.value||currentChat())
const tabController=useBrowserTabController({chatId:()=>currentChat(),tabs:()=>pages.value.map(page=>({id:page.windowId,pageId:page.windowId,chatId:owner(page.windowId),title:displayTabs.value.find(tab=>tab.kind==='browser'&&tab.pageId===page.windowId)?.presentation.label||page.title,url:page.desiredUrl||page.url,pinned:page.pinned,muted:page.muted,audible:page.audible,loading:page.loading})),activeId:()=>selectedBrowser.value?.pageId||'',detached:()=>true,busy:()=>!!busy.value,select:selectBrowser,newTab:()=>create(),changed:async()=>{await refresh()},beforeClose:()=>tabStrip.value?.freezeForClose(),notify:message=>error.value=message})
const {menuRef:browserMenu,menuItems:browserMenuItems,selectedIds:multiSelected,contextIds:contextTargets,pending:menuPending}=tabController
const fileActions=useWorkspaceFileActions({open:openOwnedFile,notify:message=>error.value=message,isCurrent:target=>!disposed&&!busy.value&&tabs.value.some(tab=>tab.kind==='file'&&tab.file.chatId===target.chatId&&tab.file.path===target.path)})

function friendlyError(cause:unknown){const raw=String(cause);return /file_|workspace_/.test(raw)?fileWindowError(cause):/browser_|external_open/.test(raw)?browserTabError(cause):cause instanceof Error?cause.message:String(cause)}
function acceptState(state:DetachedWorkspaceState){
  const previous=tabs.value.map(tab=>tab.key)
  tree.value=state.pages;tabs.value=state.tabs;contextChatId.value=state.contextChatId;currentHostId.value=state.hostId;alwaysOnTop.value=!!state.alwaysOnTop
  for(const tab of state.tabs)knownChats.add(tab.chatId)
  active.value=selection.activeId(state.activeKey||undefined,active.value,previous,state.tabs.map(tab=>tab.key))
}
async function refresh(){const request=selection.beginRefresh();try{const state=await api.workspaceState();if(!disposed&&selection.acceptsRefresh(request))acceptState(state)}catch(cause){if(!disposed&&selection.acceptsRefresh(request))error.value=friendlyError(cause)}}
async function perform(label:string,run:()=>Promise<unknown>){if(busy.value||disposed)return;busy.value=label;error.value='';try{await run()}catch(cause){if(!disposed)error.value=friendlyError(cause)}finally{if(!disposed)busy.value=''}}
function focusSelected(){void nextTick(()=>tabStrip.value?.focusSelected())}
async function activateContent(key:string){
  if(disposed||!tabs.value.some(tab=>tab.key===key))return
  const intent=selection.beginSelection(key);active.value=key
  try{const state=await api.activateTab(key);if(!disposed&&selection.isCurrentSelection(intent))acceptState(state)}catch(cause){if(!disposed&&selection.isCurrentSelection(intent))error.value=friendlyError(cause)}
  finally{if(!disposed&&selection.settleSelection(intent))void refresh()}
}
function selectContent(key:string){void activateContent(key)}
function selectBrowser(pageId:string){selectContent(detachedBrowserTabKey(pageId))}
function selectTab(tab:DetachedWorkspaceTab,event:MouseEvent){if(tab.kind==='browser')tabController.selectTab(tab.pageId,event);else{tabController.clearSelection();selectContent(tab.key)}}
function prepareFileDrag(tab:DetachedWorkspaceTab){if(tab.kind==='file'&&!busy.value&&!menuPending.value){dragFileViewer=tab.viewerChatId;void fileDrag.prepare(tab.file)}}
function prepareDrag(event:PointerEvent,tab:DetachedWorkspaceTab){if(event.button!==0||busy.value||menuPending.value||(event.target as Element)?.closest('.workspace-tab-close,.workspace-tab-audio'))return;if(tab.kind==='file')prepareFileDrag(tab);else if(tabController.canDrag(tab.pageId))void browserDrag.prepare(tab.pageId)}
function startDrag(event:DragEvent,tab:DetachedWorkspaceTab){if(tab.kind==='file')fileDrag.start(event,tab.file);else browserDrag.start(event,tab.pageId)}
function endDrag(event:DragEvent,tab:DetachedWorkspaceTab){if(tab.kind==='file')void fileDrag.end(event);else void browserDrag.end(event)}
function dragOver(event:DragEvent){browserDrag.over(event);fileDrag.over(event)}
function dragLeave(event:DragEvent){browserDrag.leave(event);fileDrag.leave(event)}
async function dropTab(event:DragEvent,before?:string){
  if(event.dataTransfer?.types.includes(fileTabMime)){dragFileViewer=contextChatId.value||currentChat();await fileDrag.drop(event,before);await refresh()}
  else await browserDrag.drop(event,before)
}
async function reorderBrowsers(pageId:string,before?:string,pageIds?:string[]){try{await api.reorderTabs((pageIds?.length?pageIds:[pageId]).map(detachedBrowserTabKey),before||null);await refresh()}catch(cause){error.value=friendlyError(cause);await refresh()}}
function blankTabMenu(event:MouseEvent){if((event.target as Element)?.closest('.workspace-tab-item,button'))return;tabController.showMenu(event,null)}
function tabMenu(event:MouseEvent|KeyboardEvent,tab:DetachedWorkspaceTab){
  if(tab.kind==='browser'){tabController.showMenu(event,tab.pageId);return}
  if(busy.value||menuPending.value)return
  const captured={...tab,file:{...tab.file}}
  void fileActions.show({chatId:captured.file.chatId,path:captured.file.path},event,'context',{items:[{id:'attach-tab',label:'当前文件移回工作区',icon:'workspace-attach'},{id:'close-tab',label:'关闭标签页',icon:'xmark'}],run:async id=>{
    if(!tabs.value.some(item=>item.key===captured.key))throw Error('文件标签已移动或关闭，请重新打开菜单。')
    if(id==='attach-tab')await perform('正在移回工作区…',async()=>{await fileApi.attach(captured.file.key);await refresh()})
    else if(id==='close-tab')await close(captured.key)
  }})
}
function contextKey(event:KeyboardEvent,tab:DetachedWorkspaceTab){if(!event.isComposing&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();event.stopPropagation();tabMenu(event,tab)}}
async function close(key:string){
  const tab=tabs.value.find(tab=>tab.key===key),restore=!!tabBar.value?.contains(document.activeElement)
  if(!tab)return
  await perform('正在关闭标签页…',async()=>{tabStrip.value?.freezeForClose();if(tab.kind==='file')await fileApi.close(tab.file.key);else await tabController.closeTabs([tab.pageId]);await refresh();if(restore)focusSelected()})
}
function middleClose(event:MouseEvent,tab:DetachedWorkspaceTab){if(event.button===1){event.preventDefault();if(tab.kind==='file'||!pageMap.value.get(tab.pageId)?.pinned)void close(tab.key)}}
async function create(){await perform('正在新建标签页…',async()=>{
  const chatId=currentChat();if(!chatId)throw Error('当前窗口没有可用的所属对话，请从对话中重新打开。')
  await api.tabAction({chatId,action:'new',pageId:selectedBrowser.value?.pageId});await refresh();await nextTick()
  const panel=[...document.querySelectorAll<HTMLElement>('.browser-tab-panel')].find(element=>element.checkVisibility());panel?.querySelector<HTMLInputElement>('[aria-label="浏览器地址"]')?.focus()
})}
async function attachAll(keys=tabs.value.map(tab=>tab.key)){await perform('正在移回工作区…',async()=>{
  const currentKeys=new Set(tabs.value.map(tab=>tab.key))
  if(keys.length!==currentKeys.size||new Set(keys).size!==currentKeys.size||keys.some(key=>!currentKeys.has(key)))throw Error('窗口标签已变化，请重新打开菜单。')
  const targets=keys.map(key=>tabs.value.find(tab=>tab.key===key));if(targets.some(tab=>!tab))throw Error('窗口标签已变化，请重新打开菜单。')
  const browsers=targets.filter((tab):tab is BrowserContent=>tab?.kind==='browser'),files=targets.filter((tab):tab is FileContent=>tab?.kind==='file')
  // Every operation retains its original owner and waits for the existing host acknowledgement.
  for(const file of files)await fileApi.attach(file.file.key)
  const groups=new Map<string,string[]>();for(const tab of browsers)groups.set(tab.chatId,[...groups.get(tab.chatId)||[],tab.pageId])
  for(const [chatId,pageIds]of groups)await api.tabAction({chatId,action:'attach',pageId:pageIds[0],pageIds})
  await refresh()
})}
function openOwnedFile(path:string,chatId:string){void perform('正在打开文件…',async()=>{await fileApi.open(chatId,path);await refresh();const key=detachedFileTabKey(makeFileTab(chatId,path).key);if(tabs.value.some(tab=>tab.key===key))await activateContent(key)})}
async function toggleWindowPin(){if(pinPending.value||disposed)return;pinPending.value=true;try{const state=await api.setAlwaysOnTop(!alwaysOnTop.value);if(!disposed&&(!currentHostId.value||state.hostId===currentHostId.value))alwaysOnTop.value=state.enabled}catch(cause){if(!disposed)error.value=friendlyError(cause)}finally{pinPending.value=false}}
async function toggleFullscreen(){if(fullscreenPending.value||disposed)return;fullscreenPending.value=true;try{const state=await window.navora!.app.toggleFullscreen();if(!disposed)fullscreen.value=state.fullscreen}catch{if(!disposed)error.value='无法切换窗口全屏，请重试。'}finally{fullscreenPending.value=false}}
function stopTabDoubleClick(event:MouseEvent){if((event.target as Element)?.closest('[role="tab"]')){event.preventDefault();event.stopPropagation()}}
async function shortcut(action:BrowserTabAction,pageId=selectedBrowser.value?.pageId,fromPage=false){
  if(busy.value)return
  if(fromPage&&(!pageId||selectedBrowser.value?.pageId!==pageId))return
  if(action==='new'){await create();return}
  if(action==='reopen'){await tabController.reopen();return}
  if(action==='close'){if(active.value)await close(active.value);return}
  if(action==='address'){if(!selectedBrowser.value)return;await nextTick();const input=[...document.querySelectorAll<HTMLInputElement>('[aria-label="浏览器地址"]')].find(input=>input.checkVisibility());input?.focus();input?.select();return}
  if(action==='mute'){if(pageId)await tabController.toggleMute(pageId);return}
  if(action==='reload'||action==='reloadIgnoringCache'){if(pageId)try{await api.command(pageId,action)}catch(cause){error.value=browserTabError(cause)}else if(selectedFile.value)await filePreview.value?.refresh();return}
  const ids=tabs.value.map(tab=>tab.key),at=ids.indexOf(active.value),next=action==='last'?ids.at(-1):action.startsWith('index')?ids[Number(action.slice(5))-1]:ids[(at+(action==='next'?1:-1)+ids.length)%ids.length]
  if(!next)return
  await activateContent(next)
  if(fromPage&&selectedBrowser.value){await nextTick();try{await api.command(selectedBrowser.value.pageId,'focus')}catch(cause){error.value=friendlyError(cause)}}else focusSelected()
}
function hostKey(event:KeyboardEvent){
  if(event.defaultPrevented||hasVisibleUi('.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])'))return
  if(!event.isComposing&&!event.altKey&&!event.shiftKey&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();openWindowFind('workspace');return}
  const action=browserTabShortcut({key:event.key,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,isComposing:event.isComposing,isAutoRepeat:event.repeat})
  if(action){event.preventDefault();event.stopPropagation();void shortcut(action)}
}
function tabKey(event:KeyboardEvent){
  if(!(event.target as Element).matches('[role=tab]')||!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)||!tabs.value.length||event.isComposing)return
  event.preventDefault();event.stopPropagation();const focused=(event.target as HTMLElement).dataset.fileKey||active.value
  if(event.key==='Delete'){void close(focused);return}
  const at=tabs.value.findIndex(tab=>tab.key===focused),next=event.key==='Home'?0:event.key==='End'?tabs.value.length-1:(at+(event.key==='ArrowRight'?1:-1)+tabs.value.length)%tabs.value.length
  selectContent(tabs.value[next]!.key);focusSelected()
}

const editCommands:BrowserEditCommand[]=['undo','redo','cut','copy','paste','pastePlain','delete','selectAll']
const applicationEditing=useApplicationEditTarget({nativePage:()=>{const page=selectedBrowser.value&&pageMap.value.get(selectedBrowser.value.pageId);return page&&!page.loadError&&/^https?:\/\//i.test(page.url)?page.windowId:undefined},preview:()=>[...document.querySelectorAll<HTMLElement>('.browser-start-page,.browser-host-file-content .preview-code,.browser-host-file-content .preview-markdown')].find(element=>element.checkVisibility())||null})
type ApplicationTarget={key:string;kind:DetachedWorkspaceTab['kind'];chatId:string;pageId?:string;file?:WorkspaceFileTab;edit:unknown;address?:BrowserPageAddressContext;allKeys:string[]}
function captureApplicationTarget(nativePageId?:string):ApplicationTarget|undefined{
  const tab=selectedContent.value;if(!tab||nativePageId&&(tab.kind!=='browser'||tab.pageId!==nativePageId))return
  return {key:tab.key,kind:tab.kind,chatId:tab.chatId,...(tab.kind==='file'?{file:{...tab.file}}:{pageId:tab.pageId,address:browserPageAddressState(pageMap.value.get(tab.pageId),tab.chatId).context}),edit:applicationEditing.capture(nativePageId),allKeys:tabs.value.map(tab=>tab.key)}
}
function restoreApplicationTarget(value:unknown){return applicationEditing.restore((value as ApplicationTarget|undefined)?.edit)}
function applicationTarget(context:AppCommandContext){const target=context.target as ApplicationTarget|undefined;if(!target||target.key!==active.value||!tabs.value.some(tab=>tab.key===target.key&&tab.kind===target.kind&&tab.chatId===target.chatId))throw Error('内容标签已变化，请重新打开菜单。');return target}
async function browserAddressCommand(context:AppCommandContext,action:BrowserPageAddressAction){const target=applicationTarget(context);try{if(!target.address)throw Error('browser_page_address_changed');await api.pageAddressAction(target.address,action)}catch(cause){throw Error(browserPageAddressError(cause))}}
const applicationMenuState=computed<AppCommandStateMap>(()=>{
  const page=selectedBrowser.value&&pageMap.value.get(selectedBrowser.value.pageId),address=browserPageAddressState(page,selectedBrowser.value?.chatId),available=!!selectedContent.value&&!busy.value&&!menuPending.value,isBrowser=!!selectedBrowser.value,isFile=!!selectedFile.value,state:AppCommandStateMap={
    'browser.new':{enabled:!!currentChat()&&!busy.value},'browser.reopen':{enabled:!!tabController.state.value?.recentlyClosed.length&&!busy.value,reason:'当前对话没有可恢复的浏览器标签页。'},
    'content.close':{enabled:available},'workspace.attach':{enabled:available,label:attachLabel.value},
    'file.reveal':{visible:isFile,enabled:available},'file.openExternal':{visible:isFile,enabled:available},
    'view.windowPinned':{enabled:!pinPending.value,checked:alwaysOnTop.value},'view.fullscreen':{enabled:!fullscreenPending.value,checked:fullscreen.value,label:fullscreen.value?'退出全屏':'进入全屏'},
    'conversation.find':{enabled:available,label:isFile?'在当前文件中查找…':'在当前网页中查找…'},
    'browser.reload':{enabled:available,label:isFile?'刷新文件预览':'重新加载页面'},'browser.reloadIgnoringCache':{visible:isBrowser,enabled:available},'browser.mute':{visible:isBrowser,enabled:available,label:page?.muted?'取消当前页面静音':'静音当前页面',checked:!!page?.muted},
    'browser.copyUrl':{visible:isBrowser,enabled:available&&!!address.context,label:address.copyLabel,reason:address.reason},'browser.openExternal':{visible:isBrowser&&address.visible,enabled:available&&!!address.context,label:address.label,reason:address.reason},
  }
  for(const command of editCommands)state[`edit.${command}` as AppCommandId]={enabled:available&&applicationEditing.state.value[command],reason:isFile?'当前文件预览为只读；请选择文本后复制。':'当前目标不支持此编辑操作。'}
  return state
})
const applicationMenuHandlers=computed<AppCommandHandlers>(()=>{
  const handlers:AppCommandHandlers={
    'browser.new':()=>create(),'browser.reopen':()=>tabController.reopen(),'content.close':context=>close(applicationTarget(context).key),'workspace.attach':context=>attachAll(applicationTarget(context).allKeys),
    'view.windowPinned':()=>toggleWindowPin(),'view.fullscreen':()=>toggleFullscreen(),'conversation.find':context=>{applicationTarget(context);openWindowFind('workspace')},
    'browser.reload':async context=>{const target=applicationTarget(context);if(target.kind==='browser'&&target.pageId)await api.command(target.pageId,'reload');else await filePreview.value?.refresh()},
    'browser.reloadIgnoringCache':context=>{const target=applicationTarget(context);if(target.pageId)return api.command(target.pageId,'reloadIgnoringCache')},'browser.mute':context=>{const target=applicationTarget(context);if(target.pageId)return tabController.toggleMute(target.pageId)},
    'browser.copyUrl':context=>browserAddressCommand(context,'copy'),'browser.openExternal':context=>browserAddressCommand(context,'external'),
    'file.reveal':async context=>{const target=applicationTarget(context);if(target.file)await fileActions.perform({chatId:target.file.chatId,path:target.file.path},'reveal')},
    'file.openExternal':async context=>{const target=applicationTarget(context);if(target.file)await fileActions.perform({chatId:target.file.chatId,path:target.file.path},'system')},
  }
  for(const command of editCommands)handlers[`edit.${command}` as AppCommandId]=context=>applicationEditing.execute(command,applicationTarget(context).edit)
  return handlers
})
const resized=()=>width.value=innerWidth
watch(active,()=>void nextTick(()=>tabBar.value?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'})))
watch(()=>displayTabs.value.find(tab=>tab.key===active.value)?.presentation.fullTitle,title=>{document.title=title?`${title} — Navora`:'工作区 — Navora'},{immediate:true})
onMounted(()=>{
  fullscreenUnsub=window.navora!.app.onFullscreen(value=>{if(!disposed)fullscreen.value=value});void window.navora!.app.isFullscreen().then(state=>{if(!disposed)fullscreen.value=state.fullscreen}).catch(()=>{})
  pinUnsub=api.onAlwaysOnTop?.(state=>{if(!disposed&&state.hostId===currentHostId.value)alwaysOnTop.value=state.enabled})
  void window.navora!.app.info().then(info=>{if(!disposed)appVersion.value=info.version}).catch(()=>{})
  void window.navora!.chats.list().then(chats=>{if(!disposed)owners.value=Object.fromEntries(chats.map(chat=>[chat.id,chat.title]))}).catch(()=>{})
  presentUnsub=api.onPresent(()=>void refresh());shortcutUnsub=api.onTabShortcut(payload=>void shortcut(payload.action,payload.pageId,true));workspaceUnsub=api.onWorkspaceChanged(()=>void refresh());filesUnsub=fileApi.onChanged(()=>void refresh())
  void refresh();unsub=window.navora!.browser.onTreeUpdated(payload=>{if(!knownChats.size||knownChats.has(payload.chatId))void refresh()});window.addEventListener('resize',resized)
})
onBeforeUnmount(()=>{disposed=true;selection.invalidate();unsub?.();presentUnsub?.();shortcutUnsub?.();pinUnsub?.();fullscreenUnsub?.();workspaceUnsub?.();filesUnsub?.();window.removeEventListener('resize',resized)})
</script>
<style scoped>
.browser-host-page{height:100dvh;display:flex;flex-direction:column;background:var(--navora-surface);min-width:0;min-height:0;overflow:hidden}.browser-host-page button,.browser-host-page .ui-action-menu button{cursor:default}
.browser-host-tabs{min-width:0;position:relative;gap:4px;background:var(--navora-header,var(--navora-surface));border-bottom-color:var(--navora-stroke)}.browser-host-tabs.platform-win{padding-right:var(--detached-caption-width,138px)}.browser-host-tabs :is(button,[role=tab],.workspace-tab-item){-webkit-app-region:no-drag;pointer-events:auto}
.browser-host-drag-space{flex:1 0 36px;min-width:36px;align-self:stretch;-webkit-app-region:drag}.browser-host-controls-divider{position:absolute;right:var(--detached-caption-width,138px);top:13px;height:18px;width:1px;background:var(--navora-stroke);pointer-events:none}.browser-host-tabs:not(.platform-win) .browser-host-controls-divider{position:static;flex:0 0 1px;align-self:center}.browser-host-tablist::-webkit-scrollbar{display:none}
.browser-host-new-tab{position:relative;z-index:1;width:32px;height:32px;min-height:32px;flex:0 0 32px;margin:0;padding:0;border:1px solid transparent;border-radius:7px;color:var(--tab-ink);-webkit-app-region:no-drag}.browser-host-new-tab:hover:not(:disabled){border-color:var(--tab-hover-border);background:var(--tab-control-hover);color:var(--tab-hover-ink)}.browser-host-new-tab:focus-visible{outline:2px solid var(--tab-focus);outline-offset:-2px}.browser-host-new-tab>.app-icon{width:17px;height:17px;font-size:17px}.browser-host-pin.is-pinned{background:var(--tab-control-hover);color:var(--tab-hover-ink);border-color:var(--tab-hover-border)}
.browser-host-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.browser-host-error{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:13px;color:var(--control-danger);border-bottom:1px solid var(--navora-stroke)}.browser-host-error>span{flex:1}
.browser-host-content{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.browser-host-file-content{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}.browser-host-file-toolbar{display:flex;flex:none;min-width:0;min-height:44px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-header,var(--navora-surface))}
</style>
