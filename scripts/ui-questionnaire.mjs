import {build} from 'esbuild'
import {createServer} from 'vite'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root=process.cwd(),require=createRequire(import.meta.url),output=path.resolve(process.env.NAVORA_UI_OUTPUT||'../_planning/questionnaire-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-questionnaire-ui-')),entry=path.join(output,'entry.mjs')
const extensions=process.env.NAVORA_QUESTIONNAIRE_EXTENSIONS==='1',fixture=extensions?'questionnaire-extensions.renderer.mts':'questionnaire.renderer.mts'
let server
try{
  fs.mkdirSync(output,{recursive:true})
  server=await createServer({cacheDir:path.join(output,'vite-cache'),optimizeDeps:{entries:['scripts/fixtures/'+fixture]},server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'questionnaire-probe',configureServer(vite){vite.middlewares.use('/__questionnaire_probe',async(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml('/__questionnaire_probe',`<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/scripts/fixtures/${fixture}"></script></body></html>`))})}}]});await server.listen()
  await build({entryPoints:[extensions?'scripts/ui-questionnaire-extensions-entry.ts':'scripts/ui-questionnaire-entry.ts'],outfile:entry,platform:'node',target:'node20',format:'esm',bundle:true,external:['electron']})
  if(extensions)await build({entryPoints:['scripts/ui-questionnaire-extensions-preload.ts'],outfile:path.join(output,'preload.cjs'),platform:'node',target:'node20',format:'cjs',bundle:true,external:['electron']})
  const address=server.httpServer.address(),env={...process.env,NAVORA_UI_OUTPUT:output,NAVORA_DATA_ROOT:profile,NAVORA_QUESTIONNAIRE_URL:`http://127.0.0.1:${address.port}/__questionnaire_probe`};delete env.ELECTRON_RUN_AS_NODE
  const status=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Questionnaire UI checks timed out'))},120000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})});process.exitCode=Number(status)
}finally{
  await server?.close()
  const relative=path.relative(os.tmpdir(),profile);if(!relative.startsWith('navora-questionnaire-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolated profile path')
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
