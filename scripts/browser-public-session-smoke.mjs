import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {electronRuntimeRelease} from './electron-runtime-release.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),executable=require('electron')
const release=electronRuntimeRelease(executable)
if(release!=='45.0.0-cloudbypass.11')throw Error(`Public session smoke requires .11; found ${release}`)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-public-session-'))
const server=http.createServer((request,response)=>{
  const url=new URL(request.url||'/',`http://${request.headers.host}`)
  if(url.pathname==='/download'){response.writeHead(200,{'Content-Disposition':'attachment; filename="owned-fixture.txt"','Content-Type':'application/octet-stream'});response.end('isolated-download');return}
  if(url.pathname==='/echo'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({chat:request.headers['x-fixture-chat']||null,cookie:request.headers.cookie||'',proof:Object.keys(request.headers).some(name=>name.startsWith('x-navora-internal'))}));return}
  response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end('<!doctype html><title>Public session fixture</title><input id="entry"><p>Isolated local fixture</p>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try{
  const entry=path.join(temporary,'public-session-smoke.mjs')
  await build({entryPoints:[path.join(root,'scripts/browser-public-session-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  for(const stage of ['seed','restore','relocated','zero','save-failure','invalid','missing-storage']){
    const env={...process.env,NAVORA_PUBLIC_SESSION_ROOT:temporary,NAVORA_PUBLIC_SESSION_STAGE:stage,NAVORA_PUBLIC_SESSION_ORIGIN:`http://127.0.0.1:${server.address().port}`};delete env.ELECTRON_RUN_AS_NODE
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(executable,[entry],{cwd:root,env,stdio:'inherit',windowsHide:true});let expired=false
      const timer=setTimeout(()=>{expired=true;child.kill()},90_000)
      child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);expired?reject(Error(`Public session ${stage} exceeded 90 seconds`)):resolve(code??1)})
    })
    if(code!==0){process.exitCode=code;break}
  }
}finally{
  await new Promise(resolve=>server.close(resolve))
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!/^navora-public-session-[^\\/]+$/u.test(relative))throw Error('Unsafe public session smoke cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
