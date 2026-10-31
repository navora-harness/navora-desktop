<template>
  <div class="sidebar-dock dock-layout" :class="{ 'dock-dragging': dragging.length, 'dock-resizing': resizing }" @dragend="clearDrag" @drop="clearDrag">
    <template v-for="(group, index) in modelValue.groups" :key="group.id">
      <section v-show="members(group).length" class="dock-group" :class="{ 'dock-collapsed': group.collapsed }" :data-group="group.id" :style="{ flex: group.collapsed ? '0 0 34px' : `${group.weight} 1 0px` }">
        <header class="dock-header">
          <button type="button" class="dock-collapse" :aria-expanded="!group.collapsed" :aria-label="`折叠或展开${label(active(group))}`" @click="collapse(group)"><font-awesome-icon :icon="group.collapsed ? 'chevron-right' : 'chevron-down'" /></button>
          <div class="dock-tabs" role="tablist" aria-label="侧栏面板">
            <button v-for="panel in members(group)" :id="`dock-tab-${panel.id}`" :key="panel.id" type="button" role="tab" :aria-selected="active(group) === panel.id" :aria-controls="`dock-pane-${panel.id}`" :tabindex="active(group) === panel.id ? 0 : -1" class="dock-tab" :class="{ active: active(group) === panel.id }" :title="`${panel.label} · 拖动可组合或拆分`" draggable="true" @dragstart="startDrag($event, [panel.id])" @click="select(group, panel.id)" @keydown="tabKey($event, group, panel.id)">{{ panel.label }}</button>
          </div>
          <div :id="`dock-actions-${group.id}`" class="dock-panel-actions" />
          <v-menu location="bottom end">
            <template #activator="{ props: menuProps }"><button v-bind="menuProps" type="button" class="dock-menu-button" aria-label="面板布局" title="面板布局" draggable="true" @dragstart="startDrag($event, members(group).map(panel => panel.id))"><font-awesome-icon icon="ellipsis" /></button></template>
            <div class="dock-menu" role="menu">
              <button v-if="members(group).length > 1" type="button" role="menuitem" @click="update(splitDockPanel(modelValue, active(group)))">拆出{{ label(active(group)) }}</button>
              <button v-for="other in modelValue.groups.filter(item => item.id !== group.id && members(item).length)" :key="other.id" type="button" role="menuitem" @click="move([active(group)], other.id, 'tab')">与{{ members(other).map(panel => panel.label).join('、') }}组合</button>
              <button v-if="index > 0" type="button" role="menuitem" @click="reorder(group, -1)">上移此组</button>
              <button v-if="index < modelValue.groups.length - 1" type="button" role="menuitem" @click="reorder(group, 1)">下移此组</button>
              <button type="button" role="menuitem" @click="hide(active(group))">隐藏{{ label(active(group)) }}</button>
              <button type="button" role="menuitem" @click="update(normalizeDock(null, panels.map(panel => panel.id)))">恢复默认布局</button>
            </div>
          </v-menu>
        </header>
        <div :id="`dock-content-${group.id}`" class="dock-content" :inert="group.collapsed" />
        <div v-if="dragging.length" class="dock-drop-zones">
          <div v-for="placement in placements" :key="placement" class="dock-drop-zone" :class="[placement, { targeted: dropTarget === `${group.id}:${placement}` }]" @dragover.prevent.stop="over($event, group.id, placement)" @dragleave="dropTarget = ''" @drop.prevent.stop="drop(group.id, placement)">{{ placement === 'tab' ? '合并为标签组' : placement === 'before' ? '放在上方' : '放在下方' }}</div>
        </div>
      </section>
      <div v-if="nextVisible(group)" class="sidebar-divider horizontal dock-divider" role="separator" aria-label="调整面板高度" aria-orientation="horizontal" tabindex="0" @pointerdown="beginResize($event, group)" @keydown="resizeKey($event, group)" />
    </template>
    <!-- Each panel has one stable owner, even when its destination group changes. -->
    <template v-if="ready">
      <Teleport v-for="panel in panels" :key="panel.id" defer :to="`#dock-content-${groupFor(panel.id)?.id}`">
        <div v-show="isActive(panel.id)" :id="`dock-pane-${panel.id}`" class="dock-pane" role="tabpanel" :aria-labelledby="`dock-tab-${panel.id}`" :inert="!isActive(panel.id)">
          <slot :name="panel.id" :active="isActive(panel.id)" :header-target="`#dock-actions-${groupFor(panel.id)?.id}`"><component :is="panel.component" v-if="panel.component" /></slot>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { moveDockPanels, normalizeDock, splitDockPanel, type DockGroup, type DockPlacement, type SidebarDockLayout } from '../../../shared/sidebar-dock'
