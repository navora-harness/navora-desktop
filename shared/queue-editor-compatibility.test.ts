import test from 'node:test'
import assert from 'node:assert/strict'
import {createComposerDocument} from './composer-document'

test('queue editor recovery keeps unknown raw documents while loading and saving compatible neighbors',async()=>{
  const key='navora.queue-editor-drafts.v1',future={schemaVersion:3,id:'future-document',chatId:'chat-a',revision:1,updatedAt:1,content:[{type:'future-node',payload:'keep verbatim'}]}
  const unknown={chatId:'chat-a',entry:{id:'unknown',content:'readable',createdAt:1},document:future,updatedAt:1},known={chatId:'chat-a',entry:{id:'known',content:'known',createdAt:2},document:createComposerDocument('chat-a','known'),updatedAt:2}
  const values=new Map<string,string>([[key,JSON.stringify([unknown,known])]])
  const host=globalThis as unknown as {localStorage?:{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}},previous=host.localStorage
  host.localStorage={getItem:name=>values.get(name)||null,setItem:(name,value)=>{values.set(name,value)}}
  try{const drafts=await import('../src/editor/queue-editor-drafts')
    assert.equal(drafts.queueEditorDraftUnsupported('chat-a','unknown'),true)
    assert.equal(drafts.queueEditorDraft('chat-a','known')?.entry.id,'known')
    drafts.saveQueueEditorDraft({...known,entry:{id:'new',content:'new',createdAt:3},updatedAt:3})
    const persisted=JSON.parse(values.get(key)!) as typeof known[]
    assert.deepEqual(persisted.find(item=>item.entry.id==='unknown')?.document,future)
    drafts.removeQueueEditorDraft('chat-a','unknown')
    assert.deepEqual((JSON.parse(values.get(key)!) as typeof known[]).find(item=>item.entry.id==='unknown')?.document,future)
  }finally{host.localStorage=previous}
})
