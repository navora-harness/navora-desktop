import { build } from 'esbuild'
import fs from 'node:fs'
import ts from 'typescript'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// These are checked-in distribution copies of the same pure matching implementation.
for (const destination of ['../navora-plugin-sdk/lib/platform.mjs', '../navora-store/src/plugin-platform.js']) {
  await build({ entryPoints: [path.join(root, 'shared/plugin-platform.ts')], outfile: path.resolve(root, destination),
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    banner: { js: '// Generated from navora-desktop/shared/plugin-platform.ts; run scripts/sync-plugin-contract.mjs.' } })
}
const program = ts.createProgram([path.join(root, 'shared/plugin-platform.ts')], {
  declaration: true, emitDeclarationOnly: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true,
})
program.emit(undefined, (name, text) => {
  if (name.endsWith('plugin-platform.d.ts')) fs.writeFileSync(path.resolve(root, '../navora-plugin-sdk/lib/platform.d.mts'), text)
})
