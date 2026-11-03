<template>
  <main class="file-host-page" :aria-busy="busy" @keydown="keyDown">
    <DetachedWindowBar @dragover="drag.over" @dragleave="drag.leave" @drop="drag.drop($event)">
      <div ref="tabBar" class="file-host-tabs" role="tablist" aria-label="文件标签" @keydown="tabKey">
        <WorkspaceTabItem v-for="tab in tabs" :key="tab.key" class="file-host-tab" :tab-id="'file-tab-'+tabs.indexOf(tab)" :file-key="tab.key" controls="file-host-content" kind="file" :label="name(tab.path)" :title="`${ownerLabel(tab.chatId)} / ${tab.path}`" :aria-label="`${name(tab.path)}，${ownerLabel(tab.chatId)}，${tab.path}`" :selected="active===tab.key" :draggable="!busy" :close-disabled="busy" @pointerenter="!busy&&drag.prepare(tab)" @pointerdown="!busy&&drag.prepare(tab)" @dragstart="drag.start($event,tab)" @dragend="drag.end" @drop="drag.drop($event,tab.key)" @auxclick="middleClose($event,tab.key)" @select="active=tab.key" @close="close(tab.key)" />
      </div>
      <ActionMenu label="文件窗口更多操作" :disabled="busy" default-cursor :items="[{id:'attach',label:'当前标签移回工作区',icon:'window-restore'},{id:'all',label:'全部移回工作区',icon:'layer-group'},{id:'close',label:'关闭当前标签页',icon:'xmark',divider:true}]" @select="action" />
      <button type="button" class="ui-icon-button file-host-restore" :disabled="busy || !selected" aria-label="移回工作区" title="移回工作区" @mousedown.prevent.stop @click.stop="action('attach')"><AppIcon icon="arrow-left-to-line" /></button>
    </DetachedWindowBar>
    <div v-if="error" class="file-host-notice" role="alert">{{error}}<button type="button" class="ui-icon-button" aria-label="关闭操作提示" @click="error=''"><AppIcon icon="xmark" /></button></div>
    <div id="file-host-content" class="file-host-content" role="tabpanel" :aria-labelledby="'file-tab-'+tabs.findIndex(tab=>tab.key===active)">
      <KeepAlive :max="4"><FilePreviewPanel v-if="selected" :key="selected.key" embedded tabbed :chat-id="selected.chatId" :path="selected.path" :width="width" @close="close(selected.key)" @open-file="openFile" @notify="error=$event" /></KeepAlive>
    </div>
  </main>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import DetachedWindowBar from '@/components/DetachedWindowBar.vue'
