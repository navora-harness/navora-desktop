import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-file-selection-ui-'))
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
try{
  await server.listen();const address=server.httpServer.address(),port=typeof address==='object'&&address?address.port:0
  const env={...process.env,NAVORA_FILE_SELECTION_URL:`http://127.0.0.1:${port}/scripts/fixtures/file-manager-selection.html`,NAVORA_FILE_SELECTION_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['--no-sandbox',path.join(root,'scripts/ui-file-manager-selection-entry.cjs')],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('File manager selection verification deadline'))},90000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})})
}finally{await server.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(profile));if(!relative.startsWith('navora-file-selection-ui-')||path.isAbsolute(relative)||relative.includes(path.sep))throw Error('Unsafe fixture cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
