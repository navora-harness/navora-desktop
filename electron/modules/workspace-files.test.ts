import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkspaceFiles } from './workspace-files'
import type { AppConfig } from '../../shared/config'

async function fixture(t: TestContext, maxBytes = 1000) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'navora-workspace-test-'))
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(base))
    assert.ok(relative.startsWith('navora-workspace-test-') && !relative.includes(path.sep))
    await fs.rm(base, { recursive: true, force: true })
  })
  const files = new WorkspaceFiles(base, () => ({
    files: { root_dirname: 'workspace', max_write_bytes: maxBytes },
  }) as AppConfig)
  return { base, files, root: files.chatRoot('chat') }
}

test('blocks reads and writes through a junction outside the workspace', async (t) => {
  const { base, files, root } = await fixture(t)
  const outside = path.join(base, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'marker.txt'), 'unchanged')
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(files.readText('chat', 'link/marker.txt'), /path_outside_workspace/)
  await assert.rejects(files.writeText('chat', 'link/new/file.txt', 'changed'), /path_outside_workspace/)
  assert.equal(await fs.readFile(path.join(outside, 'marker.txt'), 'utf8'), 'unchanged')
  await assert.rejects(fs.access(path.join(outside, 'new')))
})

test('allows internal links and new nested files, rejects traversal and dot chat IDs', async (t) => {
  const { files, root } = await fixture(t)
  await fs.mkdir(path.join(root, 'actual'))
  await fs.symlink(path.join(root, 'actual'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await files.writeText('chat', 'link/nested/file.txt', 'inside')
  assert.equal((await files.readText('chat', 'actual/nested/file.txt')).content, 'inside')
  assert.throws(() => files.resolve('chat', '../outside'), /path_outside_workspace/)
  assert.notEqual(files.chatRoot('..'), path.dirname(root))
})

test('rejects a built-in chat root redirected outside its parent', async (t) => {
  const { base, files } = await fixture(t)
  const outside = path.join(base, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(base, 'workspace', 'redirected'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => files.chatRoot('redirected'), /path_outside_workspace/)
})

test('concatenation preserves input when the destination is also an input', async (t) => {
  const { files } = await fixture(t)
  await files.writeText('chat', 'part.txt', 'hello')
  const result = await files.concat('chat', ['part.txt', 'part.txt'], 'part.txt')
  assert.equal(result.bytes, 10)
  assert.equal((await files.readText('chat', 'part.txt')).content, 'hellohello')
})

test('failed concatenation preserves the destination and removes temporary output', async (t) => {
  const { files, root } = await fixture(t)
  await files.writeText('chat', 'dest.txt', 'keep')
  await assert.rejects(files.concat('chat', ['dest.txt', 'missing.txt'], 'dest.txt'), /ENOENT/)
  assert.equal((await files.readText('chat', 'dest.txt')).content, 'keep')
  assert.deepEqual(await fs.readdir(root), ['dest.txt'])
})

test('concatenation enforces the write limit without replacing the destination', async (t) => {
  const { files, root } = await fixture(t, 8)
  await files.writeText('chat', 'part.txt', '12345')
  await files.writeText('chat', 'dest.txt', 'keep')
  await assert.rejects(files.concat('chat', ['part.txt', 'part.txt'], 'dest.txt'), /write_too_large/)
  assert.equal((await files.readText('chat', 'dest.txt')).content, 'keep')
  assert.equal((await fs.readdir(root)).some((name) => name.endsWith('.tmp')), false)
})
