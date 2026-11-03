import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitPluginInstall, recoverPluginTransactions } from './plugin-install-transaction'
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
