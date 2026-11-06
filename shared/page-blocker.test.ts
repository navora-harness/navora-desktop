import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyPageBlocker,compactPageBlocker,type PageBlockerProbe,type PageBlockerSummaryV1} from './page-blocker'
import {serializeToolResultForModel} from './page-digest'
const probe=(patch:Partial<PageBlockerProbe>={}):PageBlockerProbe=>({verificationText:false,challengeControl:false,suspectedFrame:false,blockingContainer:false,foreground:false,visible:false,kind:'unknown',partial:false,...patch})
const summary:PageBlockerSummaryV1={version:1,chatId:'chat',windowId:'page',webContentsId:1,documentEpoch:2,controlEpoch:3,observedAt:4,observationId:'observation',layoutRevision:'1000x800',state:'confirmed',kind:'human_verification',coverage:'partial',scope:'visible_viewport',reasonCodes:['MAX_NODES'],omittedFrames:1,truncated:true,evidence:[{kind:'blocking_container'}],requiresUser:true,blocksInteraction:'yes',followup:'user_handoff',probeUsed:true}
test('domain/hidden frame and unavailable coverage never confirm a verification',()=>{
  assert.equal(classifyPageBlocker([probe({suspectedFrame:true})],true,false).state,'not_observed')
  assert.equal(classifyPageBlocker([probe({visible:true,suspectedFrame:true,foreground:true,blockingContainer:true})],true,false).state,'suspected')
  assert.equal(classifyPageBlocker([],false,true).state,'unknown')
  assert.equal(classifyPageBlocker([],true,true).state,'unknown')
})
test('verification requires visible foreground container and concrete verification signal',()=>{
  const candidate=probe({visible:true,foreground:true,blockingContainer:true,verificationText:true,kind:'human_verification'})
  const result=classifyPageBlocker([candidate],true,true)
  assert.equal(result.state,'confirmed');assert.equal(result.requiresUser,true)
  assert.equal(classifyPageBlocker([{...candidate,foreground:false}],true,false).state,'suspected')
  assert.equal(classifyPageBlocker([{...candidate,visible:false}],true,false).state,'not_observed')
})
test('ordinary text and cookie/login dialog do not become human verification',()=>{
  assert.equal(classifyPageBlocker([probe({visible:true})],true,false).state,'not_observed')
  const result=classifyPageBlocker([probe({visible:true,foreground:true,blockingContainer:true,challengeControl:true,kind:'site_dialog'})],true,false)
  assert.equal(result.kind,'site_dialog');assert.equal(result.state,'confirmed')
  assert.equal(result.requiresUser,false)
  const mixed=classifyPageBlocker([probe({visible:true,foreground:true,blockingContainer:true,challengeControl:true,kind:'site_dialog'}),probe({visible:true,foreground:true,blockingContainer:true,challengeControl:true,kind:'human_verification'})],true,false)
  assert.equal(mixed.kind,'human_verification');assert.equal(mixed.requiresUser,true)
})
test('normal, safe, oversized native, generic and extreme digest paths retain blocker identity',()=>{
  for(const safe of [false,true])for(const budget of [9000,3000,1200,800])for(const value of ['x'.repeat(100000),{nested:'x'.repeat(100000)},{complete:false,truncated:true,truncationReasons:['MAX_NODES'],elements:Array.from({length:300},()=>({text:'x'.repeat(1000)})),frames:[]}]){
    const raw={ok:true,pageBlocker:summary,value,capabilities:'x'.repeat(20000)}
    const serialized=serializeToolResultForModel(raw,budget,safe),result=JSON.parse(serialized)
    assert.ok(serialized.length<=budget)
    assert.equal(result.pageBlocker.state,'confirmed');assert.equal(result.pageBlocker.observationId,'observation')
    assert.equal(result.pageBlocker.documentEpoch,2);assert.deepEqual(result.pageBlocker.reasonCodes,['MAX_NODES'])
  }
})
test('new diagnostics do not persist unexpected page text/URLs',()=>{
  const compact=compactPageBlocker({...summary,url:'https://fixture.invalid/?token=secret',text:'private verification question'})
  assert.ok(!JSON.stringify(compact).includes('secret'));assert.ok(!JSON.stringify(compact).includes('question'))
})
