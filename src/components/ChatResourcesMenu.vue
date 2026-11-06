<template>
  <div class="chat-resource-buttons">
    <ActionMenu v-if="native.menusSupported.value" class="chat-resource-button chat-more-trigger" :label="`${contextLabel}更多操作`" :context-key="`${context}:${chatId}`" :items="actions" :disabled="context==='chat'&&!chatId" @select="selectAction" />
    <v-menu v-else v-model="moreOpen" location="bottom end" origin="auto" :offset="6" :close-on-content-click="true">
      <template #activator="{props:menuProps}"><button v-bind="menuProps" type="button" class="chat-resource-button chat-more-trigger" :class="{selected:moreOpen}" :title="`${contextLabel}更多操作`" :aria-label="`${contextLabel}更多操作`" :disabled="context==='chat' && !chatId"><AppIcon icon="ellipsis" /></button></template>
      <div class="conversation-actions-menu" role="menu" :aria-label="`${contextLabel}操作菜单`" @keydown="onMenuKey" @keydown.esc.stop="moreOpen=false">
        <template v-if="context==='chat'">
        <div class="conversation-actions-heading">浏览器</div>
        <button type="button" role="menuitem" aria-label="快速打开浏览器" :disabled="!chatId || openingBrowser" @click="quickOpen"><AppIcon :icon="openingBrowser?'circle-notch':'browser'" :spin="openingBrowser" /><span>打开浏览器标签页<small>已有页面会直接显示</small></span><kbd>Ctrl/⌘ ⇧ B</kbd></button>
        <button type="button" role="menuitem" :disabled="isRemote" @click="openFolder"><AppIcon icon="folder-open" /><span>打开对话文件夹</span></button>
        <div class="conversation-actions-heading conversation-actions-section">当前对话 · {{ windowCount }} 个页面</div>
        <button type="button" role="menuitem" @click="emit('rename')"><AppIcon icon="pen-to-square" /><span>修改标题</span></button>
        <button type="button" role="menuitem" @click="emit('search')"><AppIcon icon="magnifying-glass" /><span>在当前聊天中查找</span><kbd>Ctrl/⌘ F</kbd></button>
        <button type="button" role="menuitem" :aria-label="pinned?'取消置顶当前对话':'置顶当前对话'" @click="emit('pin')"><AppIcon icon="thumbtack" /><span>{{ pinned?'取消置顶':'置顶对话' }}</span><AppIcon v-if="pinned" class="conversation-actions-check" icon="check" /></button>
        <button type="button" role="menuitem" :disabled="!canExport || exporting" @click="emit('export')"><AppIcon icon="file-export" /><span>{{ exporting?'正在导出…':'导出对话' }}</span></button>
        <button v-if="running" type="button" role="menuitem" @click="emit('stop')"><AppIcon icon="stop" /><span>停止当前任务</span></button>
        <button type="button" role="menuitem" class="conversation-action-danger" @click="emit('delete')"><AppIcon icon="trash" /><span>删除当前对话…</span></button>
        </template>
        <template v-else><div class="conversation-actions-heading">{{ contextLabel }}</div><button v-for="action in pageActions" :key="action.id" type="button" role="menuitem" :disabled="action.disabled" :title="action.reason" @click="emit('contextAction',action.id)"><AppIcon :icon="action.icon" /><span>{{ action.label }}</span></button><div class="conversation-actions-heading conversation-actions-section">导航</div><button type="button" role="menuitem" @click="emit('contextAction','back')"><AppIcon icon="comments" /><span>返回对话</span></button></template>
      </div>
    </v-menu>
    <ConversationAnnotationsMenu v-if="context==='chat'" :chat-id="chatId" :entries="annotationEntries" :busy-key="annotationBusyKey" :error="annotationError" @action="(entry,action,copyId)=>emit('annotationAction',entry,action,copyId)" @refresh="emit('refreshAnnotations')"/>
    <button v-if="context==='chat'" type="button" class="chat-resource-button" :class="{selected:open,'has-updates':updated&&!open}" data-chat-resource="resources" :title="summaryLabel" aria-label="当前对话摘要" :aria-description="updated&&!open?`${updateCount||1} 项新资源或更新，打开查看后清除提示`:undefined" aria-controls="conversation-summary" :aria-expanded="open" :disabled="!chatId" @click="emit('toggleResources')"><AppIcon icon="file-lines" /></button>
  </div>
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
import {computed,ref,watch} from 'vue'
import type {BrowserTreeSession} from '@shared/types'
import ActionMenu,{type ActionMenuItem} from './ActionMenu.vue'
import {useNativeUi} from '@/composables/useNativeUi'
import ConversationAnnotationsMenu from './ConversationAnnotationsMenu.vue'
import type {AnnotationChatAction,AnnotationChatEntry} from '@shared/browser-annotation-chat'
const props=withDefaults(defineProps<{chatId:string;tree:BrowserTreeSession[];isRemote:boolean;open?:boolean;updated?:boolean;updateCount?:number;pinned?:boolean;canExport?:boolean;exporting?:boolean;context:'chat'|'files'|'plugins'|'settings'|'creator'|'browser';running?:boolean;annotationEntries?:AnnotationChatEntry[];annotationBusyKey?:string;annotationError?:string}>(),{annotationEntries:()=>[]})
const emit=defineEmits<{notify:[text:string,color?:string];toggleResources:[];showBrowser:[];rename:[];pin:[];export:[];newChat:[];search:[];delete:[];stop:[];newBrowserTab:[];contextAction:[action:string];annotationAction:[entry:AnnotationChatEntry,action:AnnotationChatAction,copyId?:string];refreshAnnotations:[]}>()
const native=useNativeUi(),openingFolder=ref(false),openingBrowser=ref(false),moreOpen=ref(false)
const summaryLabel=computed(()=>`当前对话摘要${props.updated&&!props.open?` · ${props.updateCount||1} 项新资源或更新`:''}`)
const contextLabel=computed(()=>({chat:'当前对话',files:'文件管理',plugins:'插件',settings:'设置',creator:'创建器',browser:'浏览器'})[props.context])
const pageActions=computed<ActionMenuItem[]>(()=>({files:[{id:'refresh',label:'刷新文件列表',icon:'arrow-rotate-right'},{id:'folder',label:'打开当前文件夹',icon:'folder-open',disabled:props.isRemote,reason:props.isRemote?'请在桌面端打开文件夹':undefined}],plugins:[{id:'create',icon:'plus',label:'创建插件'}],settings:[{id:'models',icon:'microchip',label:'模型配置'},{id:'plugins',icon:'puzzle-piece',label:'打开插件管理'},{id:'create-skill',icon:'book',label:'技能创建器'}],creator:[],browser:[{id:'new-browser',icon:'plus',label:'新建浏览器标签页'}],chat:[]})[props.context])
const currentSessions=computed(()=>props.tree.filter(session=>session.chatId===props.chatId))
const windowCount=computed(()=>currentSessions.value.reduce((sum,session)=>sum+session.windows.length,0))
watch(()=>[props.context,props.chatId],()=>{moreOpen.value=false})
const actions=computed<ActionMenuItem[]>(()=>props.context==='chat'?[
  {id:'browser',label:'打开浏览器标签页',icon:'browser',shortcut:'CommandOrControl+Shift+B',disabled:!props.chatId||openingBrowser.value},
  {id:'folder',label:'打开对话文件夹',icon:'folder-open',disabled:props.isRemote||openingFolder.value},
  {id:'rename',label:'修改标题',icon:'pen-to-square',divider:true},
  {id:'search',label:'在当前聊天中查找',icon:'magnifying-glass',shortcut:'CommandOrControl+F'},
  {id:'pin',label:props.pinned?'取消置顶':'置顶对话',icon:'thumbtack',checked:!!props.pinned},
  {id:'export',label:props.exporting?'正在导出…':'导出对话',icon:'file-export',disabled:!props.canExport||props.exporting},
  ...(props.running?[{id:'stop',label:'停止当前任务',icon:'stop'}]:[]),
  {id:'delete',label:'删除当前对话…',icon:'trash',danger:true,divider:true}
]:[...pageActions.value,{id:'back',icon:'comments',label:'返回对话',divider:!!pageActions.value.length}])
function selectAction(id:string){
  if(props.context!=='chat'){emit('contextAction',id);return}
  if(id==='browser'){void quickOpen();return}
  if(id==='folder'){void openFolder();return}
  switch(id){case 'rename':emit('rename');break;case 'search':emit('search');break;case 'pin':emit('pin');break;case 'export':emit('export');break;case 'stop':emit('stop');break;case 'delete':emit('delete');break}
}
function onMenuKey(event:KeyboardEvent){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault();event.stopPropagation()
  const buttons=[...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if(!buttons.length)return
  const current=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:current<0?(event.key==='ArrowDown'?0:buttons.length-1):(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus()
}
async function openFolder(){
  if(!props.chatId||props.isRemote||openingFolder.value)return
  openingFolder.value=true
  try{const result=await window.navora!.workspace.open(props.chatId,'.');if(!result.ok)throw Error(result.error)}
  catch{emit('notify','无法打开对话文件夹')}
  finally{openingFolder.value=false}
}
async function quickOpen(){
  if(!props.chatId||!window.navora||openingBrowser.value)return
  openingBrowser.value=true
  emit('showBrowser')
  try{
    const existing=currentSessions.value.flatMap(session=>session.windows)[0]
    if(existing){await window.navora.browser.setVisible(existing.windowId,true);return}
    const session=currentSessions.value.find(session=>session.isDefault)||currentSessions.value[0]||await window.navora.browser.createSession(props.chatId,{persist:false})
    await window.navora.browser.createWindow(session.sessionId,{show:true})
  }catch{emit('notify','打开浏览器失败')}
  finally{openingBrowser.value=false}
}
defineExpose({quickOpen})
</script>
<style>
.chat-resource-buttons{display:flex;align-items:center;gap:3px;flex-shrink:0;-webkit-app-region:no-drag}
.chat-resource-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border:1px solid transparent;border-radius:7px;color:#657184;background:transparent;cursor:default;transition:background-color 140ms ease,color 140ms ease,border-color 140ms ease;-webkit-app-region:no-drag}
.chat-resource-button.has-updates{position:relative}.chat-resource-button.has-updates::after{content:"";position:absolute;top:3px;right:3px;width:5px;height:5px;box-shadow:0 0 0 2px var(--navora-surface);border-radius:50%;background:var(--navora-accent)}
.chat-resource-button>svg{width:16px;height:16px}.chat-resource-button:hover:not(:disabled){background:#edf0f4;border-color:#dce2ea;color:#2c4666}.chat-resource-button.selected{background:#eaf0f7;color:#345e8a}.chat-resource-button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}.chat-resource-button:disabled{opacity:.4}
.conversation-actions-menu .conversation-action-danger{color:#b65d63}
.chat-resource-divider{height:16px;width:1px;margin:0 4px;background:#dfe5ed;flex-shrink:0}.chat-more-trigger>svg{width:14px;height:14px}
.conversation-actions-menu{width:min(280px,calc(100vw - 24px));max-height:calc(100dvh - 68px);overflow-y:auto;padding:6px;border:1px solid #d5deea;border-radius:11px;background:#fff;color:#52647c;box-shadow:0 10px 30px #243b581c;-webkit-app-region:no-drag}
.conversation-actions-heading{padding:6px 10px 5px;font-size:10px;line-height:1.5;color:#8a96a6}.conversation-actions-section{margin-top:5px;padding-top:10px;border-top:1px solid #e1e6ee}
.conversation-actions-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:8px 10px;border:1px solid transparent;border-radius:6px;background:transparent;color:#4a5d76;text-align:left;font:inherit;font-size:12px;line-height:1.5;cursor:default;transition:background-color 140ms ease,color 140ms ease}
.conversation-actions-menu button>svg{width:13px;height:13px;flex-shrink:0;color:#74869d}.conversation-actions-menu button>span{flex:1;min-width:0}.conversation-actions-menu button small{display:block;font-size:10px;color:#8a97a9}.conversation-actions-menu kbd{font:10px/1.5 Consolas,monospace;color:#8a97a9;white-space:nowrap}.conversation-actions-menu .conversation-actions-count{white-space:nowrap}.conversation-actions-menu button .conversation-actions-check{color:#426d9c;width:11px}
.conversation-actions-menu button:hover:not(:disabled),.conversation-actions-menu button:focus-visible{background:#eaf0f7;color:#34577e}.conversation-actions-menu button:focus-visible{outline:2px solid #6b8db5;outline-offset:-2px}.conversation-actions-menu button:disabled{opacity:.4}
@media(prefers-reduced-motion:reduce){.conversation-actions-menu button{transition:none}}
@media(prefers-reduced-motion:reduce){.chat-resource-button{transition:none}}
</style>
