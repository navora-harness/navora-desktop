import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-settings-ui-'))
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
try{await server.listen();const address=server.httpServer.address(),port=typeof address==='object'&&address?address.port:0;const env={...process.env,NAVORA_SETTINGS_URL:`http://127.0.0.1:${port}/scripts/fixtures/settings-navigation.html`,NAVORA_SETTINGS_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;process.exitCode=await new Promise((resolve,reject)=>{const entry=process.env.NAVORA_SETTINGS_MATERIAL_ONLY==='1'?'ui-settings-material-entry.cjs':'ui-settings-navigation-entry.cjs';const child=spawn(require('electron'),['--force-device-scale-factor=1',path.join(root,'scripts',entry)],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Settings component verification deadline'))},90000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})})}finally{await server.close();const relative=path.relative(os.tmpdir(),profile);if(!relative.startsWith('navora-settings-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe fixture cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
