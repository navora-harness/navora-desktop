import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-outline-'))
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(project,'release/ui-outline-position'))
const entry=path.join(project,'dist-electron/ui-outline-position.mjs')
fs.mkdirSync(output,{recursive:true})
try{
  await build({entryPoints:[path.join(project,'scripts/ui-outline-position-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"},plugins:[{name:'matching-renovation-compositor',setup(builder){builder.onResolve({filter:/^electron$/},args=>args.importer.replaceAll('\\','/').endsWith('/electron/main.ts')?{path:'outline-electron',namespace:'outline'}:undefined);builder.onLoad({filter:/.*/,namespace:'outline'},()=>({contents:"export * from 'electron';import {BrowserWindow as Native} from 'electron';export class BrowserWindow extends Native{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}})}}",loader:'js'}))}}]})
  for(const reduced of [false,true]){
    const data=path.join(profile,reduced?'reduced':'normal'),images=reduced?path.join(output,'reduced-motion'):output
    fs.mkdirSync(data,{recursive:true});fs.mkdirSync(images,{recursive:true})
    const env={...process.env,NAVORA_DATA_ROOT:data,NAVORA_UI_OUTPUT:images,NAVORA_UI_REDUCED_MOTION:reduced?'1':'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
    process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:project,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Outline UI timed out'))},60000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
    if(process.exitCode)break
  }
}finally{
  fs.rmSync(entry,{force:true});const resolved=fs.realpathSync(profile),tmp=fs.realpathSync(os.tmpdir());if(path.dirname(resolved).toLowerCase()!==tmp.toLowerCase()||!path.basename(resolved).startsWith('navora-outline-'))throw Error('Unsafe outline fixture cleanup');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
