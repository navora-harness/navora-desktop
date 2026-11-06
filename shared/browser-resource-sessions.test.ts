import test from 'node:test'
import assert from 'node:assert/strict'
import {browserPagesByChat,browserResourceSessions,mergeBrowserResourceSessions} from './browser-resource-sessions'
import {publicBrowserSession} from './browser-session'
import type {BrowserTreeSession,BrowserTreeWindow} from './types'

const page=(id:string,chatId:string,title=id)=>({windowId:id,sessionId:'sess_default',chatId,title,url:`https://example.test/${id}`} as BrowserTreeWindow)
const shared={...publicBrowserSession(),windows:[page('a','chat-a','规格'),page('b','chat-b','设计')]}
const empty={sessionId:'private-b',chatId:'chat-b',sessionIndex:1,partition:'persist:private-b',persist:true,name:'独立账户',windows:[]} as BrowserTreeSession
const chats=[{id:'chat-a',title:'当前任务'},{id:'chat-b',title:'参考任务'}],options={currentChatId:'chat-a',scope:'all' as const,includeEmpty:false,query:''}
test('session-first resources keep one public entry, scope page counts, and expose empty private sessions explicitly',()=>{
  const all=browserResourceSessions(chats,[shared,empty],options)
  assert.deepEqual(all.sessions.map(session=>session.sessionId),['sess_default']);assert.equal(all.pages,2);assert.equal(all.hiddenEmpty,1)
  const current=browserResourceSessions(chats,[shared,empty],{...options,scope:'current'})
  assert.deepEqual(current.sessions[0]!.windows.map(page=>page.windowId),['a']);assert.equal(current.pages,1);assert.equal(current.hiddenEmpty,0)
  assert.equal(browserResourceSessions(chats,[shared,empty],{...options,includeEmpty:true}).sessions.length,2)
  assert.equal(browserResourceSessions(chats,[],options).sessions[0]!.initialized,false)
  assert.equal(browserResourceSessions(chats,[shared],{...options,scope:'current',currentChatId:''}).pages,2)
})
test('resource search respects owner scope and discovers a named empty session without duplicating default',()=>{
  const byOwner=browserResourceSessions(chats,[shared,empty],{...options,query:'参考任务'})
  assert.deepEqual(byOwner.sessions[0]!.windows.map(page=>page.windowId),['b']);assert.equal(byOwner.sessions.length,2)
  const scoped=browserResourceSessions(chats,[shared,empty],{...options,scope:'current',query:'参考任务'})
  assert.equal(scoped.sessions.length,1);assert.equal(scoped.pages,0);assert.equal(scoped.matched,0)
  const named=browserResourceSessions(chats,[shared,empty],{...options,query:'独立账户'})
  assert.equal(named.sessions.length,2);assert.equal(named.matched,1);assert.equal(named.pages,0)
  assert.equal(browserResourceSessions(chats,[shared,{...shared,windows:[page('a','chat-a')]}],options).pages,2)
})
test('partial public snapshots replace only their own chat pages and remove closed pages without erasing other owners',()=>{
  const next=mergeBrowserResourceSessions([shared,empty],'chat-a',[{...publicBrowserSession(),windows:[page('a-new','chat-a')]}])
  assert.deepEqual(next[0]!.windows.map(page=>page.windowId),['b','a-new']);assert.equal(next[1]!.sessionId,'private-b')
  const closed=mergeBrowserResourceSessions(next,'chat-a',[publicBrowserSession()])
  assert.deepEqual(closed[0]!.windows.map(page=>page.windowId),['b'])
  assert.deepEqual(shared.windows.map(page=>page.windowId),['a','b'],'Projection never mutates a prior snapshot')
})
test('workspace page grouping uses each public page origin and preserves legacy private ownership',()=>{
  const groups=browserPagesByChat([shared,{...empty,windows:[{...page('legacy',''),chatId:undefined}]}])
  assert.deepEqual([...groups.keys()],['chat-a','chat-b'])
  assert.deepEqual(groups.get('chat-a')!.map(page=>page.windowId),['a'])
  assert.deepEqual(groups.get('chat-b')!.map(page=>page.windowId),['b','legacy'])
})
