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


test('resource citations exclude narration while preserving evidence on the final answer',()=>{
  const messages=[
    {id:'note',role:'assistant',content:'Opening source',createdAt:1,meta:{sources:[{url:'https://example.com/progress'}]}},
    {id:'tool',role:'tool',content:'done',createdAt:2},
    {id:'answer',role:'assistant',content:'Result',createdAt:3,meta:{phase:'final',sources:[{url:'https://example.com/final'}]}},
  ] as ChatMessage[]
  assert.deepEqual(conversationSources(messages).map(source=>source.url),['https://example.com/final'])
})
import {ResourceUnreadTracker,browserSummaryResources} from './conversation-resources'

test('summary unread baseline is silent and revisions deduplicate per resource',()=>{
  const tracker=new ResourceUnreadTracker(),file={id:'file:one',version:'1'}
  assert.equal(tracker.update('chat',[file]),0)
  assert.equal(tracker.update('chat',[{...file,version:'2'}]),1)
  assert.equal(tracker.update('chat',[{...file,version:'2'}]),1)
  assert.equal(tracker.update('chat',[{...file,version:'3'},{id:'file:two',version:'1'}]),2)
  tracker.markRead('chat');assert.equal(tracker.count('chat'),0)
  assert.equal(tracker.update('chat',[{...file,version:'4'}],true),0)
})
test('summary unread state stays with its chat and removes deleted resources',()=>{
  const tracker=new ResourceUnreadTracker();tracker.update('a',[]);tracker.update('b',[])
  tracker.update('a',[{id:'file:a',version:'1'}]);tracker.update('b',[{id:'file:b',version:'1'}])
  tracker.markRead('b');assert.equal(tracker.count('a'),1);assert.equal(tracker.count('b'),0)
  assert.equal(tracker.update('a',[]),0)
  assert.equal(tracker.update('a',[{id:'file:a',version:'2'}]),1)
})
test('summary ignores start pages and failed loads, and navigation metadata never repeats a badge',()=>{
  const page={windowId:'page',url:'about:blank',title:'',loading:false} as BrowserTreeSession['windows'][number]
  const tree=[{windows:[page]}] as BrowserTreeSession[]
  assert.deepEqual(browserSummaryResources(tree),[])
  page.url='https://example.test/';const initial=browserSummaryResources(tree)
  page.title='A new title';page.loading=true;page.visible=true;page.url='https://example.test/next'
  assert.deepEqual(browserSummaryResources(tree),initial)
  page.loadError={code:-105,url:page.url,description:'fixture'};assert.deepEqual(browserSummaryResources(tree),[])
})
