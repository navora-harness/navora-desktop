import test from 'node:test'
import assert from 'node:assert/strict'
import {decodeWorkspaceFileText} from './workspace-file-actions'

test('complete file copying retains text past preview limits, empty files and BOM encodings',()=>{
  const content='中文与 emoji 🌿\n'.repeat(40000)
  assert.ok(Buffer.byteLength(content)>262144)
  assert.equal(decodeWorkspaceFileText(Buffer.from(content)),content)
  assert.equal(decodeWorkspaceFileText(Buffer.alloc(0)),'')
  assert.equal(decodeWorkspaceFileText(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('hello')])), 'hello')
  assert.equal(decodeWorkspaceFileText(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('你好','utf16le')])), '你好')
  assert.equal(decodeWorkspaceFileText(Buffer.from([0xfe,0xff,0x4f,0x60,0x59,0x7d])), '你好')
})

test('invalid encodings and binary NUL content fail instead of copying replacement characters',()=>{
  assert.throws(()=>decodeWorkspaceFileText(Buffer.from([0x61,0,0x62])),/file_content_binary/)
  assert.throws(()=>decodeWorkspaceFileText(Buffer.from([0xc3,0x28])),/file_content_encoding/)
  assert.throws(()=>decodeWorkspaceFileText(Buffer.from([0xff,0xfe,0x61])),/file_content_encoding/)
  assert.equal(decodeWorkspaceFileText(Buffer.from([0x61,0xe4,0xbd]),true),'a','A capability probe may end between UTF-8 code units')
})
