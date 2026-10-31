<template>
  <div class="global-resources" :data-resource-kind="kind">
    <div class="global-resource-filter">
      <font-awesome-icon icon="magnifying-glass" />
      <input v-model="query" :aria-label="kind === 'files' ? '搜索文件所属对话' : '搜索浏览器资源'" placeholder="搜索对话" />
      <button v-if="kind === 'browser'" class="resource-action" type="button" title="刷新全部浏览器" aria-label="刷新全部浏览器" :disabled="loading" @click="reload"><font-awesome-icon icon="arrow-rotate-right" /></button>
    </div>
    <div class="global-resource-scope">全部对话 <span>{{ owners.length }}</span></div>
    <div v-if="error" class="global-resource-empty">{{ error }} <button type="button" @click="reload">重试</button></div>
    <div v-else-if="loading && !owners.length" class="global-resource-empty">正在加载…</div>
    <div v-else-if="!owners.length" class="global-resource-empty">{{ query ? '没有匹配的资源' : kind === 'files' ? '暂无对话文件夹' : '暂无浏览器资源' }}</div>
    <div v-else class="global-resource-list">
      <section v-for="owner in owners" :key="owner.id" class="resource-owner" :class="{expanded: expanded === owner.id}" :data-owner-id="owner.id">
        <div class="resource-owner-head">
          <button type="button" class="resource-owner-toggle" :aria-expanded="expanded === owner.id" @click="expanded = expanded === owner.id ? '' : owner.id">
            <font-awesome-icon :icon="expanded === owner.id ? 'chevron-down' : 'chevron-right'" class="owner-chevron" />
            <span class="owner-title" :title="owner.title">{{ owner.title || '新对话' }}</span>
            <span v-if="kind === 'browser'" class="owner-count">{{ sessionsOf(owner.id).reduce((n,s) => n + s.windows.length,0) }}</span>
            <span v-if="owner.id === activeChatId" class="owner-current">当前</span>
          </button>
          <button type="button" class="resource-action owner-open" title="打开此对话" aria-label="打开资源所属对话" @click="emit('selectChat',owner.id)"><font-awesome-icon icon="arrow-up-right-from-square" /></button>
        </div>
        <div v-if="expanded === owner.id" class="resource-owner-body">
          <WorkspaceFilesPanel v-if="kind === 'files'" :key="owner.id" :chat-id="owner.id" embedded @notify="notify" @preview="emit('preview',{chatId:owner.id,path:$event.path})" />
          <BrowserResourcesPanel v-else :chat-id="owner.id" :tree="sessionsOf(owner.id)" embedded :is-remote="isRemote" :owner-label="ownerLabel" :dnd-mime="dndMime" @notify="notify" @add-ref="emit('addRef',$event)" @ask-close-session="emit('askCloseSession',$event)" @remote-view="emit('remoteView',$event)" />
        </div>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserContextRef,BrowserTreeSession,ChatSession} from '@shared/types'
