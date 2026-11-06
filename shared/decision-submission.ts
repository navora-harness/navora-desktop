export type DecisionSubmissionState={pending:boolean;error:string;expired:boolean;cancelledDuringSubmit?:boolean}
export type DecisionSubmissionStates=Record<string,DecisionSubmissionState>
const pendingRequests=new Set<string>()
export function isDecisionSubmitting(id:string){return pendingRequests.has(id)}

/** Keep the request and draft visible until the backend acknowledges this ID. */
export async function submitDecision(states:DecisionSubmissionStates,id:string,send:()=>Promise<boolean>,accepted:()=>void){
  if(pendingRequests.has(id)||states[id]?.pending||states[id]?.expired)return
  pendingRequests.add(id)
  states[id]={pending:true,error:'',expired:false}
  const state=states[id]!
  try{
    const delivered=await send()
    if(delivered)accepted()
    else{state.expired=true;state.error='请求已失效，请等待新的请求。'}
  }catch{
    state.expired=!!state.cancelledDuringSubmit
    state.error=state.expired?'请求已失效，请等待新的请求。':'未能送达，选择和填写内容已保留，请重试。'
  }finally{state.pending=false;pendingRequests.delete(id)}
}

/** Cancel events can arrive before the IPC response for the same submission. */
export function deferDecisionCancellation(states:DecisionSubmissionStates,id:string){
  if(!states[id]?.pending)return false
  states[id]!.cancelledDuringSubmit=true
  return true
}
