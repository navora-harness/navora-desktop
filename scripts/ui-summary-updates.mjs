import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-summary-updates-'))
const output = path.resolve(process.env.NAVORA_UI_OUTPUT || path.join(project, 'release/ui-summary-updates'))
const entry = path.join(project, 'dist-electron/ui-summary-updates.mjs')
fs.mkdirSync(output, { recursive: true })
try {
  await build({ entryPoints: [path.join(project, 'scripts/ui-summary-updates-entry.ts')], outfile: entry,
    bundle: true, platform: 'node', target: 'node20', format: 'esm', external: ['electron'],
    banner: { js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);" } })
  fs.rmSync(path.join(output, 'completed.json'), { force: true })
  const env = { ...process.env, NAVORA_DATA_ROOT: profile, NAVORA_UI_OUTPUT: output }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const status = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [entry], { cwd: project, env, stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(Error('Summary update UI check timed out')) }, 90000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1) })
  })
  process.exitCode = Number(status)
  if (!process.exitCode && !fs.existsSync(path.join(output, 'completed.json'))) throw Error('Summary UI exited before completion')
} finally {
  fs.rmSync(entry, { force: true })
  const resolved = fs.realpathSync(profile), tempRoot = fs.realpathSync(os.tmpdir())
  if (path.dirname(resolved).toLowerCase() !== tempRoot.toLowerCase() || !path.basename(resolved).startsWith('navora-summary-updates-')) throw Error('Unsafe fixture profile cleanup path')
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
