import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-ui-find-integration-')),entry=path.join(temporary,'entry.mjs')
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'..','_planning','conversation-find-diagnostic','baseline'))
let server
try{
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'),{recursive:true})
  await build({entryPoints:[path.join(root,'scripts/ui-conversation-find-integration-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_FIND_PROJECT:root,NAVORA_DATA_ROOT:path.join(temporary,'profile'),NAVORA_UI_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  if(process.env.NAVORA_FIND_RENDERER==='source'){
    const {createServer}=await import('vite');server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
    await server.listen();const address=server.httpServer.address();env.VITE_DEV_SERVER_URL=`http://127.0.0.1:${address.port}/`
  }
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Conversation find integration exceeded its deadline'))},120000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
}finally{
  await server?.close();const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-ui-find-integration-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe integration cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
