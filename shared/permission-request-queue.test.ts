import test from 'node:test'
import assert from 'node:assert/strict'
import {permissionRequestsForChat} from './permission-request-queue'
import type {PermissionRequest} from './types'

const request=(id:string,chatId:string):PermissionRequest=>({id,chatId,capability:'file.write',detail:'create file',timeoutMs:120000})

test('permission inbox keeps arrival order and shows active chat plus its sub-chats',()=>{
  const requests=[request('a1','main-a'),request('b1','main-b'),request('a2','sub-a'),request('a3','main-a')]
  const chats=[{id:'main-a',kind:'main' as const},{id:'main-b',kind:'main' as const},{id:'sub-a',kind:'sub' as const,parentChatId:'main-a'}]
  assert.deepEqual(permissionRequestsForChat(requests,'main-a',chats).map(req=>req.id),['a1','a2','a3'])
  assert.deepEqual(permissionRequestsForChat(requests,'main-b',chats).map(req=>req.id),['b1'])
  assert.deepEqual(permissionRequestsForChat(requests,null,chats),[])
})
