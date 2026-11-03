<template>
  <aside ref="panel" class="file-workspace" :class="{overlay,'full-page':fullPage}" :aria-label="fullPage?'浏览器内容区':'工作区'" :style="fullPage?undefined:{width:`${width}px`}" @keydown="onWorkspaceKey">
    <div v-if="!overlay && !fullPage" class="file-workspace-resizer" role="separator" aria-label="调整工作区宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="320" :aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @dblclick="emit('resize',540)" @keydown="resizeKey" />
    <header class="file-workspace-head" @dragover="dragOver" @dragleave="fileDrag.leave" @drop="dropTab($event)">
      <div ref="tabBar" class="file-workspace-tabs" role="tablist" aria-label="已打开的文件与网页" @keydown="onTabsKey" @wheel="onTabWheel"><TransitionGroup tag="div" name="workspace-tab" class="file-workspace-tab-list">
        <WorkspaceTabItem v-for="(tab,index) in tabs" :key="tab.key" class="file-workspace-tab" :class="{selected:active?.key===tab.key}" :tab-id="`${uid}-${index}`" :file-key="tab.key" :page-id="tab.pageId" :controls="`${uid}-content`" :kind="tab.kind==='browser'?'browser':'file'" :label="tabLabel(tab)" :title="`${ownerLabel(tab.chatId)} / ${tab.path}`" :aria-label="`${tabLabel(tab)}，${tab.loading?'正在加载，':''}${ownerLabel(tab.chatId)}`" :selected="active?.key===tab.key" :draggable="tab.kind==='browser'?!!tab.pageId:desktop" :favicon-url="tab.faviconUrl" :loading="tab.loading" close-label="关闭标签页" @pointerenter="tab.kind==='browser'?undefined:fileDrag.prepare(tab)" @pointerdown="tab.kind==='browser'?browserDrag.prepare(tab.pageId):fileDrag.prepare(tab)" @dragstart="tab.kind==='browser'?browserDrag.start($event,tab.pageId):fileDrag.start($event,tab)" @dragend="tab.kind==='browser'?browserDrag.end($event):fileDrag.end($event)" @dragover="dragOver" @drop="dropTab($event,tab.kind==='browser'?tab.pageId:tab.key)" @auxclick="closeOnMiddle($event,tab.key)" @select="emit('select',tab.key)" @close="closeTab(tab.key)" />
      </TransitionGroup></div>
      <button type="button" class="file-workspace-close file-workspace-new-tab" aria-label="新建浏览器标签页" title="新建浏览器标签页" @click="emit('openBrowser')"><AppIcon icon="plus" /></button>
      <ActionMenu label="工作区更多操作" default-cursor :items="workspaceActions" @select="workspaceAction" />
      <button v-if="!fullPage" type="button" class="ui-icon-button workspace-expand" :aria-label="expanded?'还原工作区':'展开工作区'" :title="expanded?'还原工作区':'展开工作区'" @click="emit('expand')"><AppIcon :icon="expanded?'workspace-restore':'workspace-expand'" /></button>
      <button type="button" class="ui-icon-button" :class="{'browser-primary-return':fullPage}" :title="fullPage?'返回对话，保留网页':'隐藏工作区，保留已打开的标签'" :aria-label="fullPage?'返回对话并保留网页':'隐藏工作区'" @click="hidePanel"><AppIcon v-if="fullPage" icon="comments" /><AppIcon v-else icon="angles-right" /></button>
    </header>
    <div v-if="active && active.chatId!==viewerChatId" class="file-workspace-owner">来自 {{ ownerLabel(active.chatId) }}</div>
    <div :id="`${uid}-content`" class="file-workspace-content" role="tabpanel" :aria-labelledby="active?`${uid}-${tabs.findIndex(tab=>tab.key===active?.key)}`:undefined">
      <div v-if="!tabs.length" class="workspace-empty" :class="{'browser-empty':fullPage}">
        <template v-if="fullPage"><span class="browser-empty-icon"><AppIcon icon="globe" /></span><strong>当前没有打开的网页</strong><p>从左侧选择已有页面，或新建网页开始浏览。</p><button type="button" class="ui-button primary" @click="emit('openBrowser')"><AppIcon icon="plus" />新建网页</button></template>
        <template v-else><AppIcon icon="window-restore" /><strong>工作区</strong><p>在这里查看文件和网页</p><button type="button" class="ui-button" @click="emit('openBrowser')">新建网页</button><button type="button" class="ui-button" @click="pickerOpen=true">打开对话文件</button></template>
      </div>
      <KeepAlive :max="4"><FilePreviewPanel v-if="active && active.kind!=='browser'" :key="active.key" tabbed embedded :chat-id="active.chatId" :path="active.path" :width="width" @close="hidePanel" @open-file="emit('openFile',{path:$event,chatId:active.chatId})" @notify="notify" /></KeepAlive>
      <BrowserTabPanel v-for="tab in tabs.filter(item=>item.kind==='browser')" v-show="active?.key===tab.key" :key="tab.key" :chat-id="tab.chatId" :tab-key="tab.key" :active="active?.key===tab.key" :url="tab.url" @expand="emit('expand')" @changed="(title,url,pageId,faviconUrl,loading)=>emit('browserChanged',tab.key,title,url,pageId,faviconUrl,loading)" />
    </div>
    <v-dialog v-model="pickerOpen" max-width="420" content-class="file-picker-dialog" @after-enter="focusPicker" @after-leave="finishLocate"><section ref="pickerRoot" class="file-workspace-picker" aria-label="选择工作区文件"><header><span>当前对话文件</span><button type="button" class="file-workspace-close" aria-label="关闭文件选择" @click="pickerOpen=false"><AppIcon icon="xmark" /></button></header><WorkspaceFilePicker :chat-id="viewerChatId" @open="chooseFile" @locate="locateFile" /></section></v-dialog>
  </aside>
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
import WorkspaceTabItem from './WorkspaceTabItem.vue'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import {browserTabShortcut,type BrowserTabAction} from '@shared/browser-workspace'
import type {FileTab} from '@shared/file-tabs'
import FilePreviewPanel from './FilePreviewPanel.vue'
import BrowserTabPanel from './BrowserTabPanel.vue'
import {useFileDrag,fileTabMime} from '@/composables/useFileDrag'
import {useBrowserDrag} from '@/composables/useBrowserDrag'
import WorkspaceFilePicker from './WorkspaceFilePicker.vue'
import ActionMenu from './ActionMenu.vue'
const props=defineProps<{tabs:FileTab[];active:FileTab|null;viewerChatId:string;width:number;maximum:number;overlay:boolean;expanded?:boolean;fullPage?:boolean;ownerLabel:(id:string)=>string}>()
const emit=defineEmits<{openBrowser:[];browserChanged:[key:string,title:string,url:string,pageId:string,faviconUrl?:string,loading?:boolean];expand:[];reorder:[pageId:string,before?:string];select:[key:string];close:[key:string];hide:[];resize:[width:number];openFile:[file:{path:string;chatId:string}];notify:[text:string,color?:string];locate:[payload:{chatId:string;messageId:string}]}>()
const desktop=window.navora?.app.platform!=='web',fileDrag=useFileDrag(message=>emit('notify',message,'warning'),()=>props.viewerChatId)
function dragOver(event:DragEvent){browserDrag.over(event);fileDrag.over(event)}
function dropTab(event:DragEvent,before?:string){if(event.dataTransfer?.types.includes(fileTabMime))void fileDrag.drop(event,before);else void browserDrag.drop(event,before)}
const browserDrag=useBrowserDrag(message=>emit('notify',message,'warning'),(id,before)=>emit('reorder',id,before))
const uid='file-workspace-'+useId(),panel=ref<HTMLElement|null>(null),tabBar=ref<HTMLElement|null>(null)
const pickerOpen=ref(false)
const pickerRoot=ref<HTMLElement>()
function focusPicker(){if(pickerOpen.value)pickerRoot.value?.querySelector('input')?.focus()}
const workspaceActions=computed(()=>[
  ...(!props.fullPage?[{id:'file',label:'打开文件标签页',icon:'folder-open'},{id:'expand',label:props.expanded?'还原工作区':'展开工作区',icon:props.expanded?'workspace-restore':'workspace-expand'}]:[]),
  ...(props.active?[{id:'detach',label:'移至独立窗口',icon:'arrow-up-right-from-square',disabled:!desktop||(props.active.kind==='browser'&&!props.active.pageId)}]:[]),
  {id:'close',label:'关闭当前标签页',icon:'xmark',disabled:!props.active,divider:true}
])
function workspaceAction(action:string){if(action==='file')pickerOpen.value=true;else if(action==='expand')emit('expand');else if(action==='close'&&props.active)closeTab(props.active.key);else if(action==='detach'&&props.active){const run=props.active.kind==='browser'?window.navora!.browser.workspace.detach(props.active.pageId!):window.navora!.fileTabs.detach({...props.active},props.viewerChatId);void run.catch(e=>emit('notify',String(e),'warning'))}}
let pendingLocate:{chatId:string;messageId:string}|undefined
function locateFile(messageId:string){pendingLocate={chatId:props.viewerChatId,messageId};pickerOpen.value=false}
function finishLocate(){const target=pendingLocate;pendingLocate=undefined;if(target)emit('locate',target)}
watch(pickerOpen,value=>{if(value)pendingLocate=undefined})
function chooseFile(path:string){pickerOpen.value=false;emit('openFile',{path,chatId:props.viewerChatId})}
watch(()=>props.viewerChatId,()=>{pendingLocate=undefined;pickerOpen.value=false})
const name=(path:string)=>path.split('/').at(-1)||path
function tabLabel(tab:FileTab){
  const label=tab.kind==='browser'?(tab.path||'新标签页'):name(tab.path)
  if(tab.kind!=='browser')return label
  const duplicates=props.tabs.filter(item=>item.kind==='browser'&&(item.path||'新标签页')===label)
  return duplicates.length>1?`${label} ${duplicates.indexOf(tab)+1}`:label
}
const notify=(text:string,color?:string)=>emit('notify',text,color)
function selectedButton(){return tabBar.value?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')}
function onTabWheel(event:WheelEvent){
  const el=event.currentTarget as HTMLElement,max=el.scrollWidth-el.clientWidth
  if(max<=1)return
  const delta=event.shiftKey?(event.deltaX||event.deltaY):Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY
  if(!delta)return
  const next=Math.max(0,Math.min(max,el.scrollLeft+delta))
  if(next===el.scrollLeft)return
  event.preventDefault();el.scrollLeft=next
}
function closeOnMiddle(event:MouseEvent,key:string){if(event.button===1){event.preventDefault();closeTab(key)}}
watch(()=>props.active?.key,()=>void nextTick(()=>selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})))
function restoreLauncher(){void nextTick(()=>{const target=[...document.querySelectorAll<HTMLButtonElement>('[data-chat-resource=workspace]:not(:disabled),[data-chat-resource=resources],.file-manager .file-manager-row.selected .file-manager-entry,[data-resource-kind=files] [role=treeitem][aria-selected=true]')].filter(el=>el.checkVisibility()).sort((a,b)=>Number(b.dataset.chatResource==='workspace')-Number(a.dataset.chatResource==='workspace'))[0];target?.focus({preventScroll:true})})}
function hidePanel(){emit('hide');if(!props.fullPage)restoreLauncher()}
function closeTab(key:string){if(props.tabs.length===1){emit('close',key);if(!props.fullPage)restoreLauncher();return}const restore=tabBar.value?.contains(document.activeElement);emit('close',key);if(restore)void nextTick(()=>selectedButton()?.focus({preventScroll:true}))}
function onTabsKey(event:KeyboardEvent){
  if(!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)||!(event.target as Element).matches('[role=tab]'))return
  event.preventDefault();event.stopPropagation()
  if(event.key==='Delete'){if(props.active)closeTab(props.active.key);return}
  const current=props.tabs.findIndex(tab=>tab.key===props.active?.key)
  const index=event.key==='Home'?0:event.key==='End'?props.tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+props.tabs.length)%props.tabs.length
  const tab=props.tabs[index];if(tab){emit('select',tab.key);void nextTick(()=>selectedButton()?.focus({preventScroll:true}))}
}
async function shortcut(action:BrowserTabAction,pageId?:string){
  const source=pageId?props.tabs.find(t=>t.pageId===pageId):props.active
  if(pageId&&!source)return
  if(action==='new'){emit('openBrowser');await nextTick();[...panel.value?.querySelectorAll<HTMLInputElement>('[aria-label="浏览器地址"]')||[]].find(el=>el.checkVisibility())?.focus();return}
  if(!source)return
  if(action==='close'){closeTab(source.key);return}
  const at=props.tabs.findIndex(t=>t.key===source.key),next=props.tabs[(at+(action==='next'?1:-1)+props.tabs.length)%props.tabs.length]
  if(!next)return
  emit('select',next.key);await nextTick()
  if(pageId&&next.pageId){try{await window.navora!.browser.workspace.command(next.pageId,'focus')}catch(e){emit('notify',String(e),'warning')}}else selectedButton()?.focus({preventScroll:true})
}
function onWorkspaceKey(event:KeyboardEvent){
  if(event.defaultPrevented||event.isComposing)return
  if(event.key==='Escape'){event.stopPropagation();if(!(event.target as Element).closest('input,textarea,select')){event.preventDefault();hidePanel()}return}
  const action=browserTabShortcut({key:event.key,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,isAutoRepeat:event.repeat})
  if(action){event.preventDefault();event.stopPropagation();void shortcut(action)}
}
let shortcutUnsub:(()=>void)|undefined
onMounted(()=>{if(window.navora?.app.platform!=='web')shortcutUnsub=window.navora!.browser.workspace.onTabShortcut(payload=>void shortcut(payload.action,payload.pageId));if(props.active?.kind==='browser'&&!props.active.pageId&&props.active.url==='about:blank')void nextTick(()=>panel.value?.querySelector<HTMLInputElement>('[aria-label="浏览器地址"]')?.focus())})
let stopResize:(()=>void)|undefined
function resizeKey(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();emit('resize',event.key==='Home'?540:event.key==='End'?props.maximum:props.width+(event.key==='ArrowLeft'?20:-20))}
function beginResize(event:PointerEvent){
  if(event.button!==0)return
  event.preventDefault();stopResize?.()
  const handle=event.currentTarget as HTMLElement,start=event.clientX,width=props.width
  const move=(next:PointerEvent)=>emit('resize',width+start-next.clientX)
  const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);stopResize=undefined}
  handle.setPointerCapture(event.pointerId);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);stopResize=end
}
watch(()=>props.overlay,()=>stopResize?.())
onBeforeUnmount(()=>{stopResize?.();shortcutUnsub?.()})
</script>
<style>
.file-workspace{container-type:inline-size}
.shell:not(.mobile-layout) .browser-primary-return{display:none}
.file-workspace.full-page{inset:0;width:100%;border-left:0;box-shadow:none}
.file-workspace.full-page .file-workspace-head{min-height:44px}
.shell:not(.mobile-layout) .file-workspace.full-page .file-workspace-head{padding-right:12px}
.shell.frameless:not(.mobile-layout) .file-workspace.full-page .file-workspace-head{box-sizing:border-box;height:48px;min-height:48px;background:var(--navora-header,#f8f9fb);-webkit-app-region:no-drag}
.shell.mobile-layout .file-workspace.full-page{top:calc(88px + env(safe-area-inset-top,0px))}
.shell.mobile-layout:not(.frameless) .file-workspace.full-page{top:calc(48px + env(safe-area-inset-top,0px))}
.browser-workspace-heading h1{font-size:14px;font-weight:550}
.browser-workspace-heading .ui-button{margin-left:auto}
.workspace-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--navora-muted);padding:24px;text-align:center}
.workspace-empty>svg{width:28px;height:28px}
.workspace-empty p{margin:0;font-size:13px}
.workspace-empty.browser-empty{gap:10px}
.browser-empty-icon{display:grid;place-items:center;width:44px;height:44px;margin-bottom:4px;border:1px solid #dce4ed;border-radius:13px;background:#fff;color:#74869c;box-shadow:0 2px 7px #25384d0a}
.browser-empty-icon>.app-icon{width:21px;height:21px}
.browser-empty>strong{color:#384c65;font-size:15px;font-weight:600}
.browser-empty>p{max-width:340px;color:#74849a;line-height:1.6}
.browser-empty>.ui-button{margin-top:7px}
@container(max-width:520px){.file-workspace-head .workspace-expand{display:none}}

/* The parent content area already starts below the window title bar. */
.file-workspace{position:absolute;inset:0 0 0 auto;display:flex;flex-direction:column;min-width:0;min-height:0;max-width:100%;background:#f7f8fa;border-left:1px solid #d8dee7;z-index:7;isolation:isolate}.file-workspace.overlay{box-shadow:-8px 0 30px #243b5814}
.file-workspace-head :is(button,[role=tab],.workspace-tab-item,.file-workspace-tabs,.file-workspace-tab-list){-webkit-app-region:no-drag;pointer-events:auto}
.file-workspace-head{display:flex;align-items:center;min-height:44px;gap:6px;padding:4px 8px;border-bottom:1px solid #e0e5ec;background:#fff;flex-shrink:0}.file-workspace-tabs{display:flex;align-items:center;gap:5px;overflow-x:auto;scrollbar-width:thin;min-width:0;flex:1}.file-workspace-tab{display:flex;align-items:center;gap:0;flex:0 1 190px;min-width:132px;max-width:190px;height:36px;box-sizing:border-box;border:1px solid #dfe5ec;border-radius:9px;background:#fff;color:#40536b;transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease}.file-workspace-tab:hover{background:#f5f7fa;color:#263b55;border-color:#bdcbd9}.file-workspace-tab.selected{border-color:#9eb5ce;background:#eaf1f8;color:#1f3e61;box-shadow:inset 0 -2px 0 #547fae}.file-workspace-tab>[role=tab]{display:flex;align-items:center;gap:8px;min-width:0;height:100%;text-align:left;padding:0 4px 0 10px;border:0;border-radius:8px;background:transparent;color:inherit;flex:1}.file-workspace-tab>[role=tab]>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:1.3}.file-workspace-tab>[role=tab]>svg{width:14px;height:14px;flex-shrink:0;color:#586d84}.file-workspace-tab.selected>[role=tab]>svg{color:#315f90}.file-tab-close,.file-workspace-close{display:grid;place-items:center;width:25px;height:25px;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:#51657e}.file-tab-close{margin:0 4px 0 1px;opacity:.82;transition:opacity 120ms ease,background-color 120ms ease,color 120ms ease}.file-workspace-tab.selected .file-tab-close,.file-workspace-tab:hover .file-tab-close,.file-workspace-tab:focus-within .file-tab-close{opacity:1}.file-tab-close svg,.file-workspace-close svg{width:13px;height:13px}.file-tab-close:hover{background:#e5ebf2;color:#263b55}.file-workspace-close:hover{background:#e8edf3;border-color:#d5dce6;color:#344c68}.file-workspace button:focus-visible,.file-workspace-resizer:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}.file-workspace-tabs .file-workspace-tab:focus-within{border-color:#7898bb}.file-workspace-owner{padding:5px 12px;border-bottom:1px solid #e0e5ec;background:#fff;color:#748194;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file-workspace-content{display:flex;flex:1;min-height:0;min-width:0}.navora-app .shell .file-workspace .file-workspace-content>.file-preview.embedded{border-radius:0;top:auto;width:100%}.file-workspace-resizer{position:absolute;inset:0 auto 0 -4px;width:8px;cursor:col-resize;touch-action:none;z-index:2}.file-workspace-resizer:hover{background:#537ab929}
.file-workspace .file-workspace-tab>.file-tab-close{width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;flex:0 0 24px;margin:0 4px 0 1px;border:0;border-radius:6px;background:transparent;color:#5d718a;opacity:.9}
.file-workspace .file-workspace-tab>.file-tab-close:hover{background:#fdebec;color:#b5323c}
.file-workspace .file-workspace-tab>.file-tab-close:focus-visible{outline:2px solid #7898bb;outline-offset:-2px;opacity:1}
/* Firefox-like tab strip: quiet inactive tabs and a raised white active tab. */
.file-workspace-head{background:#f1f3f6;border-bottom-color:#cbd3dd}
.file-workspace-tabs{gap:2px}
.file-workspace-head .workspace-expand{border-radius:9px;color:#7b838d}
.file-workspace-head .workspace-expand>.app-icon{width:15px;height:15px}
.file-workspace-head .workspace-expand:hover:not(:disabled){background:#e6e8eb;color:#535c67}
.file-workspace .file-workspace-tab{border-color:transparent;border-radius:8px 8px 0 0;background:transparent;color:#4d5e73}
.file-workspace .file-workspace-tab:hover{border-color:#d6dce4;background:#e8ebef;color:#304258}
.file-workspace .file-workspace-tab.selected{border-color:#cbd3dd;border-bottom-color:#fff;border-radius:8px 8px 0 0;background:#fff;color:#1f2f43;box-shadow:none}
.file-workspace .file-workspace-tab.selected>[role=tab]>svg{color:#425f7f}
.file-workspace{border-left:0}
.file-workspace-resizer{left:-6px;width:12px;background:transparent}
.file-workspace-resizer::before{content:'';position:absolute;left:5px;top:8px;bottom:8px;width:1px;border-radius:1px;background:linear-gradient(180deg,transparent,#c8d2de 12%,#c8d2de 88%,transparent);transition:width 140ms ease,background 140ms ease}
.file-workspace-resizer::after{content:'';position:absolute;left:3px;top:calc(50% - 18px);width:5px;height:36px;border-radius:4px;background:#7892ae;opacity:0;transform:scale(.85);transition:opacity 140ms ease,transform 140ms ease}
.file-workspace-resizer:hover::before,.file-workspace-resizer:active::before,.file-workspace-resizer:focus-visible::before{left:4px;width:3px;background:#6f92b8}
.file-workspace-resizer:hover::after,.file-workspace-resizer:active::after,.file-workspace-resizer:focus-visible::after{opacity:.72;transform:scale(1)}
.file-workspace-enter-active,.file-workspace-leave-active{transition:opacity 180ms ease,transform 180ms ease}.file-workspace-enter-from,.file-workspace-leave-to{opacity:0;transform:translateX(12px)}
.file-workspace-picker{width:min(360px,calc(100vw - 24px));max-height:420px;display:flex;flex-direction:column;padding:8px 12px 12px;background:#fff;border:1px solid #d8dee7;border-radius:12px;color:#58677b;box-shadow:0 8px 24px #243b581a;font-size:12px}.file-workspace-picker>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.file-workspace-picker>.sidebar-panel{margin:0;border:0;padding:0;min-height:0;overflow:auto}.file-workspace-picker .res-body{padding:0;max-height:310px;overflow:auto}.file-workspace-picker .ws-root{font-size:10px;color:#7e8a9a}.file-workspace-picker .res-head{display:none}.file-workspace-picker .res-tree{max-height:none}.file-workspace-picker .tree-row{color:#53657b}.file-workspace-picker .res-empty{padding:20px;color:#7e8a9a}
.navora-app .main.file-workspace-open{padding-right:var(--file-workspace-reserve)}
.navora-app .shell.frameless:not(.mobile-layout)>.main.file-workspace-open .main-top{padding-right:12px}
.navora-app .main>.conversation-resource-card{right:calc(var(--file-workspace-reserve,0px) + 12px);max-width:calc(100% - var(--file-workspace-reserve,0px) - 24px)}
.navora-app .shell.frameless.mobile-layout .file-workspace{top:calc(88px + env(safe-area-inset-top,0px))}.navora-app .shell.mobile-layout:not(.frameless) .file-workspace{top:calc(48px + env(safe-area-inset-top,0px))}
@media(prefers-reduced-motion:reduce){.file-workspace-enter-active,.file-workspace-leave-active{transition:none}}
.v-dialog.v-overlay>.v-overlay__content.file-picker-dialog{padding:0;border:0!important;border-radius:12px;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;overflow:visible}
.file-workspace-picker{width:100%;min-height:0;max-height:min(420px,calc(100dvh - 48px));overflow:hidden}.file-workspace-picker>header{flex-shrink:0}.file-workspace-picker>.workspace-file-picker{flex:1;min-height:0;overflow:hidden}.file-workspace-picker .workspace-picker-results{flex:1}
.file-workspace button{cursor:pointer}
.file-workspace .file-workspace-tab{height:36px;flex:0 1 250px;min-width:112px;max-width:280px;border:1px solid #d5dce5;border-radius:9px;background:#f5f7fa;color:#53657b;box-shadow:none}
.file-workspace .file-workspace-tab:hover{border-color:#bdcbd9;background:#edf2f7;color:#30465f}
.file-workspace .file-workspace-tab.selected{border-color:#9eb5ce;border-radius:9px;background:#fff;color:#203a57;box-shadow:0 1px 3px rgba(35,52,72,.07)}
.file-workspace .file-workspace-tab>[role=tab]{height:100%;padding:0 5px 0 10px;border-radius:8px;font-size:13px;font-weight:550;cursor:pointer}
.file-workspace .file-workspace-tab>[role=tab]>.workspace-tab-kind-icon{width:16px;height:16px}
.file-workspace .file-workspace-tab>.workspace-tab-close{width:24px;height:24px;min-width:24px;flex:0 0 24px;margin:0 4px 0 0;opacity:0}
.file-workspace .file-workspace-tab:is(:hover,.selected,:focus-within)>.workspace-tab-close{opacity:1}
.file-workspace .file-workspace-tabs{gap:5px}
.file-workspace .file-workspace-head{background:#fff;border-bottom-color:#e0e5ec}
.file-workspace .file-workspace-tabs{display:flex;width:auto;max-width:none;flex:1 1 0%;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scrollbar-color:transparent transparent;overscroll-behavior-x:contain;margin-right:0}
.file-workspace .file-workspace-tabs::-webkit-scrollbar{display:none;width:0;height:0}
.file-workspace .file-workspace-tab-list{display:flex;align-items:center;gap:5px;width:100%;min-width:0}
.file-workspace .file-workspace-tab{min-width:108px}
.file-workspace .file-workspace-new-tab{margin-right:auto;color:#65778d;background:transparent;border-color:transparent;transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease}
.file-workspace .file-workspace-new-tab:hover{color:#3e5874;background:#e7edf4;border-color:#d2dce7}
.file-workspace .file-workspace-new-tab:active{color:#304b68;background:#dce5ee;border-color:#c7d4e2}
.file-workspace .workspace-tab-enter-active,.file-workspace .workspace-tab-leave-active{transition:opacity 170ms ease,transform 170ms ease,flex-basis 170ms ease,max-width 170ms ease,margin 170ms ease}
.file-workspace .workspace-tab-move{transition:transform 170ms ease}
.file-workspace .file-workspace-tab.workspace-tab-enter-from,.file-workspace .file-workspace-tab.workspace-tab-leave-to{min-width:0!important;max-width:0!important;flex-basis:0!important;margin:0!important;border-width:0!important;opacity:0;transform:scale(.96)}
.file-workspace.full-page .file-workspace-head{height:44px;min-height:44px;padding:4px 10px;background:var(--navora-chrome,var(--navora-background));border-bottom-color:#e4e8ee}
.file-workspace.full-page .file-workspace-tab{height:34px;border-color:transparent;border-radius:9px;background:transparent;color:#53657b}
.file-workspace.full-page .file-workspace-tab:hover{border-color:#e0e6ed;background:#edf1f5;color:#30465f}
.file-workspace.full-page .file-workspace-tab.selected{border-color:#d8e0e9;border-radius:9px;background:#fff;color:#203a57;box-shadow:0 1px 2px rgba(35,52,72,.06)}
.file-workspace.full-page .file-workspace-new-tab{width:32px;min-width:32px;height:32px;min-height:32px;border-radius:8px}
.file-workspace.full-page .file-workspace-head>.ui-icon-button{width:32px;min-width:32px;height:32px;min-height:32px;border-radius:8px}
@container(max-width:520px){.file-workspace .file-workspace-tabs{max-width:calc(100% - 124px)}}
@media(prefers-reduced-motion:reduce){.file-workspace .workspace-tab-enter-active,.file-workspace .workspace-tab-leave-active,.file-workspace .workspace-tab-move{transition:none}.file-workspace .file-workspace-tab.workspace-tab-enter-from,.file-workspace .file-workspace-tab.workspace-tab-leave-to{transform:none}}
</style>