import WorkspaceFilesPanel from './WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from './BrowserResourcesPanel.vue'
const props=defineProps<{kind:'files'|'browser';active?:boolean;chats:ChatSession[];activeChatId:string;isRemote:boolean;ownerLabel:(id:string)=>string;dndMime:string}>()
const emit=defineEmits<{notify:[text:string,color?:string];preview:[selection:{chatId:string;path:string}];selectChat:[id:string];addRef:[ref:BrowserContextRef];askCloseSession:[session:BrowserTreeSession];remoteView:[id:string]}>()
const query=ref(''),expanded=ref(props.activeChatId),sessions=ref<BrowserTreeSession[]>([]),loading=ref(false),error=ref('')
const sessionsOf=(id:string)=>sessions.value.filter(session=>session.chatId===id)
const owners=computed(()=>{
  const needle=query.value.trim().toLocaleLowerCase()
  return props.chats.filter(chat=>props.kind==='files'||sessionsOf(chat.id).length)
    .filter(chat=>!needle||chat.title.toLocaleLowerCase().includes(needle)||(props.kind==='browser'&&sessionsOf(chat.id).some(s=>s.windows.some(w=>(w.title+' '+w.url).toLocaleLowerCase().includes(needle)))))
})
function notify(text:string,color?:string){emit('notify',text,color)}
let disposed=false,again=false,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
async function reload(){
  if(props.kind!=='browser'||props.active===false)return
  if(loading.value){again=true;return}
  loading.value=true;error.value=''
  try{const result=await window.navora!.browser.treeAll();if(!disposed)sessions.value=result}
  catch{if(!disposed)error.value='加载浏览器失败'}
  finally{loading.value=false;if(again&&!disposed){again=false;void reload()}}
}
watch(()=>props.active,active=>{if(active)void reload()})
watch(owners,list=>{if(!list.some(owner=>owner.id===expanded.value))expanded.value=list[0]?.id||''})
onMounted(()=>{void reload();if(props.kind==='browser')unsubscribe=window.navora?.browser.onTreeUpdated(()=>{clearTimeout(timer);timer=setTimeout(()=>void reload(),100)})})
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);unsubscribe?.()})
</script>
<style scoped>
.global-resources{display:flex;flex-direction:column;flex:1;min-height:0;font-size:12px;color:#566174}
.global-resource-filter{display:flex;align-items:center;gap:7px;border:1px solid #d8dfe8;border-radius:8px;background:#fff;padding:3px 7px;margin:0 2px 10px;min-height:32px}.global-resource-filter>svg{width:12px;color:#818b98}.global-resource-filter:focus-within{border-color:#6588b2;box-shadow:0 0 0 2px #6588b21a}
.global-resource-filter input{min-width:0;flex:1;outline:none;color:#37455a;font-size:12px;width:100%}.global-resource-filter input::placeholder{color:#7a8492}
.global-resource-scope{display:flex;align-items:center;justify-content:space-between;padding:0 7px 7px;color:#858e9b;font-size:11px}.global-resource-list{overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin;padding:0 2px}
.resource-owner-head{display:flex;align-items:center;gap:1px}.resource-owner-toggle{display:flex;align-items:center;gap:7px;min-width:0;flex:1;min-height:34px;padding:5px;border-radius:7px;cursor:pointer;text-align:left;color:#566174}
.resource-owner-toggle:hover{background:#e9edf2;color:#283d57}.owner-chevron{width:8px;height:8px;flex-shrink:0}.owner-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.owner-count{font-size:10px;color:#7c899b}.owner-current{font-size:10px;color:#6c86a4}
.resource-action{width:26px;height:26px;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;flex-shrink:0;color:#65758a;cursor:pointer}.resource-action>svg{width:12px;height:12px}.resource-action:hover{background:#e7e9ee;border-color:#dce0e7;color:#272d36}.resource-action:disabled{opacity:.45;cursor:default}.owner-open{opacity:0}.resource-owner-head:is(:hover,:focus-within) .owner-open{opacity:1}
.resource-owner-body{padding:3px 0 8px 11px;margin:0 0 4px 8px;border-left:1px solid #d8dfe8;min-height:80px}.resource-owner-body :deep(.sidebar-panel){margin:0;padding:0;border:0}.resource-owner-body :deep(.res-head){min-height:27px;padding:0;justify-content:flex-end}.resource-owner-body :deep(.res-body){max-height:45dvh;overflow:auto}.resource-owner-body :deep(.res-tree){max-height:none;overflow:visible}.resource-owner-body :deep(.res-empty){min-height:60px}.resource-owner-body :deep(.ws-root){font-size:10px}
.global-resource-empty{padding:20px 10px;color:#8591a0;text-align:center}.global-resource-empty button{color:#3a6c9d;margin-left:5px}
.resource-owner-toggle,.resource-action,.owner-open{transition:background-color 140ms ease,color 140ms ease,opacity 140ms ease}button:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
@media(hover:none){.owner-open{opacity:1}}@media(prefers-reduced-motion:reduce){.resource-owner-toggle,.resource-action,.owner-open{transition:none}}
</style>
