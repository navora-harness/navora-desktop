import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? collect(file) : entry.name.endsWith('.test.ts') ? [file] : []
  })
}
const filters = process.argv.slice(2)
const entries = ['shared', 'electron/modules'].flatMap((dir) => collect(path.join(root, dir)))
  .filter(file => !filters.length || filters.some(filter => path.basename(file).includes(filter)))
if (!entries.length) throw new Error('No tests found')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-tests-'))
try {
  const result = await build({
    entryPoints: entries,
    outbase: root,
    outdir: tempRoot,
    outExtension: { '.js': '.mjs' },
    platform: 'node',
    target: 'node20',
    format: 'esm',
    bundle: true,
    sourcemap: 'inline',
    metafile: true,
    plugins: [{
      name: 'node-unit-native-boundary',
      setup(builder) {
        // Pure helpers can share a module with native code. Drop only an unused
        // Electron import after tree shaking; actual native calls remain external.
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', external: true, sideEffects: false }))
      },
    }],
    logLevel: 'warning',
  })
  const output = Object.keys(result.metafile.outputs).filter((file) => file.endsWith('.mjs'))
  const run = spawnSync(process.execPath, ['--test', ...output], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} finally {
  // Only remove the newly-created test directory inside the system temp folder.
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(tempRoot))
  if (!relative.startsWith('navora-tests-') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('Unsafe test cleanup path')
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
