import test from 'node:test'
import assert from 'node:assert/strict'
import type {ChatMessage} from './types'
import {conversationOutputBlocks,boundedToolOutput,toolActivityLabel} from './conversation-output'
const message=(id:string,role:ChatMessage['role'],content=id,meta:ChatMessage['meta']={}):ChatMessage=>({id,role,content,createdAt:1,meta})
test('flat transcript preserves interleaved progress, tools and late events without moving across runs',()=>{
  const rows=[message('p','assistant','正在检查',{phase:'progress',runId:'one'}),message('t','tool','结果',{runId:'one'}),message('a','assistant','说明',{phase:'final',runId:'one'}),message('late','log','最后记录',{runId:'one'}),message('next','assistant','下一轮',{runId:'two'})]
  assert.deepEqual(conversationOutputBlocks(rows).map(block=>block.key),rows.map(row=>row.id))
  assert.ok(conversationOutputBlocks(rows).every(block=>block.type!=='run'))
})
test('hidden routine logs retain actual errors and stops, repeated message IDs do not duplicate',()=>{
  const rows=[message('log','log','普通记录'),message('error','log','失败',{kind:'agent_error'}),message('stop','log','停止',{kind:'agent_stop'})]
  assert.deepEqual(conversationOutputBlocks([...rows,rows[1]!],false).map(block=>block.key),['error','stop'])
})
test('activity summaries do not turn errors or unknown status into success and large output is bounded',()=>{
  const row=message('exec','tool','x',{toolName:'terminal.exec',status:'error'})
  assert.equal(toolActivityLabel(row),'运行命令未完成')
  assert.equal(toolActivityLabel(row,'unconfirmed'),'运行命令 · 状态待确认')
  assert.equal(toolActivityLabel(message('old','tool','old result',{toolName:'terminal.exec'})),'运行命令 · 状态待确认')
  const long='中'.repeat(1000000),result=boundedToolOutput(long)
  assert.equal(result.text.length,24000);assert.equal(result.truncated,true);assert.equal(result.total,long.length)
})
