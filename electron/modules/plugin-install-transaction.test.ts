import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitPluginInstall, commitPluginMutation, recoverPluginTransactions, writePluginIndexAtomic } from './plugin-install-transaction'
import { randomUUID } from 'node:crypto'
test('failed package activation restores both previous package, suite sibling and index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-install-test-'))
  try {
    for (const name of ['target', 'sibling', '.staging/new']) { fs.mkdirSync(path.join(root, name), { recursive: true }); fs.writeFileSync(path.join(root, name, 'value'), name) }
    fs.writeFileSync(path.join(root, 'index.json'), 'old index')
    assert.throws(() => commitPluginInstall(root, path.join(root, '.staging/new'), 'target', ['sibling'], () => {
      fs.writeFileSync(path.join(root, 'index.json'), 'new index'); throw new Error('load_failed')
    }), /load_failed/)
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'target')
    assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'sibling')
    assert.equal(fs.readFileSync(path.join(root, 'index.json'), 'utf8'), 'old index')
    recoverPluginTransactions(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('uninstall/link index transaction restores every sibling and preserves external projects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-mutation-test-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-external-test-'))
  try {
    for (const name of ['old', 'sibling']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'value'), name) }
    fs.writeFileSync(path.join(external, 'source'), 'developer project')
    fs.writeFileSync(path.join(root, 'index.json'), 'original')
    assert.throws(() => commitPluginMutation(root, ['old', 'sibling'], () => {
      writePluginIndexAtomic(path.join(root, 'index.json'), JSON.stringify({ link: external })); throw new Error('candidate_failed')
    }), /candidate_failed/)
    assert.equal(fs.readFileSync(path.join(root, 'old/value'), 'utf8'), 'old')
    assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'sibling')
    assert.equal(fs.readFileSync(path.join(root, 'index.json'), 'utf8'), 'original')
    assert.equal(fs.readFileSync(path.join(external, 'source'), 'utf8'), 'developer project')
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }) }
})

