<template>
  <SidebarContextMenu ref="shell" :native-items="nativeItems" @native-action="nativeAction">
    <div class="browser-tab-menu-content">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separatorBefore" role="separator" class="browser-tab-menu-separator" />
        <button type="button" role="menuitem" class="sidebar-more-item browser-tab-menu-item" :class="{danger:item.danger,'is-submenu-open':submenu?.id===item.id}" :disabled="item.disabled" :title="item.reason" :aria-haspopup="item.children?'menu':undefined" :aria-expanded="item.children?submenu?.id===item.id:undefined" @pointerenter="hoverItem(item,$event)" @focus="focusRootItem(item)" @click.stop="clickItem(item,$event)" @keydown="rootKey($event,item)">
          <BrowserTabAudioIcon v-if="item.icon==='tab-audio'||item.icon==='tab-muted'" :muted="item.icon==='tab-muted'" />
          <AppIcon v-else :icon="item.icon||'minus'" :style="{visibility:item.icon?'visible':'hidden'}" />
          <span class="browser-tab-menu-label">{{ item.label }}</span><span v-if="item.shortcut" class="browser-tab-menu-shortcut">{{ item.shortcut }}</span><AppIcon v-if="item.children" icon="chevron-right" class="browser-tab-menu-chevron" />
        </button>
      </template>
    </div>
  </SidebarContextMenu>
  <Teleport to="body">
    <div v-if="open&&submenu?.children" ref="submenuPanel" class="sidebar-ctx-panel browser-tab-submenu" role="menu" :aria-label="submenu.label" :style="{left:`${position.x}px`,top:`${position.y}px`}" @pointerenter="cancelLeave" @pointerleave="queueLeave" @contextmenu.prevent @click.stop>
      <template v-for="item in submenu.children" :key="item.id">
        <div v-if="item.separatorBefore" role="separator" class="browser-tab-menu-separator" />
        <button type="button" role="menuitem" class="sidebar-more-item browser-tab-menu-item" :class="{danger:item.danger}" :disabled="item.disabled" :title="item.reason" @click.stop="activate(item)">
          <BrowserTabAudioIcon v-if="item.icon==='tab-audio'||item.icon==='tab-muted'" :muted="item.icon==='tab-muted'" />
          <AppIcon v-else :icon="item.icon||'minus'" :style="{visibility:item.icon?'visible':'hidden'}" />
          <span class="browser-tab-menu-label">{{ item.label }}</span><span v-if="item.shortcut" class="browser-tab-menu-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script lang="ts">
export type BrowserTabMenuItem={id:string;label:string;icon?:string;shortcut?:string;disabled?:boolean;reason?:string;danger?:boolean;separatorBefore?:boolean;children?:BrowserTabMenuItem[]}
</script>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import SidebarContextMenu from './sidebar/SidebarContextMenu.vue'
import AppIcon from './icons/AppIcon.vue'
import BrowserTabAudioIcon from './BrowserTabAudioIcon.vue'
import type {NativeMenuItem} from '@shared/native-ui'

