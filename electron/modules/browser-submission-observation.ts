import {sameAgentTarget,type SubmissionObservation} from './browser-target-text'

type Pending={before:Electron.AgentSnapshot;target:Electron.AgentTarget;expected:string;attempts:number;expires:number;timer?:ReturnType<typeof setTimeout>}
const pending=new WeakMap<object,Pending>()
/** Ephemeral host memory only: no typed text or baseline is returned in receipts. */
export function rememberSubmissionObservation(page:object,before:Electron.AgentSnapshot|undefined,target:Electron.AgentTarget,expected:string) {
  if(!before||!expected)return
  const old=pending.get(page);if(old?.timer)clearTimeout(old.timer)
  const entry:Pending={before,target:{...target},expected,attempts:0,expires:Date.now()+30000}
  pending.set(page,entry)
  entry.timer=setTimeout(()=>{if(pending.get(page)===entry)pending.delete(page)},30000);entry.timer.unref()
}
export function observePendingSubmission(page:object,snapshot:Electron.AgentSnapshot):SubmissionObservation|undefined {
  const entry=pending.get(page)
  if(!entry)return
  if(Date.now()>entry.expires){clearTimeout(entry.timer);pending.delete(page);return}
  entry.attempts++
  const observed=observeSubmittedText(entry.before,snapshot,entry.target,entry.expected)
  if(observed.status==='observed'||entry.attempts>=3){clearTimeout(entry.timer);pending.delete(page)}
  return{...observed,inputTarget:{...entry.target}}
}

/** This certifies only a new visible rendering of the verified text, never a
 * backend commit or arbitrary form success. Both snapshots must be unfiltered. */
export function observeSubmittedText(before:Electron.AgentSnapshot|undefined,after:Electron.AgentSnapshot,target:Electron.AgentTarget,expected:string):SubmissionObservation {
  const unknown:SubmissionObservation={status:'unknown'}
  if(!before||!expected||!before.complete||before.truncated||!after.complete||after.truncated)return unknown
  const covers=(snapshot:Electron.AgentSnapshot)=>snapshot.frames.some(frame=>frame.status==='covered'&&frame.processId===target.processId&&frame.routingId===target.routingId&&frame.documentId===target.documentId)
  if(!covers(before)||!covers(after))return unknown
  const original=after.elements.find(element=>sameAgentTarget(element.target,target))
  const targetState=original?(original.visible?'present':'hidden'):'removed'
  if(targetState==='present')return{status:'unknown',targetState}
  const normalized=(value:string)=>value.replace(/\s+/gu,' ').trim()
  const matches=(element:Electron.AgentElement)=>element.visible&&element.target.processId===target.processId&&element.target.routingId===target.routingId&&element.target.documentId===target.documentId&&element.target.webContentsId===target.webContentsId&&typeof element.value!=='string'&&!element.valueRedacted&&!['input','textarea'].includes(element.tagName.toLowerCase())&&normalized(element.text||'')===normalized(expected)
  // Framework rerenders can replace backend IDs while preserving an existing
  // label. Identity churn alone does not establish that Enter produced a result.
  const match=before.elements.some(matches)?undefined:after.elements.find(matches)
  return match?{status:'observed',evidence:'new_visible_noneditable_text',targetState,coverage:'complete',target:{...match.target},inputTarget:{...target}}:{status:'unknown',targetState,coverage:'complete'}
}
