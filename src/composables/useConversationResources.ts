import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
import type {BrowserTreeSession} from '@shared/types'
import {browserResourceIds,ResourceAutoOpen} from '@shared/conversation-resources'

export type ResourceTab='overview'|'files'|'browser'|'outputs'
export function useConversationResources(chatId:Ref<string|null>,tree:Ref<BrowserTreeSession[]>){
  const open=ref(false),tab=ref<ResourceTab>('overview'),files=ref<string[]>([])
  const discovery=new ResourceAutoOpen()
  let generation=0,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
  const browserIds=computed(()=>browserResourceIds(tree.value))
  function discover(){
    if(!chatId.value)return
    const found=discovery.update(chatId.value,[...files.value,...browserIds.value])
    if(found&&!open.value){tab.value='overview';open.value=true}
  }
  async function refresh(){
    const id=chatId.value,seq=++generation
    if(!id)return
    try{
      const resources=await window.navora!.workspace.resources(id)
      if(!resources.ok)return
      if(seq!==generation||id!==chatId.value)return
      // Existing files keep their identity across writes, refreshes and browser loading.
      files.value=resources.entries.map(entry=>`file:${entry.id}`)
      discover()
    }catch{/* The file panel owns its retry/error state. */}
  }
  function show(next?:ResourceTab){if(next)tab.value=next;open.value=true}
  function close(){open.value=false}
  watch(chatId,()=>{generation++;clearTimeout(timer);files.value=[];open.value=false;tab.value='overview';void refresh()},{immediate:true,flush:'sync'})
  watch(browserIds,discover)
  onMounted(()=>{unsubscribe=window.navora?.workspace.onChanged(event=>{if(event.chatId!==chatId.value)return;clearTimeout(timer);timer=setTimeout(()=>void refresh(),120)})})
  onBeforeUnmount(()=>{generation++;clearTimeout(timer);unsubscribe?.()})
  return {open,tab,show,close,refresh}
}
