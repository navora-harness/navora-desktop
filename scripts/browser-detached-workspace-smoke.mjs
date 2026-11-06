import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(root,'package.json')),{build}=require('esbuild'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-detached-workspace-')),profile=path.join(temporary,'profile'),entry=path.join(temporary,'entry.mjs'),preload=path.join(temporary,'preload.cjs'),output=path.resolve(root,'../_planning/detached-workspace-backend')
fs.mkdirSync(profile);fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(preload,`const{contextBridge,ipcRenderer}=require('electron');const transfers=[];let ack='auto';contextBridge.exposeInMainWorld('fixture',{invoke:(name,...args)=>ipcRenderer.invoke(name,...args),transfers:()=>transfers,ack:value=>{ack=value},complete:(id,error)=>ipcRenderer.invoke('navora:file-tabs.completeTransfer',id,error)});ipcRenderer.on('navora:file-tabs.transfer',(_event,value)=>{transfers.push(value);if(value.requestId&&ack!=='hold')ipcRenderer.invoke('navora:file-tabs.completeTransfer',value.requestId,ack==='fail'?'fixture-rejected':undefined)});`)
try{
  await build({entryPoints:[path.join(root,'scripts/browser-detached-workspace-smoke.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_MIXED_PROFILE:profile,NAVORA_MIXED_PRELOAD:preload,NAVORA_MIXED_OUTPUT:output};for(const key of ['ELECTRON_RUN_AS_NODE','VITE_DEV_SERVER_URL','NODE_OPTIONS'])delete env[key]
  const code=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['--no-sandbox',entry],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Detached workspace smoke deadline'))},55000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})});assert.equal(code,0)
}finally{const resolved=fs.realpathSync(temporary);assert.equal(path.dirname(resolved).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('navora-detached-workspace-'));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:200})}
