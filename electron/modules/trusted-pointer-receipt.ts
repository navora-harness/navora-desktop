import {randomUUID} from 'node:crypto'
import type {WebContents} from 'electron'
import {getBrowserAutomationController,withBrowserPointerInput} from './browser-automation-controller'
import {assertBrowserInputCurrent,currentBrowserInputOperation} from './browser-input-context'
import {confirmPointerMotionReceipt,invalidatePointerMotion,pointerMotionPosition} from './pointer-motion'

// Dedicated isolated state. Page scripts cannot write this ledger or manufacture
// isTrusted events. Nothing is exposed through a preload or a page bridge.
const WORLD=1010
const EVALUATION_TIMEOUT_MS=250
const BUTTONS={left:0,middle:1,right:2,back:3,forward:4} as const
const sequences=new WeakMap<WebContents,number>()
type Button=keyof typeof BUTTONS
type Sample={type:string;x:number;y:number;button:number;buttons:number}
type Receipt={token:string;events:Sample[]}
type NativePointerKind='click'|'move'

function beginScript(token:string,button:number,kind:NativePointerKind,sequence:number,deadline:number):string {
  return `(()=>{
    if(Date.now()>${deadline}||${sequence}<=(globalThis.__navoraPointerReceiptSequence??0))return null;
    globalThis.__navoraPointerReceiptSequence=${sequence};
    globalThis.__navoraPointerReceipt?.dispose();
    const state={token:${JSON.stringify(token)},events:[],dispose:null};
    const listener=event=>{
      if(!event.isTrusted||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
      if(${JSON.stringify(kind)}==='click'&&event.button!==${button})return;
      state.events.push({type:event.type,x:event.clientX,y:event.clientY,button:event.button,buttons:event.buttons});
      if(state.events.length>32)state.events.shift();
    };
    const types=${JSON.stringify(kind==='click'?['mousedown','mouseup']:['mousemove'])};
    let expiry;
    state.dispose=()=>{clearTimeout(expiry);for(const type of types)removeEventListener(type,listener,true)};
    for(const type of types)addEventListener(type,listener,{capture:true,passive:true});
    globalThis.__navoraPointerReceipt=state;
    expiry=setTimeout(()=>{state.dispose();if(globalThis.__navoraPointerReceipt===state)delete globalThis.__navoraPointerReceipt},30000);
    return {token:state.token};
  })()`
}

type Evaluation={ok:true;value:any}|{ok:false;reason:'timeout'|'aborted'|'unavailable'}
/** Optional observation must not keep the operation's commit/drain set alive.
 * A renderer may never settle this promise, even after the native click finished. */
function evaluateReceipt(wc:WebContents,code:string,signal?:AbortSignal):Promise<Evaluation>{
  if(signal?.aborted)return Promise.resolve({ok:false,reason:'aborted'})
  return new Promise(resolve=>{
    let settled=false
    const finish=(result:Evaluation)=>{
      if(settled)return
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(result)
    }
    const abort=()=>finish({ok:false,reason:'aborted'})
    const timer=setTimeout(()=>finish({ok:false,reason:'timeout'}),EVALUATION_TIMEOUT_MS)
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted){abort();return}
    try{Promise.resolve(wc.executeJavaScriptInIsolatedWorld(WORLD,[{code}])).then(value=>finish({ok:true,value}),()=>finish({ok:false,reason:'unavailable'}))}
    catch{finish({ok:false,reason:'unavailable'})}
  })
}
function finishScript(token:string,sequence:number):string {
  return `(()=>{globalThis.__navoraPointerReceiptSequence=Math.max(globalThis.__navoraPointerReceiptSequence??0,${sequence});const state=globalThis.__navoraPointerReceipt;if(state?.token!==${JSON.stringify(token)})return null;state.dispose();delete globalThis.__navoraPointerReceipt;return {token:state.token,events:state.events}})()`
}
function finalPoint(receipt:Receipt|null,token:string,button:number,kind:NativePointerKind){
  if(!receipt||receipt.token!==token||!Array.isArray(receipt.events))return undefined
  let pressed=false,point:{x:number;y:number}|undefined
  for(const event of receipt.events){
    if(!Number.isFinite(event.x)||!Number.isFinite(event.y))return undefined
    if(kind==='move'){
      if(event.type!=='mousemove'||event.buttons!==0)return undefined
      point={x:event.x,y:event.y}
    }else{
      if(event.button!==button)return undefined
      if(event.type==='mousedown'){pressed=true;point=undefined}
      else if(event.type==='mouseup'&&pressed&&event.buttons===0){pressed=false;point={x:event.x,y:event.y}}
      else return undefined
    }
  }
  return pressed?undefined:point
}

