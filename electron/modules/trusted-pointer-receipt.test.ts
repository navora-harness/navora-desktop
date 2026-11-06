import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import vm from 'node:vm'
import type {WebContents} from 'electron'
import {automationTestApi} from './browser-automation-test-api'
import {getBrowserAutomationController} from './browser-automation-controller'
import {withBrowserInputOperation} from './browser-input-context'
import {dispatchPointerMotion,invalidatePointerMotion,pointerMotionPosition,pointerMotionWasInterpolated} from './pointer-motion'
import {nativePointerWithReceipt} from './trusted-pointer-receipt'

let nextId=90000
const targetFor=(wc:WebContents):Electron.AgentTarget=>({webContentsId:wc.id,processId:20,routingId:30,documentId:40,backendNodeId:50})
function fixture(){
  const listeners=new Map<string,Set<(event:Record<string,unknown>)=>void>>()
  const world=vm.createContext({
    setTimeout:(fn:()=>void,ms:number)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout,
    addEventListener(type:string,listener:(event:Record<string,unknown>)=>void){const entries=listeners.get(type)??new Set();entries.add(listener);listeners.set(type,entries)},
    removeEventListener(type:string,listener:(event:Record<string,unknown>)=>void){listeners.get(type)?.delete(listener)},
  })
  const batches:Array<Array<{type:string;position?:{x:number;y:number};atMs:number}>>=[]
  const wc=Object.assign(new EventEmitter(),{
    id:nextId++,isDestroyed:()=>false,mainFrame:{processId:20,routingId:30},...automationTestApi(),
    executeJavaScriptInIsolatedWorld:async(worldId:number,scripts:Array<{code:string}>)=>{assert.equal(worldId,1010);return vm.runInContext(scripts[0].code,world)},
    dispatchInputSequence:async(steps:Array<{type:string;position?:{x:number;y:number};atMs:number}>)=>{batches.push(steps);return{status:'completed',dispatchedCount:steps.length,lastDispatchedIndex:steps.length-1}},
  }) as unknown as WebContents
  const controller=getBrowserAutomationController(wc)
  const emit=(type:string,x:number,y:number,trusted=true)=>{for(const fn of [...(listeners.get(type)??[])])fn({type,clientX:x,clientY:y,button:0,buttons:type==='mousedown'?1:0,isTrusted:trusted})}
  const click=(x:number,y:number,trusted=true)=>{emit('mousedown',x,y,trusted);emit('mouseup',x,y,trusted)}
  const run=<T>(action:()=>Promise<T>,runId='receipt-run',signal?:AbortSignal)=>controller.run({runId,claimInput:true,signal},operation=>withBrowserInputOperation(wc,operation,action))
  const dispatched=():Electron.AgentDispatchResult=>({status:'dispatched',stage:'event-dispatch',stages:[]})
  return{wc,controller,batches,emit,click,run,dispatched,listeners}
}

test('native main-frame click confirms actual event coordinates and the next ordinary approach interpolates',async()=>{
  const f=fixture(),target=targetFor(f.wc)
  try{
    await f.run(async()=>{
      const approach=await dispatchPointerMotion(f.wc,{action:'move',to:{x:300,y:200}})
      assert.equal(approach.startPosition,'unknown')
      assert.equal(pointerMotionWasInterpolated(approach),false)
      // The target moved while approaching. Only its delivered mouseup is truth.
      const first=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{f.click(327,219);return f.dispatched()})
      assert.equal(first.pointerReceipt.confirmed,true)
      assert.deepEqual(pointerMotionPosition(f.wc).point,{x:327,y:219})
    })
    await f.run(async()=>{
      const next=await dispatchPointerMotion(f.wc,{action:'move',to:{x:70,y:100},motion:{durationMs:100,intervalMs:10}})
      assert.equal(next.startPosition,'confirmed')
      assert.deepEqual(next.startPoint,{x:327,y:219})
      assert.equal(pointerMotionWasInterpolated(next),true)
      assert.ok(f.batches.at(-1)!.length>2)
      assert.equal(next.movementDurationMs,100)
      const second=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{f.click(70,100);return f.dispatched()})
      assert.equal(second.pointerReceipt.confirmed,true)
    })
    assert.ok([...f.listeners.values()].every(entries=>entries.size===0),'Receipt listeners are removed after each native call')
  }finally{f.controller.dispose()}
})

