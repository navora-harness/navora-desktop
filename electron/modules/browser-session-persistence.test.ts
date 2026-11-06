import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {browserWorkspaceV2Path,loadBrowserWorkspace,saveBrowserWorkspace} from './browser-session-persistence'

function fixture(t:{after(fn:()=>void):void}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-session-state-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return path.join(root,'browser-workspace.json')
}

test('legacy migration keeps an immutable original backup and private partition identity',t=>{
  const file=fixture(t),legacy=[{sessionId:'sess_old',chatId:'one',sessionIndex:3,pages:[{id:'win_old',url:'https://example.com/'}]}]
  const original=JSON.stringify(legacy);fs.writeFileSync(file,original)
  assert.equal(loadBrowserWorkspace(file).version,1)
  assert.equal(fs.readFileSync(file+'.v1-backup','utf8'),original)
  const records=[{...legacy[0],scope:'persistent',partition:'persist:one-3'},{scope:'default',sessionId:'sess_default',chatId:'',partition:'persist:navora-public-browser-v1',pages:[]}]
  saveBrowserWorkspace(file,records)
  assert.equal(loadBrowserWorkspace(file).version,2)
  assert.equal(loadBrowserWorkspace(file).records[0]!.partition,'persist:one-3')
  assert.equal(loadBrowserWorkspace(file).records.length,2)
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).length,1)
  assert.equal(fs.readFileSync(file+'.v1-backup','utf8'),original)
})

test('zero-page public identity survives restart and a prior valid v2 remains backed up',t=>{
  const file=fixture(t),publicSession={scope:'default',sessionId:'sess_default',chatId:'',partition:'persist:navora-public-browser-v1',pages:[]}
  saveBrowserWorkspace(file,[publicSession])
  saveBrowserWorkspace(file,[{...publicSession,pages:[{chatId:'one',id:'win_a',url:'https://example.com/'}]}])
  assert.equal(JSON.parse(fs.readFileSync(browserWorkspaceV2Path(file)+'.bak','utf8')).sessions[0].pages.length,0)
  assert.equal(loadBrowserWorkspace(file).records[0]!.pages[0].chatId,'one')
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),[])
})

test('invalid versioned state throws rather than silently loading legacy empty state',t=>{
  const file=fixture(t);fs.writeFileSync(file,'[]');fs.writeFileSync(browserWorkspaceV2Path(file),'{"version":999,"sessions":[]}')
  assert.throws(()=>loadBrowserWorkspace(file),/version_invalid/)
  assert.ok(fs.existsSync(browserWorkspaceV2Path(file)))
})

test('display counters and numbers persist independently from partition indices and deleted sessions',t=>{
  const file=fixture(t)
  saveBrowserWorkspace(file,[{scope:'persistent',sessionId:'sess_a',sessionIndex:1,displayIndex:4,partition:'persist:original'}],19)
  const state=loadBrowserWorkspace(file)
  assert.equal(state.nextDisplayIndex,19)
  assert.equal(state.records[0]!.displayIndex,4)
  assert.equal(state.records[0]!.partition,'persist:original')
  saveBrowserWorkspace(file,[],state.nextDisplayIndex)
  assert.equal(loadBrowserWorkspace(file).nextDisplayIndex,19)
})

test('a failed compatibility write cannot commit new authoritative state',t=>{
  const file=fixture(t),original=[{scope:'persistent',sessionId:'sess_old',name:'original'}]
  saveBrowserWorkspace(file,original)
  const state=fs.readFileSync(browserWorkspaceV2Path(file),'utf8')
  fs.unlinkSync(file);fs.mkdirSync(file)
  assert.throws(()=>saveBrowserWorkspace(file,[{...original[0],name:'uncommitted'}]))
  assert.equal(fs.readFileSync(browserWorkspaceV2Path(file),'utf8'),state)
})
