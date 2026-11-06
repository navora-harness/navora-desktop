<template>
  <template v-if="native.menusSupported.value">
    <button type="button" class="sidebar-more-trigger" :aria-label="`${label}更多操作`" :title="`${label}更多操作`" aria-haspopup="menu" :aria-expanded="nativeShell?.open||false" @click="nativeShell?.show($event)"><AppIcon icon="ellipsis" /></button>
    <SidebarContextMenu ref="nativeShell"><slot /><button type="button" role="menuitem" :aria-label="hideAriaLabel||hideLabel" @click="emit('hide')"><AppIcon icon="sidebar-hide" /><span>{{hideLabel}}</span></button></SidebarContextMenu>
  </template>
  <v-menu v-else v-model="open" location="bottom end" origin="auto" :offset="6" :close-on-content-click="true">
    <template #activator="{props:menuProps}">
      <button v-bind="menuProps" type="button" class="sidebar-more-trigger" :aria-label="`${label}更多操作`" :title="`${label}更多操作`">
        <AppIcon icon="ellipsis" />
      </button>
    </template>
    <div class="sidebar-panel-menu" role="menu" :aria-label="`${label}操作`" @keydown.esc.stop="open=false" @keydown="onKey">
      <slot />
      <button type="button" role="menuitem" :aria-label="hideAriaLabel || hideLabel" @click="emit('hide')"><AppIcon icon="sidebar-hide" /><span>{{ hideLabel }}</span></button>
    </div>
  </v-menu>
</template>
<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import SidebarContextMenu from './SidebarContextMenu.vue'
import {useNativeUi} from '@/composables/useNativeUi'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
withDefaults(defineProps<{label:string;hideLabel?:string;hideAriaLabel?:string}>(),{hideLabel:'隐藏侧栏'})
const emit=defineEmits<{hide:[]}>()
const open=ref(false)
const native=useNativeUi(),nativeShell=ref<InstanceType<typeof SidebarContextMenu>>()
function otherNative(){open.value=false}
onMounted(()=>{void native.ready();window.addEventListener(NATIVE_UI_OPEN,otherNative)})
onBeforeUnmount(()=>window.removeEventListener(NATIVE_UI_OPEN,otherNative))
function onKey(event:KeyboardEvent){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
  event.preventDefault()
  event.stopPropagation()
  const buttons=[...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')]
  if(!buttons.length)return
  const current=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
    current<0?(event.key==='ArrowDown'?0:buttons.length-1):
    (current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus()
}
</script>
<style scoped>
.sidebar-more-trigger{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:#6c788c;cursor:pointer;-webkit-app-region:no-drag;transition:background-color 140ms ease,color 140ms ease,border-color 140ms ease}.sidebar-more-trigger svg{width:13px;height:13px}.sidebar-more-trigger:hover,.sidebar-more-trigger[aria-expanded=true]{background:#e8edf4;border-color:#d6dfeb;color:#365576}.sidebar-more-trigger:focus-visible{outline:2px solid #6b8db5;outline-offset:-2px}
.sidebar-panel-menu{min-width:160px;max-width:260px;padding:5px;border:1px solid #d6dfe9;border-radius:9px;background:#fff;box-shadow:0 8px 28px #21344b1c;color:#52647c}.sidebar-panel-menu :deep(button[role=menuitem]){display:flex;align-items:center;gap:9px;width:100%;min-height:33px;padding:7px 10px;border:1px solid transparent;border-radius:5px;text-align:start;font:inherit;font-size:12px;line-height:1.5;color:#52647c;background:transparent;cursor:pointer}.sidebar-panel-menu :deep(button[role=menuitem] svg){width:12px;height:12px;flex-shrink:0;color:#7a8ba1}.sidebar-panel-menu :deep(button[role=menuitem]:hover:not(:disabled)){background:#eaf0f7;color:#34577e}.sidebar-panel-menu :deep(button[role=menuitem]:focus-visible){outline:2px solid #6b8db5;outline-offset:-2px;background:#eaf0f7}.sidebar-panel-menu :deep(button[role=menuitem]:disabled){opacity:.45;cursor:default}
@media(prefers-reduced-motion:reduce){.sidebar-more-trigger{transition:none}}
</style>