test('a never-settling begin observation times out without tracking the renderer promise or replaying input',async()=>{
  const f=fixture(),target=targetFor(f.wc),evaluate=f.wc.executeJavaScriptInIsolatedWorld.bind(f.wc)
  let beginCode='',nativeCalls=0,resolveLate!:(value:unknown)=>void
  const late=new Promise(resolve=>{resolveLate=resolve})
  f.wc.executeJavaScriptInIsolatedWorld=async(world,scripts)=>{
    if(scripts[0].code.includes('const listener=event=>')){beginCode=scripts[0].code;return late}
    return evaluate(world,scripts)
  }
  try{
    const started=performance.now()
    await f.run(async()=>{
      const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{nativeCalls++;f.click(11,12);return f.dispatched()})
      assert.equal(result.pointerReceipt.confirmed,false)
      assert.equal(result.pointerReceipt.reason,'trusted_pointer_receipt_begin_timeout')
    })
    assert.ok(performance.now()-started<1000,'Optional renderer observation cannot stall controller drain')
    assert.equal(nativeCalls,1)
    resolveLate(await evaluate(1010,[{code:beginCode}]))
    await new Promise<void>(resolve=>setImmediate(resolve))
    assert.equal(pointerMotionPosition(f.wc).valid,false)
    assert.ok([...f.listeners.values()].every(entries=>entries.size===0),'Expired begin cannot install a late listener')
  }finally{f.controller.dispose()}
})

test('a never-settling finish observation times out and its late trusted result cannot confirm the pointer',async()=>{
  const f=fixture(),target=targetFor(f.wc),evaluate=f.wc.executeJavaScriptInIsolatedWorld.bind(f.wc)
  let finishReads=0,nativeCalls=0,value:unknown,resolveLate!:(value:unknown)=>void
  const late=new Promise(resolve=>{resolveLate=resolve})
  f.wc.executeJavaScriptInIsolatedWorld=async(world,scripts)=>{
    const result=await evaluate(world,scripts)
    if(!scripts[0].code.includes('const listener=event=>')&&finishReads++===0){value=result;return late}
    return result
  }
  try{
    await f.run(async()=>{
      const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{nativeCalls++;f.click(11,12);return f.dispatched()})
      assert.equal(result.pointerReceipt.confirmed,false)
      assert.equal(result.pointerReceipt.reason,'trusted_pointer_receipt_finish_timeout')
    })
    assert.equal(nativeCalls,1)
    resolveLate(value)
    await new Promise<void>(resolve=>setImmediate(resolve))
    assert.equal(pointerMotionPosition(f.wc).valid,false)
    assert.ok([...f.listeners.values()].every(entries=>entries.size===0))
  }finally{f.controller.dispose()}
})

test('aborting begin or finish releases optional observation promptly and rejects late results',async()=>{
  for(const phase of ['begin','finish'] as const){
    const f=fixture(),target=targetFor(f.wc),evaluate=f.wc.executeJavaScriptInIsolatedWorld.bind(f.wc),abort=new AbortController()
    let nativeCalls=0,resolveStarted!:()=>void,resolveLate!:(value:unknown)=>void,lateValue:unknown,beginCode=''
    const started=new Promise<void>(resolve=>{resolveStarted=resolve})
    const late=new Promise(resolve=>{resolveLate=resolve})
    let blocked=false
    f.wc.executeJavaScriptInIsolatedWorld=async(world,scripts)=>{
      const begin=scripts[0].code.includes('const listener=event=>')
      if(!blocked&&begin===(phase==='begin')){
        blocked=true
        if(begin)beginCode=scripts[0].code;else lateValue=await evaluate(world,scripts)
        resolveStarted();return late
      }
      return evaluate(world,scripts)
    }
    try{
      const pending=f.run(()=>nativePointerWithReceipt(f.wc,target,'click','left',async()=>{nativeCalls++;f.click(11,12);return f.dispatched()}),'abort-receipt-run',abort.signal)
      await started
      const atAbort=performance.now();abort.abort(new Error('receipt-test-abort'))
      await assert.rejects(pending,/receipt-test-abort|aborted|operation_invalidated/)
      assert.ok(performance.now()-atAbort<150,'Abort does not wait for the 250ms observation deadline')
      assert.equal(nativeCalls,phase==='begin'?0:1)
      resolveLate(phase==='begin'?await evaluate(1010,[{code:beginCode}]):lateValue)
      await new Promise<void>(resolve=>setImmediate(resolve))
      assert.equal(pointerMotionPosition(f.wc).valid,false)
      assert.ok([...f.listeners.values()].every(entries=>entries.size===0))
    }finally{f.controller.dispose()}
  }
})

