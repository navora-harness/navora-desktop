import { computed, markRaw, onBeforeUnmount, shallowReactive, ref, watch, type Component } from 'vue'
import { normalizeDock, type SidebarDockLayout } from '../../shared/sidebar-dock'

export type SidebarPanelDefinition = { id: string; label: string; icon: string; component?: Component }
const registry = shallowReactive(new Map<string, SidebarPanelDefinition>([
  ['chats', { id: 'chats', label: '对话', icon: 'comments' }],
  ['workspace', { id: 'workspace', label: '文件', icon: 'folder-open' }],
  ['browser', { id: 'browser', label: '浏览器', icon: 'window-maximize' }],
]))
/** Application extensions register a panel without changing the docking engine. */
export function registerSidebarPanel(definition: SidebarPanelDefinition): () => void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(definition.id) || registry.has(definition.id)) throw new Error('invalid_or_duplicate_sidebar_panel')
  registry.set(definition.id, { ...definition, component: definition.component ? markRaw(definition.component) : undefined })
  return () => { if (registry.get(definition.id)?.label === definition.label) registry.delete(definition.id) }
}
export function useSidebarDock() {
  const panels = computed(() => [...registry.values()])
  let saved: unknown
  try {
    const stored = localStorage.getItem('navora.sidebar.dock')
    if (stored) saved = JSON.parse(stored)
    else {
      const legacy = JSON.parse(localStorage.getItem('navora.sidebar') || '{}')
      saved = { hidden: [legacy.chats === false ? 'chats' : '', legacy.showWorkspace === false ? 'workspace' : '', legacy.showBrowser === false ? 'browser' : ''] }
    }
  } catch { /* defaults */ }
  const layout = ref(normalizeDock(saved, panels.value.map(panel => panel.id)))
  const visible = computed(() => Object.fromEntries(panels.value.map(panel => [panel.id, !layout.value.hidden.includes(panel.id)])))
  const selected = computed(() => Object.fromEntries(panels.value.map(panel => {
    const group = layout.value.groups.find(item => item.panels.includes(panel.id))
    const active = group?.panels.includes(group.active) && visible.value[group.active] ? group.active : group?.panels.find(id => visible.value[id])
    return [panel.id, visible.value[panel.id] && panel.id === active]
  })))
  function set(next: SidebarDockLayout) { layout.value = normalizeDock(next, panels.value.map(panel => panel.id)) }
  function activate(panel: string, toggle = true) {
    const group = layout.value.groups.find(item => item.panels.includes(panel))
    if (!group || !registry.has(panel)) return
    if (toggle && selected.value[panel] && !group.collapsed) layout.value.hidden.push(panel)
    else {
      layout.value.hidden = layout.value.hidden.filter(id => id !== panel)
      group.active = panel
      group.collapsed = false
    }
  }
  function persist() { try { localStorage.setItem('navora.sidebar.dock', JSON.stringify(layout.value)) } catch { /* optional storage */ } }
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(layout, () => { clearTimeout(timer); timer = setTimeout(persist, 120) }, { deep: true })
  watch(panels, () => set(layout.value))
  onBeforeUnmount(() => { clearTimeout(timer); persist() })
  return { layout, panels, visible, selected, activate, set }
}