/** Keep native target validation, then learn its actual main-viewport endpoint
 * from trusted DOM mouse events. Bounds and element offsets are never evidence
 * of where a native target operation finally moved the pointer. */
export async function nativePointerWithReceipt<T extends Electron.AgentDispatchResult>(
  wc:WebContents,target:Electron.AgentTarget,kind:NativePointerKind,button:Button,
  submit:()=>Promise<T>,
):Promise<{dispatch:T;pointerReceipt:{confirmed:boolean;reason?:string;sequence:number};position:ReturnType<typeof pointerMotionPosition>}> {
  assertBrowserInputCurrent(wc)
  const controller=getBrowserAutomationController(wc)
  const operation=currentBrowserInputOperation(wc)
  const epoch=controller.captureEpoch(),documentEpoch=controller.captureDocumentEpoch(),runId=controller.snapshot().leaseRunId
  const sequence=(sequences.get(wc)??0)+1;sequences.set(wc,sequence)
  invalidatePointerMotion(wc,`native_target_${kind}_pending`)
  const generation=pointerMotionPosition(wc).generation
  const token=randomUUID()
  const mainFrame=target.webContentsId===wc.id&&target.processId===wc.mainFrame.processId&&target.routingId===wc.mainFrame.routingId
  const current=()=>{
    assertBrowserInputCurrent(wc)
    return currentBrowserInputOperation(wc)===operation&&controller.captureEpoch()===epoch&&controller.captureDocumentEpoch()===documentEpoch&&controller.snapshot().leaseRunId===runId&&sequences.get(wc)===sequence&&pointerMotionPosition(wc).generation===generation
  }
  let installed=false,disposed=false,reason=mainFrame?'trusted_pointer_receipt_unavailable':'target_frame_conversion_unavailable'
  let confirmed=false
  try{
    if(mainFrame){
      const ready=await evaluateReceipt(wc,beginScript(token,BUTTONS[button],kind,sequence,Date.now()+EVALUATION_TIMEOUT_MS),operation?.signal)
      installed=ready.ok&&ready.value?.token===token
      reason=ready.ok?'trusted_pointer_receipt_missing':`trusted_pointer_receipt_begin_${ready.reason}`
    }
    assertBrowserInputCurrent(wc)
    if(!current())throw new Error('pointer_receipt_scope_changed')
    const dispatch=await withBrowserPointerInput(wc,submit,result=>result.status==='dispatched'&&!result.deliveryWarning)
    let receipt:Receipt|null=null
    if(installed){
      const read=await evaluateReceipt(wc,finishScript(token,sequence),operation?.signal)
      if(read.ok){receipt=read.value;disposed=receipt?.token===token}
      else reason=`trusted_pointer_receipt_finish_${read.reason}`
    }
    if(dispatch.status==='dispatched'&&!dispatch.deliveryWarning){
      const point=finalPoint(receipt,token,BUTTONS[button],kind)
      if(point){
        try{confirmed=current()&&confirmPointerMotionReceipt(wc,generation,point)}catch{/* A newer owner/document wins. */}
        reason=confirmed?'':'pointer_receipt_scope_changed'
      }
    }else reason='native_pointer_dispatch_unconfirmed'
    if(!confirmed&&pointerMotionPosition(wc).generation===generation)invalidatePointerMotion(wc,reason)
    return {dispatch,pointerReceipt:{confirmed,...(confirmed?{}:{reason}),sequence},position:pointerMotionPosition(wc)}
  }catch(error){
    if(pointerMotionPosition(wc).generation===generation)invalidatePointerMotion(wc,'native_pointer_dispatch_rejected')
    throw error
  }finally{
    // Token-scoped cleanup has no input side effects and never awaits a stalled
    // renderer. Late begin scripts reject expired/older sequences themselves.
    if(mainFrame&&!disposed&&!wc.isDestroyed()){
      try{void Promise.resolve(wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:finishScript(token,sequence)}])).catch(()=>{})}catch{/* The document/renderer may already be gone. */}
    }
  }
}
