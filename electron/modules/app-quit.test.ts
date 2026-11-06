import test from 'node:test'
import assert from 'node:assert/strict'
import {createAppQuitIntent,createAppQuitDrain,readAppQuitState} from './app-quit'

function windowPort(id=1){const sent:unknown[]=[];let shown=0;return {sent,get shown(){return shown},isDestroyed:()=>false,isMinimized:()=>true,restore:()=>{shown++},show:()=>{shown++},focus:()=>{shown++},webContents:{id,isDestroyed:()=>false,send:(channel:string,payload:unknown)=>sent.push({channel,payload})}}}
test('tray quit shows the main window and requests confirmation without stopping anything',async()=>{
  const win=windowPort();let commits=0
  const intent=createAppQuitIntent({getMain:()=>win,createMain:async()=>assert.fail(),commit:()=>{commits++}})
  intent.ready(win);await intent.request();assert.equal(win.shown,3);assert.deepEqual(win.sent,[{channel:'navora:app.quit-requested',payload:{source:'tray'}}]);assert.equal(commits,0)
  assert.deepEqual(intent.confirm(),{ok:true});intent.confirm();await intent.request();assert.equal(commits,1);assert.equal(win.sent.length,1)
})
test('a missing main window is created once and its mounted listener receives the pending request',async()=>{
  let main:ReturnType<typeof windowPort>|null=null,created=0
  const intent=createAppQuitIntent({getMain:()=>main,createMain:async()=>{created++;main=windowPort()},commit:()=>assert.fail()})
  await Promise.all([intent.request(),intent.request()]);assert.equal(created,1);assert.equal(main!.sent.length,0)
  intent.ready(main!);assert.equal(main!.sent.length,1)
})
test('reloading or unsubscribing postpones delivery and foreign readiness is rejected',async()=>{
  const main=windowPort(),foreign=windowPort(2)
  const intent=createAppQuitIntent({getMain:()=>main,createMain:async()=>assert.fail(),commit:()=>assert.fail()})
  intent.ready(main);intent.loading(main);await intent.request();assert.equal(main.sent.length,0)
  assert.throws(()=>intent.ready(foreign),/main_window_required/);intent.ready(main);assert.equal(main.sent.length,1)
})

test('quit state counts live Agents across root and child chats, excluding cancellation cleanup leases',()=>{
  const runs=new Map(['other-root','child-task','stopping-task'].map(id=>[id,new AbortController()]))
  runs.get('stopping-task')!.abort()
  const runtime={runningChatIds:()=>[...runs.keys()],isRunning:(id:string)=>!!runs.get(id)&&!runs.get(id)!.signal.aborted}
  assert.deepEqual(readAppQuitState(runtime),{runningAgents:2})
  runs.get('other-root')!.abort();runs.get('child-task')!.abort()
  assert.equal(runs.size,3,'cleanup leases still exist')
  assert.deepEqual(readAppQuitState(runtime),{runningAgents:0})
  assert.deepEqual(readAppQuitState(),{runningAgents:0})
})

test('a new Agent arriving after the UI state check cannot be stopped by an old confirmation',()=>{
  const win=windowPort();let running=0,commits=0
  const intent=createAppQuitIntent({getMain:()=>win,createMain:async()=>assert.fail(),state:()=>({runningAgents:running}),commit:()=>{commits++}})
  assert.deepEqual(intent.state(),{runningAgents:0})
  running=2
  assert.deepEqual(intent.confirm(0),{ok:false,reason:'running_agents_changed',runningAgents:2})
  assert.equal(commits,0)
  assert.deepEqual(intent.confirm(2),{ok:true});assert.equal(commits,1)
  intent.confirm(2);assert.equal(commits,1)
})

test('task completion after confirmation does not prevent quit, and invalid acknowledgements never commit',()=>{
  const win=windowPort();let commits=0
  const intent=createAppQuitIntent({getMain:()=>win,createMain:async()=>assert.fail(),state:()=>({runningAgents:0}),commit:()=>{commits++}})
  for(const value of [-1,NaN,Infinity,0.5,'0'])assert.throws(()=>intent.confirm(value as number),/invalid_quit_state/)
  assert.equal(commits,0)
  assert.deepEqual(intent.confirm(2),{ok:true});assert.equal(commits,1)
})

test('confirmed quit waits for plugin drain once, with concurrent confirmation sharing the pending commit',async()=>{
  let release!:()=>void,commits=0,stops=0,drains=0
  const held=new Promise<void>(resolve=>{release=resolve})
  const barrier=createAppQuitDrain({stop:()=>{stops++},drain:async()=>{drains++;await held},commit:()=>{commits++}})
  const win=windowPort(),intent=createAppQuitIntent({getMain:()=>win,createMain:async()=>assert.fail(),commit:()=>barrier.request()})
  const first=intent.confirm(0),second=intent.confirm(0)
  assert.equal(first,second);await Promise.resolve();assert.equal(stops,1);assert.equal(drains,1);assert.equal(commits,0);assert.equal(barrier.ready(),false)
  release();assert.deepEqual(await first,{ok:true});assert.equal(commits,1);assert.equal(barrier.ready(),true)
})

test('quit drain is reentrant during window closure and a failed drain can be retried without native quit',async()=>{
  let attempts=0,commits=0,quitting=false,reentrant:Promise<void>|undefined
  const barrier=createAppQuitDrain({stop:()=>{quitting=true;reentrant=barrier.request()},drain:async()=>{if(++attempts===1)throw Error('fixture_cleanup_failed')},commit:()=>{commits++},failed:()=>{quitting=false}})
  const win=windowPort(),intent=createAppQuitIntent({getMain:()=>win,createMain:async()=>assert.fail(),commit:()=>barrier.request()})
  const first=intent.confirm(0)
  await assert.rejects(Promise.resolve(first),/fixture_cleanup_failed/);assert.equal(commits,0);assert.equal(barrier.ready(),false);assert.equal(quitting,false)
  await assert.rejects(reentrant!,/fixture_cleanup_failed/)
  assert.deepEqual(await intent.confirm(0),{ok:true});assert.equal(attempts,2);assert.equal(commits,1)
})
