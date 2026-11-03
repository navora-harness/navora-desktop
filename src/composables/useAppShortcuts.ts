import {computed,onMounted,onBeforeUnmount,ref,shallowRef} from 'vue'
import type {AppConfig} from '@shared/config'
import type {AppCommandId} from '@shared/app-commands'
import {configurableAppShortcutIds,createDefaultAppShortcuts,isAppShortcutEnabled,type ConfigurableAppShortcutId} from '@shared/app-shortcuts'
import {createSettingsCommit} from '@shared/settings-commit'

const config=shallowRef<AppConfig|null>(null),saving=ref(false),reading=ref(false),error=ref('')
let clients=0,revision=0,off:(()=>void)|undefined
const enabled=(id:AppCommandId)=>isAppShortcutEnabled(config.value,id)
async function reload(){
  const api=window.navora?.config
  if(!api||reading.value)return
  reading.value=true;error.value=''
  const before=revision
  try{const next=await api.get();if(clients&&before===revision){revision++;config.value=next}}
  catch{error.value='暂时无法读取快捷键设置，请重试。'}
  finally{reading.value=false}
}
async function write(change:(draft:AppConfig)=>void){
  const api=window.navora?.config
  if(!api||saving.value)return
  saving.value=true;error.value=''
  try{
    const base=await api.get(),draft=structuredClone(base)
    change(draft)
    const request=createSettingsCommit(base,draft,crypto.randomUUID()),before=revision
    const saved=await api.commit(request)
    // Broadcasts can include a newer edit from another window before this RPC resolves.
    if(revision===before){revision++;config.value=saved}
  }catch(cause){error.value=String(cause).includes('config_conflict')?'快捷键设置已在其他窗口更改，请重试。':'快捷键设置未保存，请重试。'}
  finally{saving.value=false}
}
export function useAppShortcuts(){
  onMounted(()=>{
    if(clients++>0)return
    const api=window.navora?.config;if(!api)return
    off=api.onChanged(next=>{const first=!config.value;revision++;config.value=next;if(first)error.value=''})
    void reload()
  })
  onBeforeUnmount(()=>{if(--clients===0){off?.();off=undefined;revision++}})
  return {
    enabled,saving,reading,error,reload,available:computed(()=>!!window.navora?.config&&!!config.value),
    customized:computed(()=>configurableAppShortcutIds.some(id=>!enabled(id))),
    setEnabled:(id:ConfigurableAppShortcutId,value:boolean)=>write(draft=>{draft.app.shortcuts={...draft.app.shortcuts,[id]:value}}),
    reset:()=>write(draft=>{draft.app.shortcuts={...draft.app.shortcuts,...createDefaultAppShortcuts()}}),
  }
}
