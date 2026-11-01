<template>
  <aside ref="panel" class="file-workspace" :class="{overlay}" aria-label="文件侧栏" :style="{width:`${width}px`}" @keydown="onWorkspaceKey">
    <div v-if="!overlay" class="file-workspace-resizer" role="separator" aria-label="调整文件侧栏宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="320" :aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @keydown="resizeKey" />
    <header class="file-workspace-head">
      <div ref="tabBar" class="file-workspace-tabs" role="tablist" aria-label="已打开文件" @keydown="onTabsKey">
        <div v-for="(tab,index) in tabs" :key="tab.key" class="file-workspace-tab" :class="{selected:active?.key===tab.key}" role="presentation" @auxclick="closeOnMiddle($event,tab.key)">
          <button :id="`${uid}-${index}`" type="button" role="tab" :data-file-key="tab.key" :aria-label="`${name(tab.path)}，${ownerLabel(tab.chatId)}，${tab.path}`" :aria-selected="active?.key===tab.key" :aria-controls="`${uid}-content`" :tabindex="active?.key===tab.key?0:-1" :title="`${ownerLabel(tab.chatId)} / ${tab.path}`" @click="emit('select',tab.key)"><font-awesome-icon icon="file-lines" /><span>{{ name(tab.path) }}</span></button>
          <button type="button" class="file-tab-close" :aria-label="`关闭标签页：${name(tab.path)}`" :title="`关闭 ${tab.path}`" @click="closeTab(tab.key)"><font-awesome-icon icon="xmark" /></button>
        </div>
      </div>
      <v-menu v-model="pickerOpen" location="bottom end" :close-on-content-click="false" max-width="360" @after-leave="finishLocate">
        <template #activator="{props:menuProps}"><button v-bind="menuProps" type="button" class="file-workspace-close" aria-label="新增文件标签页" title="选择文件"><font-awesome-icon icon="plus" /></button></template>
        <section class="file-workspace-picker" aria-label="选择工作区文件"><header><span>当前对话文件</span><button type="button" class="file-workspace-close" aria-label="关闭文件选择" @click="pickerOpen=false"><font-awesome-icon icon="xmark" /></button></header><WorkspaceFilePicker :chat-id="viewerChatId" @open="chooseFile" @locate="locateFile" /></section>
      </v-menu>
      <button type="button" class="file-workspace-close" aria-label="关闭文件预览" title="收起文件侧栏" @click="hidePanel"><font-awesome-icon icon="xmark" /></button>
    </header>
    <div v-if="active && active.chatId!==viewerChatId" class="file-workspace-owner">来自 {{ ownerLabel(active.chatId) }}</div>
    <div :id="`${uid}-content`" class="file-workspace-content" role="tabpanel" :aria-labelledby="`${uid}-${tabs.findIndex(tab=>tab.key===active?.key)}`">
      <KeepAlive :max="4"><FilePreviewPanel v-if="active" :key="active.key" tabbed embedded :chat-id="active.chatId" :path="active.path" :width="width" @close="hidePanel" @open-file="emit('openFile',{path:$event,chatId:active.chatId})" @notify="notify" /></KeepAlive>
    </div>
  </aside>
