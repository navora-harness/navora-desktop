import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { electronRuntimeRelease } from './electron-runtime-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const executable = process.env.NAVORA_ELECTRON_EXECUTABLE || require('electron')
if (!path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('Electron smoke requires an existing absolute executable path')
if (electronRuntimeRelease(executable) !== '45.0.0-cloudbypass.11') throw new Error('Browser smoke requires the customized .11 runtime')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-browser-smoke-'))
const entry = path.join(temporary, 'smoke.mjs')
try {
  await build({entryPoints:[path.join(root, 'scripts/browser-smoke-entry.ts')],outfile:entry,
    bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],
    banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},
  })
  const env = {...process.env, NAVORA_SMOKE_ROOT:temporary}
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, [entry], {cwd:root,env,stdio:'inherit',windowsHide:true})
    let expired=false
    const timer = setTimeout(() => { expired=true;child.kill() }, 60000)
    child.on('error', (error) => {clearTimeout(timer); reject(error)})
    child.on('exit', (status) => {clearTimeout(timer);expired?reject(new Error('Browser smoke exceeded 60 seconds')):resolve(status ?? 1)})
  })
  process.exitCode = Number(code)
  if(code===0){
    const report=JSON.parse(fs.readFileSync(path.join(temporary,'result.json'),'utf8'))
    if(report.ok!==true||report.cleanupComplete!==true)throw Error('Browser smoke exited without completing verification and cleanup')
    console.log(JSON.stringify(report))
  }
} finally {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary))
  if (!relative.startsWith('navora-browser-smoke-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
    throw new Error('Unsafe smoke cleanup path')
  }
  fs.rmSync(temporary, {recursive:true,force:true,maxRetries:10,retryDelay:250})
}
