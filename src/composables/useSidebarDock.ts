import { computed, markRaw, onBeforeUnmount, shallowReactive, ref, watch, type Component } from 'vue'
import { normalizeDock, splitDockPanel, type SidebarDockLayout } from '../../shared/sidebar-dock'
import { mergeRail, normalizeRail, splitRail } from '../../shared/sidebar-rail'
export type SidebarPanelDefinition = { id:string;label:string;icon:string;component?:Component }
const registry=shallowReactive(new Map<string,SidebarPanelDefinition>([
  ['chats',{id:'chats',label:'对话',icon:'comments'}],['workspace',{id:'workspace',label:'文件',icon:'folder-open'}],['browser',{id:'browser',label:'浏览器',icon:'window-maximize'}],
]))
export function registerSidebarPanel(definition:SidebarPanelDefinition):()=>void {
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(definition.id)||registry.has(definition.id))throw new Error('invalid_or_duplicate_sidebar_panel')
  registry.set(definition.id,{...definition,component:definition.component?markRaw(definition.component):undefined})
  return ()=>{if(registry.get(definition.id)?.label===definition.label)registry.delete(definition.id)}
}
export function useSidebarDock() {
  const panels=computed(()=>[...registry.values()])
  let saved:unknown,savedRail:unknown
  try {
    saved=JSON.parse(localStorage.getItem('navora.sidebar.dock')||'null')
    savedRail=JSON.parse(localStorage.getItem('navora.sidebar.rail')||'null')
    if(!saved){const legacy=JSON.parse(localStorage.getItem('navora.sidebar')||'{}');saved={hidden:[legacy.chats===false?'chats':'',legacy.showWorkspace===false?'workspace':'',legacy.showBrowser===false?'browser':'']}}
  }catch{/* Recover optional local preferences. */}
  const layout=ref(normalizeDock(saved,panels.value.map(panel=>panel.id)))
  if(!savedRail) {
    const groups=layout.value.groups.map(group=>({id:`rail-${group.panels[0]}`,panels:group.panels}))
    savedRail={groups,active:groups.find(group=>group.panels.some(id=>!layout.value.hidden.includes(id)))?.id||''}
  }
  const rail=ref(normalizeRail(savedRail,panels.value.map(panel=>panel.id)))
  // Combined rail entries show all of their panels simultaneously.
  for(const panel of panels.value)layout.value=splitDockPanel(layout.value,panel.id)
  function applySelection() {
    const members=rail.value.groups.find(group=>group.id===rail.value.active)?.panels||[]
    layout.value.hidden=layout.value.groups.flatMap(group=>group.panels).filter(id=>!members.includes(id))
  }
  applySelection()
  const visible=computed(()=>Object.fromEntries(panels.value.map(panel=>[panel.id,!layout.value.hidden.includes(panel.id)])))
  const selected=visible
  function set(next:SidebarDockLayout){layout.value=normalizeDock(next,panels.value.map(panel=>panel.id));applySelection()}
  function activateGroup(id:string,toggle=true) {
    if(!rail.value.groups.some(group=>group.id===id))return
    rail.value.active=toggle&&rail.value.active===id?'':id
    if(rail.value.active)for(const group of layout.value.groups)if(group.panels.some(panel=>rail.value.groups.find(item=>item.id===id)!.panels.includes(panel)))group.collapsed=false
    applySelection()
  }
  function activate(panel:string,toggle=true){const group=rail.value.groups.find(group=>group.panels.includes(panel));if(group)activateGroup(group.id,toggle)}
  function mergeGroups(source:string,target:string){rail.value=mergeRail(rail.value,source,target);activateGroup(rail.value.active,false)}
  function splitPanel(panel:string){rail.value=splitRail(rail.value,panel);applySelection()}
  function splitGroup(id:string){const group=rail.value.groups.find(item=>item.id===id);if(!group)return;for(const panel of group.panels.slice(1).reverse())rail.value=splitRail(rail.value,panel);applySelection()}
  function close(){rail.value.active='';applySelection()}
  function persist(){try{localStorage.setItem('navora.sidebar.dock',JSON.stringify(layout.value));localStorage.setItem('navora.sidebar.rail',JSON.stringify(rail.value))}catch{/* Optional storage. */}}
  let timer:ReturnType<typeof setTimeout>|undefined
  watch([layout,rail],()=>{clearTimeout(timer);timer=setTimeout(persist,120)},{deep:true})
  watch(panels,()=>{rail.value=normalizeRail(rail.value,panels.value.map(panel=>panel.id));set(layout.value)})
  onBeforeUnmount(()=>{clearTimeout(timer);persist()})
  return {layout,panels,visible,selected,activate,set,rail,activateGroup,mergeGroups,splitPanel,splitGroup,close}
}
