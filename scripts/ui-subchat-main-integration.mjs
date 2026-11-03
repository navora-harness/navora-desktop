import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-subchat-main-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'..','_planning','subchat-main-integration')),entry=path.join(output,'entry.mjs')
let server
try{
  if(!fs.existsSync(path.join(root,'dist-electron','main.js')))throw Error('Build the main process first; this runner never modifies production builds.')
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'),{recursive:true});for(const name of ['completed.json','failed.json','failure.png','process-stdout.log','process-stderr.log'])fs.rmSync(path.join(output,name),{force:true})
  await build({entryPoints:[path.join(root,'scripts/ui-subchat-main-integration-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_SUBCHAT_PROJECT:root,NAVORA_DATA_ROOT:path.join(temporary,'profile'),NAVORA_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  if(process.env.NAVORA_SUBCHAT_RENDERER==='source'){const {createServer}=await import('vite');server=await createServer({root,cacheDir:path.join(output,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await server.listen();env.VITE_DEV_SERVER_URL=`http://127.0.0.1:${server.httpServer.address().port}/`}
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Subchat main integration exceeded its deadline'))},150000);for(const [stream,target,name]of [[child.stdout,process.stdout,'process-stdout.log'],[child.stderr,process.stderr,'process-stderr.log']])stream.on('data',chunk=>{target.write(chunk);fs.appendFileSync(path.join(output,name),chunk)});child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
  if(process.exitCode===0&&!fs.existsSync(path.join(output,'completed.json')))throw Error('Application exited without completing its isolated integration checks.')
}finally{await server?.close();const relative=path.relative(os.tmpdir(),temporary);if(!relative.startsWith('navora-subchat-main-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolated integration cleanup');fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
