import assert from 'node:assert/strict'
import test from 'node:test'
import {browserInputMustNotReplay} from './browser-input-result'

test('native click and iframe partial receipts stop Flow before retries or clearance shortcuts',()=>{
  for(const method of ['clickElement','target_clickElement','iframe-native-selector']){
    assert.equal(browserInputMustNotReplay({ok:false,method,dispatch:{status:'failed',stage:'event-dispatch',deliveryWarning:'PARTIAL_CLICK_SEQUENCE',reason:'release failed'}}),true)
  }
  assert.equal(browserInputMustNotReplay({ok:false,error:'target_click_failed',message:'native acknowledgement lost'}),true)
  assert.equal(browserInputMustNotReplay({ok:false,method:'iframe-offset',status:'failed',dispatchedCount:2,cleanup:{dispatched:1,failed:0}}),true)
})

test('known zero-delivery resolution failures remain distinguishable from uncertain delivery',()=>{
  assert.equal(browserInputMustNotReplay({ok:false,dispatch:{status:'failed',stage:'target-resolution',reason:'STALE_TARGET'}}),false)
  assert.equal(browserInputMustNotReplay({ok:false,status:'failed',dispatchedCount:0}),false)
  assert.equal(browserInputMustNotReplay({ok:false,status:'failed',dispatchedCount:null}),true)
  assert.equal(browserInputMustNotReplay({ok:false,status:'cancelled',dispatchedCount:0}),true)
  assert.equal(browserInputMustNotReplay({ok:true,dispatch:{status:'dispatched'}}),false)
  assert.equal(browserInputMustNotReplay({ok:true,status:'completed',cleanup:{dispatched:1,failed:1}}),true)
})
