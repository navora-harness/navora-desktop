import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {electronRuntimeRelease} from './electron-runtime-release.mjs'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(import.meta.url), executable=require('electron')
const release=electronRuntimeRelease(executable)
if(release!=='45.0.0-cloudbypass.11')throw Error(`Expected customized .11, found ${release}`)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-native-text-'))
try{
  const entry=path.join(temporary,'native-text-smoke.mjs')
  await build({entryPoints:[path.join(project,'scripts/native-text-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_NATIVE_TEXT_SMOKE_ROOT:temporary,NAVORA_NATIVE_TEXT_RELEASE:release}
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(executable,[entry],{cwd:project,env,stdio:'inherit',windowsHide:true})
    let expired=false
    const timer=setTimeout(()=>{expired=true;child.kill()},60000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('exit',code=>{clearTimeout(timer);expired?reject(Error('Native text smoke exceeded 60 seconds')):resolve(code??1)})
  })
}finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!relative.startsWith('navora-native-text-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe native text smoke cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
