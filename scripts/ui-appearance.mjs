import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(import.meta.url)
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-appearance-'))
const output=path.resolve(process.env.NAVORA_UI_OUTPUT||path.join(root,'release','ui-appearance'))
fs.mkdirSync(output,{recursive:true})
const entry=path.join(root,'dist-electron','ui-appearance.mjs')
await build({entryPoints:[path.join(root,'scripts/ui-appearance-entry.ts')],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true})
const timer=setTimeout(()=>child.kill(),60000)
child.on('exit',code=>{clearTimeout(timer);fs.rmSync(entry,{force:true});process.exitCode=code??1})
