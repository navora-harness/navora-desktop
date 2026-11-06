import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-audio-smoke-')),entry=path.join(temporary,'audio-smoke.mjs')
const output=path.resolve(process.env.NAVORA_AUDIO_OUTPUT||path.join(root,'release','browser-audio-smoke'))
try{
  fs.mkdirSync(output,{recursive:true});fs.rmSync(path.join(output,'completed.json'),{force:true})
  await build({entryPoints:[path.join(root,'scripts/browser-audio-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __audioRequire} from 'node:module';const require=__audioRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_AUDIO_PROFILE:path.join(temporary,'profile'),NAVORA_AUDIO_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Audio lifecycle checks did not exit within 30s'))},30000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
  if(!process.exitCode&&!fs.existsSync(path.join(output,'completed.json')))throw Error('Audio smoke exited without completing checks')
}finally{
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-audio-smoke-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe audio smoke cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
