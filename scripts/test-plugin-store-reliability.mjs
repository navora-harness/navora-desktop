import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'

// The real store/transaction run against synthetic packages. Only Electron's
// application identity is replaced; no personal profile or marketplace is read.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-store-reliability-'))
let store
let checks = 0
function check(fn) { fn(); checks++ }
try {
  const output = path.join(temp, 'store.mjs')
  await build({ entryPoints: [path.join(project, 'electron/modules/plugin-store.ts')], outfile: output, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'warning', banner: { js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);" },
    plugins: [{ name: 'synthetic-electron', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const net={},desktopCapturer={},screen={},session={},BrowserWindow=class {};export const app={getVersion:()=> '0.4.12',getAppPath:()=>${JSON.stringify(path.join(temp, 'no-bundles'))}}`, loader: 'js' }))
    } }] })
  const { PluginStore } = await import(pathToFileURL(output).href)
  const data = path.join(temp, 'data')
  store = new PluginStore(data)
  const valid = `module.exports={tools:[{type:'function',function:{name:'sample_tool',description:'fixture',parameters:{type:'object',properties:{}}}}],planPermissions(){return {capabilities:['compute.local']}},async execute(){return global.__navoraStoreFixture?.() ?? {ok:true}}}`
  function pkg(name, id = 'sample', options = {}) {
    const dir = path.join(temp, name); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id, name: id, version: options.version || '1', main: 'main.cjs', ...(options.suite ? { suite: options.suite } : {}) }))
    fs.writeFileSync(path.join(dir, 'main.cjs'), options.invalid ? 'module.exports={}' : valid)
    return dir
  }
  function zip(dir, name) { const file = path.join(temp, `${name}.zip`); const z = new AdmZip(); z.addLocalFolder(dir); z.writeZip(file); return file }
  const first = pkg('first', 'sample', { suite: 'example-suite' })
  assert.equal((await store.importFromPath(zip(first, 'first'))).ok, true)
  assert.equal(store.setEnabled('sample', false).ok, true)
  const before = JSON.stringify(store.list())
  const bad = pkg('bad', 'sample', { invalid: true, version: '2', suite: 'example-suite' })
  check(() => assert.equal(store.get('sample').enabled, false))
  assert.equal((await store.importFromPath(bad, { overwrite: true })).ok, false)
  check(() => assert.equal(JSON.stringify(store.list()), before))
  check(() => assert.ok(fs.existsSync(path.join(data, 'plugins/sample/main.cjs'))))
  assert.equal((await store.importFromPath(zip(bad, 'bad'), { overwrite: true })).ok, false)
  check(() => assert.equal(JSON.stringify(store.list()), before))
  const badSibling = pkg('bad-sibling', 'other', { invalid: true, suite: 'example-suite' })
  assert.equal((await store.importFromPath(badSibling, { replaceSuite: true })).ok, false)
  check(() => assert.equal(JSON.stringify(store.list()), before))
  const linked = pkg('linked', 'sample', { version: '3', suite: 'example-suite' })
  assert.equal((await store.importFromPath(linked, { overwrite: true })).ok, true)
  check(() => assert.equal(store.get('sample').kind, 'linked'))
  check(() => assert.equal(store.get('sample').enabled, false))
  assert.equal((await store.importFromPath(zip(bad, 'bad-again'), { overwrite: true })).ok, false)
  check(() => assert.equal(store.get('sample').path, linked))
  check(() => assert.ok(fs.existsSync(path.join(linked, 'main.cjs'))))
  // Candidate activation may fail after the initial successful health check.
  const late = pkg('late', 'sample', { version: '4', suite: 'example-suite' })
  fs.writeFileSync(path.join(late, 'main.cjs'), `if(global.__lateLoads=(global.__lateLoads||0)+1,global.__lateLoads>1)throw Error('late_load_failure');${valid}`)
  assert.equal((await store.importFromPath(late, { overwrite: true })).error, 'late_load_failure')
  check(() => assert.equal(store.get('sample').path, linked))
  check(() => assert.equal(store.get('sample').enabled, false))
  check(() => assert.ok(fs.existsSync(path.join(linked, 'main.cjs')) && fs.existsSync(path.join(late, 'main.cjs'))))
  const session = pkg('session', 'session-plugin', { suite: 'example-suite' })
  assert.equal(store.linkSessionPlugin('scope', session).ok, true)
  const sessionBefore = JSON.stringify(store.listSessionPlugins('scope'))
  const badSession = pkg('bad-session', 'session-plugin', { invalid: true })
  check(() => assert.equal(store.linkSessionPlugin('scope', badSession).ok, false))
  check(() => assert.equal(JSON.stringify(store.listSessionPlugins('scope')), sessionBefore))
  fs.writeFileSync(path.join(session, 'main.cjs'), 'module.exports={}')
  store.reloadSessionDir(session)
  check(() => assert.equal(JSON.stringify(store.listSessionPlugins('scope')), sessionBefore))
  // Progress callbacks can reenter IPC-like store mutations synchronously.
  const next = pkg('next', 'sample', { version: '5', suite: 'example-suite' })
  let reentry
  assert.equal((await store.importFromPath(next, { overwrite: true, onProgress() { reentry = store.remove('sample') } })).ok, true)
  check(() => assert.equal(reentry.error, 'plugin_busy'))
  check(() => assert.equal(store.get('sample').version, '5'))
  // Model permissions can be pending while an update happens. Old code must
  // not execute after approval eventually resolves.
  store.setEnabled('sample', true)
  let approve
  const approved = new Promise(r => { approve = r })
  const ctx = { chatId: 'scope2', pluginScopeChatId: 'scope2', signal: new AbortController().signal,
    registry: { getTree: () => [] }, gate: { check: async () => { await approved; return { ok: true } } }, getConfig: () => ({ browser: { url_allowlist: [] } }) }
  let oldExecuted = false
  global.__navoraStoreFixture = () => { oldExecuted = true; return { ok: true } }
  const pending = store.execute('sample_tool', {}, ctx)
  assert.equal(store.remove('sample').ok, true)
  approve()
  check(() => assert.equal(oldExecuted, false))
  const pendingResult = await pending
  check(() => assert.equal(pendingResult?.error, 'plugin_no_longer_active'))
  // Active JS execution, not just sidecar processes, also prevents replacement.
  assert.equal((await store.importFromPath(next)).ok, true)
  let finish
  global.__navoraStoreFixture = () => new Promise(r => { finish = r })
  const running = store.execute('sample_tool', {}, { ...ctx, pluginApprovedCapabilities: ['compute.local'] })
  check(() => assert.equal(store.remove('sample').error, 'plugin_busy'))
  check(() => assert.deepEqual(store.removeMany(['sample']), { removed: [], failed: ['sample'] }))
  check(() => assert.equal(store.linkSessionPlugin('scope3', next).error, 'plugin_busy'))
  check(() => assert.equal(store.exportToZip('sample', path.join(temp, 'active.zip')).error, 'plugin_busy'))
  finish({ ok: true }); await running
  check(() => assert.equal(store.remove('sample').ok, true))
  check(() => assert.ok(fs.existsSync(path.join(next, 'main.cjs'))))
  const sessionRunning = store.execute('sample_tool', {}, { ...ctx, chatId: 'scope', pluginScopeChatId: 'scope', pluginApprovedCapabilities: ['compute.local'] })
  const suiteNext = pkg('suite-next', 'third', { suite: 'example-suite' })
  check(() => assert.equal(store.unloadSessionPlugin('scope', 'session-plugin'), false))
  const suiteResult = await store.importFromPath(suiteNext)
  check(() => assert.equal(suiteResult.error, 'plugin_busy'))
  finish({ ok: true }); await sessionRunning
  check(() => assert.equal(store.unloadSessionPlugin('scope', 'session-plugin'), true))
  assert.equal((await store.importFromPath(suiteNext)).ok, true)
  const unrelatedRun = store.execute('sample_tool', {}, { ...ctx, pluginApprovedCapabilities: ['compute.local'] })
  const oldLoaded = store.loaded.get('third')
  const unrelated = pkg('unrelated', 'unrelated')
  fs.writeFileSync(path.join(unrelated, 'main.cjs'), valid.replace('sample_tool', 'unrelated_tool'))
  assert.equal((await store.importFromPath(unrelated)).ok, true)
  check(() => assert.equal(store.loaded.get('third'), oldLoaded))
  check(() => assert.equal(store.remove('third').error, 'plugin_busy'))
  finish({ ok: true }); await unrelatedRun
  const reloadBefore = JSON.stringify(store.list())
  fs.writeFileSync(path.join(suiteNext, 'main.cjs'), 'module.exports={}')
  store.reload()
  check(() => assert.equal(JSON.stringify(store.list()), reloadBefore))
  // A bad journal is retained outside the replay directory. Subsequent startups
  // remain blocked rather than loading a possibly half-committed package.
  const blockedRoot = path.join(temp, 'blocked')
  fs.mkdirSync(path.join(blockedRoot, 'plugins/.transactions/bad-entry'), { recursive: true })
  fs.writeFileSync(path.join(blockedRoot, 'plugins/.transactions/bad-entry/journal.json'), '{broken')
  const blocked = new PluginStore(blockedRoot)
  check(() => assert.deepEqual(blocked.list(), []))
  check(() => assert.equal(blocked.linkSessionPlugin('scope', suiteNext).error, 'install_recovery_required'))
  check(() => assert.ok(fs.readdirSync(path.join(blockedRoot, 'plugins/.transaction-quarantine')).length > 0))
  await blocked.dispose()
  const blockedAgain = new PluginStore(blockedRoot)
  check(() => assert.equal(blockedAgain.exportToZip('third', path.join(temp, 'blocked.zip')).error, 'install_recovery_required'))
  await blockedAgain.dispose()
  // Budget failures use ZIP metadata; no huge expansion is allocated.
  const overEntries = new AdmZip()
  overEntries.addFile('plugin.json', Buffer.from('{}'))
  for (let i = 0; i < 10_000; i++) overEntries.addFile(`f${i}`, Buffer.alloc(0))
  const manyZip = path.join(temp, 'many.zip'); overEntries.writeZip(manyZip)
  check(() => assert.throws(() => store.parseFromPath(manyZip), /zip_too_many_files/))
  const overSize = new AdmZip(); overSize.addFile('plugin.json', Buffer.from('{}'))
  const largeZip = path.join(temp, 'large.zip'); overSize.writeZip(largeZip)
  const bytes = fs.readFileSync(largeZip)
  for (let offset = 0; offset + 46 <= bytes.length; offset++) if (bytes.readUInt32LE(offset) === 0x02014b50) { bytes.writeUInt32LE(500 * 1024 * 1024 + 1, offset + 24); break }
  fs.writeFileSync(largeZip, bytes)
  check(() => assert.throws(() => store.parseFromPath(largeZip), /zip_expansion_limit/))
  await store.dispose()
  const afterClosed = await store.execute('sample_tool', {}, { ...ctx, pluginApprovedCapabilities: ['compute.local'] })
  check(() => assert.equal(afterClosed.error, 'runtime_closed'))
  const closedImport = await store.importFromPath(unrelated, { overwrite: true })
  check(() => assert.equal(closedImport.error, 'runtime_closed'))
  console.log(JSON.stringify({ ok: true, checks, isolated: true, realStore: true, realFilesystem: true, electronIdentityStub: true }))
} finally {
  delete global.__navoraStoreFixture; delete global.__lateLoads
  await store?.dispose()
  const relative = path.relative(os.tmpdir(), temp)
  if (!relative.startsWith('navora-store-reliability-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw Error('unsafe_test_cleanup')
  fs.rmSync(temp, { recursive: true, force: true })
}
