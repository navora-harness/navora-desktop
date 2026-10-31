<template>
  <div class="resource-overview">
    <section class="resource-overview-section">
      <header><h3>输出内容</h3><button type="button" class="resource-icon-button" data-resource-view="files" aria-label="查看全部文件" title="查看全部文件" @click="emit('view','files')"><font-awesome-icon icon="folder-open" /></button></header>
      <div v-if="error" class="resource-overview-empty">无法读取文件 <button type="button" @click="load">重试</button></div>
      <div v-else-if="!entries.length" class="resource-overview-empty">{{ loading?'正在读取…':'暂无输出文件' }}</div>
      <button v-for="entry in entries.slice(0,3)" :key="entry.path" type="button" class="resource-overview-row" :title="entry.path" @click="entry.type==='dir'?emit('view','files'):emit('preview',entry.path)"><font-awesome-icon :icon="entry.type==='dir'?'folder':'file-lines'" /><span>{{ entry.name }}</span></button>
      <button v-if="entries.length" type="button" class="resource-overview-more" @click="emit('view','files')"><font-awesome-icon icon="folder-open" />查看全部文件</button>
      <button v-if="outputCount" type="button" class="resource-overview-more" data-resource-view="outputs" @click="emit('view','outputs')"><font-awesome-icon icon="align-left" />对话输出 <small>{{ outputCount }}</small></button>
    </section>
    <section class="resource-overview-section">
      <header><h3>来源</h3><span v-if="sources.length" class="resource-overview-count">{{ sources.length }}</span></header>
      <div v-if="!sources.length" class="resource-overview-empty">暂无来源</div>
      <button v-for="source in shownSources" :key="source.url" type="button" class="resource-overview-row" :title="source.url" @click="openSource(source.url)"><font-awesome-icon icon="link" /><span>{{ source.title || source.url }}</span></button>
      <button v-if="sources.length>3" type="button" class="resource-overview-more" @click="allSources=!allSources"><font-awesome-icon :icon="allSources?'chevron-up':'link'" />{{ allSources?'收起来源':'查看全部来源' }}</button>
    </section>
    <section v-if="tree.length" class="resource-overview-section">
      <header><h3>浏览器</h3><button type="button" class="resource-icon-button" data-resource-view="browser" aria-label="管理当前浏览器" title="管理当前浏览器" @click="emit('view','browser')"><font-awesome-icon icon="window-maximize" /></button></header>
      <button v-for="browser in windows.slice(0,3)" :key="browser.windowId" type="button" class="resource-overview-row" :title="browser.url" @click="emit('view','browser')"><font-awesome-icon icon="window-maximize" /><span>{{ browser.title || browser.url || '新窗口' }}</span><small>{{ browser.loading?'加载中':browser.visible?'已打开':'已隐藏' }}</small></button>
      <button v-if="!windows.length || windows.length>3" type="button" class="resource-overview-more" @click="emit('view','browser')">管理浏览器 <small>{{ windows.length }} 个窗口</small></button>
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {BrowserTreeSession,ChatMessage} from '@shared/types'
import {conversationSources} from '@shared/conversation-resources'
import type {ResourceTab} from '@/composables/useConversationResources'
import type {WsEntry} from './sidebar/WorkspaceTreeNode.vue'
const props=defineProps<{chatId:string;messages:ChatMessage[];tree:BrowserTreeSession[]}>()
const emit=defineEmits<{view:[tab:ResourceTab];preview:[path:string];notify:[text:string]}>()
const entries=ref<WsEntry[]>([]),loading=ref(false),error=ref(false),allSources=ref(false)
const sources=computed(()=>conversationSources(props.messages))
const shownSources=computed(()=>allSources.value?sources.value:sources.value.slice(0,3))
const outputCount=computed(()=>props.messages.filter(message=>message.role==='assistant'&&message.content.trim()).length)
const windows=computed(()=>props.tree.flatMap(session=>session.windows))
let generation=0,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
async function load(){
  const seq=++generation,id=props.chatId
  loading.value=true;error.value=false
  try{
    const result=await window.navora!.workspace.list(id,'.')
    if(seq!==generation)return
    if(!result.ok)throw Error(result.error)
    entries.value=(result.entries||[]).sort((a,b)=>(b.mtimeMs||0)-(a.mtimeMs||0))
  }catch{if(seq===generation)error.value=true}
  finally{if(seq===generation)loading.value=false}
}
async function openSource(url:string){try{const result=await window.navora!.app.openExternal(url);if(!result.ok)throw Error('open_failed')}catch{emit('notify','无法打开此来源')}}
watch(()=>props.chatId,()=>{entries.value=[];allSources.value=false;void load()},{immediate:true})
onMounted(()=>{unsubscribe=window.navora?.workspace.onChanged(event=>{if(event.chatId===props.chatId){clearTimeout(timer);timer=setTimeout(()=>void load(),150)}})})
onBeforeUnmount(()=>{generation++;clearTimeout(timer);unsubscribe?.()})
</script>
<style>
.resource-overview{padding:0 14px 8px;overflow:auto;min-height:0;overscroll-behavior:contain;scrollbar-width:thin}
.resource-overview-section{padding:9px 0 10px}.resource-overview-section+.resource-overview-section{border-top:1px solid #e7e9ed}.resource-overview-section>header{display:flex;align-items:center;gap:6px;margin-bottom:5px;min-height:25px}.resource-overview-section h3{font-size:12px;font-weight:500;color:#77808b;flex:1;margin:0}.resource-overview-section .resource-icon-button{width:25px;height:25px;color:#818995}.resource-overview-section .resource-icon-button svg{width:13px;height:13px}
.resource-overview-row,.resource-overview-more{display:flex;align-items:center;gap:10px;width:100%;min-width:0;text-align:left;border:1px solid transparent;border-radius:7px;color:#626b78;padding:6px 7px;min-height:33px;transition:background-color 140ms,color 140ms}.resource-overview-row>svg,.resource-overview-more>svg{width:13px;height:13px;flex-shrink:0;color:#7d8795}.resource-overview-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px}.resource-overview-row:hover,.resource-overview-more:hover{background:#f0f2f5;color:#343e4e}.resource-overview-more{color:#89919b;font-size:11px;min-height:30px}.resource-overview-row small,.resource-overview-more small,.resource-overview-count{font-size:10px;color:#89929f;flex-shrink:0}.resource-overview-empty{font-size:12px;color:#929aa4;padding:8px 7px 10px}.resource-overview-empty button{color:#4d7096;padding-left:5px}
@media(prefers-reduced-motion:reduce){.resource-overview-row,.resource-overview-more{transition:none}}
</style>
