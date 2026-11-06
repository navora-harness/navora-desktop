import test from 'node:test'
import assert from 'node:assert/strict'
import type {WebContents} from 'electron'
import {observePageBlocker} from './page-blocker-observer'
const context={chatId:'chat',windowId:'page',documentEpoch:1,controlEpoch:1}
function fixture(probes:unknown[]=[],partial=false){
  let calls=0
  const mainFrame={processId:1,routingId:1,framesInSubtree:[]}
  const sample={probes,frames:[],partial,layout:'1000x800'}
  const wc={id:1,mainFrame,executeJavaScriptInIsolatedWorld:async()=>{calls++;return sample}} as unknown as WebContents
  return {wc,sample,get calls(){return calls}}
}
test('independent verification survives native MAX_NODES and unreadable frame coverage',async()=>{
  const f=fixture([{verificationText:true,challengeControl:true,suspectedFrame:false,blockingContainer:true,foreground:true,visible:true,kind:'human_verification',partial:false}])
  const result=await observePageBlocker(f.wc,{...context,nativeSnapshot:{complete:false,truncated:true,truncationReasons:['MAX_NODES'],frames:[{status:'skipped'}]}})
  assert.equal(result.state,'confirmed');assert.equal(result.coverage,'partial');assert.ok(result.reasonCodes.includes('MAX_NODES'))
})
test('suspected generation has only one followup, and uncertain result remains unknown',async()=>{
  const f=fixture([{verificationText:true,challengeControl:false,suspectedFrame:false,blockingContainer:false,foreground:false,visible:true,kind:'human_verification',partial:false}])
  const first=await observePageBlocker(f.wc,context)
  assert.equal(first.state,'unknown');assert.equal(first.probeUsed,true);assert.equal(f.calls,2)
  const second=await observePageBlocker(f.wc,context)
  assert.equal(second.state,'unknown');assert.equal(f.calls,3)
  await observePageBlocker(f.wc,{...context,documentEpoch:2});assert.equal(f.calls,5)
})
test('a cleared foreground retains prior blocking history without retaining page content',async()=>{
  const f=fixture([{verificationText:true,challengeControl:true,blockingContainer:true,foreground:true,visible:true,kind:'human_verification',partial:false}])
  const first=await observePageBlocker(f.wc,context)
  f.sample.probes=[]
  const second=await observePageBlocker(f.wc,context)
  assert.equal(second.state,'not_observed');assert.equal(second.previouslyBlockedAt,first.observedAt);assert.ok(second.clearedAt)
})
test('probe unavailable does not claim the page is clear',async()=>{
  const f=fixture();Object.assign(f.wc,{executeJavaScriptInIsolatedWorld:async()=>{throw Error('renderer gone')}})
  const result=await observePageBlocker(f.wc,context)
  assert.equal(result.state,'unknown');assert.equal(result.coverage,'unavailable')
})
