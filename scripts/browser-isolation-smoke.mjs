import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(import.meta.url)
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-isolation-smoke-'))
const output=path.resolve(process.env.NAVORA_ISOLATION_OUTPUT||path.join(root,'release','browser-isolation'))
fs.mkdirSync(output,{recursive:true})
try {
  const entry=path.join(temporary,'isolation.mjs')
  await build({entryPoints:[path.join(root,'scripts/browser-isolation-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_ISOLATION_PROFILE:temporary,NAVORA_ISOLATION_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Browser isolation smoke exceeded 60 seconds'))},60000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
} finally {
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-isolation-smoke-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolation fixture cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
