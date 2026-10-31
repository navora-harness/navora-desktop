import {computed,onBeforeUnmount,ref,watch,type Ref} from 'vue'
import {closeFileTab,emptyFileTabs,openFileTab,removeFileOwner,restoreFileTabs,type FileTabs} from '@shared/file-tabs'
export function useFileTabs(viewer:Ref<string|null>){
  const workspaces=ref(new Map<string,FileTabs>())
  try{const saved=JSON.parse(localStorage.getItem('navora.file-tabs.v1')||'[]');if(Array.isArray(saved))for(const row of saved.slice(-40))if(Array.isArray(row)&&typeof row[0]==='string')workspaces.value.set(row[0],restoreFileTabs(row[1]))}catch{/* Optional metadata restoration. */}
  const current=computed(()=>workspaces.value.get(viewer.value||'')||emptyFileTabs())
  const active=computed(()=>current.value.tabs.find(tab=>tab.key===current.value.active)||null)
  function update(state:FileTabs){if(viewer.value)workspaces.value.set(viewer.value,state)}
  function open(chatId:string,path:string){update(openFileTab(current.value,chatId,path))}
  function removeOwner(owner:string){workspaces.value.delete(owner);for(const [id,state] of workspaces.value)workspaces.value.set(id,removeFileOwner(state,owner))}
  function select(key:string){if(current.value.tabs.some(tab=>tab.key===key))update({...current.value,active:key,open:true})}
  function close(key:string){update(closeFileTab(current.value,key))}
  function hide(){update({...current.value,open:false})}
  function toggle(){if(current.value.tabs.length)update({...current.value,open:!current.value.open})}
  let timer:ReturnType<typeof setTimeout>|undefined
  function persist(){try{localStorage.setItem('navora.file-tabs.v1',JSON.stringify([...workspaces.value.entries()].slice(-40)))}catch{/* Storage is optional; file contents never enter storage. */}}
  watch(workspaces,()=>{clearTimeout(timer);timer=setTimeout(persist,150)},{deep:true})
  onBeforeUnmount(()=>{clearTimeout(timer);persist()})
  return {current,active,open,select,close,hide,toggle,removeOwner}
}
