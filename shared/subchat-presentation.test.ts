import test from 'node:test'
import assert from 'node:assert/strict'
import {subchatGlyph,subchatGroup,subchatIndex,subchatSummary,subchatTime} from './subchat-presentation'
import {assertSubchatCapacity,interruptedSubchatRun,subchatAttemptSummary,subchatInheritance} from './subchat-runtime'
import {replayConversationEvents,upsertConversationMessage} from './conversation-session'
import {revealedToolOutput} from './conversation-output'
import type {ChatSession} from './types'
const child=(id='child'):ChatSession=>({id,kind:'sub',parentChatId:'parent',title:'同名任务',createdAt:10,updatedAt:20,messages:[],spawnStatus:'running'})
test('stable SVG identity survives rename and differs across same-named children',()=>{
  assert.equal(subchatGlyph('a'),subchatGlyph('a'));assert.notEqual(subchatGlyph('a'),subchatGlyph('b'));assert.match(subchatGlyph('a'),/^<svg/);assert.doesNotMatch(subchatGlyph('<script>'),/<script>/)
})
test('index is lightweight and uses current run, pending and actual time provenance',()=>{
  const chat=child();chat.messages=[{id:'m',role:'assistant',content:'结果',createdAt:15}];chat.subchatRun={id:'r',attempt:2,status:'failed',startedAt:1000,finishedAt:62000,summary:'新运行失败'}
  const item=subchatIndex(chat,2);assert.equal(item.status,'failed');assert.equal(item.summary,'新运行失败');assert.equal('messages'in item,false);assert.equal(item.messageCount,1);assert.equal(subchatGroup(item),'attention');assert.equal(subchatTime(item,999999),'1 分 1 秒')
  delete item.run;assert.match(subchatTime(item),/^更新于 /)
})
test('capacity counts registered siblings, never persisted running markers or unrelated roots',()=>{
  const a=child('a'),b=child('b'),c=child('c')
  assert.doesNotThrow(()=>assertSubchatCapacity(a,[a,b,c],new Set(['parent','other-root']),1))
  assert.throws(()=>assertSubchatCapacity(a,[a,b,c],new Set(['b']),1),/max_subchats/)
  assert.doesNotThrow(()=>assertSubchatCapacity(a,[a,b,c],new Set(['b']),2))
  assert.throws(()=>assertSubchatCapacity({...a,parentChatId:undefined},[a],new Set(),4),/parent_not_found/)
})
test('follow-up summaries stay within the actual attempt including provider failures before a run context exists',()=>{
  const chat=child();chat.subchatRun={id:'follow-up',attempt:2,status:'failed',startedAt:100}
  chat.messages=[{id:'old',role:'assistant',content:'Earlier successful answer',createdAt:50,meta:{phase:'final',runId:'first'}},{id:'failure',role:'log',content:'Current provider failed',createdAt:101,meta:{kind:'agent_error',runId:'follow-up'}}]
  assert.equal(subchatAttemptSummary(chat),'Current provider failed');assert.equal(subchatSummary(chat),'Current provider failed')
  delete chat.messages[1].meta!.runId;assert.equal(subchatAttemptSummary(chat),'Current provider failed')
  chat.messages.pop();assert.equal(subchatAttemptSummary(chat),'');assert.equal(subchatSummary(chat),'')
  chat.messages.push({id:'new',role:'assistant',content:'Current successful answer',createdAt:102,meta:{phase:'final',runId:'follow-up'}});assert.equal(subchatAttemptSummary(chat),'Current successful answer')
})
test('creation inheritance is an independent snapshot including reasoning and execution mode',()=>{
  const parent={...child('parent'),kind:'main' as const,permissions:{preset:'balanced' as const,modes:{navigate:'ask' as const}},providerId:'provider',model:'model',reasoningLevel:'high',executionMode:'agent' as const}
  const snapshot=subchatInheritance(parent as ChatSession)
  parent.permissions.modes.navigate='allow' as 'ask';parent.reasoningLevel='low';parent.model='changed'
  assert.equal(snapshot.permissions?.modes.navigate,'ask');assert.equal(snapshot.reasoningLevel,'high');assert.equal(snapshot.executionMode,'agent');assert.equal(snapshot.model,'model')
})
test('restart recovery is explicit and never fabricates a legacy start time',()=>{
  const old=interruptedSubchatRun(child(),9000)!;assert.equal(old.status,'interrupted');assert.equal(old.startedAt,undefined);assert.equal(old.finishedAt,9000)
  const running=child();running.subchatRun={id:'real',attempt:4,startedAt:100,status:'running'};const recovered=interruptedSubchatRun(running,9000)!
  assert.equal(recovered.id,'real');assert.equal(recovered.startedAt,100);assert.equal(recovered.attempt,4);assert.equal(interruptedSubchatRun({...running,subchatRun:recovered},9999),undefined)
})
test('late snapshot replay scopes messages to their true chat and never restores a trimmed transcript',()=>{
  const snapshot=child('a');snapshot.messages=[{id:'m1',role:'user',content:'保留',createdAt:1}]
  const replay=replayConversationEvents(snapshot,[{type:'message',chatId:'b',message:{id:'foreign',role:'assistant',content:'不能串线',createdAt:2}},{type:'message',chatId:'a',message:{id:'m2',role:'assistant',content:'新消息',createdAt:2}},{type:'message_update',chatId:'a',message:{id:'m2',role:'assistant',content:'更新后',createdAt:2}},{type:'title',chatId:'a',title:'新标题'}])
  assert.deepEqual(replay.messages.map(m=>m.id),['m1','m2']);assert.equal(replay.messages[1].content,'更新后');assert.equal(replay.title,'新标题');assert.equal(snapshot.messages.length,1)
  assert.equal(upsertConversationMessage(replay.messages,{...replay.messages[1],content:'再更新'}).length,2)
})
test('search reveals a bounded actual window beyond the initial tool preview with original offsets',()=>{
  const text='a'.repeat(50000)+'查找目标'+'b'.repeat(50000),result=revealedToolOutput(text,{from:50000,to:50004})
  assert.equal(result.start,47000);assert.ok(result.text.includes('查找目标'));assert.equal(result.text.indexOf('查找目标')+result.start,50000);assert.ok(result.text.length<7000);assert.equal(result.total,text.length)
  assert.equal(revealedToolOutput(text).text.length,24000);assert.equal(revealedToolOutput(text,{from:-1,to:2}).start,0)
})
