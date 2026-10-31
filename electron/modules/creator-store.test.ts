import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import { creatorTemplate } from '../../shared/creators'
import { CreatorStore, assertCreatorFiles, validateCreator } from './creator-store'

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-creator-test-'))
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root))
    assert.ok(relative.startsWith('navora-creator-test-') && !relative.includes(path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return new CreatorStore(root)
}
test('creator templates satisfy skill metadata and plugin source checks without executing entry code', () => {
  for (const kind of ['plugin', 'skill'] as const) assert.equal(validateCreator(kind, creatorTemplate(kind)).ok, true)
  const files = creatorTemplate('plugin')
  files['main.cjs'] = 'globalThis.__creatorExecuted = true;\n' + files['main.cjs']
  assert.equal(validateCreator('plugin', files).ok, true)
  assert.equal((globalThis as Record<string, unknown>).__creatorExecuted, undefined)
  files['main.cjs'] = 'module.exports = { tools: [;'
  assert.equal(validateCreator('plugin', files).ok, false)
  assert.ok(validateCreator('plugin', files).issues.some(issue => issue.message.includes('语法错误')))
  assert.equal(validateCreator('skill', { 'SKILL.md': '---\nname: demo\n---\nbody' }).ok, false)
})
test('drafts persist with optimistic revisions and immutable installation snapshots', t => {
  const store = fixture(t), project = store.create('plugin', 'text')
  const initialSnapshot = store.snapshot(project.id, project.revision)
  const original = fs.readFileSync(path.join(initialSnapshot, 'main.cjs'), 'utf8')
  const next = store.save(project.id, project.revision, { ...project.files, 'README.md': '# 更新' }, '新版')
  assert.equal(next.revision, 2)
  assert.equal(store.get(project.id).files['README.md'], '# 更新')
  assert.throws(() => store.save(project.id, project.revision, project.files, '旧内容'), /revision_conflict/)
  assert.throws(() => store.snapshot(project.id, project.revision), /revision_conflict/)
  assert.equal(fs.readFileSync(path.join(initialSnapshot, 'main.cjs'), 'utf8'), original)
  const installed = store.markInstalled(project.id, next.revision, 'example', initialSnapshot)
  assert.equal(installed.installedRevision, 2)
  assert.equal(new CreatorStore(path.dirname(store.root)).list('plugin')[0]!.installedId, 'example')
  assert.equal(store.list('skill').length, 0)
})
test('creator rejects traversal, unsupported files, oversized content and escaped snapshot directories', t => {
  const store = fixture(t), project = store.create('skill', 'basic')
  assert.throws(() => store.get('../../outside'), /project_not_found/)
  assert.throws(() => assertCreatorFiles('skill', { '../outside': 'x' }), /invalid_files/)
  assert.throws(() => assertCreatorFiles('plugin', { 'main.cjs': 'x'.repeat(300001) }), /file_too_large/)
  assert.throws(() => store.save(project.id, project.revision, { 'other.md': 'x' }, 'bad'), /invalid_files/)
  assert.equal(store.get(project.id).revision, 1)
  const outside = path.join(path.dirname(store.root), 'outside')
  fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(store.root, project.id, 'releases'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => store.snapshot(project.id, 1), /invalid_files/)
  assert.deepEqual(fs.readdirSync(outside), [])
})
