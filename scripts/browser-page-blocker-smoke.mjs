import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(project,'package.json'))
const {build}=require('esbuild'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-page-blocker-smoke-')),profile=path.join(temporary,'profile'),entry=path.join(temporary,'entry.mjs')
const output=path.resolve(project,'../_planning/page-blocker-verification-2026-11-05')
fs.mkdirSync(profile);fs.mkdirSync(output,{recursive:true})
try{
  await build({entryPoints:[path.join(project,'scripts/browser-page-blocker-smoke.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_BLOCKER_PROFILE:profile,NAVORA_BLOCKER_OUTPUT:output}
  for(const name of ['ELECTRON_RUN_AS_NODE','VITE_DEV_SERVER_URL','PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_FILE','NODE_OPTIONS'])delete env[name]
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true})
    const timeout=setTimeout(()=>{child.kill();reject(Error('Isolated blocker check deadline exceeded'))},50000)
    child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk))
    child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('exit',code=>{clearTimeout(timeout);resolve(code??1)})
  })
  if(code!==0)throw Error('Isolated blocker check failed: '+code)
}finally{
  const resolved=fs.realpathSync(temporary),tempRoot=fs.realpathSync(os.tmpdir())
  assert.equal(path.dirname(resolved).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(resolved).startsWith('navora-page-blocker-smoke-'))
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:200})
}
console.log('Local browser blocker checks passed. Temporary profile removed.')