</template>
<script setup lang="ts">
import {nextTick,onBeforeUnmount,ref,useId,watch} from 'vue'
import type {FileTab} from '@shared/file-tabs'
import FilePreviewPanel from './FilePreviewPanel.vue'
import WorkspaceFilePicker from './WorkspaceFilePicker.vue'
const props=defineProps<{tabs:FileTab[];active:FileTab|null;viewerChatId:string;width:number;maximum:number;overlay:boolean;ownerLabel:(id:string)=>string}>()
const emit=defineEmits<{select:[key:string];close:[key:string];hide:[];resize:[width:number];openFile:[file:{path:string;chatId:string}];notify:[text:string,color?:string];locate:[payload:{chatId:string;messageId:string}]}>()
const uid='file-workspace-'+useId(),panel=ref<HTMLElement|null>(null),tabBar=ref<HTMLElement|null>(null)
const pickerOpen=ref(false)
let pendingLocate:{chatId:string;messageId:string}|undefined
function locateFile(messageId:string){pendingLocate={chatId:props.viewerChatId,messageId};pickerOpen.value=false}
function finishLocate(){const target=pendingLocate;pendingLocate=undefined;if(target)emit('locate',target)}
watch(pickerOpen,value=>{if(value)pendingLocate=undefined})
function chooseFile(path:string){pickerOpen.value=false;emit('openFile',{path,chatId:props.viewerChatId})}
watch(()=>props.viewerChatId,()=>{pendingLocate=undefined;pickerOpen.value=false})
const name=(path:string)=>path.split('/').at(-1)||path
const notify=(text:string,color?:string)=>emit('notify',text,color)
function selectedButton(){return tabBar.value?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')}
watch(()=>props.active?.key,()=>void nextTick(()=>selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})))
function restoreLauncher(){void nextTick(()=>{const target=[...document.querySelectorAll<HTMLButtonElement>('[data-chat-resource=workspace]:not(:disabled),[data-chat-resource=resources],.file-manager .file-manager-row.selected .file-manager-entry,[data-resource-kind=files] [role=treeitem][aria-selected=true]')].filter(el=>el.checkVisibility()).sort((a,b)=>Number(b.dataset.chatResource==='workspace')-Number(a.dataset.chatResource==='workspace'))[0];target?.focus({preventScroll:true})})}
function hidePanel(){emit('hide');restoreLauncher()}
function closeOnMiddle(event:MouseEvent,key:string){if(event.button===1){event.preventDefault();closeTab(key)}}
function closeTab(key:string){if(props.tabs.length===1){emit('close',key);restoreLauncher();return}const restore=tabBar.value?.contains(document.activeElement);emit('close',key);if(restore)void nextTick(()=>selectedButton()?.focus({preventScroll:true}))}
function onTabsKey(event:KeyboardEvent){
  if(!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)||!(event.target as Element).matches('[role=tab]'))return
  event.preventDefault();event.stopPropagation()
  if(event.key==='Delete'){if(props.active)closeTab(props.active.key);return}
  const current=props.tabs.findIndex(tab=>tab.key===props.active?.key)
  const index=event.key==='Home'?0:event.key==='End'?props.tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+props.tabs.length)%props.tabs.length
  const tab=props.tabs[index];if(tab){emit('select',tab.key);void nextTick(()=>selectedButton()?.focus({preventScroll:true}))}
}
function onWorkspaceKey(event:KeyboardEvent){if(event.key==='Escape'){event.stopPropagation();if(!(event.target as Element).closest('input,textarea,select')){event.preventDefault();hidePanel()}return}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w'&&props.active){event.preventDefault();event.stopPropagation();closeTab(props.active.key)}}
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
onBeforeUnmount(()=>stopResize?.())
</script>
<style>
.file-workspace{position:absolute;inset:44px 0 0 auto;display:flex;flex-direction:column;min-width:0;min-height:0;max-width:100%;background:#f7f8fa;border-left:1px solid #d8dee7;z-index:7;isolation:isolate}.file-workspace.overlay{box-shadow:-8px 0 30px #243b5814}
.file-workspace-head{display:flex;align-items:center;min-height:43px;gap:6px;padding:5px 8px;border-bottom:1px solid #e0e5ec;background:#fff;flex-shrink:0}.file-workspace-tabs{display:flex;align-items:center;gap:5px;overflow-x:auto;scrollbar-width:thin;min-width:0;flex:1}.file-workspace-tab{display:flex;align-items:center;gap:1px;flex:0 0 auto;min-width:110px;max-width:210px;border:1px solid transparent;border-radius:8px;color:#7b8593}.file-workspace-tab.selected{border-color:#d5dce6;background:#f8f9fb;color:#3e526b}.file-workspace-tab>[role=tab]{display:flex;align-items:center;gap:7px;min-width:0;text-align:left;padding:6px 3px 6px 9px;flex:1}.file-workspace-tab>[role=tab]>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.file-workspace-tab>[role=tab]>svg{width:12px;height:12px;flex-shrink:0}.file-tab-close,.file-workspace-close{display:grid;place-items:center;width:25px;height:25px;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:#798493}.file-tab-close{margin-right:3px}.file-tab-close svg,.file-workspace-close svg{width:12px;height:12px}.file-tab-close:hover,.file-workspace-close:hover{background:#e8edf3;border-color:#d5dce6;color:#344c68}.file-workspace button:focus-visible,.file-workspace-resizer:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}.file-workspace-owner{padding:5px 12px;border-bottom:1px solid #e0e5ec;background:#fff;color:#748194;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file-workspace-content{display:flex;flex:1;min-height:0;min-width:0}.navora-app .shell .file-workspace .file-workspace-content>.file-preview.embedded{border-radius:0;top:auto;width:100%}.file-workspace-resizer{position:absolute;inset:0 auto 0 -4px;width:8px;cursor:col-resize;touch-action:none;z-index:2}.file-workspace-resizer:hover{background:#537ab929}
.file-workspace-enter-active,.file-workspace-leave-active{transition:opacity 180ms ease,transform 180ms ease}.file-workspace-enter-from,.file-workspace-leave-to{opacity:0;transform:translateX(12px)}
.file-workspace-picker{width:min(360px,calc(100vw - 24px));max-height:420px;display:flex;flex-direction:column;padding:8px 12px 12px;background:#fff;border:1px solid #d8dee7;border-radius:12px;color:#58677b;box-shadow:0 8px 24px #243b581a;font-size:12px}.file-workspace-picker>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.file-workspace-picker>.sidebar-panel{margin:0;border:0;padding:0;min-height:0;overflow:auto}.file-workspace-picker .res-body{padding:0;max-height:310px;overflow:auto}.file-workspace-picker .ws-root{font-size:10px;color:#7e8a9a}.file-workspace-picker .res-head{display:none}.file-workspace-picker .res-tree{max-height:none}.file-workspace-picker .tree-row{color:#53657b}.file-workspace-picker .res-empty{padding:20px;color:#7e8a9a}
.navora-app .main.file-workspace-open{padding-right:var(--file-workspace-reserve)}
.navora-app .shell.frameless:not(.mobile-layout)>.main.file-workspace-open .main-top{padding-right:12px}
.navora-app .main>.conversation-resource-card{right:calc(var(--file-workspace-reserve,0px) + 12px);max-width:calc(100% - var(--file-workspace-reserve,0px) - 24px)}
.navora-app .shell.frameless.mobile-layout .file-workspace{top:calc(88px + env(safe-area-inset-top,0px))}.navora-app .shell.mobile-layout:not(.frameless) .file-workspace{top:calc(48px + env(safe-area-inset-top,0px))}
@media(prefers-reduced-motion:reduce){.file-workspace-enter-active,.file-workspace-leave-active{transition:none}}
</style>
