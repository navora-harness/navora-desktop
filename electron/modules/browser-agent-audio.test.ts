import test from 'node:test'
import assert from 'node:assert/strict'
import {BrowserAgentAudio} from './browser-agent-audio'
import {createBrowserAutomationState,normalizeBrowserAutomation} from '../../shared/browser-automation'

function fixture(muted=false){const writes:boolean[]=[];const target={isAudioMuted:()=>muted,setAudioMuted:(value:boolean)=>{muted=value;writes.push(value)}};return {target,writes,audio:new BrowserAgentAudio(target)}}
const state=(patch:Partial<ReturnType<typeof createBrowserAutomationState>>={})=>({...createBrowserAutomationState(),...patch})
test('Agent auto mute defaults on and legacy/explicit false is preserved',()=>{
  assert.equal(normalizeBrowserAutomation({}).auto_mute,true)
  assert.equal(normalizeBrowserAutomation({auto_mute:false}).auto_mute,false)
  assert.throws(()=>normalizeBrowserAutomation({auto_mute:'false'}))
})
test('manual browsing and idle AI permission do not auto mute',()=>{
  const {audio,writes}=fixture()
  audio.sync(state(),true);audio.sync(state({owner:'user',activeOperations:1}),true);audio.sync(state({owner:'paused',leaseRunId:'a'}),true)
  assert.deepEqual(writes,[])
})
test('task lease mutes across model waits and restores the original preference',()=>{
  const {audio,target,writes}=fixture()
  audio.sync(state({leaseRunId:'a',activity:'acting'}),true)
  assert.equal(target.isAudioMuted(),true);assert.equal(audio.preference,false)
  audio.sync(state({leaseRunId:'a',activity:'waiting'}),true)
  assert.deepEqual(writes,[true])
  audio.sync(state(),true)
  assert.equal(target.isAudioMuted(),false);assert.equal(audio.preference,false)
})
test('already muted user stays muted after task, takeover, or setting disabled',()=>{
  for(const end of [state(),state({owner:'user',leaseRunId:'a'})]){
    const {audio,target}=fixture(true);audio.sync(state({leaseRunId:'a'}),true);audio.sync(end,true);assert.equal(target.isAudioMuted(),true)
  }
  const {audio,target}=fixture(true);audio.sync(state({leaseRunId:'a'}),true);audio.sync(state({leaseRunId:'a'}),false);assert.equal(target.isAudioMuted(),true)
})
test('manual choice during a task wins, persists, and a new task gets its own automatic scope',()=>{
  const {audio,target}=fixture()
  audio.sync(state({leaseRunId:'a'}),true);audio.setManual(false);audio.sync(state({leaseRunId:'a',activity:'waiting'}),true)
  assert.equal(target.isAudioMuted(),false)
  audio.sync(state({leaseRunId:'b'}),true);assert.equal(target.isAudioMuted(),true);assert.equal(audio.preference,false)
  audio.setManual(true);audio.sync(state(),true);assert.equal(target.isAudioMuted(),true)
})
test('disabling during a task restores sound and re-enabling samples current manual preference',()=>{
  const {audio,target}=fixture()
  audio.sync(state({leaseRunId:'a'}),true);audio.sync(state({leaseRunId:'a'}),false);assert.equal(target.isAudioMuted(),false)
  audio.sync(state({leaseRunId:'a'}),true);assert.equal(target.isAudioMuted(),true)
  audio.sync(state({owner:'paused'}),true);assert.equal(target.isAudioMuted(),false)
})
test('short Agent operations without a run lease are scoped to actual activity',()=>{
  const {audio,target}=fixture()
  audio.sync(state({activeOperations:1,activity:'acting'}),true);assert.equal(target.isAudioMuted(),true)
  audio.sync(state(),true);assert.equal(target.isAudioMuted(),false)
})
test('display snapshot separates manual preference, actual mute and temporary Agent cause',()=>{const {audio,writes}=fixture();audio.sync(state({leaseRunId:'a'}),true);const count=writes.length;assert.deepEqual(audio.snapshot(),{muted:true,manualMuted:false,muteReason:'agent',agentAutoMuted:true,manualOverride:false});assert.equal(writes.length,count);audio.setManual(false);assert.equal(audio.snapshot().muteReason,undefined);assert.equal(audio.snapshot().manualOverride,true);audio.setManual(true);assert.equal(audio.snapshot().muteReason,'manual')})
