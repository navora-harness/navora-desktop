import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
import {annotationChatEntries,ANNOTATION_CHAT_SAVED} from '@shared/browser-annotation-chat'
import type {BrowserAnnotation,BrowserAnnotationDraft,BrowserAnnotationTarget,BrowserDraftRecovery} from '@shared/browser-workspace'

export function useChatAnnotations(chatId:Ref<string>){
  const notes=ref<BrowserAnnotation[]>([]),targets=ref<BrowserAnnotationTarget[]>([]),drafts=ref<BrowserAnnotationDraft[]>([]),recovery=ref<BrowserDraftRecovery>({copies:[],issues:[]}),error=ref('')
  const entries=computed(()=>annotationChatEntries(notes.value,targets.value,drafts.value,recovery.value.copies))
  let disposed=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined
  async function refresh(){
    const id=chatId.value,ticket=++generation,api=window.navora?.browser.workspace
    if(!id||!api)return
    try{
      const [saved,pending,buffers,copies]=await Promise.all([api.annotations(id),api.annotationTargets(id),api.annotationDrafts(id),api.annotationDraftRecovery(id)])
      if(disposed||ticket!==generation||chatId.value!==id)return
      notes.value=saved;targets.value=pending;drafts.value=buffers;recovery.value=copies;error.value=''
    }catch{if(!disposed&&ticket===generation)error.value='批注暂时无法读取，请重试。'}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh(),100)}
  watch(chatId,()=>{generation++;clearTimeout(timer);notes.value=[];targets.value=[];drafts.value=[];recovery.value={copies:[],issues:[]};error.value='';void refresh()},{immediate:true})
  onMounted(()=>{unsubscribe=window.navora?.workspace.onChanged(event=>{if(event.chatId===chatId.value)schedule()});window.addEventListener(ANNOTATION_CHAT_SAVED,schedule)})
  onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);unsubscribe?.();window.removeEventListener(ANNOTATION_CHAT_SAVED,schedule)})
  return {entries,recovery,error,refresh}
}
