<template>
  <div class="sidebar-dock dock-layout">
    <section v-for="panel in panels" v-show="active === panel.id" :key="panel.id" class="dock-group dock-single dock-leading" :data-group="`group-${panel.id}`">
      <header class="dock-header">
        <h2 :id="`dock-label-${panel.id}`" class="dock-label">{{ panel.label }}</h2>
        <div :id="`dock-actions-${panel.id}`" class="dock-panel-actions" />
        <button v-if="showPin" type="button" class="ui-icon-button" :disabled="pinDisabled" :aria-label="pinDisabled?pinDisabledReason||'当前布局使用固定侧栏':pinned?'切换为悬浮侧栏':'固定侧栏'" :title="pinDisabled?pinDisabledReason||'当前布局使用固定侧栏':pinned?(floating?'当前窗口较窄，侧栏临时悬浮；点击保持悬浮':'切换为悬浮侧栏'):'固定侧栏'" :aria-pressed="pinned" @click="emit('pin')"><SidebarPresentationIcon :floating="!pinned" /></button>
        <button type="button" class="ui-icon-button" :aria-label="`隐藏${panel.label}侧栏`" :title="`隐藏${panel.label}侧栏`" @click="emit('close')"><AppIcon icon="sidebar-hide" /></button>
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
import SidebarPresentationIcon from '../icons/SidebarPresentationIcon.vue'
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'
withDefaults(defineProps<{panels:SidebarPanelDefinition[];active:string;floating?:boolean;pinned?:boolean;pinDisabled?:boolean;pinDisabledReason?:string;showPin?:boolean}>(),{showPin:true})
const emit=defineEmits<{close:[];pin:[]}>()
const ready=ref(false)
onMounted(()=>{ready.value=true})
</script>
<style scoped>
.dock-layout,.dock-group,.dock-content,.dock-pane{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.dock-header{height:44px;min-height:44px;display:flex;align-items:center;gap:3px;-webkit-app-region:no-drag}
.dock-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:#556174;padding-left:3px}
.dock-panel-actions{display:flex;align-items:center;flex-shrink:0}
</style>
