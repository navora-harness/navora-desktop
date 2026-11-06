import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-followup-ui-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'..','_planning','ui-automation-followup-2026-11-05'))
const entry=path.join(project,'dist-electron','ui-automation-followup.mjs')
try{
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'))
  for(const name of ['completed.json','failed.json'])fs.rmSync(path.join(output,name),{force:true})
  await build({entryPoints:[path.join(project,'scripts/ui-automation-followup-entry.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_NATIVE_PROJECT:project,NAVORA_DATA_ROOT:path.join(temporary,'profile'),NAVORA_UI_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:temporary,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Followup UI deadline exceeded'))},120000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
  if(code!==0)throw Error('Followup UI fixture failed: '+code)
  const report=JSON.parse(fs.readFileSync(path.join(output,'completed.json'),'utf8'))
  if(report.ok!==true)throw Error('Followup UI fixture did not confirm success')
  console.log(`Followup UI: ${report.checks.length} checks passed; screenshots: ${output}`)
}finally{
  fs.rmSync(entry,{force:true})
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-followup-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe fixture cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:250})
}
