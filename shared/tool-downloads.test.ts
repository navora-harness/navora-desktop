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

test('tool download progress does not reorder records by their last update', t => {
  let time = 100
  t.mock.method(Date, 'now', () => time++)
  const list = new ToolDownloadList()
  const event = (id: string) => ({ type: 'message', chatId: 'a', message: {
    id, role: 'tool', content: '', createdAt: 1,
    meta: { toolName: 'file_download', args: { dest: `${id}.pdf` }, status: 'running' },
  } }) as AgentEvent
  const first = event('first'), second = event('second')
  list.observe(first); list.observe(second); list.observe(first)
  assert.deepEqual(list.list().map(entry => entry.id), ['tool:a:second', 'tool:a:first'])
})

test('active tool downloads can exceed history capacity and settling them trims only terminal history', () => {
  const list = new ToolDownloadList()
  const event = (id: string) => ({ type: 'message', chatId: 'a', message: {
    id, role: 'tool', content: '', createdAt: 1,
    meta: { toolName: 'file_download', args: { dest: `${id}.pdf` }, status: 'running' },
  } }) as AgentEvent
  const first = event('0')
  list.observe(first)
  for (let index = 1; index < 110; index++) list.observe(event(String(index)))
  assert.equal(list.list().length, 110)
  list.observe({ type: 'status', chatId: 'a', running: false })
  assert.equal(list.list().length, 100)
  assert.equal(list.list().every(entry => entry.state === 'cancelled'), true)
  if (first.type === 'message') first.message.meta!.status = 'done'
  list.observe(first)
  assert.equal(list.list().length, 100)
  assert.equal(list.get('tool:a:0'), undefined)
})
