import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-ui-smoke-'))
const entry = path.join(root, 'dist-electron', 'ui-smoke.mjs')
const output = path.resolve(process.env.NAVORA_UI_OUTPUT || path.join(root, 'release', 'ui-smoke'))
try {
  fs.mkdirSync(output, {recursive:true})
  await build({entryPoints:[path.join(root,'scripts/ui-smoke-entry.ts')],outfile:entry,
    bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],
    banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},
    plugins:[{
      name:'hidden-ui-compositor',
      setup(builder) {
        builder.onResolve({filter:/^electron$/},(args) => {
          if(args.importer.replaceAll('\\','/').endsWith('/electron/main.ts')) return {path:'ui-electron',namespace:'ui-smoke'}
        })
        builder.onLoad({filter:/.*/,namespace:'ui-smoke'},() => ({contents:`
          export * from 'electron';
          import {BrowserWindow as NativeBrowserWindow} from 'electron';
          export class BrowserWindow extends NativeBrowserWindow {
            constructor(options) {super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}})}
          }
        `,loader:'js'}))
      },
    }],
  })
  for(const reduced of [false,true]) {
    const images = reduced ? path.join(output,'reduced-motion') : output
    fs.mkdirSync(images,{recursive:true})
    const env = {...process.env,NAVORA_DATA_ROOT:temporary,NAVORA_UI_OUTPUT:images,NAVORA_UI_REDUCED_MOTION:reduced ? '1' : '0'}
    delete env.ELECTRON_RUN_AS_NODE
    delete env.VITE_DEV_SERVER_URL
    const status = await new Promise((resolve,reject) => {
      const child = spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
      const timer = setTimeout(() => {child.kill();reject(new Error('UI smoke exceeded 60 seconds'))},60000)
      child.on('error',(error) => {clearTimeout(timer);reject(error)})
      child.on('exit',(code) => {clearTimeout(timer);resolve(code ?? 1)})
    })
    process.exitCode = Number(status)
    if(process.exitCode !== 0) break
  }
  console.log(`UI screenshots: ${output}`)
} finally {
  fs.rmSync(entry,{force:true})
  const relative = path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if (!relative.startsWith('navora-ui-smoke-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe UI cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
