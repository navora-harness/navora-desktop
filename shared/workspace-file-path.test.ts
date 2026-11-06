import test from 'node:test'
import assert from 'node:assert/strict'
import {workspaceFileDisplayPath} from './workspace-file-path'

test('file hints display absolute paths using the owning workspace platform separators',()=>{
  assert.equal(workspaceFileDisplayPath('D:\\work\\项目','docs/report.md'),'D:\\work\\项目\\docs\\report.md')
  assert.equal(workspaceFileDisplayPath('C:/workspace/','docs/文件 #1.md'),'C:\\workspace\\docs\\文件 #1.md')
  assert.equal(workspaceFileDisplayPath('\\\\server\\share\\','file.txt'),'\\\\server\\share\\file.txt')
  assert.equal(workspaceFileDisplayPath('/home/alice/project/','docs/file.txt'),'/home/alice/project/docs/file.txt')
  assert.equal(workspaceFileDisplayPath('/','file.txt'),'/file.txt')
  assert.equal(workspaceFileDisplayPath('D:\\other-chat','docs/report.md'),'D:\\other-chat\\docs\\report.md')
})

test('unavailable or invalid workspace metadata never invents an absolute hint',()=>{
  for(const root of [undefined,'','relative/root','https://example.test','D:\\root\0'])assert.equal(workspaceFileDisplayPath(root,'docs/report.md'),'docs/report.md')
  assert.equal(workspaceFileDisplayPath('D:\\work','../outside'),'../outside')
})
