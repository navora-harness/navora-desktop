<template>
  <main class="browser-host-page" :aria-busy="!!busy" @keydown="hostKey">
    <DetachedWindowBar class="browser-host-tabs" @dragover="drag.over" @dragleave="drag.leave" @drop="drag.drop($event)">
      <div ref="tabBar" class="browser-host-tablist" role="tablist" aria-label="浏览器标签" @keydown="tabKey">
        <WorkspaceTabItem v-for="p in pages" :key="p.windowId" class="browser-host-tab" :tab-id="`browser-tab-${p.windowId}`" :page-id="p.windowId" :controls="`browser-panel-${p.windowId}`" kind="browser" :label="tabLabel(p)" :title="p.title || p.url" :favicon-url="p.faviconUrl" :loading="p.loading" :selected="p.windowId===active" :draggable="!busy" :close-disabled="!!busy" @pointerdown="drag.prepare(p.windowId)" @dragstart="drag.start($event,p.windowId)" @dragend="drag.end" @drop="drag.drop($event,p.windowId)" @auxclick="middleClose($event,p.windowId)" @select="active=p.windowId" @close="close(p.windowId)" />
      </div>
      <button type="button" class="ui-icon-button browser-host-new-tab" :disabled="!!busy" aria-label="新建浏览器标签页" :title="busy || '新建浏览器标签页（Ctrl/⌘ T）'" @click="create"><AppIcon :icon="busy?'circle-notch':'plus'" :spin="!!busy" /></button>
      <button type="button" class="ui-icon-button browser-host-restore" :disabled="!!busy" aria-label="移回会话窗口" title="移回会话窗口" @mousedown.prevent.stop @click.stop="attachAll"><AppIcon icon="arrow-left-to-line" /></button>
      <span class="browser-host-status" role="status">{{ busy }}</span>
    </DetachedWindowBar>
    <div v-if="error" class="browser-host-error" role="alert"><span>{{ error }}</span><button type="button" class="ui-icon-button" aria-label="关闭窗口操作提示" @click="error='' "><AppIcon icon="xmark" /></button></div>
    <BrowserTabPanel v-for="p in pages" v-show="p.windowId===active" :id="`browser-panel-${p.windowId}`" :key="p.windowId" role="tabpanel" :aria-labelledby="`browser-tab-${p.windowId}`" :chat-id="owner(p.windowId)" :page-id="p.windowId" :active="p.windowId===active" detached />
  </main>
