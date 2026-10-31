<template>
  <div class="rail-panel-groups">
    <div v-for="entry in entries" :key="entry.id" class="rail-group-entry" :class="{'rail-drop-target':target===entry.id,'rail-drag-source':dragging===entry.id}" @dragover="over($event,entry.id)" @dragleave="target=''" @drop="drop($event,entry.id)">
      <button type="button" class="sidebar-icon-btn rail-group-button" :class="{selected:!inactive&&state.active===entry.id}" :data-rail-group="entry.id" :data-panel="entry.members.length===1?entry.members[0]!.id:undefined" :title="description(entry)" :aria-label="description(entry)" :aria-pressed="!inactive&&state.active===entry.id" draggable="true" @dragstart="start($event,entry.id)" @click="emit('activate',entry.id)" @contextmenu.prevent="menu=entry.id" @keydown="key($event,entry.id)">
        <font-awesome-icon v-if="entry.members.length===1" :icon="entry.members[0]!.icon" />
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="4.5" stroke-width="1.2" opacity=".55" /><g v-for="(panel,index) in entry.members.slice(0,4)" :key="panel.id" :transform="glyphPosition(index,entry.members.length)"><path v-if="panel.id==='chats'" d="M3 4h18v12H10l-5 4v-4H3z" /><path v-else-if="panel.id==='workspace'" d="M2 6h8l3 3h9l-3 11H2z M2 6V3h8l3 3" /><g v-else-if="panel.id==='browser'"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M2 8h20" /></g><g v-else><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12h8M12 8v8" /></g></g></svg>
      </button>
      <v-menu :model-value="menu===entry.id" location="end" @update:model-value="menu=$event?entry.id:''"><template #activator="{props:menuProps}"><button v-bind="menuProps" class="rail-menu-anchor" tabindex="-1" aria-hidden="true" /></template><div class="rail-group-menu" role="menu"><span>{{ entry.members.map(panel=>panel.label).join(' + ') }}</span><template v-if="entry.members.length>1"><button v-for="panel in entry.members" :key="panel.id" role="menuitem" @click="emit('split',panel.id);menu=''">拆出{{ panel.label }}</button><button role="menuitem" @click="emit('splitAll',entry.id);menu=''">全部拆开</button></template><button v-for="other in entries.filter(item=>item.id!==entry.id)" :key="other.id" role="menuitem" @click="emit('merge',entry.id,other.id);menu=''">与{{ other.members.map(panel=>panel.label).join('、') }}组合</button><button role="menuitem" @click="emit('activate',entry.id);menu=''">{{ state.active===entry.id?'关闭':'打开' }}侧栏</button></div></v-menu>
    </div>
    <div v-if="detachingPanel" class="rail-detach-target" aria-hidden="true"><font-awesome-icon :icon="panels.find(panel=>panel.id===detachingPanel)?.icon || 'plus'" /></div>
    <Teleport to="body"><div v-if="dragging || detachingPanel" class="rail-drag-hint" role="status">{{ detachingPanel ? '松开，拆成独立图标' : '拖到图标或当前侧栏中组合' }}</div></Teleport>
  </div>
</template>
<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import type {SidebarRailState} from '../../../shared/sidebar-rail'
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'
const props=defineProps<{state:SidebarRailState;panels:SidebarPanelDefinition[];inactive:boolean;detachingPanel?:string}>()
const emit=defineEmits<{activate:[id:string];merge:[source:string,target:string];split:[panel:string];splitAll:[id:string];dragging:[id:string]}>()
const entries=computed(()=>props.state.groups.map(group=>({...group,members:group.panels.flatMap(id=>props.panels.filter(panel=>panel.id===id))})).filter(group=>group.members.length))
type Entry=(typeof entries.value)[number]
const dragging=ref(''),target=ref(''),menu=ref('')
function description(entry:Entry){return entry.members.length>1?`${entry.members.map(panel=>panel.label).join(' + ')}组合 · 点击同时打开或关闭`:`显示/隐藏${({chats:'对话列表',workspace:'工作区',browser:'浏览器资源'} as Record<string,string>)[entry.members[0]!.id]||entry.members[0]!.label}`}
function glyphPosition(index:number,count:number){return `translate(${count===2?3+index*10:index%2*10+3},${count===2?8:Math.floor(index/2)*10+3}) scale(.32)`}
function clear(){dragging.value='';target.value='';emit('dragging','')}
function start(event:DragEvent,id:string){if(!event.dataTransfer)return;menu.value='';dragging.value=id;emit('dragging',id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-navora-sidebar-rail-group',id)}
function over(event:DragEvent,id:string){if(!dragging.value||dragging.value===id)return;event.preventDefault();event.stopPropagation();target.value=id;if(event.dataTransfer)event.dataTransfer.dropEffect='move'}
function drop(event:DragEvent,id:string){if(!dragging.value||dragging.value===id)return;event.preventDefault();event.stopPropagation();emit('merge',dragging.value,id);clear()}
function key(event:KeyboardEvent,id:string){if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();menu.value=id}else if(event.key==='Escape'){menu.value='';clear()}}
onMounted(()=>{window.addEventListener('dragend',clear);window.addEventListener('drop',clear);window.addEventListener('blur',clear)})
onBeforeUnmount(()=>{window.removeEventListener('dragend',clear);window.removeEventListener('drop',clear);window.removeEventListener('blur',clear)})
</script>
<style scoped>
.rail-panel-groups{display:flex;flex-direction:column;gap:8px;min-height:0;max-height:calc(100dvh - 300px);overflow-y:auto;scrollbar-width:none;padding:3px 4px;margin-inline:-4px;width:40px}
.rail-group-entry{position:relative;width:32px;height:32px;flex-shrink:0}.rail-group-button{cursor:default}.rail-drag-source{opacity:.5}.rail-menu-anchor{position:absolute;inset:0;visibility:hidden;pointer-events:none}
.rail-drop-target .rail-group-button{background:#e2edf7!important;border-color:#86a7cc!important;outline:2px solid #7b9dc140;outline-offset:2px}
.rail-detach-target{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border:1px dashed #7f9dbf;border-radius:8px;color:#5b7b9e;background:#eaf1f8;pointer-events:none}.rail-detach-target svg{width:15px;height:15px}
.rail-drag-hint{position:fixed;left:56px;top:96px;z-index:2400;pointer-events:none;padding:6px 9px;background:#fff;border:1px solid #dde5ee;border-radius:7px;color:#5c7592;font-size:11px;white-space:nowrap;box-shadow:0 3px 12px #2136500d}
.rail-group-menu{min-width:170px;display:flex;flex-direction:column;padding:5px;border:1px solid #d5dde7;border-radius:9px;background:#fff;max-height:70dvh;overflow:auto}.rail-group-menu>span{padding:6px 8px;color:#8591a1;font-size:10px}.rail-group-menu button{padding:7px 8px;border-radius:6px;color:#56677e;text-align:left;font-size:12px;cursor:pointer}.rail-group-menu button:hover{background:#edf1f6}.rail-group-menu button:focus-visible{outline:2px solid #6489b5;outline-offset:-2px}
</style>
