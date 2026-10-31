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

test('resource indexing finds nested files, ignores empty folders and never creates missing roots',async t=>{
  const {base,files,root}=await fixture(t)
  assert.equal(await files.containsFiles('missing'),false)
  await assert.rejects(fs.access(path.join(base,'workspace','missing')))
  await fs.mkdir(path.join(root,'empty','nested'),{recursive:true})
  assert.equal(await files.containsFiles('chat'),false)
  await fs.writeFile(path.join(root,'empty','nested','note.txt'),'found')
  assert.equal(await files.containsFiles('chat'),true)
  await fs.rm(path.join(root,'empty'),{recursive:true})
  const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.txt'),'private')
  await fs.symlink(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir')
  assert.equal(await files.containsFiles('chat'),false)
})

test('blocks reads and writes through a junction outside the workspace', async (t) => {
  const { base, files, root } = await fixture(t)
  const outside = path.join(base, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'marker.txt'), 'unchanged')
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(files.readText('chat', 'link/marker.txt'), /path_outside_workspace/)
  await assert.rejects(files.preview('chat', 'link/marker.txt'), /path_outside_workspace/)
  await assert.rejects(files.writeText('chat', 'link/new/file.txt', 'changed'), /path_outside_workspace/)
  assert.equal(await fs.readFile(path.join(outside, 'marker.txt'), 'utf8'), 'unchanged')
  await assert.rejects(fs.access(path.join(outside, 'new')))
})

test('preview bounds large reads, handles Unicode/empty files and leaves binaries unsupported', async t => {
  const { files, root } = await fixture(t)
  await fs.writeFile(path.join(root, 'note.md'), '# 你好\n正文')
  assert.equal((await files.preview('chat', 'note.md')).kind, 'markdown')
  assert.equal((await files.preview('chat', 'note.md')).content, '# 你好\n正文')
  await fs.writeFile(path.join(root, 'empty.txt'), '')
  assert.equal((await files.preview('chat', 'empty.txt')).content, '')
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 0, 4, 0, 8]))
  assert.equal((await files.preview('chat', 'binary.bin')).kind, 'unsupported')
  await fs.writeFile(path.join(root, 'wide.txt'), Buffer.concat([Buffer.from([255,254]), Buffer.from('文本', 'utf16le')]))
  assert.equal((await files.preview('chat', 'wide.txt')).content, '文本')
  const large = await fs.open(path.join(root, 'large.txt'), 'w')
  await large.write(Buffer.from('a'.repeat(262143) + '你'))
  await large.truncate(100 * 1024 * 1024)
  await large.close()
  const preview = await files.preview('chat', 'large.txt')
  assert.equal(preview.truncated, true)
  assert.equal(preview.size, 100 * 1024 * 1024)
  assert.equal(preview.content?.length, 262143)
  assert.equal(preview.content?.includes('\uFFFD'), false)
  await assert.rejects(files.preview('chat', '../outside'), /path_outside_workspace/)
  await assert.rejects(files.preview('chat', '.'), /not_a_file/)
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


test('resource snapshots preserve nested owner metadata, versions, missing roots and link boundaries',async t=>{
  const {base,files,root}=await fixture(t)
  assert.deepEqual((await files.resources('missing')).entries,[])
  await assert.rejects(fs.access(path.join(base,'workspace','missing')))
  await fs.mkdir(path.join(root,'nested'));await fs.writeFile(path.join(root,'nested','report.md'),'first')
  const outside=path.join(base,'elsewhere');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.txt'),'private')
  await fs.symlink(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir')
  const first=await files.resources('chat'),entry=first.entries[0]!
  assert.equal(first.entries.length,1);assert.equal(entry.path,'nested/report.md');assert.equal(entry.ownerChatId,'chat');assert.equal(entry.kind,'document')
  await fs.writeFile(path.join(root,'nested','report.md'),'second version')
  const second=(await files.resources('chat')).entries[0]!
  assert.equal(second.id,entry.id);assert.notEqual(second.revision,entry.revision)
  await fs.rm(path.join(root,'nested','report.md'));assert.equal((await files.resources('chat')).entries.length,0)
})
test('resource snapshot limits and inaccessible subdirectories are explicit instead of false emptiness',async t=>{
  const {base,root}=await fixture(t)
  for(let i=0;i<4;i++)await fs.writeFile(path.join(root,`${i}.txt`),'file')
  const bounded=new WorkspaceFiles(base,()=>({files:{root_dirname:'workspace',max_list_entries:2}}) as AppConfig)
  const result=await bounded.resources('chat');assert.equal(result.entries.length,2);assert.equal(result.truncated,true)
  await fs.mkdir(path.join(root,'locked'))
  const resolve=bounded.resolveExisting.bind(bounded)
  bounded.resolveExisting=async(id,relative)=>{if(relative==='locked')throw Error('EACCES');return resolve(id,relative)}
  for(let i=1;i<4;i++)await fs.rm(path.join(root,`${i}.txt`))
  const partial=await bounded.resources('chat');assert.equal(partial.entries.length,1);assert.equal(partial.unavailable,1)
})
