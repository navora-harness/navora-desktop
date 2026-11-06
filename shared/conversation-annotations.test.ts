import test from 'node:test'
import assert from 'node:assert/strict'
import {annotationChatEntries} from './browser-annotation-chat'
import {conversationAnnotationsView,filterConversationAnnotations} from './conversation-annotations'
import type {BrowserAnnotation,BrowserAnnotationTarget} from './browser-workspace'

function note(id:string,createdAt:number,taskState:BrowserAnnotation['taskState']='pending'):BrowserAnnotation{
  return {id,createdAt,taskState,revision:3,comment:`意见 ${id}`,selection:{title:'QQ Windows 版下载',url:'https://example.test/download',text:'Windows 64位 版下载'}} as BrowserAnnotation
}
const entries=annotationChatEntries([note('one',1),note('two',2,'resolved')],[{id:'target',createdAt:3,comment:'尚未保存',selection:{title:'草稿页面'}} as BrowserAnnotationTarget])
const base={entries,query:'',state:'all' as const,selectedKey:'',page:0}
function panel(options:Partial<Parameters<typeof conversationAnnotationsView>[0]>={}){return conversationAnnotationsView({...base,...options})}

test('annotation search covers comments, source titles, URLs and selection text while keeping source order intact',()=>{
  const before=entries.map(entry=>entry.key)
  assert.equal(filterConversationAnnotations(entries,'  WINDOWS  ','all').length,2)
  assert.equal(filterConversationAnnotations(entries,'example.test','all').length,2)
  assert.equal(filterConversationAnnotations(entries,'意见 one','pending')[0]?.note?.id,'one')
  assert.equal(filterConversationAnnotations(entries,'64位','resolved')[0]?.note?.id,'two')
  assert.equal(filterConversationAnnotations(entries,'','unsaved')[0]?.target?.id,'target')
  assert.deepEqual(filterConversationAnnotations(entries,'','all').map(entry=>entry.createdAt),[3,2,1])
  assert.deepEqual(entries.map(entry=>entry.key),before)
})

test('selected detail keeps the original revision and disappears after filtering or removal',()=>{
  const saved=panel({selectedKey:'annotation:one'}),draft=panel({selectedKey:'annotation-target:target'})
  assert.equal(saved.selected?.note?.revision,3)
  assert.equal(saved.selected?.key,'annotation:one')
  assert.equal(draft.selected?.note,undefined)
  assert.equal(draft.selected?.target?.id,'target')
  assert.equal(panel({selectedKey:'deleted-note'}).selected,undefined)
  assert.equal(panel({selectedKey:'annotation:one',state:'resolved'}).selected,undefined)
})

test('large lists paginate and clamp after removal or search',()=>{
  const many=annotationChatEntries(Array.from({length:1000},(_,index)=>note(`note_${index}`,index)),[])
  const last=panel({entries:many,page:10000})
  assert.equal(last.pages,125);assert.equal(last.page,124);assert.equal(last.visible.length,8)
  assert.equal(panel({query:'does not exist',page:100}).page,0)
  assert.equal(panel({entries:[]}).visible.length,0)
})
