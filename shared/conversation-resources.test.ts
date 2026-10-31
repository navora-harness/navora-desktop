import test from 'node:test'
import assert from 'node:assert/strict'
import {ResourceAutoOpen,browserResourceIds,conversationSources} from './conversation-resources'
import type {BrowserTreeSession} from './types'
import type {ChatMessage} from './types'

test('resource sources deduplicate citations and reject executable or credential URLs',()=>{
  const messages=[
    {id:'source',createdAt:1,role:'assistant',content:'',meta:{sources:[{url:'https://example.com/doc#old',title:'Old'}]}},
    {id:'source',createdAt:1,role:'assistant',content:'',meta:{sources:[{url:'https://example.com/doc#new',title:'Latest'},{url:'javascript:alert(1)'},{url:'https://user:secret@example.com/private'},{url:'broken'}]}},
  ] as ChatMessage[]
  assert.deepEqual(conversationSources(messages),[{url:'https://example.com/doc',title:'Latest'}])
})

test('resource discovery opens new files and windows without reopening dismissed resources',()=>{
  const state=new ResourceAutoOpen()
  assert.equal(state.update('a',[]),false)
  assert.equal(state.update('a',['file:report']),true)
  assert.equal(state.update('a',['file:report']),false)
  assert.equal(state.update('b',[]),false)
  assert.equal(state.update('a',['file:report']),false)
  assert.equal(state.update('a',['file:report','browser:window1']),true)
  assert.equal(state.update('a',['file:report']),false)
  assert.equal(state.update('a',['file:report','browser:window2']),true)
})
test('browser title, visibility and loading changes do not change resource identity',()=>{
  const tree=[{sessionId:'s',windows:[{windowId:'w',title:'Loading',loading:true,visible:false}]}] as BrowserTreeSession[]
  const ids=browserResourceIds(tree)
  tree[0]!.windows[0]!.title='Ready';tree[0]!.windows[0]!.loading=false;tree[0]!.windows[0]!.visible=true
  assert.deepEqual(browserResourceIds(tree),ids)
})
