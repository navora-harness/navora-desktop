import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-window-startup-'))
const entry=path.join(project,'dist-electron','ui-window-startup.mjs')
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'artifacts','window-startup'))
try{
  fs.mkdirSync(output,{recursive:true})
  await build({entryPoints:[path.join(project,'scripts/ui-window-startup-entry.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const requested=process.argv.slice(2)
  for(const scenario of requested.length?requested:['normal','slow','solid','dark','tray']){
    const profile=path.join(temporary,scenario),scenarioOutput=path.join(output,scenario)
    fs.mkdirSync(profile);fs.mkdirSync(scenarioOutput,{recursive:true})
    fs.rmSync(path.join(scenarioOutput,'completed.json'),{force:true})
    fs.rmSync(path.join(scenarioOutput,'failed.json'),{force:true})
    const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:scenarioOutput,NAVORA_STARTUP_SCENARIO:scenario}
    delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(require('electron'),[entry],{cwd:temporary,env,stdio:'inherit',windowsHide:true})
      const timer=setTimeout(()=>{child.kill();reject(Error('Startup fixture deadline exceeded'))},45000)
      child.once('error',error=>{clearTimeout(timer);reject(error)})
      child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
    })
    if(code!==0)throw Error('Startup scenario failed: '+scenario+' ('+code+')')
    const receipt=JSON.parse(fs.readFileSync(path.join(scenarioOutput,'completed.json'),'utf8'))
    if(!receipt.ok)throw Error('Startup receipt missing: '+scenario)
    console.log('Startup scenario passed:',scenario,'visible splash:',receipt.durationMs+'ms')
  }
}finally{
  fs.rmSync(entry,{force:true})
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-window-startup-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe startup fixture cleanup')
  try{fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
  catch(error){console.warn('Temporary startup profile cleanup was deferred:',error.message)}
}
