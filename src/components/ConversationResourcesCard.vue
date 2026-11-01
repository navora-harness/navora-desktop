<template>
  <aside ref="card" class="conversation-resource-card" :class="{'is-overview':tab==='overview'}" :data-layout="overlay?'overlay':'docked'" aria-label="当前对话摘要面板" :style="{'--resource-width':`${width}px`}" @keydown.esc="onEscape">
    <div v-if="!overlay" class="resource-card-resizer" role="separator" aria-label="调整资源面板宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="280" :aria-valuemax="maximum" tabindex="0" @pointerdown="beginResize" @keydown="resizeKey" />
    <header class="resource-card-head"><button v-if="tab!=='overview'" type="button" class="resource-icon-button" aria-label="返回资源概览" title="返回资源概览" @click="changeTab('overview')"><font-awesome-icon icon="arrow-left" /></button><div><h2>{{ tab==='overview' ? '摘要' : '对话摘要' }}</h2><span :title="title">{{ title }}</span></div><SidebarMoreMenu label="摘要面板" hide-label="隐藏摘要面板" hide-aria-label="关闭资源面板" @hide="emit('close')" /></header>
    <nav v-if="tab!=='overview'" class="resource-card-tabs" aria-label="资源类型">
      <button v-for="item in tabs" :key="item.id" type="button" :data-resource-tab="item.id" :aria-pressed="tab===item.id" @click="changeTab(item.id)">{{ item.label }}<span v-if="item.id==='browser' && windowCount">{{ windowCount }}</span><span v-if="item.id==='outputs' && outputs.length">{{ outputs.length }}</span></button>
    </nav>
    <ConversationResourceOverview v-if="tab==='overview'" :chat-id="chatId" :messages="messages" :tree="tree" @view="changeTab" @jump="emit('jump',$event)" @preview="emit('preview',$event)" @notify="notify" />
    <div v-else-if="tab==='files'" class="resource-card-body resource-files">
      <WorkspaceFilePicker :chat-id="chatId" compact @open="emit('preview',$event)" @locate="emit('jump',$event)" @searching="filesSearching=$event" />
      <WorkspaceFilesPanel v-show="!filesSearching" :key="chatId" embedded :chat-id="chatId" @notify="notify" @preview="emit('preview',$event.path)" />
    </div>
    <div v-else-if="tab==='browser'" class="resource-card-body resource-browser">
      <BrowserResourcesPanel :key="chatId" embedded :chat-id="chatId" :tree="tree" :is-remote="isRemote" :owner-label="ownerLabel" :dnd-mime="dndMime" @notify="notify" @add-ref="emit('addRef',$event)" @ask-close-session="emit('askCloseSession',$event)" @remote-view="emit('remoteView',$event)" />
    </div>
    <div v-else class="resource-card-body resource-outputs">
      <template v-if="selectedOutput">
        <div class="resource-output-actions"><button type="button" @click="selectedOutputId=''">返回输出列表</button><button type="button" @click="emit('jump',selectedOutput.id)">定位到对话 <font-awesome-icon icon="arrow-up-right-from-square" /></button></div>
        <ChatMarkdown :chat-id="chatId" :content="selectedOutput.content" @open-media="emit('openMedia',$event)" @open-file="emit('preview',$event)" @notify="notify" />
      </template>
      <template v-else>
        <div v-if="!outputs.length" class="resource-empty">暂无输出</div>
        <button v-for="(message,index) in outputs" :key="message.id" type="button" class="resource-output-row" @click="selectedOutputId=message.id"><font-awesome-icon icon="file-lines" /><span>{{ outputTitle(message.content) }}</span><small>{{ outputs.length-index }}</small><font-awesome-icon icon="chevron-right" /></button>
      </template>
    </div>
  </aside>