import WorkspaceTabItem from '@/components/WorkspaceTabItem.vue'
import ActionMenu from '@/components/ActionMenu.vue'
import FilePreviewPanel from '@/components/FilePreviewPanel.vue'
import {useFileDrag} from '@/composables/useFileDrag'
import {makeFileTab,type FileTab} from '@shared/file-tabs'
import {fileWindowError} from '@shared/file-windows'
import {browserTabAfterRemoval,browserTabShortcut} from '@shared/browser-workspace'
const api=window.navora!.fileTabs,tabs=ref<FileTab[]>([]),active=ref(''),error=ref(''),busy=ref(false),owners=ref<Record<string,string>>({}),width=ref(innerWidth),tabBar=ref<HTMLElement|null>(null)
const selected=computed(()=>tabs.value.find(tab=>tab.key===active.value)),name=(path:string)=>path.split('/').at(-1)||path
const ownerLabel=(id:string)=>owners.value[id]||'对话文件'
const drag=useFileDrag(message=>error.value=message,()=>selected.value?.chatId||'')
let off:(()=>void)|undefined,disposed=false
function update(next:FileTab[]){const previous=tabs.value.map(t=>t.key),fresh=next.find(tab=>!previous.includes(tab.key));active.value=fresh?.key||browserTabAfterRemoval(previous,active.value,next.map(t=>t.key));tabs.value=next}
async function perform(run:()=>Promise<unknown>){if(busy.value||disposed)return;busy.value=true;try{error.value='';await run()}catch(e){if(!disposed)error.value=fileWindowError(e)}finally{if(!disposed)busy.value=false}}
function focusSelected(){void nextTick(()=>tabBar.value?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus({preventScroll:true}))}
function close(key:string){const focused=tabBar.value?.contains(document.activeElement);void perform(async()=>{await api.close(key);if(focused&&!disposed)focusSelected()})}
function middleClose(event:MouseEvent,key:string){if(event.button===1){event.preventDefault();close(key)}}
function action(id:string){if(id==='close'){if(selected.value)close(selected.value.key);return}void perform(async()=>{if(id==='all'){for(const tab of [...tabs.value])await api.attach(tab.key)}else if(selected.value)await api.attach(selected.value.key)})}
function openFile(path:string){if(selected.value)void perform(async()=>{const chatId=selected.value!.chatId;await api.open(chatId,path);update(await api.state());active.value=makeFileTab(chatId,path).key})}
function keyDown(event:KeyboardEvent){if(event.defaultPrevented||busy.value||document.querySelector('.v-overlay--active'))return;const shortcut=browserTabShortcut({key:event.key,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,isComposing:event.isComposing,isAutoRepeat:event.repeat});if(!shortcut||shortcut==='new')return;event.preventDefault();event.stopPropagation();if(shortcut==='close'){if(selected.value)close(selected.value.key)}else move(shortcut==='next'?1:-1)}
function move(step:number){if(!tabs.value.length)return;const at=tabs.value.findIndex(t=>t.key===active.value);active.value=tabs.value[(at+step+tabs.value.length)%tabs.value.length]!.key;focusSelected()}
function tabKey(event:KeyboardEvent){if(!(event.target as Element).matches('[role=tab]'))return;if(['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Delete'){if(selected.value)close(selected.value.key)}else if(event.key==='Home'||event.key==='End'){active.value=(event.key==='Home'?tabs.value[0]:tabs.value.at(-1))!.key;focusSelected()}else move(event.key==='ArrowRight'?1:-1)}}
const resize=()=>width.value=innerWidth
watch(active,()=>void nextTick(()=>tabBar.value?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'})))
watch(selected,tab=>{document.title=tab?`${name(tab.path)} — Navora`:'文件浏览器 — Navora'},{immediate:true})
onMounted(async()=>{off=api.onChanged(update);window.addEventListener('resize',resize);await perform(async()=>{update(await api.state());owners.value=Object.fromEntries((await window.navora!.chats.list()).map(chat=>[chat.id,chat.title]))})})
onBeforeUnmount(()=>{disposed=true;off?.();window.removeEventListener('resize',resize)})
</script>
<style>
.file-host-page{height:100dvh;display:flex;flex-direction:column;min-width:0;background:var(--navora-surface)}
.file-host-page button,.file-host-page .ui-action-menu button{cursor:default}
.file-host-tabs{display:flex;flex:1;min-width:0;gap:5px;overflow:auto;scrollbar-width:none;overscroll-behavior-x:contain}
.file-host-tabs::-webkit-scrollbar{display:none}
.file-host-tab{flex:0 1 210px}
.file-host-restore{position:absolute;right:var(--detached-caption-width,138px);top:2px;width:46px;height:40px;min-height:40px;padding:0;border:0;border-radius:0;background:transparent;color:#52677e;z-index:5;-webkit-app-region:no-drag}
.file-host-restore:hover:not(:disabled){background:#e7ebf0;color:#263b55}
.file-host-restore:disabled{opacity:.45}
.file-host-restore>.app-icon{width:18px;height:18px;font-size:18px}
.file-host-content{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.file-host-notice{display:flex;align-items:center;justify-content:space-between;padding:4px 12px;color:var(--control-danger);font-size:13px}
</style>
