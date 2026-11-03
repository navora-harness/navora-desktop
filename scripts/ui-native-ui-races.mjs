import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-native-ui-races-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'..','_planning','native-ui-source-races'))
const server=await createServer({root,cacheDir:path.join(temporary,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
try{await server.listen();const address=server.httpServer.address(),port=typeof address==='object'&&address?address.port:0,env={...process.env,NAVORA_NATIVE_RACE_URL:`http://127.0.0.1:${port}/scripts/fixtures/native-ui-races.html`,NAVORA_DATA_ROOT:temporary,NAVORA_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['--no-sandbox',path.join(root,'scripts/ui-native-ui-races-entry.cjs')],{cwd:temporary,env,stdio:'inherit',windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Native UI concurrency fixture deadline'))},30000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})}finally{await server.close();const relative=path.relative(os.tmpdir(),temporary);if(!relative.startsWith('navora-native-ui-races-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe native UI fixture cleanup');fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:200})}