import type { SidebarPanelDefinition } from '@/composables/useSidebarDock'
const props = defineProps<{ modelValue: SidebarDockLayout; panels: SidebarPanelDefinition[] }>()
const emit = defineEmits<{ 'update:modelValue': [layout: SidebarDockLayout] }>()
const ready = ref(false), dragging = ref<string[]>([]), dropTarget = ref(''), resizing = ref(false)
const placements: DockPlacement[] = ['before', 'tab', 'after']
const members = (group: DockGroup) => group.panels.flatMap(id => props.modelValue.hidden.includes(id) ? [] : props.panels.filter(panel => panel.id === id))
const active = (group: DockGroup) => members(group).some(panel => panel.id === group.active) ? group.active : members(group)[0]?.id || ''
const label = (id: string) => props.panels.find(panel => panel.id === id)?.label || id
const groupFor = (id: string) => props.modelValue.groups.find(group => group.panels.includes(id))
const isActive = (id: string) => { const group = groupFor(id); return Boolean(group && !group.collapsed && active(group) === id) }
const update = (layout: SidebarDockLayout) => emit('update:modelValue', layout)
function select(group: DockGroup, panel: string) { update({ ...props.modelValue, groups: props.modelValue.groups.map(item => item === group ? { ...item, active: panel, collapsed: false } : item) }) }
function collapse(group: DockGroup) { update({ ...props.modelValue, groups: props.modelValue.groups.map(item => item === group ? { ...item, collapsed: !item.collapsed } : item) }) }
function hide(panel: string) { update({ ...props.modelValue, hidden: [...props.modelValue.hidden, panel] }) }
function reorder(group: DockGroup, delta: number) {
  const groups = [...props.modelValue.groups], index = groups.indexOf(group)
  groups.splice(index, 1); groups.splice(Math.max(0, index + delta), 0, group)
  update({ ...props.modelValue, groups })
}
function move(panels: string[], target: string, placement: DockPlacement) { update(moveDockPanels(props.modelValue, panels, target, placement)) }
function startDrag(event: DragEvent, panels: string[]) {
  if (!event.dataTransfer) return
  dragging.value = panels
  event.dataTransfer.setData('application/x-navora-sidebar-panels', JSON.stringify(panels))
  event.dataTransfer.effectAllowed = 'move'
}
function clearDrag() { dragging.value = []; dropTarget.value = '' }
function over(event: DragEvent, group: string, placement: DockPlacement) { if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; dropTarget.value = `${group}:${placement}` }
function drop(target: string, placement: DockPlacement) { move(dragging.value, target, placement); clearDrag() }
async function tabKey(event: KeyboardEvent, group: DockGroup, panel: string) {
  const list = members(group), index = list.findIndex(item => item.id === panel)
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = list[event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + list.length) % list.length]
  if (next) { select(group, next.id); await nextTick(); document.getElementById(`dock-tab-${next.id}`)?.focus() }
}
function nextVisible(group: DockGroup) {
  if (!members(group).length || group.collapsed) return undefined
  return props.modelValue.groups.slice(props.modelValue.groups.indexOf(group) + 1).find(item => members(item).length && !item.collapsed)
}
function adjust(first: DockGroup, second: DockGroup, delta: number, heights?: [number, number]) {
  const a = heights?.[0] ?? first.weight, b = heights?.[1] ?? second.weight
  const amount = Math.max(64 - a, Math.min(b - 64, delta))
  update({ ...props.modelValue, groups: props.modelValue.groups.map(group => group === first ? { ...group, weight: a + amount } : group === second ? { ...group, weight: b - amount } : group) })
}
let endResize: (() => void) | undefined
function beginResize(event: PointerEvent, first: DockGroup) {
  const second = nextVisible(first)
  if (event.button !== 0 || !second) return
  event.preventDefault(); endResize?.()
  const handle = event.currentTarget as HTMLElement
  const firstHeight = handle.previousElementSibling!.getBoundingClientRect().height
  const secondElement = handle.parentElement!.querySelector<HTMLElement>(`[data-group="${second.id}"]`)!
  const secondHeight = secondElement.getBoundingClientRect().height
  // Convert all weights into rendered pixels before resizing any adjacent pair.
  const groups = props.modelValue.groups.map(group => ({ ...group, weight: handle.parentElement!.querySelector<HTMLElement>(`[data-group="${group.id}"]`)?.getBoundingClientRect().height || group.weight }))
  const initial = { ...props.modelValue, groups }
  update(initial)
  const start = event.clientY
  const move = (next: PointerEvent) => {
    const amount = Math.max(64 - firstHeight, Math.min(secondHeight - 64, next.clientY - start))
    update({ ...initial, groups: groups.map(group => group.id === first.id ? { ...group, weight: firstHeight + amount } : group.id === second.id ? { ...group, weight: secondHeight - amount } : group) })
  }
  const end = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); handle.removeEventListener('lostpointercapture', end)
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    resizing.value = false; endResize = undefined
  }
  handle.setPointerCapture(event.pointerId); resizing.value = true
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end)
  endResize = end
}
function resizeKey(event: KeyboardEvent, group: DockGroup) {
  const second = nextVisible(group)
  if (!second || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); adjust(group, second, event.key === 'ArrowUp' ? -20 : 20)
}
onMounted(() => { ready.value = true; window.addEventListener('dragend', clearDrag); window.addEventListener('drop', clearDrag) })
onBeforeUnmount(() => { endResize?.(); window.removeEventListener('dragend', clearDrag); window.removeEventListener('drop', clearDrag) })
</script>