</template>
<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import WorkspaceTabItem from '@/components/WorkspaceTabItem.vue'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {browserTabAfterRemoval,browserTabShortcut,stableBrowserTabOrder,type BrowserTabAction} from '@shared/browser-workspace'
import type {BrowserTreeSession,BrowserTreeWindow} from '@shared/types'
import DetachedWindowBar from '@/components/DetachedWindowBar.vue'
import BrowserTabPanel from '@/components/BrowserTabPanel.vue'
import {useBrowserDrag} from '@/composables/useBrowserDrag'
const tree=ref<BrowserTreeSession[]>([]),active=ref(''),error=ref(''),order=ref<string[]>([]),busy=ref(''),tabBar=ref<HTMLElement|null>(null)
const pages=computed(()=>{
  const list=tree.value.flatMap(s=>s.windows),byId=new Map(list.map(p=>[p.windowId,p]))
  return stableBrowserTabOrder(order.value,list.map(p=>p.windowId)).map(id=>byId.get(id)!)
})
const api=window.navora!.browser.workspace,drag=useBrowserDrag(message=>error.value=friendlyError(message),(id,before)=>{
  if(id===before)return
  order.value=pages.value.map(p=>p.windowId).filter(p=>p!==id)
  const at=before?order.value.indexOf(before):-1
  order.value.splice(at<0?order.value.length:at,0,id)
})
let disposed=false,request=0,unsub:(()=>void)|undefined,presentUnsub:(()=>void)|undefined,shortcutUnsub:(()=>void)|undefined
const knownChats=new Set<string>()
function owner(id:string){return tree.value.find(s=>s.windows.some(p=>p.windowId===id))?.chatId||''}
function tabLabel(page:BrowserTreeWindow){
  const label=page.title||(page.url==='about:blank'?'新标签页':'无标题')
  const duplicates=pages.value.filter(item=>(item.title||(item.url==='about:blank'?'新标签页':'无标题'))===label)
  return duplicates.length>1?`${label} ${duplicates.findIndex(item=>item.windowId===page.windowId)+1}`:label
}
function friendlyError(e:unknown){const text=e instanceof Error?e.message:String(e);return text.includes('browser_busy_finish_action_first')?'请先退出批注或恢复 AI 操作，再移动页面。':text.includes('browser_chat_mismatch')?'不同对话的页面不能合并到同一窗口。':text.includes('browser_busy_wait_for_current_action')?'页面正在执行操作，请稍后重试。':text}
async function refresh(){
  const current=++request
  try{
    const state=await api.state()
    if(disposed||current!==request)return
    const previous=pages.value.map(p=>p.windowId),live=state.pages.flatMap(s=>s.windows).map(p=>p.windowId)
    order.value=stableBrowserTabOrder(order.value,live);tree.value=state.pages
    for(const session of state.pages)knownChats.add(session.chatId)
    active.value=browserTabAfterRemoval(previous,active.value,order.value)
  }catch(e){if(!disposed&&current===request)error.value=friendlyError(e)}
}
async function perform(label:string,run:()=>Promise<void>){if(busy.value)return;busy.value=label;error.value='';try{await run()}catch(e){if(!disposed)error.value=friendlyError(e)}finally{if(!disposed)busy.value=''}}
function focusSelected(){void nextTick(()=>tabBar.value?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus({preventScroll:true}))}
async function close(id:string){
  const restore=!!tabBar.value?.contains(document.activeElement)
  await perform('正在关闭标签页…',async()=>{await window.navora!.browser.closeWindow(id);await refresh();if(restore)focusSelected()})
}
async function create(){
  await perform('正在新建标签页…',async()=>{
    const chatId=owner(active.value)||tree.value[0]?.chatId;if(!chatId)return
    active.value=await api.ensure(chatId,`browser:${crypto.randomUUID()}`);await refresh();await nextTick()
    const panel=[...document.querySelectorAll<HTMLElement>('.browser-tab-panel')].find(p=>p.checkVisibility())
    panel?.querySelector<HTMLInputElement>('[aria-label="浏览器地址"]')?.focus()
  })
}
async function attachAll(){await perform('正在移回工作区…',async()=>{for(const p of [...pages.value])await api.attach(p.windowId)})}
async function shortcut(action:BrowserTabAction,pageId=active.value,fromPage=false){
  if(!pages.value.some(p=>p.windowId===pageId)||busy.value)return
  if(action==='new'){await create();return}
  if(action==='close'){await close(pageId);return}
  const ids=pages.value.map(p=>p.windowId),at=ids.indexOf(pageId)
  active.value=ids[(at+(action==='next'?1:-1)+ids.length)%ids.length]!
  if(fromPage){await nextTick();try{await api.command(active.value,'focus')}catch(e){error.value=friendlyError(e)}}else focusSelected()
}
function hostKey(e:KeyboardEvent){
  if(e.defaultPrevented||document.querySelector('.v-overlay--active,.sidebar-ctx-panel'))return
  const action=browserTabShortcut({key:e.key,control:e.ctrlKey,meta:e.metaKey,shift:e.shiftKey,alt:e.altKey,isComposing:e.isComposing,isAutoRepeat:e.repeat})
  if(action){e.preventDefault();e.stopPropagation();void shortcut(action)}
}
function middleClose(e:MouseEvent,id:string){if(e.button===1){e.preventDefault();void close(id)}}
function tabKey(e:KeyboardEvent){
  if(!(e.target as Element).matches('[role=tab]')||!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(e.key)||!pages.value.length)return
  e.preventDefault();e.stopPropagation()
  if(e.key==='Delete'){void close(active.value);return}
  const at=pages.value.findIndex(p=>p.windowId===active.value),next=e.key==='Home'?0:e.key==='End'?pages.value.length-1:(at+(e.key==='ArrowRight'?1:-1)+pages.value.length)%pages.value.length
  active.value=pages.value[next]!.windowId;focusSelected()
}
watch(active,()=>void nextTick(()=>tabBar.value?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'})))
onMounted(()=>{
  presentUnsub=api.onPresent(async payload=>{await refresh();if(!disposed&&pages.value.some(p=>p.windowId===payload.pageId))active.value=payload.pageId})
  shortcutUnsub=api.onTabShortcut(payload=>void shortcut(payload.action,payload.pageId,true))
  void refresh();unsub=window.navora!.browser.onTreeUpdated(payload=>{
    if(!knownChats.size||knownChats.has(payload.chatId))void refresh()
  })
})
onBeforeUnmount(()=>{disposed=true;request++;unsub?.();presentUnsub?.();shortcutUnsub?.()})
</script>
<style scoped>
.browser-host-page{height:100dvh;display:flex;flex-direction:column;background:var(--navora-surface);min-width:0}
.browser-host-page button,.browser-host-page .ui-action-menu button{cursor:pointer}
.browser-host-tabs{min-width:0;position:relative;gap:5px;background:var(--navora-chrome,var(--navora-background));border-bottom-color:#cbd3dd}
.browser-host-tabs :is(button,[role=tab],.workspace-tab-item){-webkit-app-region:no-drag;pointer-events:auto}
.browser-host-tablist{display:flex;flex:1 1 auto;min-width:0;overflow:auto;scrollbar-width:none;overscroll-behavior-x:contain;gap:5px;align-items:stretch}
.browser-host-tablist::-webkit-scrollbar{display:none}
.browser-host-new-tab{position:relative;z-index:1;width:36px;height:36px;min-height:36px;flex:0 0 36px;margin:0 0 0 1px;padding:0;border:1px solid transparent;border-radius:8px;color:#52677e;-webkit-app-region:no-drag}
.browser-host-new-tab:hover:not(:disabled){border-color:#d5dce5;background:#e7ebf0;color:#263b55}
.browser-host-new-tab:focus-visible{outline:2px solid #6487b1;outline-offset:-2px}
.browser-host-new-tab>.app-icon{width:17px;height:17px;font-size:17px}
.browser-host-restore{position:absolute;right:var(--detached-caption-width,138px);top:2px;width:46px;height:40px;min-height:40px;padding:0;border:0;border-radius:0;background:transparent;color:#52677e;z-index:5;-webkit-app-region:no-drag}
.browser-host-restore>.app-icon{width:18px;height:18px;font-size:18px}
.browser-host-restore:hover:not(:disabled){background:#e7ebf0;color:#263b55}
.browser-host-restore:disabled{opacity:.45}
.browser-host-tabs.platform-mac .browser-host-restore{left:80px;right:auto;top:4px;width:36px;height:36px;min-height:36px;border-radius:7px}
.browser-host-tabs:not(.platform-win):not(.platform-mac) .browser-host-restore{position:relative;top:auto;right:auto;margin-left:auto}
.browser-host-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.browser-host-error{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:13px;color:var(--control-danger);border-bottom:1px solid var(--navora-stroke)}
.browser-host-error>span{flex:1}
</style>
