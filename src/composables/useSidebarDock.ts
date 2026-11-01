import {computed, markRaw, onBeforeUnmount, shallowReactive, ref, watch, type Component} from 'vue'
import {normalizeRail} from '../../shared/sidebar-rail'
export type SidebarPanelDefinition = {id:string; label:string; icon:string; component?:Component}
const registry = shallowReactive(new Map<string,SidebarPanelDefinition>([
  ['chats',{id:'chats',label:'对话',icon:'comments'}],
  ['workspace',{id:'workspace',label:'文件',icon:'folder-open'}],
  ['browser',{id:'browser',label:'浏览器',icon:'window-maximize'}],
  ['plugins',{id:'plugins',label:'插件',icon:'puzzle-piece'}],
]))
export function registerSidebarPanel(definition:SidebarPanelDefinition):()=>void {
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(definition.id)||registry.has(definition.id)) throw new Error('invalid_or_duplicate_sidebar_panel')
  registry.set(definition.id,{...definition,component:definition.component?markRaw(definition.component):undefined})
  return ()=>{if(registry.get(definition.id)?.label===definition.label)registry.delete(definition.id)}
}
export function useSidebarDock() {
  const panels = computed(()=>[...registry.values()])
  let saved:unknown
  try { saved=JSON.parse(localStorage.getItem('navora.sidebar.rail')||'null') } catch {/* optional preferences */}
  const rail=ref(normalizeRail(saved,panels.value.map(panel=>panel.id)))
  const visible=computed(()=>Object.fromEntries(panels.value.map(panel=>[panel.id,rail.value.active===panel.id])))
  function activate(id:string,toggle=true) {
    if(!registry.has(id))return
    rail.value.active=toggle&&rail.value.active===id?'':id
  }
  function close(){rail.value.active=''}
  function persist(){try{localStorage.setItem('navora.sidebar.rail',JSON.stringify(rail.value));localStorage.removeItem('navora.sidebar.dock')}catch{/* optional preferences */}}
  watch(rail,persist,{deep:true})
  watch(panels,()=>{rail.value=normalizeRail(rail.value,panels.value.map(panel=>panel.id))})
  onBeforeUnmount(persist)
  return {panels,visible,rail,activate,close}
}
