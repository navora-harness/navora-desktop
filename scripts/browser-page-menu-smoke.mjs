import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-page-menu-')),require=createRequire(import.meta.url)
try{
  const entry=path.join(root,'entry.mjs')
  await build({entryPoints:[path.join(project,'scripts/browser-page-menu-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_PAGE_MENU_ROOT:root};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:project,env,stdio:'inherit',windowsHide:true}),deadline=setTimeout(()=>{child.kill();reject(Error('Isolated page menu verification deadline'))},60000);child.once('error',error=>{clearTimeout(deadline);reject(error)});child.once('exit',code=>{clearTimeout(deadline);resolve(code??1)})})
}finally{
  const relative=path.relative(os.tmpdir(),root)
  if(!relative.startsWith('navora-page-menu-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe fixture cleanup')
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
