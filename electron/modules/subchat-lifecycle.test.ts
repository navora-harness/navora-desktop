import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ChatStore} from './chat-store'
import {AgentInbox} from './agent-inbox'
import {assertSubchatCapacity} from '../../shared/subchat-runtime'

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-subchat-'));return {store:new ChatStore(root),root,cleanup(){const relative=path.relative(os.tmpdir(),root);assert.ok(relative.startsWith('navora-subchat-')&&!relative.includes(path.sep)&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true})}}}
test('follow-up attempts update current state while retaining first delegation receipt and refusing stale completion',()=>{
  const f=fixture();try{const parent=f.store.create(),chat=f.store.create('任务',{kind:'sub',parentChatId:parent.id})
    const first=f.store.beginSubchatRun(chat.id,'first')!;assert.equal(first.attempt,1);assert.ok(first.startedAt)
    assert.equal(f.store.finishSubchatRun(chat.id,'first','done','原结果')?.firstResult,true);const receipt=structuredClone(chat.spawnResult)
    f.store.beginSubchatRun(chat.id,'second');assert.equal(chat.spawnStatus,'running');assert.equal(chat.subchatRun?.attempt,2)
    assert.equal(f.store.finishSubchatRun(chat.id,'first','failed','过期回执'),null);assert.equal(chat.subchatRun?.status,'running')
    assert.equal(f.store.finishSubchatRun(chat.id,'second','failed','补充失败')?.firstResult,false);assert.deepEqual(chat.spawnResult,receipt);assert.equal(chat.subchatRun?.summary,'补充失败')
    assert.equal(f.store.finishSubchatRun(chat.id,'second','done','重复回执'),null)
  }finally{f.store.flushAll();f.cleanup()}
})
test('restart reconciles current and legacy running children and frees their persisted quota',()=>{
  const f=fixture();try{const parent=f.store.create(),current=f.store.create('新',{kind:'sub',parentChatId:parent.id}),legacy=f.store.create('旧',{kind:'sub',parentChatId:parent.id})
    f.store.beginSubchatRun(current.id,'real-run');f.store.flushAll();const reopened=new ChatStore(f.root)
    for(const id of [current.id,legacy.id]){const chat=reopened.get(id)!;assert.equal(chat.subchatRun?.status,'interrupted');assert.equal(chat.spawnStatus,'failed');assert.equal(chat.spawnResult?.status,'failed')}
    assert.equal(reopened.get(legacy.id)?.subchatRun?.startedAt,undefined);assert.ok(reopened.get(current.id)?.subchatRun?.startedAt)
    assert.doesNotThrow(()=>assertSubchatCapacity(reopened.get(current.id)!,reopened.listChildren(parent.id),new Set(),1));const again=new ChatStore(f.root);assert.deepEqual(again.get(current.id)?.subchatRun,reopened.get(current.id)?.subchatRun)
  }finally{f.store.flushAll();f.cleanup()}
})
test('legacy terminal delegation is not rewritten by a new retry',()=>{
  const f=fixture();try{const parent=f.store.create(),chat=f.store.create('旧',{kind:'sub',parentChatId:parent.id,spawnStatus:'done'});f.store.appendMessage(chat.id,{role:'assistant',content:'原委派结论'})
    f.store.beginSubchatRun(chat.id,'retry');assert.equal(chat.spawnResult?.finishedAt,undefined);assert.equal(chat.spawnResult?.summary,'原委派结论');assert.equal(f.store.finishSubchatRun(chat.id,'retry','cancelled','已停止')?.firstResult,false)
  }finally{f.store.flushAll();f.cleanup()}
})
test('sibling quota failure retains a child follow-up queue for explicit resume without adding a user turn',async()=>{
  const f=fixture();try{const parent=f.store.create(),a=f.store.create('a',{kind:'sub',parentChatId:parent.id}),b=f.store.create('b',{kind:'sub',parentChatId:parent.id});const running=new Set([b.id]),started:string[]=[]
    const inbox=new AgentInbox({get:id=>f.store.get(id),save:(id,entries,paused)=>f.store.setMessageQueue(id,entries,paused),changed:()=>{},running:id=>running.has(id),start:async(id,input)=>{assertSubchatCapacity(f.store.get(id)!,f.store.listChildren(parent.id),running,1);f.store.appendMessage(id,{role:'user',content:input.content});started.push(id);running.add(id)},insert:()=>false,maxChars:()=>16000})
    await inbox.submit(a.id,{content:'补充'},'queue');assert.equal(a.queuePaused,true);assert.equal(a.messages.length,0);assert.match(a.queuedMessages?.[0].error||'',/max_subchats/)
    running.delete(b.id);await inbox.resume(a.id);assert.deepEqual(started,[a.id]);assert.equal(a.messages.length,1);assert.equal(a.queuedMessages?.length,0)
  }finally{f.store.flushAll();f.cleanup()}
})
test('readable child message versions advance for transcript edits, not drafts or model selections',()=>{
  const f=fixture();try{const parent=f.store.create(),chat=f.store.create('任务',{kind:'sub',parentChatId:parent.id}),message=f.store.appendMessage(chat.id,{role:'assistant',content:'第一版'})!
    assert.equal(chat.subchatMessageVersion,1);assert.equal(message.meta?.subchatVersion,1)
    f.store.setProvider(chat.id,'provider','model');f.store.setDraft(chat.id,'未发送');assert.equal(chat.subchatMessageVersion,1)
    f.store.updateMessage(chat.id,message.id,{content:'第二版'});assert.equal(chat.subchatMessageVersion,2);assert.equal(message.meta?.subchatVersion,2)
    f.store.updateMessage(chat.id,message.id,{content:'第二版'});assert.equal(chat.subchatMessageVersion,2)
  }finally{f.store.flushAll();f.cleanup()}
})
