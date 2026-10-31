import test from 'node:test'
import assert from 'node:assert/strict'
import { executionSummary, finalOutputs, progressMessageIds, transcriptBlocks } from './message-presentation'
import type { ChatMessage } from './types'

const message = (id: string, role: ChatMessage['role'], meta?: ChatMessage['meta']): ChatMessage => ({id,role,content:id,createdAt:1,meta})
const options = {collapseTools:true,collapseLogs:true,showLogs:true}

test('legacy narration joins tool activity while final answers and separate user turns survive', () => {
  const messages = [message('u','user'),message('retry','assistant',{partial:false}),message('t','tool'),
    message('read','assistant'),message('t2','tool'),message('answer','assistant'),
    message('u2','user'),message('plain','assistant')]
  assert.deepEqual([...progressMessageIds(messages)].sort(),['read','retry'])
  assert.deepEqual(finalOutputs(messages).map(m=>m.id),['answer','plain'])
  const blocks=transcriptBlocks(messages,options)
  assert.deepEqual(blocks.map(b=>b.type),['chat','run','chat','chat','chat'])
  assert.deepEqual(blocks[1]!.type==='run' && blocks[1].items.map(m=>m.id),['retry','t','read','t2'])
  assert.equal(messages[1]!.meta?.partial,false,'Historical data stays untouched')
})

test('persistent phase survives cleared shimmer, cancellation and tool-only continuations', () => {
  const messages=[message('u','user'),message('final','assistant',{phase:'final'}),message('tool','tool'),
    message('progress','assistant',{phase:'progress',partial:false}),message('stop','log',{kind:'agent_stop'})]
  assert.deepEqual(finalOutputs(messages).map(m=>m.id),['final'])
  assert.equal(progressMessageIds(messages).has('progress'),true)
  const partial=[message('pending','assistant',{partial:true})]
  assert.equal(finalOutputs(partial).length,0)
  assert.equal(transcriptBlocks(messages,options).at(-1)!.type,'run')
})

test('one aggregate reasoning disclosure belongs to the process, not the final output', () => {
  const messages=[message('u','user'),message('step','assistant',{phase:'progress',reasoning:'round 1'}),
    message('tool','tool'),message('final','assistant',{phase:'final',reasoning:'round 1\nround 2'})]
  const blocks=transcriptBlocks(messages,options)
  assert.equal(blocks.length,3)
  assert.equal(blocks[1]!.type==='run' && blocks[1].reasoning,'round 1\nround 2')
  assert.equal(finalOutputs(messages)[0]!.content,'final')
  const pure=transcriptBlocks([message('a','assistant',{reasoning:'thought'})],options)
  assert.deepEqual(pure.map(b=>b.type),['run','chat'])
})

test('expanded-tool and hidden-log preferences retain progress and terminal failures', () => {
  const messages=[message('u','user'),message('step','assistant',{phase:'progress'}),message('tool','tool'),
    message('hidden','log',{kind:'agent_status'}),message('failure','log',{kind:'agent_error'})]
  const blocks=transcriptBlocks(messages,{collapseTools:false,collapseLogs:false,showLogs:false})
  assert.deepEqual(blocks.map(b=>b.type),['chat','run','tool','log'])
  const last=blocks.at(-1)!
  assert.equal(last.type==='log' && last.message.id,'failure')
})


test('turn stopping and round limits remain visible when routine logs are disabled',()=>{
  for(const kind of ['agent_stop','round_limit']){
    const blocks=transcriptBlocks([message('u','user'),message('end','log',{kind})],{collapseTools:true,collapseLogs:true,showLogs:false})
    assert.equal(blocks.at(-1)!.type,'run')
    const last=blocks.at(-1)!
    assert.equal(last.type==='run'&&last.items[0]!.meta?.kind,kind)
  }
})

test('post-answer logs rejoin the existing execution without crossing turns or later tool continuations',()=>{
  const first=[message('u','user'),message('t','tool'),message('a','assistant',{phase:'final'})]
  const logs=[message('l1','log',{kind:'agent_status'}),message('l2','log',{kind:'user_choice'})]
  const all=[...first,...logs,message('u2','user'),message('a2','assistant',{phase:'final'}),message('l3','log'),message('t2','tool'),message('l4','log')]
  const original=JSON.stringify(all),blocks=transcriptBlocks(all,options)
  assert.deepEqual(blocks.map(block=>block.key),['u','run:t','a','u2','run:l3','a2','run:t2'])
  assert.deepEqual(blocks.filter(block=>block.type==='run').map(block=>block.items.map(item=>item.id)),[['t','l1','l2'],['l3'],['t2','l4']])
  assert.equal(transcriptBlocks(first,options)[1]!.key,blocks[1]!.key,'Appending closing logs preserves the disclosure key')
  assert.equal(JSON.stringify(all),original,'Grouping does not mutate the persisted transcript')
})

test('manual resource closure stays quiet while genuine failures remain visible',()=>{
  const all=[message('u','user'),message('t','tool'),message('a','assistant'),
    {...message('close','log',{kind:'user_op',summary:'你关闭了一个浏览器窗口'}),content:'你关闭了一个浏览器窗口\n窗口 ID：123'},
    message('error','log',{kind:'agent_error'})]
  const blocks=transcriptBlocks(all,options),run=blocks.find(block=>block.type==='run')!
  assert.deepEqual(run.type==='run'&&run.items.map(item=>item.id),['t','error'])
  assert.equal(all.length,5,'Legacy logs remain in original history and JSON exports')
})

test('execution summaries count logs and attempted calls without claiming all attempts succeeded',()=>{
  const all=[message('ok','tool',{status:'done'}),message('failed','tool',{status:'error'}),message('log','log',{kind:'agent_status'})]
  assert.equal(executionSummary(all),'执行记录 · 2 次调用 · 1 条日志 · 1 次调用失败')
  assert.equal(executionSummary(all,{live:true,runningLabel:'读取页面'}),'正在读取页面 · 2 次调用 · 1 条日志 · 1 次调用失败')
  assert.match(executionSummary([...all,message('error','log',{kind:'agent_error'})]),/^执行中断/)
  assert.match(executionSummary([...all,message('stop','log',{kind:'agent_stop'})]),/^已停止/)
  assert.match(executionSummary([message('limit','log',{kind:'round_limit'})]),/^已达轮次上限/)
  assert.equal(executionSummary([message('thought','assistant')]),'执行记录')
})