test('recovery can repeat a partially restored rollback without consuming the only backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-recovery-test-'))
  try {
    const dir = path.join(root, '.transactions', randomUUID())
    for (const name of ['target', 'sibling']) {
      fs.mkdirSync(path.join(dir, 'backup', name), { recursive: true }); fs.writeFileSync(path.join(dir, 'backup', name, 'value'), `old-${name}`)
      fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'value'), name === 'target' ? 'old-target' : 'new-sibling')
    }
    fs.writeFileSync(path.join(root, 'index.json'), 'new index')
    fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify({ version: 2, target: 'target', existing: ['target', 'sibling'], removed: ['target', 'sibling'], oldIndex: 'old index', committed: false }))
    const result = recoverPluginTransactions(root)
    assert.equal(result.blocked, false); assert.equal(result.recovered, 1)
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'old-target')
    assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'old-sibling')
    assert.equal(fs.readFileSync(path.join(root, 'index.json'), 'utf8'), 'old index')
    assert.equal(recoverPluginTransactions(root).recovered, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

for (const invalid of [
  { target: '../outside' }, { removed: ['../outside'] }, { committed: 'true' }, { oldIndex: {} },
  { existing: ['ghost'] }, { removed: ['target', 'TARGET'] }, { unexpected: true }, { version: 99 },
]) test(`invalid journal is quarantined and never interpreted: ${JSON.stringify(invalid)}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-invalid-journal-test-'))
  try {
    const dir = path.join(root, '.transactions', randomUUID())
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(root, 'target'))
    fs.writeFileSync(path.join(root, 'target/value'), 'untouched')
    const contents = JSON.stringify({ version: 2, target: 'target', existing: ['target'], removed: ['target'], oldIndex: null, committed: false, ...invalid })
    fs.writeFileSync(path.join(dir, 'journal.json'), contents)
    const result = recoverPluginTransactions(root)
    assert.equal(result.blocked, true); assert.equal(result.issues.length, 1)
    assert.equal(fs.readFileSync(path.join(result.issues[0].path, 'journal.json'), 'utf8'), contents)
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'untouched')
    assert.equal(recoverPluginTransactions(root).blocked, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('committed recovery only cleans backup evidence, without reverting installed content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-committed-test-'))
  try {
    const dir = path.join(root, '.transactions', randomUUID())
    fs.mkdirSync(path.join(dir, 'backup/target'), { recursive: true }); fs.mkdirSync(path.join(root, 'target'))
    fs.writeFileSync(path.join(root, 'target/value'), 'new')
    fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify({ version: 2, target: 'target', existing: ['target'], removed: ['target'], oldIndex: 'old', committed: true }))
    assert.equal(recoverPluginTransactions(root).blocked, false)
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'new')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('stage and removal paths must remain inside the explicit managed roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-boundary-test-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-outside-test-'))
  try {
    fs.mkdirSync(path.join(root, '.staging'))
    fs.writeFileSync(path.join(external, 'source'), 'keep')
    assert.throws(() => commitPluginInstall(root, external, 'target', [], () => {}), /invalid_install_stage/)
    for (const target of ['..', '.hidden', 'index.json', 'CON', 'bad.', 'bad ', '../outside']) {
      assert.throws(() => commitPluginMutation(root, [target], () => {}), /invalid_install_target/)
    }
    assert.equal(fs.readFileSync(path.join(external, 'source'), 'utf8'), 'keep')
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }) }
})

test('a managed directory junction cannot redirect uninstall or recovery into an external project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-junction-test-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-junction-external-test-'))
  try {
    fs.writeFileSync(path.join(external, 'project'), 'keep')
    fs.symlinkSync(external, path.join(root, 'target'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => commitPluginMutation(root, ['target'], () => {}), /invalid_install_path/)
    assert.equal(fs.existsSync(path.join(root, '.transactions')), false)
    const dir = path.join(root, '.transactions', randomUUID())
    fs.mkdirSync(dir, { recursive: true })
    fs.symlinkSync(external, path.join(dir, 'backup'), process.platform === 'win32' ? 'junction' : 'dir')
    fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify({ version: 2, target: null, existing: [], removed: [], oldIndex: null, committed: false }))
    assert.equal(recoverPluginTransactions(root).blocked, true)
    assert.equal(fs.readFileSync(path.join(external, 'project'), 'utf8'), 'keep')
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }) }
})

function faultFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-install-fault-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of ['target', 'sibling', '.staging/new']) {
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'value'), name === '.staging/new' ? 'new-target' : `old-${name}`)
  }
  fs.writeFileSync(path.join(root, 'index.json'), 'old-index')
  const assertOld = () => {
    assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'old-target')
    assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'old-sibling')
    assert.equal(fs.readFileSync(path.join(root, 'index.json'), 'utf8'), 'old-index')
  }
  const install = () => commitPluginInstall(root, path.join(root, '.staging/new'), 'target', ['sibling'],
    () => writePluginIndexAtomic(path.join(root, 'index.json'), 'new-index'))
  return { root, assertOld, install }
}

for (const code of ['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EBUSY', 'EIO']) {
  for (const point of ['journal', 'backup1', 'backup2', 'stage', 'index', 'commit']) {
    test(`${code} during ${point} preserves previous package, suite and index`, t => {
      const f = faultFixture(t), rename = fs.renameSync
      let journals = 0, backups = 0, injected = false
      t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        const name = String(to), source = String(from)
        if (path.basename(name) === 'journal.json') journals++
        if (path.basename(path.dirname(name)) === 'backup') backups++
        const match = point === 'journal' && journals === 1 && path.basename(name) === 'journal.json'
          || point === 'commit' && journals === 2 && path.basename(name) === 'journal.json'
          || point === 'backup1' && backups === 1 && path.basename(path.dirname(name)) === 'backup'
          || point === 'backup2' && backups === 2 && path.basename(path.dirname(name)) === 'backup'
          || point === 'stage' && path.basename(path.dirname(source)) === '.staging'
          || point === 'index' && name === path.join(f.root, 'index.json')
        if (!injected && match) { injected = true; throw Object.assign(new Error(code), { code }) }
        return rename(from, to)
      })
      assert.throws(f.install, new RegExp(code)); assert.equal(injected, true)
      f.assertOld()
      assert.equal(recoverPluginTransactions(f.root).blocked, false)
    })
  }
  test(`${code} during rollback stays retryable across restart and retains immutable backups`, t => {
    const f = faultFixture(t), cp = fs.cpSync
    let denied = true
    t.mock.method(fs, 'cpSync', (...args: Parameters<typeof fs.cpSync>) => {
      if (denied) throw Object.assign(new Error('sensitive content must not appear in diagnostics'), { code })
      return cp(...args)
    })
    assert.throws(() => commitPluginInstall(f.root, path.join(f.root, '.staging/new'), 'target', ['sibling'], () => {
      writePluginIndexAtomic(path.join(f.root, 'index.json'), 'new-index'); throw Error('activation_failed')
    }), /install_rollback_failed/)
    const pending = fs.readdirSync(path.join(f.root, '.transactions'))[0]!
    const backup = path.join(f.root, '.transactions', pending, 'backup/target/value')
    assert.equal(fs.readFileSync(backup, 'utf8'), 'old-target')
    const result = recoverPluginTransactions(f.root)
    assert.equal(result.blocked, true)
    assert.equal(result.issues[0]?.error, code)
    assert.equal(result.issues[0]?.kind, 'retryable')
    assert.equal(fs.existsSync(path.join(f.root, '.transaction-quarantine')), false)
    assert.equal(fs.readFileSync(backup, 'utf8'), 'old-target')
    denied = false
    assert.equal(recoverPluginTransactions(f.root).blocked, false)
    f.assertOld()
    assert.equal(recoverPluginTransactions(f.root).recovered, 0)
  })
}

test('failed recovery storage enumeration returns a blocked report instead of crashing startup', t => {
  const f = faultFixture(t), read = fs.readdirSync
  fs.mkdirSync(path.join(f.root, '.transactions'))
  t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof fs.readdirSync>) => {
    if (String(args[0]) === path.join(f.root, '.transactions')) throw Object.assign(Error('private'), { code: 'EACCES' })
    return read(...args)
  })
  const result = recoverPluginTransactions(f.root)
  assert.equal(result.blocked, true); assert.equal(result.issues[0]?.error, 'EACCES')
  f.assertOld()
})

test('explicit retry recovers valid journals quarantined by earlier versions, without trusting damaged records', t => {
  const f = faultFixture(t), id = randomUUID(), dir = path.join(f.root, '.transaction-quarantine', id)
  fs.mkdirSync(path.join(dir, 'backup/target'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'backup/target/value'), 'old-target')
  fs.writeFileSync(path.join(f.root, 'target/value'), 'new-target')
  fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify({ version: 2, target: 'target', existing: ['target'], removed: ['target'], oldIndex: 'old-index', committed: false }))
  fs.writeFileSync(`${dir}.diagnostic.json`, '{}')
  assert.equal(recoverPluginTransactions(f.root).blocked, true)
  assert.equal(recoverPluginTransactions(f.root, true).blocked, false)
  f.assertOld()
  const invalid = path.join(f.root, '.transactions', randomUUID())
  fs.mkdirSync(invalid, { recursive: true })
  fs.writeFileSync(path.join(invalid, 'journal.json'), '{"private-token":"SECRET", bad')
  const result = recoverPluginTransactions(f.root)
  assert.equal(result.blocked, true)
  assert.equal(result.issues[0]?.error, 'invalid_install_journal')
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
  assert.equal(recoverPluginTransactions(f.root, true).blocked, true)
  f.assertOld()
})

for (const point of ['partial-write', 'file-fsync']) test(`${point} ENOSPC never publishes a partial index`, t => {
  const f = faultFixture(t), write = fs.writeFileSync, sync = fs.fsyncSync
  if (point === 'partial-write') t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
    if (typeof args[0] === 'number') { write(args[0], 'partial'); throw Object.assign(Error('ENOSPC'), { code: 'ENOSPC' }) }
    return write(...args)
  })
  else t.mock.method(fs, 'fsyncSync', (fd: number) => { sync(fd); throw Object.assign(Error('ENOSPC'), { code: 'ENOSPC' }) })
  assert.throws(() => writePluginIndexAtomic(path.join(f.root, 'index.json'), 'new-index'), /ENOSPC/)
  f.assertOld()
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false)
})

test('post-commit cleanup denial never reverts the successful installation', t => {
  const f = faultFixture(t), rm = fs.rmSync
  let denied = true
  t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
    const dir = String(args[0])
    if (denied && path.basename(path.dirname(dir)) === '.transactions' && !dir.endsWith('.tmp')) throw Object.assign(Error('EACCES'), { code: 'EACCES' })
    return rm(...args)
  })
  f.install()
  assert.equal(fs.readFileSync(path.join(f.root, 'target/value'), 'utf8'), 'new-target')
  assert.equal(fs.readFileSync(path.join(f.root, 'index.json'), 'utf8'), 'new-index')
  assert.equal(recoverPluginTransactions(f.root).blocked, true)
  denied = false
  assert.equal(recoverPluginTransactions(f.root).blocked, false)
  assert.equal(fs.readFileSync(path.join(f.root, 'target/value'), 'utf8'), 'new-target')
  assert.equal(fs.existsSync(path.join(f.root, 'sibling')), false)
})
