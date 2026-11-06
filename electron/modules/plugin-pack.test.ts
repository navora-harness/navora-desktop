import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { writeRuntimeInventory } from './plugin-package'

// Unit bundles have no product main banner. Supply its ordinary Node builtin
// require before initializing the actual bundled AdmZip; no product API is stubbed.
Object.defineProperty(globalThis, 'require', { value: createRequire(import.meta.url), configurable: true })
const { packPluginProject } = await import('./plugin-pack')
const AdmZip = createRequire(path.join(process.cwd(), 'package.json'))('adm-zip') as typeof import('adm-zip')

function fixture(t: { after: (fn: () => void) => void }, targets?: unknown[]) {
  const temporaryRoot = path.resolve(process.env.NAVORA_SDK_TEST_ROOT || os.tmpdir())
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'navora-desktop-pack-'))
  t.after(() => { assert.equal(path.dirname(root), temporaryRoot); fs.rmSync(root, { recursive: true, force: true }) })
  const project = path.join(root, 'fixture'), marker = path.join(root, 'entry-executed')
  fs.mkdirSync(project, { recursive: true })
  const author = { id: 'fixture', name: 'Fixture', version: '1.0.0', description: 'Isolated pack fixture', ...(targets ? { build: { targets } } : {}) }
  fs.writeFileSync(path.join(project, 'plugin.json'), JSON.stringify(author))
  function built(id = 'fixture', artifact?: { artifactId: string; target: unknown; runtime: unknown }, code?: string) {
    const dir = path.join(project, 'dist', id, ...(artifact ? [artifact.artifactId] : []))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ ...author, build: undefined, id, main: 'main.cjs', ...(artifact ? { packageFormatVersion: 2, ...artifact } : {}) }))
    fs.writeFileSync(path.join(dir, 'main.cjs'), code || `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); throw Error('entry must never run during pack');`)
    if (artifact) writeRuntimeInventory(dir)
    return dir
  }
  return { root, project, marker, author, built, pack: (extra = {}) => packPluginProject({ workspaceRoot: root, id: 'fixture', ...extra }) }
}
const portable = { artifactId: 'portable', target: { kind: 'portable' }, runtime: { kind: 'electron-main' } }

