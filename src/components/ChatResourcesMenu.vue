<template>
  <div class="chat-resource-buttons">
    <button type="button" class="chat-resource-button" data-chat-resource="files" title="打开对话文件夹" aria-label="打开对话文件夹" :disabled="!chatId || isRemote || openingFolder" @click="openFolder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 2h8.5A1.5 1.5 0 0 1 21 7.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/><path d="M3 10h18M7 14h4m-4 3h7"/></svg>
    </button>
    <button type="button" class="chat-resource-button" :class="{selected:fileWorkspaceOpen}" data-chat-resource="workspace" title="文件侧栏" aria-label="文件侧栏" :aria-expanded="fileWorkspaceOpen" :disabled="!hasFileTabs" @click="emit('toggleWorkspace')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5m0 4h8m-8 3h5"/></svg></button>
    <button type="button" class="chat-resource-button" :class="{selected:open}" data-chat-resource="resources" title="当前对话资源" aria-label="当前对话资源" :aria-expanded="open" :disabled="!chatId" @click="emit('toggleResources')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16m3-11h1m-1 3h1m-1 3h1"/></svg>
    </button>
    <button type="button" class="chat-resource-button" data-chat-resource="browser" title="打开或复用浏览器（Ctrl/⌘ Shift B）" aria-label="快速打开浏览器" :disabled="!chatId || openingBrowser" @click="quickOpen"><font-awesome-icon icon="window-maximize" /></button>
  </div>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import type {BrowserTreeSession} from '@shared/types'
const props=defineProps<{chatId:string;tree:BrowserTreeSession[];isRemote:boolean;open?:boolean;fileWorkspaceOpen?:boolean;hasFileTabs?:boolean}>()
const emit=defineEmits<{notify:[text:string,color?:string];toggleResources:[];toggleWorkspace:[];showBrowser:[]}>()
const openingFolder=ref(false),openingBrowser=ref(false)
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
    const existing=props.tree.flatMap(session=>session.windows)[0]
    if(existing){await window.navora.browser.setVisible(existing.windowId,true);return}
    const session=props.tree.find(session=>session.chatId===props.chatId)||await window.navora.browser.createSession(props.chatId,{persist:false})
    await window.navora.browser.createWindow(session.sessionId,{show:true})
  }catch{emit('notify','打开浏览器失败')}
  finally{openingBrowser.value=false}
}
defineExpose({quickOpen})
</script>
<style>
.chat-resource-buttons{display:flex;align-items:center;gap:3px;flex-shrink:0;-webkit-app-region:no-drag}
.chat-resource-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border:1px solid transparent;border-radius:7px;color:#657184;background:transparent;cursor:default;transition:background-color 140ms ease,color 140ms ease,border-color 140ms ease;-webkit-app-region:no-drag}
.chat-resource-button>svg{width:16px;height:16px}.chat-resource-button:hover:not(:disabled){background:#edf0f4;border-color:#dce2ea;color:#2c4666}.chat-resource-button.selected{background:#eaf0f7;color:#345e8a}.chat-resource-button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}.chat-resource-button:disabled{opacity:.4}
@media(prefers-reduced-motion:reduce){.chat-resource-button{transition:none}}
</style>
