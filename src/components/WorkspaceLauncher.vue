<template>
  <button type="button" class="workspace-launcher ui-icon-button" data-chat-resource="workspace" :class="{selected:open}" :disabled="disabled" :title="hint" :aria-label="label" :aria-description="count ? `${count} 个标签页` : undefined" :aria-pressed="open" :aria-expanded="open" @click="$emit('activate')">
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.25" y="2.75" width="15.5" height="14.5" rx="2.6" /><path v-if="!count" d="M6.5 10h7M10 6.5v7" /><text v-else x="10" y="13.65" text-anchor="middle" :class="{'many-tabs':count>9}">{{ count>9?'9+':count }}</text></svg>
  </button>
</template>
<script setup lang="ts">
import {computed} from 'vue'
const props=defineProps<{count:number;open:boolean;disabled?:boolean}>()
defineEmits<{activate:[]}>()
const label=computed(()=>props.open?'隐藏工作区':props.count?'显示工作区':'新建浏览器标签页')
const hint=computed(()=>props.open?`隐藏工作区，保留 ${props.count} 个标签页`:!props.count?`新建浏览器标签页（${window.navora?.app.platform==='darwin'?'⌘':'Ctrl'} T）`:`显示工作区 · ${props.count} 个标签页`)
</script>
<style>
.navora-app .workspace-launcher.ui-icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;min-width:32px;height:32px;min-height:32px;flex:0 0 32px;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--navora-muted,#727b8a);cursor:default;-webkit-app-region:no-drag}
.navora-app .workspace-launcher.ui-icon-button.selected{background:var(--control-selected,rgba(50,105,172,.1));color:var(--navora-accent,#3269ac)}
.navora-app .workspace-launcher.ui-icon-button:hover:not(:disabled){background:var(--control-hover);color:#52677e}
.navora-app .workspace-launcher.ui-icon-button.selected:hover:not(:disabled){background:var(--control-selected,rgba(50,105,172,.1));color:var(--navora-accent,#3269ac)}
.navora-app .workspace-launcher.ui-icon-button>svg{width:20px;height:20px;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.workspace-launcher text{fill:currentColor;stroke:none;font:500 10.5px 'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
.workspace-launcher text.many-tabs{font-size:9.5px;letter-spacing:-.1px}
</style>
