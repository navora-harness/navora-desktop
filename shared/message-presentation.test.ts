import test from 'node:test'
import assert from 'node:assert/strict'
import { finalOutputs, progressMessageIds, transcriptBlocks } from './message-presentation'
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
