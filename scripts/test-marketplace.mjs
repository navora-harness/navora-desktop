import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-marketplace-tests-'))
try {
  const file = path.join(temp, 'marketplace.mjs')
  await build({
    entryPoints: [path.join(root, 'scripts/marketplace-test-entry.ts')], outfile: file,
    platform: 'node', target: 'node20', format: 'esm', bundle: true,
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{ name: 'test-app-version', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'app', namespace: 'test-electron' }))
      builder.onLoad({ filter: /.*/, namespace: 'test-electron' }, () => ({ contents: "export const app = {getVersion: () => '1.5.0'}" }))
    } }],
  })
  const run = spawnSync(process.execPath, ['--test', file], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} finally {
  const rel = path.relative(os.tmpdir(), temp)
  if (!rel.startsWith('navora-marketplace-tests-') || rel.includes(path.sep) || path.isAbsolute(rel)) throw new Error('unsafe_cleanup_path')
  fs.rmSync(temp, { recursive: true, force: true })
}
