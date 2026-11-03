import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentInbox} from './agent-inbox'
import type {ChatSession} from '../../shared/types'
function fixture(){
  let running=true,fail=false
  const chat:ChatSession={id:'chat',title:'fixture',createdAt:1,updatedAt:1,messages:[]}
  const starts:string[]=[],inserts:string[]=[]
  const inbox=new AgentInbox({get:id=>id==='chat'?chat:null,save:(_id,entries,paused)=>{chat.queuedMessages=entries;chat.queuePaused=paused},changed:()=>{},running:()=>running,
    start:async(_id,input)=>{if(fail)throw Error('capacity');starts.push(input.content);running=true},insert:(_id,input)=>{inserts.push(input.content);return running},maxChars:()=>1000})
  return {chat,inbox,starts,inserts,setRunning:(value:boolean)=>{running=value},setFail:(value:boolean)=>{fail=value}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('legacy edits and queue resume cannot discard an unsupported structured message',async()=>{
  const f=fixture(),raw={schemaVersion:3,id:'future',chatId:'chat',revision:1,updatedAt:1,content:[{type:'future-node',payload:'must remain'}]}
  f.chat.queuedMessages=[{id:'queued',content:'readable copy',createdAt:1,document:raw as unknown as NonNullable<ChatSession['draftDocument']>}]
  await assert.rejects(()=>f.inbox.edit('chat','queued','replacement'),/composer_document_version/)
  assert.deepEqual(f.chat.queuedMessages[0].document,raw)
  f.setRunning(false);await f.inbox.resume('chat');assert.equal(f.chat.queuePaused,true);assert.deepEqual(f.chat.queuedMessages[0].document,raw);assert.deepEqual(f.starts,[])
})
test('message queue preserves order through edits, deletion, stop and resume',async()=>{
  const f=fixture()
  await f.inbox.submit('chat',{content:'first'},'queue');await f.inbox.submit('chat',{content:'second'},'queue');await f.inbox.submit('chat',{content:'remove'},'queue')
  const ids=f.chat.queuedMessages!.map(entry=>entry.id)
  f.inbox.edit('chat',ids[1],'edited');f.inbox.remove('chat',ids[2])
  f.setRunning(false);f.inbox.finished('chat');f.inbox.finished('chat');await tick()
  assert.deepEqual(f.starts,['first']);assert.equal(f.chat.queuedMessages![0].content,'edited')
  f.inbox.pause('chat');f.setRunning(false);f.inbox.finished('chat');await tick();assert.equal(f.starts.length,1)
  await f.inbox.resume('chat');assert.deepEqual(f.starts,['first','edited']);assert.deepEqual(f.chat.queuedMessages,[])
})
test('insert consumes one selected entry without reordering the queue or duplicating a user turn',async()=>{
  const f=fixture()
  await f.inbox.submit('chat',{content:'queued'},'queue')
  await f.inbox.submit('chat',{content:'correction'},'insert')
  assert.deepEqual(f.inserts,['correction']);assert.equal(f.chat.queuedMessages!.length,1)
  await f.inbox.insert('chat',f.chat.queuedMessages![0].id)
  assert.deepEqual(f.inserts,['correction','queued']);assert.deepEqual(f.chat.queuedMessages,[])
})
test('a rejected start retains queued work and requires explicit resume',async()=>{
  const f=fixture();f.setRunning(false);f.setFail(true)
  await f.inbox.submit('chat',{content:'retain'},'queue')
  assert.equal(f.chat.queuedMessages![0].content,'retain');assert.equal(f.chat.queuePaused,true)
  f.inbox.finished('chat');await tick();assert.equal(f.starts.length,0)
  f.setFail(false);await f.inbox.resume('chat');assert.deepEqual(f.starts,['retain'])
  await assert.rejects(()=>f.inbox.submit('missing',{content:'x'},'queue'),/chat_not_found/)
  await assert.rejects(()=>f.inbox.submit('chat',{content:'x'.repeat(1001)},'queue'),/message_too_long/)
})
test('a new message after stopping an empty queue starts normally',async()=>{
  const f=fixture();f.inbox.pause('chat');f.setRunning(false)
  await f.inbox.submit('chat',{content:'new task'},'queue')
  assert.deepEqual(f.starts,['new task']);assert.equal(f.chat.queuePaused,false)
})
