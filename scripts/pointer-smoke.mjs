import {build} from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {electronRuntimeRelease} from './electron-runtime-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const override = process.env.NAVORA_POINTER_ELECTRON
if (override && (!path.isAbsolute(override) || !fs.statSync(override).isFile())) {
  throw new Error('NAVORA_POINTER_ELECTRON must name an existing absolute Electron executable')
}
const executable = override || require('electron')
const release = electronRuntimeRelease(executable)
if (release !== '45.0.0-cloudbypass.11') throw new Error(`Pointer smoke requires release 45.0.0-cloudbypass.11; found ${release}`)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-pointer-smoke-'))
try {
  const entry = path.join(temporary, 'pointer-smoke.mjs')
  await build({
    entryPoints: [path.join(root, 'scripts/pointer-smoke-entry.ts')], outfile: entry,
    bundle: true, platform: 'node', target: 'node20', format: 'esm', external: ['electron'],
    banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},
  })
  const env = {...process.env, NAVORA_POINTER_SMOKE_ROOT: temporary, NAVORA_POINTER_SMOKE_RELEASE: release}
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(executable, [entry], {cwd: root, env, stdio: 'inherit', windowsHide: true})
    let expired = false
    const timer = setTimeout(() => { expired = true; child.kill() }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => {
      clearTimeout(timer)
      expired ? reject(new Error('Pointer smoke exceeded 60 seconds')) : resolve(code ?? 1)
    })
  })
} finally {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary))
  if (!relative.startsWith('navora-pointer-smoke-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
    throw new Error('Unsafe pointer smoke cleanup path')
  }
  fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 250})
}
