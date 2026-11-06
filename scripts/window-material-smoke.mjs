import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-window-material-'))
const artifact=path.join(root,'artifacts','window-material-smoke','first-show')
try{
  const entry=path.join(temporary,'entry.mjs')
  await build({entryPoints:[path.join(root,'scripts/window-material-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"}})
  await build({entryPoints:[path.join(root,'scripts/window-material-smoke-preload.ts')],outfile:path.join(temporary,'preload.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']})
  await build({entryPoints:[path.join(root,'scripts/window-material-smoke-renderer.mjs')],outfile:path.join(temporary,'renderer.js'),bundle:true,platform:'browser',format:'esm',alias:{'@shared':path.join(root,'shared')},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'}})
  fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}.main-shell{height:100vh;display:grid}.window-titlebar{grid-area:1/1/2/3;height:44px;display:flex;align-items:center;gap:28px;padding:0 16px}.activity-rail{gap:32px;padding-top:16px!important}.main,.sidebar{padding:20px}.main{display:block!important}button,input{font:inherit;border:1px solid var(--appearance-stroke);border-radius:8px;padding:7px 12px;background:var(--appearance-surface);color:var(--appearance-ink)}.browser-host-page,.file-host-page{height:100vh;display:flex;flex-direction:column}.detached-window-bar{height:44px;flex:none;display:flex;gap:12px;align-items:center;padding:0 150px 0 10px}.browser-tab-toolbar{height:44px;padding:10px 18px;flex:none}.file-host-content,.guest-target{flex:1;padding:20px;background:var(--appearance-surface)}</style></head><body><div id="app"></div><script type="module" src="renderer.js"></script></body></html>`)
  const env={...process.env,NAVORA_MATERIAL_SMOKE_ROOT:temporary,NAVORA_MATERIAL_SMOKE_ARTIFACT:artifact};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Material smoke exceeded 60 seconds'))},60000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
}finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!/^navora-window-material-[^\\/]+$/u.test(relative))throw Error('Unsafe material smoke cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
