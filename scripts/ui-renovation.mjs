import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-ui-renovation-'))
const suite = process.env.NAVORA_UI_SUITE === 'browser-tree' ? 'ui-browser-tree' : process.env.NAVORA_UI_SUITE === 'main-window' ? 'ui-main-window' : process.env.NAVORA_UI_SUITE === 'interface' ? 'ui-interface' : process.env.NAVORA_UI_SUITE === 'browser-start' ? 'ui-browser-start' : process.env.NAVORA_UI_SUITE === 'browser-workspace' ? 'ui-browser-workspace' : process.env.NAVORA_UI_SUITE === 'creators' ? 'ui-creators' : process.env.NAVORA_UI_SUITE === 'plugins' ? 'ui-plugins' : 'ui-renovation'
const entry = path.join(root, 'dist-electron', suite+'.mjs')
const output = path.resolve(process.env.NAVORA_UI_OUTPUT || path.join(root, 'release', suite))
try {
  fs.mkdirSync(output, {recursive:true})
  await build({entryPoints:[path.join(root,`scripts/${suite}-entry.ts`)],outfile:entry,
    bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],
    banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},
    plugins:[{
      name:'hidden-ui-compositor',
      setup(builder) {
        builder.onResolve({filter:/^electron$/},(args) => {
          if(suite==='ui-browser-workspace'||suite==='ui-browser-start'||suite==='ui-main-window'||suite==='ui-browser-tree')return
          if(args.importer.replaceAll('\\','/').endsWith('/electron/main.ts')) return {path:'ui-electron',namespace:'ui-renovation'}
        })
        builder.onLoad({filter:/.*/,namespace:'ui-renovation'},() => ({contents:`
          export * from 'electron';
          import {BrowserWindow as NativeBrowserWindow} from 'electron';
          export class BrowserWindow extends NativeBrowserWindow {
            // Return a native instance: bundling can rename a subclass, which
            // excludes it from Electron's constructor-name window enumeration.
            constructor(options) {return new NativeBrowserWindow({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}})}
            static getAllWindows() {return NativeBrowserWindow.getAllWindows()}
            static getFocusedWindow() {return NativeBrowserWindow.getFocusedWindow()}
          }
        `,loader:'js'}))
      },
    }],
  })
  const motionModes = process.env.NAVORA_LIVE_CREATOR === '1' || process.env.NAVORA_UI_MOTION_MODE === 'normal' ? [false] : process.env.NAVORA_UI_MOTION_MODE === 'reduced' ? [true] : [false,true]
  for(const reduced of motionModes) {
    const images = reduced ? path.join(output,'reduced-motion') : output
    fs.mkdirSync(images,{recursive:true})
    fs.rmSync(path.join(images,'completed.json'),{force:true})
    const profile = path.join(temporary,reduced ? 'reduced-motion' : 'normal')
    fs.mkdirSync(profile,{recursive:true})
    const env = {...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:images,NAVORA_UI_REDUCED_MOTION:reduced ? '1' : '0'}
    delete env.ELECTRON_RUN_AS_NODE
    delete env.VITE_DEV_SERVER_URL
    const status = await new Promise((resolve,reject) => {
      const child = spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
      const timer = setTimeout(() => {child.kill();reject(new Error('UI smoke exceeded its deadline'))},process.env.NAVORA_LIVE_CREATOR === '1' ? 120000 : suite==='ui-renovation' ? 180000 : 90000)
      child.on('error',(error) => {clearTimeout(timer);reject(error)})
      child.on('exit',(code) => {clearTimeout(timer);resolve(code ?? 1)})
    })
    process.exitCode = Number(status)
    if(process.exitCode !== 0) break
    if(!fs.existsSync(path.join(images,'completed.json'))) throw new Error('UI process exited before completing checks: '+images)
  }
  console.log(`UI screenshots: ${output}`)
} finally {
  fs.rmSync(entry,{force:true})
  const relative = path.relative(path.resolve(os.tmpdir()),path.resolve(temporary))
  if (!relative.startsWith('navora-ui-renovation-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe UI cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
