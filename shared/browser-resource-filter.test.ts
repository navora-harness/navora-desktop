import test from 'node:test'
import assert from 'node:assert/strict'
import { filterBrowserResourceOwners } from './browser-resource-filter'
import type { BrowserTreeSession, ChatSession } from './types'
const chats=[{id:'empty',title:'无资源对话'},{id:'saved',title:'资料保管'},{id:'main',title:'当前任务'},{id:'pages',title:'其它网页'}] as ChatSession[]
const sessions=[{sessionId:'saved',chatId:'saved',sessionIndex:1,name:'账户资料',windows:[]},{sessionId:'active',chatId:'pages',sessionIndex:1,windows:[{title:'参考规范',url:'https://example.test/docs'}]}] as BrowserTreeSession[]
const options={currentChatId:'main',scope:'all',includeEmpty:false,query:''} as const
test('browser resources show populated owners first and keep only the current resource-free creation entry',()=>{
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,options).map(chat=>chat.id),['pages','main'])
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,{...options,includeEmpty:true}).map(chat=>chat.id),['pages','main','saved'])
})
test('search finds named empty sessions despite the page filter and preserves the chosen scope',()=>{
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,{...options,query:'账户资料'}).map(chat=>chat.id),['saved'])
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,{...options,query:'example.test'}).map(chat=>chat.id),['pages'])
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,{...options,query:'账户资料',scope:'current'}),[])
  assert.deepEqual(filterBrowserResourceOwners(chats,sessions,{...options,scope:'current'}).map(chat=>chat.id),['main'])
})
