<template>
  <div class="sidebar-dock dock-layout">
    <section v-for="panel in panels" v-show="active === panel.id" :key="panel.id" class="dock-group dock-single dock-leading" :data-group="`group-${panel.id}`">
      <header class="dock-header">
        <h2 :id="`dock-label-${panel.id}`" class="dock-label">{{ panel.label }}</h2>
        <div :id="`dock-actions-${panel.id}`" class="dock-panel-actions" />
        <button type="button" class="dock-close" aria-label="关闭侧栏" title="关闭侧栏" @click="emit('close')"><font-awesome-icon icon="xmark" /></button>
      </header>
      <div :id="`dock-content-${panel.id}`" class="dock-content" :inert="active !== panel.id" />
    </section>
    <template v-if="ready">
      <Teleport v-for="panel in panels" :key="panel.id" defer :to="`#dock-content-${panel.id}`">
        <div v-show="active === panel.id" :id="`dock-pane-${panel.id}`" class="dock-pane" :aria-labelledby="`dock-label-${panel.id}`" :inert="active !== panel.id">
          <slot :name="panel.id" :active="active === panel.id" :header-target="`#dock-actions-${panel.id}`"><component :is="panel.component" v-if="panel.component" /></slot>
        </div>
      </Teleport>
    </template>
  </div>
</template>
<script setup lang="ts">
import {onMounted,ref} from 'vue'
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'
defineProps<{panels:SidebarPanelDefinition[];active:string}>()
const emit=defineEmits<{close:[]}>()
const ready=ref(false)
onMounted(()=>{ready.value=true})
</script>
<style scoped>
.dock-layout,.dock-group,.dock-content,.dock-pane{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.dock-header{height:44px;min-height:44px;display:flex;align-items:center;gap:3px;-webkit-app-region:no-drag}
.dock-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:#556174;padding-left:3px}
.dock-panel-actions{display:flex;align-items:center;flex-shrink:0}
.dock-close{width:28px;height:28px;display:grid;place-items:center;border:1px solid transparent;border-radius:7px;color:#6c7786;transition:background-color 140ms ease,color 140ms ease;cursor:pointer}
.dock-close svg{width:12px;height:12px}.dock-close:hover{background:#e7e9ee;color:#272d36}.dock-close:focus-visible{outline:2px solid #537ab9;outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.dock-close{transition:none}}
</style>
