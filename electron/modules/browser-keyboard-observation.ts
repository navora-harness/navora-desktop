/// <reference lib="dom" />
import type { WebContents } from 'electron'
export type KeyboardEffect = {state:'not_observed'|'confirmed'|'contradicted'|'unavailable';event:'tab'|'select_all'|'other';sameDocument:boolean;sameTarget:boolean;evidenceSource:'host_readback'}
type Sample={documentId:string;focusId:number;focused:boolean;editable:boolean;length:number;start:number|null;end:number|null}
export type KeyboardObservation={sample?:Sample;epoch:number;documentEpoch:number}
export function keyboardObservationScript():string{
  return `(${function(){
    const host=globalThis as typeof globalThis & {__navoraKeyboardReadback?:{documentId:string;ids:WeakMap<Element,number>;next:number}}
    const store=host.__navoraKeyboardReadback ||= {documentId:Date.now()+':'+Math.random(),ids:new WeakMap(),next:1}
    const element=document.activeElement
    if(element&&!store.ids.has(element))store.ids.set(element,store.next++)
    const field=element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement?element:null
    return {documentId:store.documentId,focusId:element?store.ids.get(element)||0:0,focused:document.hasFocus(),editable:!!field,length:field?.value.length||0,start:field?.selectionStart??null,end:field?.selectionEnd??null}
  }.toString()})()`
}
export async function observeKeyboard(wc:WebContents,epoch:number,documentEpoch:number,target?:Electron.AgentTarget):Promise<KeyboardObservation>{
  // Child targets are unavailable until their foreground/selection can be independently tied to this event.
  if(target&&(target.processId!==wc.mainFrame.processId||target.routingId!==wc.mainFrame.routingId))return {epoch,documentEpoch}
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
    const sample=await Promise.race([wc.executeJavaScriptInIsolatedWorld(17018,[{code:keyboardObservationScript()}],false),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),500)})]) as Sample|undefined
    return {epoch,documentEpoch,...(sample&&typeof sample.documentId==='string'&&typeof sample.focusId==='number'?{sample}:{})}
  }catch{return {epoch,documentEpoch}}finally{if(timer)clearTimeout(timer)}
}
export function keyboardEffect(key:string,before:KeyboardObservation,after:KeyboardObservation,dispatched:boolean):KeyboardEffect{
  const event=/^(?:shift\+)?tab$/i.test(key)?'tab':/^(?:ctrl|control|cmd|command|meta)\+a$/i.test(key)?'select_all':'other'
  const a=before.sample,b=after.sample
  const sameDocument=!!a&&!!b&&a.documentId===b.documentId&&before.documentEpoch===after.documentEpoch&&before.epoch===after.epoch
  const sameTarget=sameDocument&&a!.focusId===b!.focusId
  let state:KeyboardEffect['state']='not_observed'
  if(event!=='other'){
    state=!dispatched||!sameDocument||!a?.focused||!b?.focused?'unavailable':event==='tab'?(sameTarget?'contradicted':'confirmed'):!sameTarget||!b.editable||b.start===null||b.end===null?'unavailable':b.length===0||a.start===0&&a.end===a.length&&a.length===b.length&&b.start===0&&b.end===b.length?'not_observed':b.start===0&&b.end===b.length?'confirmed':'contradicted'
  }
  return {state,event,sameDocument,sameTarget,evidenceSource:'host_readback'}
}
