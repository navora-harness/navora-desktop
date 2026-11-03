import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-layout-ui-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'..','_planning','responsive-sidebar-final')),entry=path.join(profile,'entry.mjs')
try{
  fs.mkdirSync(output,{recursive:true});fs.rmSync(path.join(output,'completed.json'),{force:true});fs.rmSync(path.join(output,'failure.json'),{force:true})
  await build({entryPoints:[path.join(project,'scripts/ui-responsive-sidebar-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output,NAVORA_UI_PROJECT:project};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(createRequire(import.meta.url)('electron'),[entry],{cwd:project,env,stdio:'inherit',windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Responsive sidebar checks exceeded deadline'))},150000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
  if(!process.exitCode&&!fs.existsSync(path.join(output,'completed.json')))throw Error('Application exited without completing checks')
}finally{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(profile));if(!relative.startsWith('navora-layout-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe layout fixture cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200})}
