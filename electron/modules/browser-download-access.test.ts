import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDownloadScope, downloadChatScope, filterDownloadScope } from './browser-download-access'
import type { BrowserDownloadEntry } from '../../shared/types'

const row = (chatId: string): BrowserDownloadEntry => ({ id: chatId, chatId, sessionId: '', filename: 'a.pdf', url: '', state: 'completed', createdAt: 1, updatedAt: 1 })

test('main application and authenticated RPC keep legacy global access, while explicit scopes remain exact', () => {
  assert.equal(downloadChatScope({ kind: 'trusted' }), undefined)
  assert.equal(downloadChatScope({ kind: 'remote' }), undefined)
  assert.equal(downloadChatScope({ kind: 'remote' }, null), undefined)
  assert.throws(() => assertDownloadScope(row('b'), downloadChatScope({ kind: 'remote' }, 'a')), /scope_mismatch/)
  const scope = downloadChatScope({ kind: 'trusted' }, 'a')
  assert.deepEqual(filterDownloadScope([row('a'), row('b')], scope).map(entry => entry.chatId), ['a'])
  assert.throws(() => assertDownloadScope(row('b'), scope), /scope_mismatch/)
  for (const value of ['', ' ', null]) assert.throws(() => downloadChatScope({ kind: 'trusted' }, value as string), /scope_required/)
})

test('detached hosts can only list and control downloads belonging to their current conversations', () => {
  const caller = { kind: 'host', chatIds: ['a', 'c'] } as const
  const scope = downloadChatScope(caller)
  assert.deepEqual(filterDownloadScope([row('a'), row('b'), row('c')], scope).map(entry => entry.id), ['a', 'c'])
  assert.equal(assertDownloadScope(row('a'), scope).id, 'a')
  assert.throws(() => assertDownloadScope(row('b'), scope), /scope_mismatch/)
  assert.throws(() => downloadChatScope(caller, 'b'), /scope_mismatch/)
  assert.deepEqual(filterDownloadScope([row('a')], downloadChatScope({ kind: 'host', chatIds: [] })), [])
})

test('unknown UI senders cannot obtain a global fallback or control a known download ID', () => {
  assert.throws(() => downloadChatScope({ kind: 'denied' }), /sender_forbidden/)
  assert.throws(() => downloadChatScope({ kind: 'denied' }, 'a'), /sender_forbidden/)
  assert.throws(() => assertDownloadScope(null, undefined), /not_found/)
})
