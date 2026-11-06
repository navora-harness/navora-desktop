import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addExecutionReceipt,createRunEvidence,finishRunEvidence,normalizeExecutionReceipt,sanitizeRunEvidence,sanitizeExecutionDiagnostic} from './agent-execution-evidence'
const receipt=(name:string,result:unknown,args:Record<string,unknown>={})=>normalizeExecutionReceipt({runId:'run-1',turnId:'u1',messageId:'m1',toolCallId:'c1',toolName:name,args,result,at:2})
test('evaluate completion never becomes native input, field verification or business completion',()=>{
  const fragment=receipt('browser_evaluate',{ok:true,input:{effect:'confirmed'},businessVerified:true,value:{success:true,cookie:'secret'}})
  assert.equal(fragment.state,'script_completed');assert.equal(fragment.inputDispatched,false);assert.equal(fragment.fieldValueVerified,false);assert.equal(fragment.businessResultVerified,false)
  assert.doesNotMatch(JSON.stringify(fragment),/secret|cookie|success/)
})
test('partial native receipt preserves dispatch despite failure and sanitizes diagnostics',()=>{
  const fragment=receipt('browser_type',{ok:false,error:'browser_operation_invalidated: private input',input:{dispatchedSteps:4,effect:'unknown'},diagnostic:{cause:'document_changed',stage:'after_dispatch',expectedEpoch:1,actualEpoch:2,dispatched:true,requiresObservation:true,url:'https://secret.test/?token=private',stack:'private'}})
  assert.equal(fragment.inputDispatched,true);assert.equal(fragment.unresolvedInput,true);assert.equal(fragment.state,'unresolved');assert.equal(fragment.errorCode,'browser_operation_invalidated')
  assert.doesNotMatch(JSON.stringify(fragment),/private|https|token|stack/)
  assert.equal(fragment.diagnostic?.cause,'document_changed')
})
test('field values, observed effects, and unknown business results remain separate',()=>{
  const fragment=receipt('browser_type',{ok:true,input:{effect:'confirmed',submitDispatched:true,submission:{cleanup:'confirmed'},pageResult:{status:'observed',evidence:'new_visible_noneditable_text',coverage:'complete',targetState:'removed'}}})
  const summary=addExecutionReceipt(createRunEvidence({chatId:'chat',runId:'run-1',at:1}),fragment)
  assert.equal(summary.counts.inputsDispatched,1);assert.equal(summary.counts.fieldValuesVerified,1);assert.equal(summary.counts.pageEffectsObserved,1);assert.equal(summary.counts.businessResultsVerified,'unknown')
  assert.equal(addExecutionReceipt(summary,fragment),summary)
})
test('unknown keyboard observation is distinct from failure and confirmed requires host provenance',()=>{
  const fake=receipt('browser_press',{ok:true,keyboardEffect:{state:'confirmed',event:'tab',evidenceSource:'page'}},{key:'Tab'})
  assert.equal(fake.keyboardEffect,undefined)
  const confirmed=receipt('browser_press',{ok:true,keyboardEffect:{state:'confirmed',event:'tab',evidenceSource:'host_readback'}},{key:'Tab'})
  assert.equal(confirmed.keyboardEffect?.state,'confirmed')
})
test('new diagnostics reject unknown strings and blocker evidence drops page content',()=>{
  assert.deepEqual(sanitizeExecutionDiagnostic({cause:'user_took_control_unproven',stage:'arbitrary',cookie:'secret'}),undefined)
  const fragment=receipt('browser_get',{ok:true,pageBlocker:{version:1,state:'confirmed',kind:'human_verification',requiresUser:true,blocksInteraction:'yes',observationId:'observation-1',reasonCodes:['visible_challenge'],question:'secret',token:'secret',url:'https://secret'}})
  assert.equal(fragment.pageBlocker?.state,'confirmed');assert.doesNotMatch(JSON.stringify(fragment),/secret|question|token|https/)
})

test('plugin top-level and arbitrary evaluated nested pageBlocker objects cannot create a host checkpoint',()=>{
  const pageBlocker={version:1,state:'confirmed',windowId:'page',requiresUser:true},plugin=normalizeExecutionReceipt({runId:'r',messageId:'m',toolCallId:'p',toolName:'browser_plugin_custom',args:{windowId:'page'},at:1,result:{ok:true,pageBlocker},trustedBrowserReceipt:false})
  assert.equal(plugin.pageBlocker,undefined)
  const evaluated=receipt('browser_evaluate',{ok:true,value:{pageBlocker}})
  assert.equal(evaluated.pageBlocker,undefined)
  assert.equal(addExecutionReceipt(createRunEvidence({chatId:'chat',runId:'r',at:0}),plugin).resumeCheckpoints,undefined)
})
test('round-trip validates versions, chat scope and final settlement without losing unknown',()=>{
  const summary=finishRunEvidence(createRunEvidence({chatId:'chat',runId:'run-1',turnId:'user',at:1,resumesRunId:'prior'}),{at:3,stopReason:'user_cancelled',unresolvedInputs:'unknown',settlement:{status:'unconfirmed',retainedPages:2,stack:'secret'}})
  assert.equal(summary.stopReason,'user_cancelled');assert.equal(summary.hasUnresolvedSideEffects,'unknown');assert.equal(summary.retainedPageCount,2)
  assert.equal(JSON.stringify(sanitizeRunEvidence(JSON.parse(JSON.stringify(summary)),'chat')),JSON.stringify(summary))
  assert.equal(sanitizeRunEvidence({...summary,version:2},'chat'),undefined);assert.equal(sanitizeRunEvidence(summary,'different-chat'),undefined)
})
