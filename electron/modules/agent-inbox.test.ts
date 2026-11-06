import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentInbox} from './agent-inbox'
import type {ChatSession} from '../../shared/types'
import {createComposerDocument} from '../../shared/composer-document'
function fixture(){
  let running=true,fail=false
  const chat:ChatSession={id:'chat',title:'fixture',createdAt:1,updatedAt:1,messages:[]}
  const starts:string[]=[],inserts:string[]=[]
  const inbox=new AgentInbox({get:id=>id==='chat'?chat:null,save:(_id,entries,paused)=>{chat.queuedMessages=entries;chat.queuePaused=paused},changed:()=>{},running:()=>running,
    start:async(_id,input)=>{if(fail)throw Error('capacity');starts.push(input.content);running=true},insert:(_id,input)=>{inserts.push(input.content);return running},accepted:(_id,key,fingerprint)=>{chat.acceptedClientMessageIds=[...(chat.acceptedClientMessageIds||[]),{id:key,fingerprint,acceptedAt:Date.now()}]},maxChars:()=>1000})
  return {chat,inbox,starts,inserts,setRunning:(value:boolean)=>{running=value},setFail:(value:boolean)=>{fail=value}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('post-acceptance coordination runs after durable acceptance but before an idle queue starts',async()=>{
  const f=fixture();f.setRunning(false);let coordinated=0
  await f.inbox.submit('chat',{content:'解释问卷',clientMessageId:'form-to-chat'},'insert',()=>{
    assert.equal(f.chat.queuedMessages?.[0]?.content,'解释问卷')
    assert.equal(f.chat.acceptedClientMessageIds?.[0]?.id,'form-to-chat')
    assert.deepEqual(f.starts,[]);coordinated++
  })
  assert.equal(coordinated,1);assert.deepEqual(f.starts,['解释问卷'])
  assert.equal(await f.inbox.submit('chat',{content:'解释问卷',clientMessageId:'form-to-chat'},'insert',()=>{coordinated++}),false)
  await assert.rejects(f.inbox.submit('chat',{content:''},'insert',()=>{coordinated++}),/empty_message/)
  assert.equal(coordinated,1)
})

test('legacy edits and queue resume cannot discard an unsupported structured message',async()=>{
  const f=fixture(),raw={schemaVersion:4,id:'future',chatId:'chat',revision:1,updatedAt:1,content:[{type:'future-node',payload:'must remain'}]}
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

test('declarations queue during a run and cannot be inserted through the queue API',async()=>{
  const f=fixture(),document={...createComposerDocument('chat','制定方案'),declarations:{version:1,ids:['automation','plan']}}
  await f.inbox.submit('chat',{content:'ignored plain text',document},'insert')
  assert.deepEqual(f.inserts,[]);assert.equal(f.chat.queuedMessages?.length,1)
  const entry=f.chat.queuedMessages![0]!
  assert.equal(entry.taskConstraints?.phase,'plan');assert.equal(entry.taskConstraints?.source?.queueId,entry.id)
  await f.inbox.insert('chat',entry.id);assert.equal(f.chat.queuedMessages?.length,1);assert.deepEqual(f.inserts,[])
  f.setRunning(false);await f.inbox.resume('chat');assert.deepEqual(f.starts,['制定方案'])
})

test('plain queue edits retain declarations and old submission retries cannot overwrite an edited revision',async()=>{
  const f=fixture(),document={...createComposerDocument('chat','方案甲'),declarations:{version:1,ids:['plan']}},original={content:'方案甲',document,clientMessageId:'stable-request'}
  await f.inbox.submit('chat',original,'queue');const id=f.chat.queuedMessages![0]!.id
  await f.inbox.edit('chat',id,'方案乙',{baseRevision:0})
  const revised=f.chat.queuedMessages![0]!
  assert.equal(revised.content,'方案乙');assert.equal(revised.revision,1);assert.equal(revised.taskConstraints?.phase,'plan');assert.equal(revised.taskConstraints?.source?.queueRevision,1)
  assert.deepEqual(revised.document?.declarations,{version:1,ids:['plan']})
  assert.equal(await f.inbox.submit('chat',original,'queue'),false);assert.equal(f.chat.queuedMessages![0]!.content,'方案乙')
  await assert.rejects(f.inbox.submit('chat',{...original,document:{...document,declarations:{version:1,ids:[]}}},'queue'),/client_message_id_conflict/)
})

test('unknown persisted constraints and declaration-only messages fail closed without losing the queued original',async()=>{
  const f=fixture(),document={...createComposerDocument('chat','保留计划'),declarations:{version:1,ids:['plan']}}
  await f.inbox.submit('chat',{content:'',document},'queue')
  const entry=f.chat.queuedMessages![0]!
  entry.taskConstraints={...entry.taskConstraints!,version:99} as never
  f.setRunning(false);await f.inbox.resume('chat');assert.deepEqual(f.starts,[]);assert.equal(f.chat.queuePaused,true);assert.equal(f.chat.queuedMessages![0]!.taskConstraints!.version,99)
  await assert.rejects(f.inbox.submit('chat',{content:'',document:{...createComposerDocument('chat'),declarations:{version:1,ids:['plan']}}},'queue'),/empty_message/)
})
