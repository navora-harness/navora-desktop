import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-browser-recovery-'))
const output=path.join(root,'release','ui-browser-recovery'),entry=path.join(root,'dist-electron','ui-browser-recovery.mjs')
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<title>重启恢复验收</title><style>body{margin:24px;background:#f6f8fc}button{padding:16px}</style><h1>浏览器恢复验收</h1><button id="target">保留这条批注</button>')})
try{
  fs.mkdirSync(output,{recursive:true})
  for(const name of ['prepared.json','completed.json'])fs.rmSync(path.join(output,name),{force:true})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${server.address().port}/restart`
  await build({entryPoints:[path.join(root,'scripts','ui-browser-recovery-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"}})
  const pids=[]
  for(const phase of ['prepare','restore']){
    const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output,NAVORA_RECOVERY_PHASE:phase,NAVORA_RECOVERY_URL:url}
    delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
    await new Promise((resolve,reject)=>{
      const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true});pids.push(child.pid)
      const timer=setTimeout(()=>{child.kill();reject(Error('Recovery fixture exceeded its deadline: '+phase))},60000)
      child.on('error',error=>{clearTimeout(timer);reject(error)})
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Recovery fixture failed: '+phase+' ('+code+')'))})
    })
    if(phase==='prepare'){
      const prepared=JSON.parse(fs.readFileSync(path.join(output,'prepared.json'),'utf8'))
      assert.ok(fs.existsSync(path.join(profile,'browser-workspace.json')),'Normal application quit persisted the workspace')
      const corrupt=path.resolve(prepared.corruptFile)
      assert.ok(corrupt.startsWith(profile+path.sep),'Corruption fixture stays inside its disposable profile')
      fs.writeFileSync(corrupt,'{interrupted draft file')
    }
  }
  assert.notEqual(pids[0],pids[1],'Restore uses a new application process')
  const report=JSON.parse(fs.readFileSync(path.join(output,'completed.json'),'utf8'))
  report.processIds=pids;fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify(report,null,2))
  console.log('[browser-recovery] Whole application exit and restart passed:',report.checks.length,'checks')
}finally{
  server.close();fs.rmSync(entry,{force:true})
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(profile))
  if(!relative.startsWith('navora-browser-recovery-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe recovery fixture cleanup')
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
