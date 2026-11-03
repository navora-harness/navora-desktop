import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-plugin-platform-'))
try {
  let catalogUrl = process.env.NAVORA_SMOKE_CATALOG_URL
  if (!catalogUrl) {
    const { ingestIncoming } = await import(pathToFileURL(path.resolve(root, '../navora-store/src/ingest.js')).href)
    const catalogRoot = path.join(temporary, 'store')
    fs.mkdirSync(path.join(catalogRoot, 'incoming'), { recursive: true })
    for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']) {
      const name = `fastls-0.1.0-${target}-plugin.zip`
      fs.copyFileSync(path.resolve(root, '../navora-plugins/dist', name), path.join(catalogRoot, 'incoming', name))
    }
    const published = ingestIncoming({ root: catalogRoot })
    if (published.errors.length || published.published.length !== 5) throw new Error(`test_catalog_failed:${JSON.stringify(published.errors)}`)
    catalogUrl = path.join(catalogRoot, 'catalog')
  }
  const entry = path.join(temporary, 'smoke.mjs')
  await build({ entryPoints: [path.join(root, 'scripts/plugin-platform-smoke-entry.ts')], outfile: entry, bundle: true,
    platform: 'node', target: 'node20', format: 'esm', external: ['electron'],
    banner: { js: "import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);" } })
  const env = { ...process.env, NAVORA_SMOKE_ROOT: temporary, NAVORA_SMOKE_PROJECT: path.resolve(root, '../navora-plugins/fastls'), NAVORA_SMOKE_CATALOG: catalogUrl }
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [entry], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Plugin platform smoke timed out')) }, 60_000)
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('exit', code => { clearTimeout(timer); resolve(code ?? 1) })
  })
} finally {
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary))
  if (!rel.startsWith('navora-plugin-platform-') || rel.includes(path.sep) || path.isAbsolute(rel)) throw new Error('unsafe_smoke_cleanup')
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
