import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {electronRuntimeRelease} from './electron-runtime-release.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const executable=require('electron'),release=electronRuntimeRelease(executable)
if(release!=='45.0.0-cloudbypass.11')throw Error(`Network scope smoke requires customized .11; found ${release}`)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-network-scope-'))
try{
  const entry=path.join(temporary,'network-scope-smoke.mjs')
  await build({entryPoints:[path.join(root,'scripts/browser-network-scope-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_NETWORK_SCOPE_SMOKE_ROOT:temporary};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(executable,[entry],{cwd:root,env,stdio:'inherit',windowsHide:true});let expired=false
    const timer=setTimeout(()=>{expired=true;child.kill()},60000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('exit',code=>{clearTimeout(timer);expired?reject(Error('Network scope smoke exceeded 60 seconds')):resolve(code??1)})
  })
}finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!/^navora-network-scope-[^\\/]+$/u.test(relative))throw Error('Unsafe network scope smoke cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
