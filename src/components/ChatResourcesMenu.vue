<template>
  <div class="chat-resource-buttons">
    <v-menu v-for="kind in kinds" :key="kind.id" :model-value="opened === kind.id" location="bottom end" :close-on-content-click="false" :max-width="420" @update:model-value="setOpen(kind.id,$event)">
      <template #activator="{props:menuProps}"><button v-bind="menuProps" type="button" class="chat-resource-button" :class="{selected:opened === kind.id}" :data-chat-resource="kind.id" :title="kind.title" :aria-label="kind.title" :aria-expanded="opened === kind.id" aria-haspopup="dialog"><font-awesome-icon :icon="kind.icon" /></button></template>
      <section v-if="opened === kind.id" class="chat-resource-popup" role="dialog" :aria-label="kind.title">
        <header class="chat-resource-header"><h2>{{ kind.title }}</h2><div :id="headerId(kind.id)" class="chat-resource-actions" /><button type="button" class="chat-resource-button" aria-label="关闭资源面板" @click="opened=''"> <font-awesome-icon icon="xmark" /></button></header>
        <WorkspaceFilesPanel v-if="kind.id === 'files'" :key="chatId" :chat-id="chatId" :header-target="'#'+headerId(kind.id)" @notify="notify" @preview="preview($event.path)" />
        <BrowserResourcesPanel v-else :key="'browser-'+chatId" :chat-id="chatId" :tree="tree" :header-target="'#'+headerId(kind.id)" :is-remote="isRemote" :owner-label="ownerLabel" :dnd-mime="dndMime" @notify="notify" @add-ref="addRef" @ask-close-session="closeSession" @remote-view="remoteView" />
      </section>
    </v-menu>
  </div>
</template>
<script setup lang="ts">
import {ref,useId,watch} from 'vue'
import type {BrowserContextRef,BrowserTreeSession} from '@shared/types'
import WorkspaceFilesPanel from './sidebar/WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from './sidebar/BrowserResourcesPanel.vue'
const props=defineProps<{chatId:string;tree:BrowserTreeSession[];isRemote:boolean;ownerLabel:(id:string)=>string;dndMime:string}>()
const emit=defineEmits<{notify:[text:string,color?:string];preview:[path:string];addRef:[ref:BrowserContextRef];askCloseSession:[session:BrowserTreeSession];remoteView:[id:string]}>()
const opened=ref(''),uid=useId().replace(/[^a-zA-Z0-9_-]/g,'')
const kinds=[{id:'files',title:'当前对话文件',icon:'folder-open'},{id:'browser',title:'当前对话浏览器',icon:'window-maximize'}]
function setOpen(id:string,value:boolean){if(value)opened.value=id;else if(opened.value===id)opened.value=''}
const headerId=(id:string)=>`chat-resource-${uid}-${id}`
const notify=(text:string,color?:string)=>emit('notify',text,color)
function preview(path:string){opened.value='';emit('preview',path)}
function addRef(ref:BrowserContextRef){opened.value='';emit('addRef',ref)}
function closeSession(session:BrowserTreeSession){opened.value='';emit('askCloseSession',session)}
function remoteView(id:string){opened.value='';emit('remoteView',id)}
watch(()=>props.chatId,()=>{opened.value=''},{flush:'sync'})
async function quickOpen(){
  if(!props.chatId||!window.navora)return
  try{
    const existing=props.tree.flatMap(session=>session.windows)[0]
    if(existing){await window.navora.browser.setVisible(existing.windowId,true);return}
    const session=props.tree.find(session=>session.chatId===props.chatId)||await window.navora.browser.createSession(props.chatId,{persist:false})
    await window.navora.browser.createWindow(session.sessionId,{show:true})
  }catch(error){notify(error instanceof Error?error.message:'打开浏览器失败')}
}
defineExpose({quickOpen})
</script>
<style>
.chat-resource-buttons{display:flex;align-items:center;gap:3px;flex-shrink:0;-webkit-app-region:no-drag}
.chat-resource-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border:1px solid transparent;border-radius:7px;color:#657184;background:transparent;cursor:pointer;transition:background-color 140ms ease,color 140ms ease,border-color 140ms ease;-webkit-app-region:no-drag}
.chat-resource-button>svg{width:15px;height:15px}.chat-resource-button:hover{background:#edf0f4;border-color:#dce2ea;color:#2c4666}.chat-resource-button.selected{background:#eaf0f7;color:#345e8a}.chat-resource-button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
.chat-resource-popup{width:min(420px,calc(100vw - 24px));min-height:150px;max-height:min(560px,calc(100dvh - 110px));display:flex;flex-direction:column;padding:0 12px 12px;border:1px solid #d7dfe9;border-radius:12px;background:#fff;color:#46546a;overflow:hidden;box-shadow:0 12px 32px #243b581a;font-size:12px}
.chat-resource-header{display:flex;align-items:center;gap:4px;min-height:46px;border-bottom:1px solid #e0e5ec;margin-bottom:8px}.chat-resource-header h2{font-size:12px;font-weight:600;flex:1}.chat-resource-actions{display:flex;align-items:center}
.chat-resource-popup .sidebar-panel{margin:0;padding:0;border:0;min-height:0;flex:1;overflow:auto}.chat-resource-popup .res-head{margin:0;padding:0;min-height:0}.chat-resource-popup .docked-head{border:0;min-height:0}.chat-resource-popup .res-body{padding:0;overflow:auto;min-height:0;flex:1}.chat-resource-popup .res-tree{max-height:none;overflow:visible}.chat-resource-popup .res-empty{opacity:1;color:#7c8a9b;min-height:100px;display:grid;place-items:center;font-size:12px}.chat-resource-popup .ws-root{opacity:1;color:#8390a2;font-size:10px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-resource-popup .icon-btn{display:inline-grid;place-items:center;width:27px;height:27px;padding:0;border:1px solid transparent;border-radius:6px;color:#64748b;background:transparent;cursor:pointer}.chat-resource-popup .icon-btn svg{width:12px;height:12px}.chat-resource-popup .icon-btn:hover{background:#edf0f4;border-color:#dce2ea;color:#2c4666}.chat-resource-popup .icon-btn:disabled{opacity:.4;cursor:default}.chat-resource-popup .res-head-actions{display:flex;gap:2px}.chat-resource-popup .tree-row{color:#52647a}.chat-resource-popup .tree-row:hover{background:#f0f3f7}.chat-resource-popup .tree-name{color:inherit}.chat-resource-popup .tree-meta{color:#8491a2}.chat-resource-popup .tree-actions{display:flex}
@media(prefers-reduced-motion:reduce){.chat-resource-button{transition:none}}
</style>