<style scoped>
.dock-layout { display:flex; flex-direction:column; min-height:0; flex:1; gap:0; overflow:hidden; }
.dock-group { position:relative; display:flex; flex-direction:column; min-height:86px; min-width:0; overflow:hidden; border:1px solid #e5e8ee; border-radius:9px; background:#fafbfc; contain:layout style; }
.dock-group.dock-collapsed { min-height:34px; }
.dock-header { height:34px; min-height:34px; display:flex; align-items:center; gap:2px; padding:2px 4px; border-bottom:1px solid #edf0f4; -webkit-app-region:no-drag; }
.dock-collapsed .dock-header { border-bottom-color:transparent; }
.dock-tabs { display:flex; align-items:center; min-width:0; flex:1; overflow:auto; scrollbar-width:none; gap:2px; }
.dock-tab { min-width:0; flex:0 1 auto; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; height:26px; padding:3px 6px; border:1px solid transparent; border-radius:6px; font-size:11px; color:#778291; cursor:grab; }
.dock-tab.active { background:#e9edf3; color:#344b68; border-color:#dfe5ed; font-weight:600; }
.dock-tab:active { cursor:grabbing; }
.dock-collapse,.dock-menu-button { width:23px; height:26px; flex-shrink:0; display:grid; place-items:center; border:1px solid transparent; border-radius:6px; color:#6c7786; cursor:pointer; }
.dock-collapse > svg { width:9px; height:9px; }
.dock-menu-button > svg { width:13px; height:13px; }
.dock-header button:hover { background:#e8ecf2; border-color:#dce3ec; color:#344b68; }
.dock-header button:focus-visible { outline:2px solid #537ab9; outline-offset:-2px; }
.dock-panel-actions { display:flex; align-items:center; flex-shrink:0; }
.dock-content { display:flex; flex:1; min-height:0; overflow:hidden; }
.dock-collapsed .dock-content { display:none; }
.dock-pane { display:flex; flex-direction:column; width:100%; flex:1; min-width:0; min-height:0; overflow:hidden; animation:dock-content-enter 160ms ease-out; }
.dock-header button { transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease; }
.dock-divider { height:8px; }
.dock-drop-zones { position:absolute; inset:0; display:grid; grid-template-rows:28% 44% 28%; z-index:10; background:#f5f8fcad; border-radius:8px; }
.dock-drop-zone { display:flex; align-items:center; justify-content:center; font-size:11px; color:#496788; border:1px dashed #b8c7d9; margin:2px; border-radius:5px; pointer-events:auto; }
.dock-drop-zone.targeted { background:#dbe8fa; border-color:#5f84b3; color:#264f85; }
.dock-menu { display:flex; flex-direction:column; min-width:170px; padding:5px; border:1px solid #e3e7ed; border-radius:9px; background:#fff; box-shadow:0 8px 24px #1c304018; }
.dock-menu button { padding:7px 9px; font-size:12px; text-align:left; color:#536176; border-radius:6px; }
.dock-menu button:hover { background:#eef2f7; }
@keyframes dock-content-enter { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }
@media(prefers-reduced-motion:reduce) { .dock-pane { animation:none; } .dock-header button { transition:none; } }
</style>
