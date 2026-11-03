import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { DownloadItem } from 'electron'
import { BrowserDownloadList, type BrowserDownloadUpsert } from './browser-download-list'

const info = (name: string, state: BrowserDownloadUpsert['state'] = 'started', chatId = 'a'): BrowserDownloadUpsert => ({
  chatId, sessionId: 's', filename: name, savePath: `D:/downloads/${name}`, url: 'https://example.test/file', state,
})
function item() {
  const events = new EventEmitter()
  let paused = false, pauses = 0
  return { events, get pauses() { return pauses }, native: Object.assign(events, {
    pause() { paused = true; pauses++ }, resume() { paused = false }, cancel() {},
    isPaused: () => paused, canResume: () => paused, getReceivedBytes: () => 5, getTotalBytes: () => 10,
  }) as unknown as DownloadItem }
}

test('progress and pause updates preserve creation order, including equal timestamps', () => {
  const list = new BrowserDownloadList()
  list.upsert(info('first')); list.upsert(info('second')); list.upsert(info('third'))
  const initial = list.list().map(entry => entry.id)
  const first = list.list().find(entry => entry.filename === 'first')!
  const native = item(); list.bindItem(first.id, native.native)
  list.upsert({ ...info('first'), receivedBytes: 3 })
  assert.equal(list.pause(first.id).ok, true)
  assert.deepEqual(list.list().map(entry => entry.id), initial)
})

test('history capacity never evicts active downloads or their native controls', () => {
  const list = new BrowserDownloadList(10)
  const first = list.upsert(info('active-0'))
  const native = item(); list.bindItem(first.id, native.native)
  for (let index = 1; index < 15; index++) list.upsert(info(`active-${index}`, index % 2 ? 'paused' : 'intercepted'))
  assert.equal(list.list().length, 15)
  assert.equal(list.get(first.id)?.canPause, true)
  assert.equal(list.pause(first.id).ok, true)
  assert.equal(native.pauses, 1)
  list.upsert(info('finished', 'completed'))
  assert.equal(list.list().length, 15)
  assert.equal(list.list().some(entry => entry.filename === 'finished'), false)
  list.upsert(info('active-0', 'completed'))
  assert.equal(list.list().length, 14)
  assert.equal(list.get(first.id), null)
})

test('capacity trims the oldest terminal records while preserving newer history', () => {
  const list = new BrowserDownloadList(10)
  const first = list.upsert(info('old', 'completed'))
  for (let index = 0; index < 10; index++) list.upsert(info(`new-${index}`, 'failed'))
  assert.equal(list.list().length, 10)
  assert.equal(list.get(first.id), null)
  assert.equal(list.list()[0].filename, 'new-9')
})

test('downloads sharing a path in different conversations never merge ownership', () => {
  const list = new BrowserDownloadList()
  const a = list.upsert(info('shared.pdf', 'started', 'a'))
  const b = list.upsert(info('shared.pdf', 'paused', 'b'))
  assert.notEqual(a.id, b.id)
  assert.equal(list.list('a')[0].state, 'started')
  assert.equal(list.list('b')[0].state, 'paused')
})

test('a late done event from a replaced native item cannot remove the current controls', () => {
  const list = new BrowserDownloadList()
  const entry = list.upsert(info('file'))
  const first = item(), next = item()
  list.bindItem(entry.id, first.native); list.bindItem(entry.id, next.native)
  first.events.emit('done')
  assert.equal(list.pause(entry.id).ok, true)
  assert.equal(next.pauses, 1)
  assert.equal(first.pauses, 0)
})
