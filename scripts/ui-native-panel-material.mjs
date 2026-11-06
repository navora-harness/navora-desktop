import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const require=createRequire(import.meta.url),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-native-material-')),entry=path.join(temporary,'fixture.mjs'),profile=path.join(temporary,'profile')
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'..','_planning','native-panel-material-2026-11-06'))
try{
  fs.mkdirSync(profile);fs.mkdirSync(output,{recursive:true})
  for(const name of ['completed.json','failed.json'])fs.rmSync(path.join(output,name),{force:true})
  await build({entryPoints:[path.join(project,'scripts/ui-native-panel-material-entry.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_NATIVE_PROJECT:project,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:temporary,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Native material fixture exceeded its 55 second deadline'))},55000)
    child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
  if(code!==0)throw Error('Native material fixture failed: '+code)
  const report=JSON.parse(fs.readFileSync(path.join(output,'completed.json'),'utf8'))
  if(!report.ok)throw Error('Native material fixture exited without a completed report')
  console.log(JSON.stringify({ok:true,distributionVersion:report.distributionVersion,electron:report.electron,checks:report.checks,output}))
}finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!/^navora-native-material-[^\\/]+$/u.test(relative))throw Error('Unsafe native material fixture cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:200})
}