</template>
<script setup lang="ts">
import {finalOutputs} from '@shared/message-presentation'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserContextRef,BrowserTreeSession,ChatMessage} from '@shared/types'
import type {ResourceTab} from '@/composables/useConversationResources'
import WorkspaceFilePicker from './WorkspaceFilePicker.vue'
import WorkspaceFilesPanel from './sidebar/WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from './sidebar/BrowserResourcesPanel.vue'
import ChatMarkdown from './ChatMarkdown.vue'
import ConversationResourceOverview from './ConversationResourceOverview.vue'
import SidebarMoreMenu from './sidebar/SidebarMoreMenu.vue'
const props=defineProps<{chatId:string;title:string;messages:ChatMessage[];tree:BrowserTreeSession[];tab:ResourceTab;width:number;availableWidth:number;overlay:boolean;isRemote:boolean;ownerLabel:(id:string)=>string;dndMime:string}>()
const emit=defineEmits<{close:[];tab:[tab:ResourceTab];resize:[width:number];preview:[path:string];jump:[id:string];notify:[text:string,color?:string];addRef:[ref:BrowserContextRef];askCloseSession:[session:BrowserTreeSession];remoteView:[id:string];openMedia:[payload:{src:string;alt?:string}]}>()
const tabs:Array<{id:ResourceTab;label:string}>=[{id:'files',label:'文件'},{id:'browser',label:'浏览器'},{id:'outputs',label:'输出'}]
const outputs=computed(()=>finalOutputs(props.messages).slice().reverse())
const windowCount=computed(()=>props.tree.reduce((count,session)=>count+session.windows.length,0))
const filesSearching=ref(false)
const selectedOutputId=ref(''),card=ref<HTMLElement|null>(null)
const selectedOutput=computed(()=>outputs.value.find(message=>message.id===selectedOutputId.value))
const maximum=computed(()=>Math.max(280,Math.min(800,props.availableWidth-624)))
let stopResize:(()=>void)|undefined
const notify=(text:string,color?:string)=>emit('notify',text,color)
function outputTitle(content:string){return content.replace(/[#*_`>|]/g,'').trim().split('\n').find(Boolean)?.slice(0,100)||'对话输出'}
function changeTab(tab:ResourceTab){emit('tab',tab)}
watch(()=>props.chatId,()=>{selectedOutputId.value=''})
function onEscape(event:KeyboardEvent){if((event.target as Element).closest('input,textarea,[contenteditable=true]'))return;event.preventDefault();event.stopPropagation();emit('close')}
function resize(value:number){emit('resize',Math.max(280,Math.min(maximum.value,value)))}
function onOutsidePointer(event:PointerEvent){
  if(!props.overlay||event.button!==0)return
  const target=event.target
  if(!(target instanceof Element)||card.value?.contains(target))return
  // Card controls can open teleported menus, dialogs and media previews.
  if(target.closest('[data-chat-resource="resources"],[data-chat-resource="browser"],.sidebar-ctx-panel,.v-overlay__content,[role="dialog"]'))return
  emit('close')
}
function resizeKey(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();resize(event.key==='Home'?400:event.key==='End'?maximum.value:props.width+(event.key==='ArrowLeft'?20:-20))}
function beginResize(event:PointerEvent){
  if(event.button!==0)return
  event.preventDefault();stopResize?.()
  const handle=event.currentTarget as HTMLElement,start=event.clientX,width=props.width
  const move=(next:PointerEvent)=>resize(width+start-next.clientX)
  const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);stopResize=undefined}
  handle.setPointerCapture(event.pointerId);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);stopResize=end
}
watch(()=>props.overlay,()=>stopResize?.())
onMounted(()=>document.addEventListener('pointerdown',onOutsidePointer,true))
onBeforeUnmount(()=>{stopResize?.();document.removeEventListener('pointerdown',onOutsidePointer,true)})
</script>
<style>
.conversation-resource-card{position:absolute;inset:56px 12px 14px auto;width:var(--resource-width);max-width:calc(100% - 24px);display:flex;flex-direction:column;min-height:0;z-index:6;background:#fff;border:1px solid #d4dce6;border-radius:13px;box-shadow:0 6px 30px #243b5814;color:#46546a;font-size:12px;isolation:isolate;contain:layout style}
.conversation-resource-card.is-overview{bottom:auto;max-height:calc(100% - 70px);border-radius:16px;border-color:#dfe3e8}
.is-overview .resource-card-head{min-height:38px;padding:10px 14px 0}.is-overview .resource-card-head h2{font-size:11px;font-weight:500;color:#8b939d}.is-overview .resource-card-head span{display:none}.is-overview .resource-card-resizer{bottom:8px}
.resource-card-head{display:flex;align-items:center;gap:8px;min-height:65px;padding:12px 14px 10px;flex-shrink:0}.resource-card-head>div{min-width:0;flex:1}.resource-card-head h2{font-size:13px;font-weight:600;margin:0 0 3px;color:#344156}.resource-card-head span{display:block;color:#7a8594;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resource-icon-button{display:grid;place-items:center;width:28px;height:28px;flex-shrink:0;border:1px solid transparent;border-radius:7px;color:#657184;background:transparent}.resource-icon-button svg{width:14px;height:14px}.resource-icon-button:hover{background:#edf0f4;border-color:#dce2ea;color:#2c4666}
.resource-card-tabs{display:flex;gap:3px;margin:0 12px 8px;padding:3px;background:#f0f2f5;border:1px solid #e0e5ec;border-radius:8px;flex-shrink:0}.resource-card-tabs button{display:flex;align-items:center;justify-content:center;gap:5px;flex:1;border:1px solid transparent;border-radius:5px;padding:5px 8px;color:#69768a;transition:background-color 140ms,color 140ms,border-color 140ms}.resource-card-tabs button:hover{color:#334b68;background:#e3e9f0}.resource-card-tabs button[aria-pressed=true]{background:#fff;border-color:#d7dfe8;color:#345b87;box-shadow:0 1px 2px #182b4610}.resource-card-tabs span{font-size:10px;color:#7e8b9d}
.resource-files{display:flex;flex-direction:column;gap:8px}.resource-files>.workspace-file-picker{flex-shrink:0}.resource-card-body.resource-files>.sidebar-panel{flex:1;height:auto}
.resource-card-body{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;overscroll-behavior:contain;scrollbar-width:thin}.resource-card-body .sidebar-panel{margin:0;padding:0;border:0;min-height:0;display:flex;flex-direction:column;height:100%;background:transparent}.resource-card-body .res-head{display:flex;align-items:center;justify-content:flex-end;min-height:30px;padding:0;margin:0 0 5px}.resource-card-body .res-head-actions{display:flex;gap:2px}.resource-card-body .res-body{padding:0;overflow:auto;min-height:0;flex:1}.resource-card-body .res-tree{max-height:none;overflow:visible}.resource-card-body .res-empty,.resource-empty{color:#7c8a9b;min-height:130px;display:grid;place-items:center;font-size:12px}.resource-card-body .ws-root{color:#8390a2;font-size:10px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-card-body .icon-btn{display:inline-grid;place-items:center;width:27px;height:27px;padding:0;border:1px solid transparent;border-radius:6px;color:#64748b;background:transparent}.resource-card-body .icon-btn svg{width:12px;height:12px}.resource-card-body .icon-btn:hover{background:#edf0f4;border-color:#dce2ea;color:#2c4666}.resource-card-body .icon-btn:disabled{opacity:.4}.resource-card-body .tree-row{color:#52647a}.resource-card-body .tree-row:hover{background:#f0f3f7}.resource-card-body .tree-name{color:inherit}.resource-card-body .tree-meta{color:#8491a2}.resource-card-body .tree-actions{display:flex}
.resource-output-row{display:flex;align-items:center;gap:8px;text-align:left;width:100%;min-height:40px;border-bottom:1px solid #e3e8ef;padding:9px 6px;color:#536277;transition:background-color 140ms}.resource-output-row:hover{background:#edf1f6;color:#2d4868}.resource-output-row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-output-row>svg{width:12px;height:12px;flex-shrink:0}.resource-output-row>small{color:#7c8a9a;font-size:10px}.resource-output-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;padding:5px 0 10px;border-bottom:1px solid #dbe2ec}.resource-output-actions button{color:#496889;border-radius:5px;padding:4px}.resource-output-actions button:hover{background:#eef2f7}.resource-output-actions svg{width:10px;margin-left:3px}.navora-app .main .resource-outputs .msg-body{font-size:13px;line-height:1.75;border:0;border-radius:0;background:transparent;padding:0;box-shadow:none}
.resource-card-resizer{position:absolute;inset:8px auto 8px -4px;width:8px;cursor:col-resize;touch-action:none;z-index:2;border-radius:4px}.resource-card-resizer:hover{background:#537ab929}.conversation-resource-card button:focus-visible,.resource-card-resizer:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
.resource-card-enter-active,.resource-card-leave-active{transition:opacity 180ms ease,transform 180ms ease}.resource-card-enter-from,.resource-card-leave-to{opacity:0;transform:translateX(12px)}
/* Reserve room in the transcript's padding, keeping its native scrollbar at the window edge. */
.navora-app .main.resource-card-docked .composer{margin-right:calc(var(--preview-width) + 24px)}
.navora-app .main.resource-card-docked .messages-wrap>.messages{padding-right:calc(var(--preview-width) + 48px)}
.navora-app .main.resource-card-docked .messages-wrap>.conversation-outline{right:calc(var(--preview-width) + 32px)}
.navora-app .main.resource-card-docked .messages-wrap>.jump-bottom{left:calc((100% - var(--preview-width) - 24px) / 2)}
@media(min-width:1101px){.navora-app .main.resource-card-docked .messages-wrap>.messages:has(+ .conversation-outline){padding-right:calc(var(--preview-width) + 72px)}}
@media(max-width:1100px){.navora-app .main.resource-card-docked .messages-wrap>.conversation-outline{right:calc(var(--preview-width) + 42px)}}
.conversation-resource-card[data-layout="overlay"]{box-shadow:0 12px 40px #243b5826}
.navora-app .shell.mobile-layout .conversation-resource-card{top:calc(56px + env(safe-area-inset-top,0px))}
.navora-app .shell.frameless.mobile-layout .conversation-resource-card{top:calc(96px + env(safe-area-inset-top,0px));max-height:calc(100% - 110px - env(safe-area-inset-top,0px))}
.navora-app .shell.mobile-layout .conversation-resource-card .file-preview.embedded{top:auto;width:100%}
@media(prefers-reduced-motion:reduce){.resource-card-enter-active,.resource-card-leave-active,.resource-card-tabs button,.resource-output-row{transition:none}}
</style>
