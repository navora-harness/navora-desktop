import test from 'node:test'
import assert from 'node:assert/strict'
import {downloadFileExtension,downloadFilePreset} from './download-file-icons'

test('file type presets follow the final case-insensitive extension, never executable-looking prefixes',()=>{
  assert.equal(downloadFilePreset('C:\\Downloads\\报告.PDF')?.key,'download-type-pdf')
  assert.equal(downloadFilePreset('照片.jpg.exe')?.key,'download-type-app')
  assert.equal(downloadFilePreset('备份.tar.gz')?.key,'download-type-archive')
  assert.equal(downloadFilePreset('文件.xlsx')?.key,'download-type-sheet')
  assert.equal(downloadFilePreset('文件.docx')?.key,'download-type-document')
  assert.equal(downloadFilePreset('组件.tsx')?.key,'download-type-code')
  assert.equal(downloadFilePreset('未知.custom'),undefined)
  assert.equal(downloadFilePreset('无扩展名'),undefined)
  assert.equal(downloadFileExtension('文档.pdf/无扩展名'),'')
  const source=downloadFilePreset('<script>alert(1)</script>.pdf')!.dataUrl
  assert.ok(!atob(source.split(',')[1]!).includes('alert'),'Filenames select fixed artwork and never enter SVG markup')
})
