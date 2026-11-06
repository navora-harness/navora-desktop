import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-browser-presentation-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'..','_planning','browser-presentation-current')),entry=path.join(temporary,'entry.mjs')
try{
  if(!fs.existsSync(path.join(project,'dist-electron','main.js')))throw Error('Build the application first. This runner never changes production builds.')
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'),{recursive:true})
  for(const name of ['completed.json','failed.json','stdout.log','stderr.log'])fs.rmSync(path.join(output,name),{force:true})
  await build({entryPoints:[path.join(project,'scripts/ui-browser-presentation-entry.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_NATIVE_PROJECT:project,NAVORA_DATA_ROOT:path.join(temporary,'profile'),NAVORA_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:temporary,env,stdio:['ignore','pipe','pipe'],windowsHide:true}),timeout=setTimeout(()=>{child.kill();reject(Error('Browser presentation panel fixture exceeded its deadline'))},150000)
    for(const [stream,target,name]of [[child.stdout,process.stdout,'stdout.log'],[child.stderr,process.stderr,'stderr.log']])stream.on('data',chunk=>{target.write(chunk);fs.appendFileSync(path.join(output,name),chunk)})
    child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('exit',code=>{clearTimeout(timeout);resolve(code??1)})
  })
  if(process.exitCode===0&&!fs.existsSync(path.join(output,'completed.json')))throw Error('Browser presentation fixture exited without a report')
}finally{
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-browser-presentation-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe temporary browser-presentation cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:250})
}
