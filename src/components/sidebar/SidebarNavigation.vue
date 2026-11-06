<template>
  <div class="rail-panel-groups">
    <button v-for="panel in panels" :key="panel.id" type="button" class="sidebar-icon-btn rail-panel-button" :class="{selected:!inactive && active===panel.id,'has-activity':panel.id==='workspace'&&downloads>0}" :data-panel="panel.id" :aria-label="label(panel)" :title="label(panel)" :aria-pressed="!inactive && active===panel.id" @click="emit('activate',panel.id)"><AppIcon :icon="panel.icon" /><span v-if="count(panel.id)" class="rail-count" :aria-label="`${count(panel.id)} ${panel.id==='workspace'?'个下载进行中':'个页面'}`">{{ count(panel.id)>99?'99+':count(panel.id) }}</span><span v-else-if="panel.id==='workspace' && unread" class="rail-notification" aria-label="有新下载完成" /></button>
  </div>
</template>
<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'
import {browserPagesByChat} from '@shared/browser-resource-sessions'
const props=defineProps<{panels:SidebarPanelDefinition[];active:string;inactive:boolean}>()
const emit=defineEmits<{activate:[id:string]}>()
const label=(panel:SidebarPanelDefinition)=>({chats:'对话列表',workspace:'对话文件',browser:'浏览器资源'} as Record<string,string>)[panel.id]||panel.label
const downloads=ref(0),pageCounts=ref<Record<string,number>>({}),unread=ref(false),pages=computed(()=>Object.values(pageCounts.value).reduce((sum,count)=>sum+count,0))
const count=(id:string)=>id==='workspace'?downloads.value:id==='browser'?pages.value:0
let offDownload:(()=>void)|undefined,offBrowser:(()=>void)|undefined,disposed=false,downloadsUpdated=false
const seenCompleted=new Set<string>(),updatedChats=new Set<string>()
function updateDownloads(items:import('@shared/types').BrowserDownloadEntry[],notify=false){downloads.value=items.filter(item=>['started','paused','intercepted'].includes(item.state)).length;for(const item of items)if(item.state==='completed'){if(notify&&!seenCompleted.has(item.id)&&props.active!=='workspace')unread.value=true;seenCompleted.add(item.id)}}
watch(()=>props.active,value=>{if(value==='workspace')unread.value=false})
onMounted(()=>{
  void window.navora?.downloads.list().then(items=>{if(!disposed&&!downloadsUpdated)updateDownloads(items)}).catch(()=>{})
  void window.navora?.browser.treeAll().then(tree=>{if(disposed)return;for(const [id,pages] of browserPagesByChat(tree))if(!updatedChats.has(id))pageCounts.value[id]=pages.length}).catch(()=>{})
  offDownload=window.navora?.downloads.onChanged(payload=>{downloadsUpdated=true;updateDownloads(payload.downloads,true)})
  offBrowser=window.navora?.browser.onTreeUpdated(payload=>{const groups=browserPagesByChat(payload.tree);for(const id of new Set([payload.chatId,...groups.keys()])){updatedChats.add(id);pageCounts.value[id]=groups.get(id)?.length||0}})
})
onBeforeUnmount(()=>{disposed=true;offDownload?.();offBrowser?.()})
</script>
<style scoped>
.rail-panel-groups{display:flex;flex-direction:column;gap:8px;min-height:0;max-height:calc(100dvh - 300px);overflow-y:auto;scrollbar-width:none;padding:3px 4px;margin-inline:-4px;width:40px}
.rail-panel-button{position:relative;flex-shrink:0}.rail-panel-button.selected{background:var(--control-selected);color:var(--navora-accent)}.rail-panel-button.selected::before{content:'';position:absolute;left:-5px;top:11px;bottom:11px;width:3px;border-radius:3px;background:var(--navora-accent)}
.rail-count{position:absolute;right:-3px;top:-3px;display:grid;place-items:center;min-width:15px;height:15px;padding:0 3px;border:2px solid var(--navora-background);border-radius:6px;color:var(--navora-muted);background:var(--navora-stroke);font-size:9px;font-weight:600;line-height:1;pointer-events:none;font-variant-numeric:tabular-nums}
.has-activity .rail-count,.rail-panel-button.selected .rail-count{background:var(--navora-accent);color:#fff}.rail-notification{position:absolute;right:1px;top:1px;width:7px;height:7px;border:2px solid var(--navora-background);border-radius:50%;background:var(--navora-accent)}
</style>
