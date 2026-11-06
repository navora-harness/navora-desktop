import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveTaskConstraints} from '../../shared/task-declarations'
import {enforceInheritedTaskConstraints,freezeTaskConstraints,taskToolFailure,taskToolVisible} from './agent-task-policy'

const plan=freezeTaskConstraints(deriveTaskConstraints({version:1,ids:['automation','plan']}))
test('planning rejects effects, raw scripts and unknown plugins before dispatch',()=>{
  for(const name of ['shell_exec','browser_evaluate','file_write','file_delete','file_download','browser_open','browser_navigate','browser_click','browser_type','browser_session_fetch','browser_cookies_get','browser_network_rule_add','app_settings_update','plugin_build','unknown_read_only_plugin'])assert.equal(taskToolFailure(name,{readonly:true,method:'GET'},plan)?.error,'task_plan_phase_restricted',name)
  assert.equal(taskToolFailure('file_read',{path:'source.ts'},plan),null)
  assert.equal(taskToolFailure('file_read',{path:'source.ts'},plan,true)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolVisible('shell_exec',plan),false);assert.equal(taskToolVisible('plan_write_artifact',plan),true)
})
test('planning checks operation parameters instead of accepting a read-like tool name',()=>{
  assert.equal(taskToolFailure('browser_network_log',{clear:true},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('browser_network_log',{clear:false},plan),null)
  assert.equal(taskToolFailure('browser_query_deep',{scrollIntoView:'false'},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('browser_query_deep',{scrollIntoView:false},plan),null)
  assert.equal(taskToolFailure('browser_screenshot',{path:'source.png'},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('browser_screenshot',{},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('desktop_screenshot',{},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('browser_get',{what:'cookies'},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('browser_get',{what:'agent_find'},plan),null)
  assert.equal(taskToolFailure('plan_read_url',{url:'https://example.com/',headers:{}},plan)?.error,'task_plan_phase_restricted')
  assert.equal(taskToolFailure('plan_write_artifact',{content:'plan',path:'code.ts'},plan)?.error,'task_plan_phase_restricted')
})
test('frozen snapshots reject unknown or inconsistent semantics and preserve ordinary execution',()=>{
  const raw=deriveTaskConstraints({version:1,ids:['plan']},{messageId:'user',queueRevision:3}),frozen=freezeTaskConstraints(raw)
  raw.declarations.ids.length=0;assert.deepEqual(frozen.declarations.ids,['plan'])
  assert.ok(Object.isFrozen(frozen)&&Object.isFrozen(frozen.declarations.ids))
  for(const value of [null,{version:2,phase:'execute'}, {...plan,phase:'execute'},{version:1,phase:'execute'},{...plan,declarations:{version:9,ids:['plan']}}])assert.throws(()=>freezeTaskConstraints(value))
  const execute=freezeTaskConstraints(deriveTaskConstraints({version:1,ids:['automation']}))
  assert.equal(taskToolFailure('shell_exec',{command:'allowed-by-normal-gate'},execute),null)
  assert.equal(taskToolFailure('shell_exec',{},null as never)?.error,'task_constraints_unsupported')
  assert.throws(()=>enforceInheritedTaskConstraints({kind:'sub',messages:[{id:'origin',role:'user',content:'origin',createdAt:1,meta:{taskConstraints:{version:99} as never}}]},execute),/unsupported/)
})
