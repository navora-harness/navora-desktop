import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

await esbuild.build({
  entryPoints: {
    main: path.join(root, 'electron/main.ts'),
    preload: path.join(root, 'electron/preload.ts'),
  },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: path.join(root, 'dist-electron'),
  external: ['electron'],
  sourcemap: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
})

const promptMdSrc = path.join(root, 'shared', 'plugin-dev-prompt.md')
const promptMdDst = path.join(root, 'dist-electron', 'plugin-dev-prompt.md')
if (fs.existsSync(promptMdSrc)) {
  fs.copyFileSync(promptMdSrc, promptMdDst)
}

const assetsSrc = path.join(root, 'electron', 'assets')
const assetsDst = path.join(root, 'dist-electron', 'assets')
if (fs.existsSync(assetsSrc)) {
  fs.mkdirSync(assetsDst, { recursive: true })
  for (const name of fs.readdirSync(assetsSrc)) {
    fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsDst, name))
  }
}

/**
 * Product build ships with NO plugins by default.
 * Optional in-repo seeds only: electron/plugins/<id>/
 * (../navora-plugins is for authoring / manual import — use navora-plugin-sdk CLI.)
 *
 * Set NAVORA_BUNDLE_PLUGINS=1 to also pack electron/plugins into
 * dist-electron/bundled-plugins/ (still never auto-packs navora-plugins).
 */
const bundledOutRoot = path.join(root, 'dist-electron', 'bundled-plugins')
if (fs.existsSync(bundledOutRoot)) {
  fs.rmSync(bundledOutRoot, { recursive: true, force: true })
}

const bundleProductPlugins = process.env.NAVORA_BUNDLE_PLUGINS === '1'
if (bundleProductPlugins) {
  const pluginsSrcRoot = path.join(root, 'electron', 'plugins')
  fs.mkdirSync(bundledOutRoot, { recursive: true })
  if (fs.existsSync(pluginsSrcRoot)) {
    const pluginDirs = fs.readdirSync(pluginsSrcRoot).filter((name) => {
      const dir = path.join(pluginsSrcRoot, name)
      return (
        fs.statSync(dir).isDirectory() &&
        fs.existsSync(path.join(dir, 'plugin.json')) &&
        (fs.existsSync(path.join(dir, 'main.ts')) || fs.existsSync(path.join(dir, 'main.js')))
      )
    })
    for (const id of pluginDirs) {
      const dir = path.join(pluginsSrcRoot, id)
      const entryTs = path.join(dir, 'main.ts')
      const entryJs = path.join(dir, 'main.js')
      const entry = fs.existsSync(entryTs) ? entryTs : entryJs
      const outDir = path.join(bundledOutRoot, id)
      fs.mkdirSync(outDir, { recursive: true })
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile: path.join(outDir, 'main.cjs'),
        external: ['electron'],
        sourcemap: true,
        footer: {
          js: 'if (module.exports && module.exports.default) module.exports = module.exports.default;',
        },
      })
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8').replace(/^\uFEFF/, ''),
      )
      manifest.main = 'main.cjs'
      fs.writeFileSync(path.join(outDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
      console.log(`plugin bundled → bundled-plugins/${id}/`)
    }
  }
} else {
  console.log('product plugins: none (default; set NAVORA_BUNDLE_PLUGINS=1 to pack electron/plugins)')
}

console.log('electron build ok → dist-electron/')
