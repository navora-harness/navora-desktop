import {computed,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'
import type {BrowserTreeSession} from '@shared/types'
import {browserSummaryResources,ResourceUnreadTracker,type SummaryResourceVersion} from '@shared/conversation-resources'

export type ResourceTab='overview'|'files'|'browser'|'outputs'
type Snapshot={files:SummaryResourceVersion[];browser:SummaryResourceVersion[];filesReady:boolean;browserReady:boolean;fileRequest:number;browserRequest:number}
export function useConversationResources(chatId:Ref<string|null>,_tree:Ref<BrowserTreeSession[]>){
  const open=ref(false),tab=ref<ResourceTab>('overview'),reading=ref(false),counts=ref<Record<string,number>>({})
  const tracker=new ResourceUnreadTracker(),snapshots=new Map<string,Snapshot>(),timers=new Map<string,ReturnType<typeof setTimeout>>()
  let disposed=false,offFiles:(()=>void)|undefined,offBrowser:(()=>void)|undefined
  const updateCount=computed(()=>chatId.value?counts.value[chatId.value]||0:0),updated=computed(()=>updateCount.value>0)
  function snapshot(id:string){let value=snapshots.get(id);if(!value){value={files:[],browser:[],filesReady:false,browserReady:false,fileRequest:0,browserRequest:0};snapshots.set(id,value)}return value}
  function publish(id:string){const value=snapshots.get(id);if(disposed||!value?.filesReady||!value.browserReady)return;const count=tracker.update(id,[...value.files,...value.browser],id===chatId.value&&reading.value);counts.value={...counts.value,[id]:count}}
  async function refreshFiles(id:string){
    const value=snapshot(id),request=++value.fileRequest
    try{const result=await window.navora!.workspace.resources(id);if(disposed||request!==value.fileRequest||!result.ok)return;value.files=result.entries.map(entry=>({id:`file:${entry.id}`,version:entry.revision||`${entry.mtimeMs}:${entry.size}`}));value.filesReady=true;publish(id)}catch{/* The summary owns its visible retry/error state. */}
  }
  async function refreshBrowser(id:string){
    const value=snapshot(id),request=++value.browserRequest
    try{const result=await window.navora!.browser.tree(id);if(disposed||request!==value.browserRequest)return;value.browser=browserSummaryResources(result);value.browserReady=true;publish(id)}catch{/* Preserve the last successful baseline. */}
  }
  async function refresh(){const id=chatId.value;if(id)await Promise.all([refreshFiles(id),refreshBrowser(id)])}
  function show(next?:ResourceTab){if(next)tab.value=next;open.value=true;void refresh()}
  function close(){open.value=false;reading.value=false}
  watch(chatId,id=>{reading.value=false;open.value=false;tab.value='overview';if(id){snapshot(id);void refresh()}},{immediate:true,flush:'sync'})
  watch(reading,value=>{const id=chatId.value;if(value&&id){tracker.markRead(id);counts.value={...counts.value,[id]:0}}},{flush:'sync'})
  onMounted(()=>{
    offFiles=window.navora?.workspace.onChanged(event=>{if(!snapshots.has(event.chatId))return;clearTimeout(timers.get(event.chatId));timers.set(event.chatId,setTimeout(()=>{timers.delete(event.chatId);void refreshFiles(event.chatId)},120))})
    offBrowser=window.navora?.browser.onTreeUpdated(event=>{const value=snapshots.get(event.chatId);if(!value)return;value.browserRequest++;value.browser=browserSummaryResources(event.tree);value.browserReady=true;publish(event.chatId)})
  })
  onBeforeUnmount(()=>{disposed=true;for(const timer of timers.values())clearTimeout(timer);offFiles?.();offBrowser?.()})
  return {open,tab,updated,updateCount,reading,show,close,refresh}
}
