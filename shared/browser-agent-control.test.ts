import test from 'node:test'
import assert from 'node:assert/strict'
import {browserAgentControl} from './browser-agent-control'
import {createBrowserAutomationState} from './browser-automation'

test('unknown and pending ownership never offer a speculative toggle',()=>{
  assert.equal(browserAgentControl().switchAction,undefined)
  assert.equal(browserAgentControl(createBrowserAutomationState(),true).switchAction,undefined)
})
test('paused and manual pages resume while an active AI page remains available for takeover',()=>{
  const state=createBrowserAutomationState()
  assert.equal(browserAgentControl({...state,owner:'paused'}).switchAction,'resume')
  assert.equal(browserAgentControl({...state,owner:'user'}).switchAction,'resume')
  assert.equal(browserAgentControl({...state,activity:'acting',activeOperations:1,inputProtected:true}).switchAction,'takeControl')
  assert.equal(browserAgentControl({...state,activity:'acting',activeOperations:1,nativePending:true}).switchAction,'takeControl')
  assert.equal(browserAgentControl(state).working,false)
})
test('recovery distinguishes confirmed unlock with unsafe cleanup from an unknown release',()=>{
  const state={...createBrowserAutomationState(),owner:'paused' as const,activity:'error' as const}
  assert.equal(browserAgentControl({...state,error:'cleanup_unconfirmed'}).recoveryAction,'reload')
  assert.equal(browserAgentControl({...state,error:'cleanup_unconfirmed',nativeConfirmed:false}).recoveryAction,'retryAutomation')
  assert.equal(browserAgentControl({...state,error:'release_unconfirmed'}).switchAction,undefined)
  assert.equal(browserAgentControl({...state,error:'release_unconfirmed'}).recoveryAction,'retryAutomation')
  assert.equal(browserAgentControl({...state,error:'TARGET_OCCLUDED'}).switchAction,'resume')
})
