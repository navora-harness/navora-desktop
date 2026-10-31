<template>
  <div class="rail-panel-groups">
    <button v-for="panel in panels" :key="panel.id" type="button" class="sidebar-icon-btn rail-panel-button" :class="{selected:!inactive && active===panel.id}" :data-panel="panel.id" :aria-label="label(panel)" :title="label(panel)" :aria-pressed="!inactive && active===panel.id" @click="emit('activate',panel.id)"><font-awesome-icon :icon="panel.icon" /></button>
  </div>
</template>
<script setup lang="ts">
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'
defineProps<{panels:SidebarPanelDefinition[];active:string;inactive:boolean}>()
const emit=defineEmits<{activate:[id:string]}>()
const label=(panel:SidebarPanelDefinition)=>({chats:'对话列表',workspace:'全部对话文件',browser:'全部浏览器资源'} as Record<string,string>)[panel.id]||panel.label
</script>
<style scoped>
.rail-panel-groups{display:flex;flex-direction:column;gap:8px;min-height:0;max-height:calc(100dvh - 300px);overflow-y:auto;scrollbar-width:none;padding:3px 4px;margin-inline:-4px;width:40px}
</style>