const props=defineProps<{items:BrowserTabMenuItem[]}>()
const emit=defineEmits<{action:[id:string];closed:[]}>()
const shell=ref<InstanceType<typeof SidebarContextMenu>>(),submenuPanel=ref<HTMLElement>()
const open=ref(false),submenu=ref<BrowserTabMenuItem|null>(null),position=ref({x:0,y:0})
function mapNative(items:BrowserTabMenuItem[]):NativeMenuItem[]{return items.flatMap(item=>[...(item.separatorBefore?[{id:`separator-${item.id}`,label:'',type:'separator' as const}]:[]),{id:item.id,label:item.label,icon:item.icon,enabled:!item.disabled,reason:item.reason,shortcut:item.shortcut,...(item.children?{children:mapNative(item.children)}:{})}])}
const nativeItems=computed(()=>mapNative(props.items))
function nativeAction(id:string){function find(items:BrowserTabMenuItem[]):BrowserTabMenuItem|undefined{for(const item of items){if(item.id===id)return item;const child=item.children&&find(item.children);if(child)return child}}const item=find(props.items);if(item&&!item.disabled&&!item.children)activate(item)}
let submenuTrigger:HTMLButtonElement|undefined,leaveTimer:ReturnType<typeof setTimeout>|undefined
function cancelLeave(){clearTimeout(leaveTimer);leaveTimer=undefined}
function clearSubmenu(restore=false){cancelLeave();submenu.value=null;if(restore&&submenuTrigger?.isConnected)submenuTrigger.focus({preventScroll:true});submenuTrigger=undefined}
function queueLeave(){cancelLeave();leaveTimer=setTimeout(()=>clearSubmenu(),250)}
function show(event:MouseEvent|KeyboardEvent){clearSubmenu();open.value=true;shell.value?.show(event)}
function hide(){clearSubmenu();shell.value?.hide();if(open.value){open.value=false;emit('closed')}}
watch(()=>shell.value?.open,value=>{if(!value&&open.value){clearSubmenu();open.value=false;emit('closed')}})
async function openSubmenu(item:BrowserTabMenuItem,trigger:HTMLButtonElement,focus=false){
  cancelLeave();if(item.disabled||!item.children)return
  submenu.value=item;submenuTrigger=trigger
  const bounds=trigger.getBoundingClientRect(),width=Math.min(300,window.innerWidth-16)
  position.value={x:Math.max(8,bounds.right+width+4>window.innerWidth-8?bounds.left-width-4:bounds.right+4),y:Math.max(8,bounds.top-6)}
  await nextTick()
  const panel=submenuPanel.value
  if(!panel||submenu.value?.id!==item.id)return
  position.value={...position.value,y:Math.max(8,Math.min(position.value.y,window.innerHeight-panel.offsetHeight-8))}
  if(focus)panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true})
}
function hoverItem(item:BrowserTabMenuItem,event:PointerEvent){
  cancelLeave()
  if(item.children&&!item.disabled)void openSubmenu(item,event.currentTarget as HTMLButtonElement)
  else clearSubmenu()
}
function clickItem(item:BrowserTabMenuItem,event:MouseEvent){if(item.children)void openSubmenu(item,event.currentTarget as HTMLButtonElement,true);else activate(item)}
function focusRootItem(item:BrowserTabMenuItem){if(submenu.value&&submenu.value.id!==item.id)clearSubmenu()}
function activate(item:BrowserTabMenuItem){if(item.disabled)return;emit('action',item.id);hide()}
function rootKey(event:KeyboardEvent,item:BrowserTabMenuItem){
  if(event.key==='ArrowRight'&&item.children&&!item.disabled){event.preventDefault();event.stopPropagation();void openSubmenu(item,event.currentTarget as HTMLButtonElement,true)}
}
watch(()=>props.items,items=>{
  if(!submenu.value)return
  const next=items.find(item=>item.id===submenu.value?.id)
  if(!next?.children||next.disabled||!submenuTrigger?.isConnected){clearSubmenu();return}
  void openSubmenu(next,submenuTrigger)
})
function submenuKey(event:KeyboardEvent){
  if(!open.value||!submenu.value||!submenuPanel.value?.contains(document.activeElement))return
  if(event.key==='ArrowLeft'||event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();clearSubmenu(true);return}
  if(event.key==='Tab'){event.stopImmediatePropagation();hide();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault();event.stopImmediatePropagation()
  const buttons=[...submenuPanel.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if(!buttons.length)return
  const at=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(Math.max(0,at)+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus({preventScroll:true})
}
// Register before SidebarContextMenu opens its own capture listener, so a nested
// menu handles its own focus navigation without moving focus in the parent.
function blurred(){if(!shell.value?.nativeOpen)hide()}
onMounted(()=>{window.addEventListener('keydown',submenuKey,true);window.addEventListener('blur',blurred);window.addEventListener('resize',hide)})
onBeforeUnmount(()=>{cancelLeave();window.removeEventListener('keydown',submenuKey,true);window.removeEventListener('blur',blurred);window.removeEventListener('resize',hide)})
defineExpose({show,hide,open})
</script>

<style>
.browser-tab-menu-content{min-width:276px;max-width:calc(100vw - 30px)}
.sidebar-ctx-panel .browser-tab-menu-content .browser-tab-menu-item.sidebar-more-item,.sidebar-ctx-panel.browser-tab-submenu .browser-tab-menu-item.sidebar-more-item{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:32px;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:var(--appearance-ink,#39414d);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:default}
.sidebar-ctx-panel .browser-tab-menu-content .browser-tab-menu-item.sidebar-more-item:hover:not(:disabled),.sidebar-ctx-panel.browser-tab-submenu .browser-tab-menu-item.sidebar-more-item:hover:not(:disabled),.sidebar-ctx-panel .browser-tab-menu-content .browser-tab-menu-item.is-submenu-open{background:var(--appearance-selection,#eef0f3)}
.sidebar-ctx-panel .browser-tab-menu-content .browser-tab-menu-item.sidebar-more-item:focus-visible,.sidebar-ctx-panel.browser-tab-submenu .browser-tab-menu-item.sidebar-more-item:focus-visible{outline:2px solid var(--appearance-accent,#6487b1);outline-offset:-2px;background:var(--appearance-selection,#eef0f3)}
.sidebar-ctx-panel .browser-tab-menu-item:disabled{opacity:.45;cursor:default}
.browser-tab-menu-item>.app-icon,.browser-tab-menu-item>.browser-tab-audio-icon{width:16px;height:16px;flex:0 0 16px}
.browser-tab-menu-label{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}
.browser-tab-menu-shortcut{flex:0 0 auto;padding-left:14px;color:var(--appearance-muted,#7b8491);font-size:12px;white-space:nowrap}
.browser-tab-menu-item>.browser-tab-menu-chevron{width:12px;height:12px;flex:0 0 12px;color:var(--appearance-muted,#7b8491)}
.browser-tab-menu-separator{height:1px;margin:5px 4px;background:var(--appearance-stroke,#e5e7eb)}
.browser-tab-submenu{position:fixed;z-index:12002;box-sizing:border-box;width:300px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);padding:6px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--appearance-stroke,#dfe2e7);border-radius:12px;background:var(--appearance-surface,#fff);color:var(--appearance-ink,#39414d);box-shadow:0 8px 28px #18203029}
</style>
