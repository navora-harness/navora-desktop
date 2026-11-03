import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-shortcuts-ui-')),entry=path.join(temporary,'ui-keyboard-shortcuts.mjs')
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'release','ui-keyboard-shortcuts'))
try{
  fs.mkdirSync(output,{recursive:true})
  fs.rmSync(path.join(output,'completed.json'),{force:true})
  await build({entryPoints:[path.join(root,'scripts/ui-keyboard-shortcuts-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_DATA_ROOT:temporary,NAVORA_UI_OUTPUT:output,NAVORA_UI_PROJECT:root};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Shortcut UI checks exceeded deadline'))},150000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
  process.exitCode=Number(status)
  if(!process.exitCode&&!fs.existsSync(path.join(output,'completed.json')))throw Error('UI process exited without completing checks')
}finally{
  fs.rmSync(entry,{force:true})
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if(!relative.startsWith('navora-shortcuts-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe shortcut UI cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
