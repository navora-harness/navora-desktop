import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-interruption-'))
const modulePath = path.join(project, 'electron/modules/plugin-install-transaction.ts')
try {
  const helper = path.join(temp, 'transaction.mjs')
  await build({ entryPoints: [modulePath], outfile: helper, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' })
  const { recoverPluginTransactions } = await import(pathToFileURL(helper).href)
  const child = path.join(temp, 'child.mjs')
  fs.writeFileSync(child, `
import fs from 'node:fs';import path from 'node:path';
import {commitPluginInstall,writePluginIndexAtomic,recoverPluginTransactions} from './transaction.mjs';
const [root,point]=process.argv.slice(2);let journals=0,backups=0;
const rename=fs.renameSync;
fs.renameSync=function(from,to){const value=rename.apply(this,arguments);
if(path.basename(to)==='journal.json') {journals++;if(point==='journal'&&journals===1||point==='commit'&&journals===2)process.exit(93)}
if(path.basename(path.dirname(to))==='backup'){backups++;if(point==='backup1'&&backups===1||point==='backup2'&&backups===2)process.exit(93)}
if(path.basename(to)==='target'&&path.basename(path.dirname(from))==='.staging'&&point==='stage')process.exit(93);
if(to===path.join(root,'index.json')&&point==='index')process.exit(93);
if(path.basename(from).startsWith('restore-')&&point==='restore')process.exit(93);
return value};
if(point==='restore'){recoverPluginTransactions(root);process.exit(0)}
commitPluginInstall(root,path.join(root,'.staging/new'),'target',['sibling'],()=>writePluginIndexAtomic(path.join(root,'index.json'),'new-index'));
`)
  const results = []
  for (const point of ['journal', 'backup1', 'backup2', 'stage', 'index', 'commit']) {
    const root = path.join(temp, point)
    for (const name of ['target', 'sibling', '.staging/new']) {
      fs.mkdirSync(path.join(root, name), { recursive: true }); fs.writeFileSync(path.join(root, name, 'value'), name === '.staging/new' ? 'new-target' : `old-${name}`)
    }
    fs.writeFileSync(path.join(root, 'index.json'), 'old-index')
    const run = spawnSync(process.execPath, [child, root, point], { windowsHide: true, encoding: 'utf8' })
    assert.equal(run.status, 93, `${point}: ${run.stderr}`)
    // Interrupt recovery itself after its first successful restored-directory
    // rename, then restart again. This is a fresh process without finalizers.
    if (['backup1', 'backup2', 'stage', 'index'].includes(point)) {
      const restoring = spawnSync(process.execPath, [child, root, 'restore'], { windowsHide: true, encoding: 'utf8' })
      assert.equal(restoring.status, 93, `${point} interrupted restore: ${restoring.stderr}`)
    }
    assert.equal(recoverPluginTransactions(root).blocked, false)
    const committed = point === 'commit'
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), committed ? 'new-target' : 'old-target')
    assert.equal(fs.existsSync(path.join(root, 'sibling')), !committed)
    if (!committed) assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'old-sibling')
    assert.equal(fs.readFileSync(path.join(root, 'index.json'), 'utf8'), committed ? 'new-index' : 'old-index')
    assert.equal(recoverPluginTransactions(root).recovered, 0)
    results.push({ point, restartRecovery: 'passed', repeatedRecovery: 'passed', interruptedRestore: ['backup1', 'backup2', 'stage', 'index'].includes(point) })
  }
  console.log(JSON.stringify({ ok: true, results, boundary: 'controlled abrupt process exit; not power loss, disk-full or physical device failure' }))
} finally {
  const relative = path.relative(os.tmpdir(), temp)
  if (!relative.startsWith('navora-interruption-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw Error('unsafe_test_cleanup')
  fs.rmSync(temp, { recursive: true, force: true })
}
