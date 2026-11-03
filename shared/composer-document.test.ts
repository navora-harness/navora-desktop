import test from 'node:test'
import assert from 'node:assert/strict'
import {compileComposerDocument,composerDocumentText,createComposerDocument,mergeComposerDocuments,normalizeComposerDocument,type ComposerContextBlock,type ComposerNode} from './composer-document'
const source=(id='one'):ComposerContextBlock=>({id,label:'需求说明',mode:'reference',status:'ready',version:2,source:{kind:'page',identity:'page-a',chatId:'chat-a',browserRef:{kind:'window',sessionId:'session-a',windowId:'page-a',label:'需求页面'}}})
const document=(content:ComposerNode[])=>({...createComposerDocument('chat-a'),content})

test('version 1 migration preserves edited excerpts and document identity',()=>{
  const legacy={...document([{type:'contextBlock',attrs:{block:{...source(),mode:'excerpt'},collapsed:true},content:[{type:'paragraph',content:[{type:'text',text:'用户修改的摘录',marks:[{type:'bold'}]}]}]}]),schemaVersion:1 as const}
  const normalized=normalizeComposerDocument(legacy,'chat-a')
  assert.equal(normalized.schemaVersion,2)
  assert.equal(normalized.id,legacy.id)
  assert.deepEqual(normalized.content,legacy.content)
  assert.match(compileComposerDocument(normalized).content,/\*\*用户修改的摘录\*\*/)
  assert.deepEqual(compileComposerDocument(normalized).refs,[])
})

test('inline sources compile at the exact position and deduplicate browser references',()=>{
  const doc=document([{type:'paragraph',content:[{type:'text',text:'参考 '},{type:'contextInline',attrs:{block:source()}},{type:'text',text:' 对比 '},{type:'contextInline',attrs:{block:source('two')}},{type:'text',text:' 总结。'}]}])
  const compiled=compileComposerDocument(doc)
  assert.equal(compiled.content,'参考 网页：需求说明 对比 网页：需求说明 总结。')
  assert.equal(compiled.refs.length,1)
  assert.equal(compiled.contexts.length,2)
  assert.equal(composerDocumentText(doc),'参考 需求说明 对比 需求说明 总结。')
})

test('inline references reject excerpts, nested resources, top-level atoms and duplicate identities',()=>{
  assert.throws(()=>normalizeComposerDocument(document([{type:'contextInline',attrs:{block:source()}}])),/structure/)
  assert.throws(()=>normalizeComposerDocument(document([{type:'paragraph',content:[{type:'contextInline',attrs:{block:{...source(),mode:'excerpt'}}}]}])),/context/)
  assert.throws(()=>normalizeComposerDocument(document([{type:'contextBlock',attrs:{block:{...source(),mode:'excerpt'}},content:[{type:'paragraph',content:[{type:'contextInline',attrs:{block:source('two')}}]}]}])),/context/)
  assert.throws(()=>normalizeComposerDocument(document([{type:'paragraph',content:[{type:'contextInline',attrs:{block:source()}},{type:'contextInline',attrs:{block:source()}}]}])),/duplicate/)
  assert.throws(()=>normalizeComposerDocument({...document([]),schemaVersion:3}),/document_version/)
})

test('recovery merge renews colliding IDs across inline and block references while preserving collapsed state',()=>{
  const left=document([{type:'paragraph',content:[{type:'contextInline',attrs:{block:source()}}]}])
  const right=document([{type:'contextBlock',attrs:{block:{...source(),mode:'excerpt'},collapsed:true},content:[{type:'paragraph',content:[{type:'text',text:'副本'}]}]}])
  const merged=mergeComposerDocuments(left,right),compiled=compileComposerDocument(merged)
  assert.equal(new Set(compiled.contexts.map(item=>item.block.id)).size,2)
  assert.equal(merged.content.at(-1)?.attrs?.collapsed,true)
  assert.equal(compiled.refs.length,1)
})

test('headings, lists and text styles survive normalization and submit compilation',()=>{
  const doc=document([{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题',marks:[{type:'bold'}]}]},{type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'链接',marks:[{type:'italic'},{type:'link',attrs:{href:'https://example.com/a(b)'}}]}]}]}]}])
  assert.equal(compileComposerDocument(doc).content,'## **标题**\n\n3. [*链接*](https://example.com/a%28b%29)')
  assert.throws(()=>normalizeComposerDocument(document([{type:'paragraph',content:[{type:'text',text:'坏链接',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}])),/link/)
  assert.equal(compileComposerDocument(document([{type:'paragraph',content:[{type:'text',text:'保留下划线',marks:[{type:'underline'}]}]}])).content,'<u>保留下划线</u>')
})
