import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'

// Run after the frontend has been built; this suite does not invoke the full build.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-ui-automation-'))
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'release','ui-browser-automation'))
const entry=path.join(root,'dist-electron','ui-browser-automation.mjs')
try{
  fs.mkdirSync(output,{recursive:true})
  fs.rmSync(path.join(output,'completed.json'),{force:true})
  fs.rmSync(path.join(output,'failure-state.json'),{force:true})
  await build({entryPoints:[path.join(root,'scripts/ui-browser-automation-entry.ts')],outfile:entry,
    bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],
    banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.env.NAVORA_UI_ELECTRON||require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Browser automation UI fixture exceeded its deadline'))},180000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
  if(code!==0)throw Error('Browser automation UI fixture failed: '+code)
  if(!fs.existsSync(path.join(output,'completed.json')))throw Error('UI fixture exited without its report')
  console.log('Browser automation UI screenshots: '+output)
}finally{
  fs.rmSync(entry,{force:true})
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(profile))
  if(!relative.startsWith('navora-ui-automation-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe UI fixture cleanup path')
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
