import {test} from 'node:test'
import assert from 'node:assert/strict'
import {annotationChatEntries} from './browser-annotation-chat'
import type {BrowserAnnotation,BrowserAnnotationDraft,BrowserAnnotationTarget,BrowserDraftCopy} from './browser-workspace'
test('saved and pending cards retain their real identity; committed target is not duplicated',()=>{
  const note={id:'ann_one',sourceTargetId:'target_one',createdAt:20,comment:'保存意见'} as BrowserAnnotation
  const committed={id:'target_one',createdAt:10} as BrowserAnnotationTarget,pending={id:'target_two',createdAt:30,comment:'未保存意见'} as BrowserAnnotationTarget
  const draft={annotationId:note.id,text:'修改草稿',deleted:false} as BrowserAnnotationDraft,deleted={annotationId:note.id,text:'旧草稿',deleted:true} as BrowserAnnotationDraft,copy={annotationId:note.id,id:'copy',text:'冲突文字'} as BrowserDraftCopy
  const entries=annotationChatEntries([note,note],[committed,pending],[deleted,draft],[copy])
  assert.deepEqual(entries.map(entry=>entry.key),['annotation:ann_one','annotation-target:target_two'])
  assert.equal(entries[0]!.note,note);assert.equal(entries[0]!.draft,draft);assert.equal(entries[0]!.copies[0],copy)
  assert.equal(entries[1]!.target,pending)
})
