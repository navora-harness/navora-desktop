import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'

test('trusted native UI IPC and renderer action lifecycles pass the inert boundary harness',()=>{
  const result=spawnSync(process.execPath,['scripts/test-native-ui-bridge.mjs'],{cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:30000})
  assert.ifError(result.error)
  assert.equal(result.status,0,result.stdout+result.stderr)
  const report=JSON.parse(result.stdout.trim()) as {ok:boolean;checks:number;nativeProcessesStarted:number;profilesOpened:number}
  assert.equal(report.ok,true)
  assert.ok(report.checks>=100)
  assert.equal(report.nativeProcessesStarted,0)
  assert.equal(report.profilesOpened,0)
})
