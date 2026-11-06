import test from 'node:test'
import assert from 'node:assert/strict'
import {browserAgentControl} from './browser-agent-control'
import {createBrowserAutomationState} from './browser-automation'
import type {PageBlockerSummaryV1} from './page-blocker'

function blocker(state:PageBlockerSummaryV1['state']='confirmed',requiresUser=true):PageBlockerSummaryV1{return {version:1,chatId:'chat',windowId:'page',webContentsId:1,documentEpoch:1,controlEpoch:1,observedAt:1,observationId:'observation',layoutRevision:'1',state,kind:'human_verification',coverage:'complete_for_scope',scope:'visible_viewport',reasonCodes:[],omittedFrames:0,truncated:false,evidence:[],requiresUser,blocksInteraction:'yes',followup:'user_handoff',probeUsed:false}}

test('confirmed human verification offers takeover and a read-only recheck after user control',()=>{
  const state={...createBrowserAutomationState(),pageBlocker:blocker()}
  const takeover=browserAgentControl(state)
  assert.equal(takeover.blocked,true);assert.equal(takeover.primaryLabel,'我来处理');assert.equal(takeover.switchAction,'takeControl')
  const recheck=browserAgentControl({...state,owner:'user'})
  assert.equal(recheck.primaryLabel,'我已完成，重新检查');assert.equal(recheck.switchAction,'resume');assert.match(recheck.hint,/不会自动重放/)
  assert.equal(browserAgentControl({...state,owner:'user'},'resume').title,'正在重新检查页面')
})
test('suspected verification and an ordinary site dialog do not request personal verification',()=>{
  for(const pageBlocker of [blocker('suspected'),blocker('confirmed',false)])assert.equal(browserAgentControl({...createBrowserAutomationState(),pageBlocker}).blocked,false)
  const fault=browserAgentControl({...createBrowserAutomationState(),pageBlocker:blocker(),nativeConfirmed:false})
  assert.equal(fault.primaryLabel,'重试解除控制');assert.equal(fault.switchAction,undefined)
})

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

test('control feedback describes the requested action and preserves unknown native acknowledgement',()=>{
  const state=createBrowserAutomationState()
  assert.equal(browserAgentControl(state,'resume').title,'正在允许 AI 操作')
  assert.equal(browserAgentControl(state,'reload').title,'正在重新加载页面')
  const model=browserAgentControl({...state,activity:'handoff',inputProtected:true,controlWait:{stage:'submitted-input',startedAt:1,elapsedMs:16000,overdue:true,committedInputs:1,pendingNavigation:0}},'takeControl')
  assert.equal(model.busy,true);assert.equal(model.spinning,false);assert.equal(model.fault,true)
  assert.equal(model.switchAction,undefined);assert.equal(model.recoveryAction,undefined)
  assert.match(model.hint,/已提交输入.*16 秒/)
})

test('a waiting lease reports isolation independently of visible cursor drawing', () => {
  const state = { ...createBrowserAutomationState(), activity: 'waiting' as const, leaseRunId: 'task', isolateInput: true, keepRendering: true, inputProtected: true, cursorEnabled: false }
  assert.match(browserAgentControl(state).hint, /后台隔离已生效.*等待期间保持/)
  assert.equal(browserAgentControl(state).switchAction, 'takeControl')
  assert.match(browserAgentControl({ ...createBrowserAutomationState(), activity: 'error', error: 'automation_rendering_unavailable' }).hint, /操作未启动/)
})

test('idle permission does not present released input or an absent cursor as a fault',()=>{
  const model=browserAgentControl(createBrowserAutomationState())
  assert.equal(model.status,'idle')
  assert.equal(model.title,'AI 待命')
  assert.match(model.hint,/开始操作时自动隔离输入/)
  assert.equal(model.protectionText,'已解除')
  assert.equal(model.showNativeStatus,false)
  assert.equal(model.primaryLabel,'我来操作')
})

test('confirmed protection and cursor visibility remain independent during an active lease',()=>{
  const state={...createBrowserAutomationState(),leaseRunId:'run',activity:'waiting' as const,isolateInput:true,keepRendering:true,inputProtected:true,cursorVisible:false}
  const hidden=browserAgentControl(state),visible=browserAgentControl({...state,cursorEnabled:true,cursorVisible:true})
  assert.equal(hidden.status,'active')
  assert.equal(hidden.showNativeStatus,true)
  assert.equal(hidden.protectionText,'已生效')
  assert.equal(hidden.cursorText,'已隐藏')
  assert.equal(visible.protectionText,hidden.protectionText)
  assert.equal(visible.cursorText,'已启用，显示待核验')
  assert.equal(browserAgentControl({...state,cursorRequested:true,cursorPositionValid:false}).cursorText,'等待首次有效指针输入')
  const incomplete=browserAgentControl({...state,inputProtected:false})
  assert.equal(incomplete.protectionText,'未生效')
  assert.doesNotMatch(incomplete.hint,/隔离已生效/)
  const pending=browserAgentControl({...state,nativePending:true})
  assert.equal(pending.protectionText,'正在确认')
  assert.equal(pending.status,'pending')
  assert.equal(pending.title,'正在确认输入保护')
  assert.equal(pending.switchAction,'takeControl')
  assert.equal(browserAgentControl({...state,nativeConfirmed:false}).protectionText,'尚未确认')
})
