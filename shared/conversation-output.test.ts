import test from 'node:test'
import assert from 'node:assert/strict'
import type {ChatMessage} from './types'
import {conversationOutputBlocks,conversationProcessGroups,boundedToolOutput,toolActivityLabel} from './conversation-output'
const message=(id:string,role:ChatMessage['role'],content=id,meta:ChatMessage['meta']={}):ChatMessage=>({id,role,content,createdAt:1,meta})
test('a terminated progress-only run collapses without inventing a successful answer',()=>{
  const rows=[message('user','user'),message('progress','assistant','正在处理',{runId:'limited',phase:'progress'}),message('call','tool','实际结果',{runId:'limited',status:'done'}),message('limit','log','达到轮次上限',{runId:'limited',kind:'round_limit'}),message('end','log','本轮运行已结束。',{runId:'limited',kind:'agent_run_end',stopReason:'round_limit'})]
  const group=conversationProcessGroups(rows)[0]!
  assert.ok(group);assert.equal(group.outcome?.label,'已达到轮次上限');assert.match(group.outcome!.detail,/未生成最终答复/)
  assert.equal(group.processIds.has('progress'),true);assert.equal(group.processIds.has('call'),true);assert.equal(group.processIds.has('user'),false)
  assert.ok(conversationProcessGroups(rows,false,false)[0]);assert.equal(conversationProcessGroups(rows).length,1)
})
test('an error or unclassified end keeps its real outcome outside the collapsed process',()=>{
  const rows=[message('p','assistant','部分进展',{runId:'one',phase:'progress'}),message('error','log','连接中断',{runId:'one',kind:'agent_error'})]
  const error=conversationProcessGroups(rows)[0]!
  assert.equal(error.outcome?.label,'运行中断');assert.equal(error.outcome?.detail,'连接中断');assert.equal(error.outcome?.error,true)
  const ended=conversationProcessGroups([rows[0]!,message('end','log','本轮运行已结束。',{runId:'one',kind:'agent_run_end',stopReason:'model_final'})])[0]!
  assert.equal(ended.outcome?.label,'本轮已结束');assert.match(ended.outcome!.detail,/未记录最终答复/)
})
test('idle or active progress alone never certifies completion and cannot swallow another run',()=>{
  const progress=message('progress','assistant','处理中',{runId:'live',phase:'progress'})
  assert.equal(conversationProcessGroups([progress],false).length,0)
  assert.equal(conversationProcessGroups([progress,message('error','log','中途错误',{runId:'live',kind:'agent_error'})],true).length,0)
  const rows=[message('old','assistant','上次进展',{runId:'old',phase:'progress'}),message('answer','assistant','上次结果',{runId:'old',phase:'final'}),progress,message('old-end','log','迟到结束',{runId:'old',kind:'agent_run_end'})]
  const groups=conversationProcessGroups(rows,true)
  assert.equal(groups.length,1);assert.equal(groups[0]!.outcome,undefined);assert.equal(groups[0]!.processIds.has('old-end'),true);assert.equal(groups[0]!.processIds.has('progress'),false);assert.equal(groups[0]!.processIds.has('answer'),false)
})
test('flat transcript preserves interleaved progress, tools and late events without moving across runs',()=>{
  const rows=[message('p','assistant','正在检查',{phase:'progress',runId:'one'}),message('t','tool','结果',{runId:'one'}),message('a','assistant','说明',{phase:'final',runId:'one'}),message('late','log','最后记录',{runId:'one'}),message('next','assistant','下一轮',{runId:'two'})]
  assert.deepEqual(conversationOutputBlocks(rows).map(block=>block.key),rows.map(row=>row.id))
  assert.ok(conversationOutputBlocks(rows).every(block=>block.type!=='run'))
})
test('hidden routine logs retain actual errors and stops, repeated message IDs do not duplicate',()=>{
  const rows=[message('log','log','普通记录'),message('error','log','失败',{kind:'agent_error'}),message('stop','log','停止',{kind:'agent_stop'})]
  assert.deepEqual(conversationOutputBlocks([...rows,rows[1]!],false).map(block=>block.key),['error','stop'])
})

test('download notifications stay in stored context without appearing in conversations or process summaries',()=>{
  const rows=[message('u','user','下载文件'),
    message('start','log','浏览器下载开始：setup.exe',{kind:'browser_download',download:{state:'started',path:'downloads/setup.exe'},runId:'run'}),
    message('done','log','浏览器下载完成：setup.exe',{kind:'browser_download',download:{state:'completed',path:'downloads/setup.exe'},runId:'run'}),
    message('old','log','浏览器下载完成：旧文件.zip\n工作区路径：downloads/旧文件.zip',{kind:'user_op'}),
    message('answer','assistant','文件已下载',{runId:'run',phase:'final'}),
    message('error','log','实际运行错误',{kind:'agent_error'})]
  const stored=structuredClone(rows)
  for(const showLogs of [true,false])assert.deepEqual(conversationOutputBlocks(rows,showLogs).map(block=>block.key),['u','answer','error'])
  const groups=conversationProcessGroups(rows)
  assert.ok(groups.every(group=>!['start','done','old'].some(id=>group.processIds.has(id))))
  assert.deepEqual(rows,stored,'Agent history, download evidence and file paths must be retained')
})
test('activity summaries do not turn errors or unknown status into success and large output is bounded',()=>{
  const row=message('exec','tool','x',{toolName:'terminal.exec',status:'error'})
  assert.equal(toolActivityLabel(row),'运行命令未完成')
  assert.equal(toolActivityLabel(row,'unconfirmed'),'运行命令 · 状态待确认')
  assert.equal(toolActivityLabel(message('old','tool','old result',{toolName:'terminal.exec'})),'运行命令 · 状态待确认')
  const long='中'.repeat(1000000),result=boundedToolOutput(long)
  assert.equal(result.text.length,24000);assert.equal(result.truncated,true);assert.equal(result.total,long.length)
})
