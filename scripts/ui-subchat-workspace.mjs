import {build} from 'esbuild'
import {createServer} from 'vite'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root=process.cwd(),require=createRequire(import.meta.url),output=path.resolve(process.env.NAVORA_UI_OUTPUT||'../_planning/subchat-workspace-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-subchat-ui-')),entry=path.join(output,'entry.mjs')
let server
try{
  fs.mkdirSync(output,{recursive:true})
  server=await createServer({cacheDir:path.join(output,'vite-cache'),optimizeDeps:{entries:['scripts/fixtures/subchat-workspace.renderer.mts']},server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'subchat-probe',configureServer(vite){vite.middlewares.use('/__subchat_probe',async(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml('/__subchat_probe','<html><head><style>:root{--navora-surface:#fff;--navora-ink:#263342;--navora-muted:#697587;--navora-stroke:#dce2e8;--navora-accent:#477591;--control-selected:#e8eff4;--control-hover:#f2f5f8}body{margin:0}#app{height:100vh}</style></head><body><div id="app"></div><script type="module" src="/scripts/fixtures/subchat-workspace.renderer.mts"></script></body></html>'))})}}]});await server.listen()
  await build({entryPoints:['scripts/ui-subchat-workspace-entry.ts'],outfile:entry,platform:'node',target:'node20',format:'esm',bundle:true,external:['electron']})
  const address=server.httpServer.address(),env={...process.env,NAVORA_UI_OUTPUT:output,NAVORA_DATA_ROOT:profile,NAVORA_SUBCHAT_URL:`http://127.0.0.1:${address.port}/__subchat_probe`};delete env.ELECTRON_RUN_AS_NODE
  const status=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Subchat UI checks timed out'))},120000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})});process.exitCode=Number(status)
}finally{
  await server?.close()
  const relative=path.relative(os.tmpdir(),profile);if(!relative.startsWith('navora-subchat-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolated profile path')
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
