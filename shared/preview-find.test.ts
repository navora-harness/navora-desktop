import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPreviewRangeIndex,previewRangeBoundaries} from './preview-find'
import {findConversationText} from './conversation-find'

test('preview matches cross inline nodes without changing original text offsets',()=>{
  const chunks=['下载','列','表']
  const match=findConversationText([{id:'preview',text:chunks.join('')}],'下载列表').matches[0]!
  assert.deepEqual(previewRangeBoundaries(chunks.map(text=>text.length),match.from,match.to),{start:{index:0,offset:0},end:{index:2,offset:1}})
})
test('empty nodes and exact node boundaries point at the actual text node',()=>{
  assert.deepEqual(previewRangeBoundaries([0,2,0,3],2,5),{start:{index:3,offset:0},end:{index:3,offset:3}})
  assert.deepEqual(previewRangeBoundaries([2,0,3],1,2),{start:{index:0,offset:1},end:{index:0,offset:2}})
})
test('surrogate pairs use the same UTF-16 coordinates as DOM Range',()=>{
  const chunks=['a😀','b😀c'],match=findConversationText([{id:'preview',text:chunks.join('')}],'😀b😀').matches[0]!
  assert.deepEqual(previewRangeBoundaries(chunks.map(text=>text.length),match.from,match.to),{start:{index:0,offset:1},end:{index:1,offset:3}})
})
test('stale or malformed offsets cannot produce a partial highlight',()=>{
  for(const [from,to] of [[-1,2],[2,2],[3,2],[0,6],[0.5,2],[0,Infinity]])assert.equal(previewRangeBoundaries([2,3],from!,to!),null)
  assert.equal(previewRangeBoundaries([1,-1],0,1),null)
  assert.equal(previewRangeBoundaries([],0,1),null)
})
test('a preview builds one immutable index for many matches',()=>{
  const lengths=[2,0,3],locate=createPreviewRangeIndex(lengths)
  lengths[0]=100
  assert.deepEqual(locate(0,1),{start:{index:0,offset:0},end:{index:0,offset:1}})
  assert.deepEqual(locate(2,5),{start:{index:2,offset:0},end:{index:2,offset:3}})
  assert.equal(locate(5,6),null)
})
