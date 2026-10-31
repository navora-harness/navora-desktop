import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ToolDownloadList } from './tool-downloads'
import type { AgentEvent } from './types'

test('tool downloads share one row across progress and terminal events without pretending pause is available', () => {
  const list = new ToolDownloadList()
  const event = { type: 'message', chatId: 'a', message: { id: 'm', role:'tool', content:'', createdAt:1, meta: { toolName:'file_download', args:{ dest:'docs/a.pdf' }, status:'running', downloadProgress:{ bytesTotal:20, contentLength:100, partsTotal:1 } } } } as AgentEvent
  list.observe(event); list.observe(event)
  assert.equal(list.list().length,1)
  const row = list.list()[0]!
  assert.equal(row.canPause, false); assert.equal(row.receivedBytes,20)
  assert.equal(list.remove(row.id).ok,false)
  assert.equal(list.list('b').length,0)
  if (event.type === 'message') event.message.meta!.status='done'
  list.observe(event)
  assert.equal(list.list()[0]?.state,'completed')
  list.clear('a'); list.observe(event)
  assert.equal(list.list().length,0)
})