test('desktop legacy pack is static and does not refresh project assets into dist', t => {
  const f = fixture(t), dir = f.built()
  fs.writeFileSync(path.join(dir, 'README.md'), 'previously built documentation')
  fs.writeFileSync(path.join(f.project, 'README.md'), 'unbuilt documentation change')
  const result = f.pack()
  assert.equal(result.ok, true, result.ok ? undefined : result.error)
  assert.equal(fs.existsSync(f.marker), false)
  if (result.ok) {
    const zip = new AdmZip(result.zips[0].path)
    assert.equal(zip.readAsText('README.md'), 'previously built documentation')
    assert.ok(zip.getEntry('main.cjs'))
  }
})
test('desktop v2 pack refuses modified bytes and leaves the original inventory unchanged', t => {
  const f = fixture(t, [portable]), dir = f.built('fixture', portable)
  const inventory = fs.readFileSync(path.join(dir, 'runtime-files.json'))
  fs.appendFileSync(path.join(dir, 'main.cjs'), '\n// tampered')
  const result = f.pack({ target: 'portable', out: 'rejected.zip' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /runtime_file_size|runtime_hash_mismatch/)
  assert.deepEqual(fs.readFileSync(path.join(dir, 'runtime-files.json')), inventory)
  assert.equal(fs.existsSync(path.join(f.root, 'rejected.zip')), false)
  assert.equal(fs.existsSync(f.marker), false)
})
test('desktop v2 ZIP keeps all inventoried map/zip/package metadata and staged dependencies', t => {
  const f = fixture(t, [portable]), dir = f.built('fixture', portable, "require('fixture-dependency'); module.exports={}")
  const dep = path.join(dir, 'node_modules/fixture-dependency'); fs.mkdirSync(dep, { recursive: true })
  fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
  fs.writeFileSync(path.join(dep, 'index.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(f.marker)}, 'dependency executed')`)
  fs.writeFileSync(path.join(dir, 'runtime.map'), 'retained map'); fs.writeFileSync(path.join(dir, 'asset.zip'), 'retained runtime asset')
  writeRuntimeInventory(dir)
  const result = f.pack({ target: 'portable' }); assert.equal(result.ok, true, result.ok ? undefined : result.error)
  assert.equal(fs.existsSync(f.marker), false)
  if (result.ok) {
    const zip = new AdmZip(result.zips[0].path)
    for (const file of JSON.parse(zip.readAsText('runtime-files.json')).files) assert.ok(zip.getEntry(file.path), file.path)
  }
  assert.equal(f.pack({ target: 'portable', includeNodeModules: true }).ok, false)
})
test('desktop pack rejects a built target changed away from its author declaration', t => {
  const platform = { artifactId: 'linux-arm64', target: { kind: 'platform', os: 'linux', arch: 'arm64', linkage: 'static' }, runtime: { kind: 'electron-main' } }
  const f = fixture(t, [platform]), dir = f.built('fixture', platform)
  const manifestPath = path.join(dir, 'plugin.json'), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.target.arch = 'x64'; fs.writeFileSync(manifestPath, JSON.stringify(manifest)); writeRuntimeInventory(dir)
  const result = f.pack({ target: 'linux-arm64' }); assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, 'built_manifest_mismatch:target')
})
test('desktop multi-entry legacy pack preserves single packages and suite without executing members', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.project, 'plugin.json'), JSON.stringify({ ...f.author, suite: 'fixture', entries: [{ id: 'fixture-one', entry: 'one.ts' }, { id: 'fixture-two', entry: 'two.ts' }] }))
  f.built('fixture-one'); f.built('fixture-two')
  const result = f.pack(); assert.equal(result.ok, true, result.ok ? undefined : result.error)
  assert.equal(fs.existsSync(f.marker), false)
  if (result.ok) {
    assert.equal(result.zips.filter(z => z.kind === 'plugin').length, 2)
    const suite = result.zips.find(z => z.kind === 'suite')!
    const zip = new AdmZip(suite.path)
    assert.equal(JSON.parse(zip.readAsText('suite.json')).packages.length, 2)
    assert.ok(zip.getEntry('packages/fixture-one/main.cjs')); assert.ok(zip.getEntry('packages/fixture-two/main.cjs'))
  }
})
test('desktop static dependency check refuses missing, parent and dynamic loads', t => {
  const f = fixture(t), dir = f.built('fixture', undefined, "require('fixture-missing')")
  let result = f.pack(); assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /runtime_dependency_missing/)
  const parentDep = path.join(f.project, 'node_modules/fixture-missing'); fs.mkdirSync(parentDep, { recursive: true }); fs.writeFileSync(path.join(parentDep, 'index.js'), 'module.exports=1')
  result = f.pack(); assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /runtime_dependency_outside_package/)
  fs.writeFileSync(path.join(dir, 'main.cjs'), 'require(process.env.UNRESOLVED_MODULE)')
  result = f.pack(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, 'runtime_dependency_dynamic')
})
test('desktop static check follows contained imports, catches transitive dependencies and refuses native addons', t => {
  const f = fixture(t), dir = f.built('fixture', undefined, "import('./dependency.cjs')")
  fs.writeFileSync(path.join(dir, 'dependency.cjs'), "require('missing-transitive')")
  let result = f.pack(); assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /runtime_dependency_missing:missing-transitive/)
  fs.writeFileSync(path.join(dir, 'dependency.cjs'), "require('./addon.node')"); fs.writeFileSync(path.join(dir, 'addon.node'), 'never loaded')
  result = f.pack(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, 'native_runtime_unsupported')
  fs.writeFileSync(path.join(dir, 'dependency.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(f.marker)}, 'executed')`)
  assert.equal(f.pack().ok, true); assert.equal(fs.existsSync(f.marker), false)
})
test('desktop includeNodeModules never injects unverified project dependencies', t => {
  const f = fixture(t), dir = f.built('fixture', undefined, 'module.exports={}')
  fs.mkdirSync(path.join(f.project, 'node_modules/not-staged'), { recursive: true })
  fs.writeFileSync(path.join(f.project, 'node_modules/not-staged/index.js'), 'throw Error("not part of built package")')
  let result = f.pack({ includeNodeModules: true }); assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, 'runtime_dependencies_not_staged')
  fs.mkdirSync(path.join(dir, 'node_modules/staged'), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules/staged/index.js'), 'module.exports=1')
  result = f.pack({ includeNodeModules: true }); assert.equal(result.ok, true)
  if (result.ok) {
    const zip = new AdmZip(result.zips[0].path)
    assert.ok(zip.getEntry('node_modules/staged/index.js'))
    assert.equal(zip.getEntry('node_modules/not-staged/index.js'), null)
  }
})
