import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {electronRuntimeRelease} from './electron-runtime-release.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),executable=createRequire(import.meta.url)('electron')
const version=electronRuntimeRelease(executable)
if(version!=='45.0.0-cloudbypass.11')throw Error('Task declarations require the customized .11 test runtime')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-task-declarations-'))
try{
  const entry=path.join(temporary,'task-declarations.mjs')
  await build({entryPoints:[path.join(root,'scripts/task-declarations-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_TASK_DECLARATIONS_ROOT:temporary};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(executable,[entry],{cwd:root,env,stdio:'inherit',windowsHide:true});let expired=false
    const timer=setTimeout(()=>{expired=true;child.kill()},60000)
    child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);expired?reject(Error('Task declaration smoke exceeded 60 seconds')):resolve(code??1)})
  })
}finally{
  if(!/^navora-task-declarations-[^\\/]+$/u.test(path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))))throw Error('Unsafe task fixture cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
