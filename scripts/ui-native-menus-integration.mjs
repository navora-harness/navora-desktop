import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-native-menu-main-')),output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'..','_planning','native-menu-main-integration')),entry=path.join(temporary,'entry.mjs')
try{
 if(!fs.existsSync(path.join(root,'dist-electron','main.js')))throw Error('Build the application first; this runner does not alter production bundles.')
 fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'),{recursive:true});for(const name of ['completed.json','failure.json','process-stdout.log','process-stderr.log'])fs.rmSync(path.join(output,name),{force:true})
 await build({entryPoints:[path.join(root,'scripts/ui-native-menus-integration-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
 const env={...process.env,NAVORA_NATIVE_MENU_PROJECT:root,NAVORA_DATA_ROOT:path.join(temporary,'profile'),NAVORA_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
 process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:temporary,env,stdio:['ignore','pipe','pipe'],windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Native menu integration exceeded its deadline'))},120000);for(const [stream,target,name]of [[child.stdout,process.stdout,'process-stdout.log'],[child.stderr,process.stderr,'process-stderr.log']])stream.on('data',chunk=>{target.write(chunk);fs.appendFileSync(path.join(output,name),chunk)});child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
 if(process.exitCode===0&&!fs.existsSync(path.join(output,'completed.json')))throw Error('Application exited without its integration report.')
}finally{const relative=path.relative(os.tmpdir(),temporary);if(!relative.startsWith('navora-native-menu-main-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolated native-menu cleanup');fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
