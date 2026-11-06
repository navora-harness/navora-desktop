import {onBeforeUnmount,reactive,watch} from 'vue'
import {workspaceFileDisplayPath} from '@shared/workspace-file-path'

const roots=reactive(new Map<string,string>()),owners=new Map<string,number>(),pending=new Map<string,Promise<void>>()
let unsubscribe:(()=>void)|undefined

function refresh(chatId:string):Promise<void>{
  const existing=pending.get(chatId)
  if(existing)return existing
  const info=window.navora?.workspace?.info
  if(!info)return Promise.resolve()
  const job=(async()=>{
    try{const result=await info(chatId);if(result.ok&&owners.has(chatId))roots.set(chatId,result.absolutePath)}catch{/* Keep the last known path when metadata is temporarily unavailable. */}
    finally{pending.delete(chatId)}
  })()
  pending.set(chatId,job)
  return job
}

/** Share root lookups across transcript messages, always keyed by the file's owner. */
export function useWorkspaceFilePaths(chatIds:()=>readonly string[]){
  let tracked:string[]=[]
  function release(){for(const id of tracked){const count=(owners.get(id)||1)-1;if(count)owners.set(id,count);else{owners.delete(id);roots.delete(id)}}tracked=[]}
  const stop=watch(()=>[...new Set(chatIds().filter(Boolean))],ids=>{
    if(ids.length===tracked.length&&ids.every((id,index)=>id===tracked[index]))return
    release();tracked=ids
    for(const id of ids){owners.set(id,(owners.get(id)||0)+1);void refresh(id)}
    if(!unsubscribe&&window.navora?.workspace?.info&&window.navora.workspace.onChanged)unsubscribe=window.navora.workspace.onChanged(event=>{if(owners.has(event.chatId))void refresh(event.chatId)})
  },{immediate:true})
  onBeforeUnmount(()=>{stop();release();if(!owners.size){unsubscribe?.();unsubscribe=undefined}})
  return {workspaceRoot:(chatId:string)=>roots.get(chatId),displayPath:(chatId:string,path:string)=>workspaceFileDisplayPath(roots.get(chatId),path)}
}