test('synthetic events, missing release and a failed native receipt never establish a position or replay input',async()=>{
  let nativeCalls=0
  for(const mode of ['synthetic','no-release','failed','warning'] as const){
    const f=fixture(),target=targetFor(f.wc)
    try{
      await f.run(async()=>{
        const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{
          nativeCalls++
          if(mode==='no-release')f.emit('mousedown',11,12);else f.click(11,12,mode!=='synthetic')
          return mode==='failed'?{status:'failed',stage:'event-dispatch',reason:'PARTIAL_CLICK_SEQUENCE',stages:[]}:mode==='warning'?{...f.dispatched(),deliveryWarning:'PARTIAL_CLICK_SEQUENCE'}:f.dispatched()
        })
        assert.equal(result.pointerReceipt.confirmed,false,mode)
        assert.equal(pointerMotionPosition(f.wc).valid,false,mode)
      })
    }finally{f.controller.dispose()}
  }
  assert.equal(nativeCalls,4,'Confirmation failure never submits a second native click')
})

test('target-local/frame input cannot use a main-frame event as coordinate conversion',async()=>{
  const f=fixture(),target={...targetFor(f.wc),routingId:999}
  try{
    await f.run(async()=>{
      const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{f.click(11,12);return f.dispatched()})
      assert.equal(result.pointerReceipt.confirmed,false)
      assert.equal(result.pointerReceipt.reason,'target_frame_conversion_unavailable')
      assert.equal(pointerMotionPosition(f.wc).valid,false)
    })
  }finally{f.controller.dispose()}
})

test('geometry, navigation and newer input generations win over late successful pointer receipts',async()=>{
  for(const change of ['geometry','navigation','external-input'] as const){
    const f=fixture(),target=targetFor(f.wc)
    try{
      await f.run(async()=>{
        const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{
          f.click(11,12)
          if(change==='geometry')f.controller.geometryChanged()
          else if(change==='navigation')f.wc.emit('did-start-navigation',{},'http://fixture/new',false,true)
          else invalidatePointerMotion(f.wc,'another_input')
          return f.dispatched()
        })
        assert.equal(result.pointerReceipt.confirmed,false,change)
        assert.equal(pointerMotionPosition(f.wc).valid,false,change)
      }).catch(error=>{if(change==='external-input')throw error;assert.match(String(error),/geometry_changed|operation_invalidated|document_changed|aborted/)})
    }finally{f.controller.dispose()}
  }
})

test('a superseded native operation cannot overwrite a newer receipt sequence',async()=>{
  const f=fixture(),target=targetFor(f.wc)
  try{
    await f.run(async()=>{
      const earlier=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{
        f.click(1,2)
        const newer=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{f.click(80,90);return f.dispatched()})
        assert.equal(newer.pointerReceipt.confirmed,true)
        return f.dispatched()
      })
      assert.equal(earlier.pointerReceipt.confirmed,false)
      assert.deepEqual(pointerMotionPosition(f.wc).point,{x:80,y:90})
    })
  }finally{f.controller.dispose()}
})

test('native hover learns its actual main-frame point and an unowned short call still releases it',async()=>{
  const f=fixture(),target=targetFor(f.wc)
  try{
    await f.run(async()=>{
      const result=await nativePointerWithReceipt(f.wc,target,'move','left',async()=>{f.emit('mousemove',22,33);return f.dispatched()})
      assert.equal(result.pointerReceipt.confirmed,true)
      assert.deepEqual(pointerMotionPosition(f.wc).point,{x:22,y:33})
    })
    await f.controller.finishRun('receipt-run')
    await f.controller.run({},operation=>withBrowserInputOperation(f.wc,operation,async()=>{
      const result=await nativePointerWithReceipt(f.wc,target,'click','left',async()=>{f.click(44,55);return f.dispatched()})
      assert.equal(result.pointerReceipt.confirmed,true)
    }))
    assert.equal(pointerMotionPosition(f.wc).valid,false,'No run lease means the controller clears the position on return')
  }finally{f.controller.dispose()}
})
