import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.resolve(process.env.NAVORA_CURSOR_OUTPUT||path.join(root,'release','cursor-visibility'))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navora-cursor-visibility-'))
fs.mkdirSync(output,{recursive:true})
try {
  const entry=path.join(temporary,'cursor.mjs')
  await build({entryPoints:[path.join(root,'scripts/browser-cursor-visibility-smoke-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  const env={...process.env,NAVORA_CURSOR_PROFILE:temporary,NAVORA_CURSOR_OUTPUT:output}
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(createRequire(import.meta.url)('electron'),['--no-sandbox',entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
    const timer=setTimeout(()=>{child.kill();reject(Error('Cursor visibility smoke exceeded 60 seconds'))},60000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})
  })
} finally {
  const relative=path.relative(os.tmpdir(),temporary)
  if(!relative.startsWith('navora-cursor-visibility-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe cursor fixture cleanup')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250})
}
