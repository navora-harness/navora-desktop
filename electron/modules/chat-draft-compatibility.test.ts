import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ChatStore} from './chat-store'
import {createComposerDocument} from '../../shared/composer-document'

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-draft-compat-'));fs.mkdirSync(path.join(root,'chats'));return {root,seed:(value:unknown)=>fs.writeFileSync(path.join(root,'chats','chat-a.json'),JSON.stringify(value)),read:()=>JSON.parse(fs.readFileSync(path.join(root,'chats','chat-a.json'),'utf8')),cleanup(){const relative=path.relative(os.tmpdir(),root);assert.ok(relative.startsWith('navora-draft-compat-')&&!relative.includes(path.sep)&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true})}}}
const chat=()=>({id:'chat-a',title:'fixture',createdAt:1,updatedAt:1,messages:[],draft:'可读的旧文本副本',draftRevision:7})
const future=()=>({...createComposerDocument('chat-a'),schemaVersion:3,revision:7,content:[{type:'futureSource',attrs:{identity:'preserve-this',payload:{nested:['不可丢弃']}}}]})

test('unrecognized draft and recovery are retained verbatim across unrelated chat persistence',()=>{
  const f=fixture();try{const raw=future(),recovery={id:'recovery',document:raw,createdAt:2,reason:'send_failed'};f.seed({...chat(),draftDocument:raw,draftRecoveries:[recovery]});const store=new ChatStore(f.root),loaded=store.get('chat-a')!
    assert.equal(loaded.draftDocument,undefined);assert.deepEqual(loaded.draftUnsupportedDocument,raw);assert.deepEqual(loaded.draftUnsupportedRecoveries,[recovery]);assert.equal(loaded.draft,'可读的旧文本副本')
    assert.throws(()=>store.setDraft('chat-a','覆盖',{baseRevision:7}),/composer_document_version/);assert.throws(()=>store.clearDraftRevision('chat-a',7),/composer_document_version/)
    store.setExecutionMode('chat-a','chat');store.flushAll();const persisted=f.read();assert.deepEqual(persisted.draftUnsupportedDocument,raw);assert.deepEqual(persisted.draftUnsupportedRecoveries,[recovery])
    const reopened=new ChatStore(f.root);assert.deepEqual(reopened.get('chat-a')?.draftUnsupportedDocument,raw)
  }finally{f.cleanup()}
})

test('a compatible app restores retained documents without replacing their identity or formatted content',()=>{
  const f=fixture();try{const raw={...createComposerDocument('chat-a','**保持原文档**'),revision:7};f.seed({...chat(),draftUnsupportedDocument:raw});const store=new ChatStore(f.root),loaded=store.get('chat-a')!
    assert.equal(loaded.draftUnsupportedDocument,undefined);assert.equal(loaded.draftDocument?.id,raw.id);assert.deepEqual(loaded.draftDocument?.content,raw.content)
    assert.doesNotThrow(()=>store.setDraft('chat-a','新编辑',{baseRevision:7}));store.flushAll()
  }finally{f.cleanup()}
})

test('queued documents with unknown versions stay paused and retain their original structure',()=>{
  const f=fixture();try{const raw=future();f.seed({...chat(),queuedMessages:[{id:'queued',content:'可读队列副本',document:raw,createdAt:1}]});const store=new ChatStore(f.root),loaded=store.get('chat-a')!
    assert.equal(loaded.queuePaused,true);assert.equal(loaded.queuedMessages?.[0].error,'invalid_composer_document');assert.deepEqual(loaded.queuedMessages?.[0].document,raw)
    store.flushChat('chat-a');assert.deepEqual(f.read().queuedMessages[0].document,raw)
  }finally{f.cleanup()}
})
