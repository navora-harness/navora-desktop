import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
import type {WorkspaceResourceSnapshot} from '@shared/workspace-resources'

export function useWorkspaceResources(chatId:Ref<string>){
  const snapshot=ref<WorkspaceResourceSnapshot|null>(null),loading=ref(false),error=ref(false)
  const entries=computed(()=>snapshot.value?.entries||[])
  let generation=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined,unsubscribeAgent:(()=>void)|undefined
  async function refresh(force=false){
    const id=chatId.value,seq=++generation
    if(!id){snapshot.value=null;loading.value=false;error.value=false;return}
    loading.value=true;error.value=false
    try{
      const result=await window.navora!.workspace.resources(id,force===true)
      if(disposed||seq!==generation)return
      if(!result.ok)throw Error(result.error)
      snapshot.value=result
    }catch{if(!disposed&&seq===generation)error.value=true}
    finally{if(!disposed&&seq===generation)loading.value=false}
  }
  watch(chatId,()=>{snapshot.value=null;clearTimeout(timer);void refresh()},{immediate:true})
  function schedule(){generation++;clearTimeout(timer);timer=setTimeout(()=>void refresh(),150)}
  onMounted(()=>{
    unsubscribe=window.navora?.workspace.onChanged(event=>{if(event.chatId===chatId.value)schedule()})
    unsubscribeAgent=window.navora?.agent.onEvent(event=>{
      if(event.chatId!==chatId.value)return
      if(event.type==='done'||event.type==='error'||((event.type==='message'||event.type==='message_update')&&((event.message.role==='tool'&&event.message.meta?.status==='done')||(event.message.role==='assistant'&&event.message.meta?.phase==='final'))))schedule()
    })
  })
  onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);unsubscribe?.();unsubscribeAgent?.()})
  return {snapshot,entries,loading,error,refresh}
}
