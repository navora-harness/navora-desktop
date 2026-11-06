import {computed,reactive} from 'vue'

// Pending requests can outlive their mounted card while the user changes chats.
// Request owners clear these in-memory drafts when a request leaves the queue.
const drafts=reactive(new Map<string,string>())

export function useDecisionDraft(requestId:()=>string){
  return computed({
    get:()=>drafts.get(requestId())||'',
    set:(value:string)=>{
      const id=requestId()
      if(!id)return
      if(value)drafts.set(id,value)
      else drafts.delete(id)
    },
  })
}

export function clearDecisionDraft(requestId:string){drafts.delete(requestId)}
