import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserDownloadEntry } from './types'
import { DownloadSnapshotGate, downloadsForChat, sortDownloads, summarizeDownloads } from './browser-download-presentation'

const row = (id: string, patch: Partial<BrowserDownloadEntry> = {}): BrowserDownloadEntry => ({
  id, chatId: 'a', sessionId: 'session', state: 'started', filename: id, url: '', createdAt: 1, updatedAt: 1,
  receivedBytes: 50, totalBytes: 100, ...patch,
})

test('download scope never falls back to global and sorting ignores progress updates', () => {
  const items = [row('old', { updatedAt: 999 }), row('new', { createdAt: 2 }), row('other', { chatId: 'b', createdAt: 3 })]
  assert.deepEqual(downloadsForChat(items, '').map(item => item.id), [])
  assert.deepEqual(downloadsForChat(items, 'a').map(item => item.id), ['new', 'old'])
  assert.deepEqual(sortDownloads(items).map(item => item.id), ['other', 'new', 'old'])
  assert.deepEqual(items.map(item => item.id), ['old', 'new', 'other'])
})

test('download ring uses byte weighting and excludes terminal and intercepted records', () => {
  const summary = summarizeDownloads([row('small', { receivedBytes: 100 }), row('large', { totalBytes: 900, receivedBytes: 0 }), row('done', { state: 'completed' }), row('waiting', { state: 'intercepted', totalBytes: undefined })])
  assert.equal(summary.progressPercent, 10)
  assert.equal(summary.progressCount, 2)
  assert.equal(summary.activeCount, 3)
})

test('received bytes are capped per item and completion is not inferred from byte totals', () => {
  assert.equal(summarizeDownloads([row('overshoot', { receivedBytes: 1000 }), row('empty', { receivedBytes: 0 })]).progressPercent, 50)
  assert.equal(summarizeDownloads([row('received', { receivedBytes: 100 })]).progressPercent, 99)
  assert.equal(summarizeDownloads([row('done', { state: 'completed' })]).progressCount, 0)
})

test('unknown or invalid active sizes produce an indeterminate ring, including zero bytes', () => {
  for (const patch of [{ totalBytes: undefined }, { totalBytes: 0 }, { totalBytes: NaN }, { totalBytes: Infinity }, { receivedBytes: NaN }, { receivedBytes: Infinity }, { receivedBytes: -1 }, { receivedBytes: undefined }]) {
    assert.equal(summarizeDownloads([row('known'), row('unknown', patch)]).progressPercent, null)
  }
  assert.equal(summarizeDownloads([row('zero', { receivedBytes: 0 })]).progressPercent, 0)
})

test('valid large byte counts remain finite and keep their correct weight', () => {
  assert.equal(summarizeDownloads([row('one', { receivedBytes: 1e308, totalBytes: 1e308 }), row('two', { receivedBytes: 0, totalBytes: 1e308 })]).progressPercent, 50)
})

test('only all-paused active transfers freeze the ring; terminal-only records are neutral', () => {
  assert.equal(summarizeDownloads([row('one', { state: 'paused' }), row('two', { state: 'failed' })]).allPaused, true)
  assert.equal(summarizeDownloads([row('one', { state: 'paused' }), row('two')]).allPaused, false)
  assert.deepEqual(summarizeDownloads([row('done', { state: 'completed' }), row('cancelled', { state: 'cancelled' })]), { activeCount: 0, progressCount: 0, allPaused: false, progressPercent: null })
})

test('late lists cannot revive cleared records, override a push or cross conversation changes', () => {
  const gate = new DownloadSnapshotGate()
  const initial = gate.begin()
  gate.changed()
  assert.equal(gate.accepts(initial), false)
  const afterPush = gate.begin()
  gate.changed()
  assert.equal(gate.accepts(afterPush), false)
  const afterClear = gate.begin()
  gate.reset()
  assert.equal(gate.accepts(afterClear), false)
  const current = gate.begin()
  assert.equal(gate.accepts(current), true)
  const newer = gate.begin()
  assert.equal(gate.accepts(current), false)
  assert.equal(gate.accepts(newer), true)
})

test('a new server instance accepts its restarted revision and invalidates old-instance lists', () => {
  const gate = new DownloadSnapshotGate()
  assert.equal(gate.acceptPush({ instanceId: 'old-server', revision: 40 }), true)
  const oldList = gate.begin()
  assert.equal(gate.acceptPush({ instanceId: 'new-server', revision: 0 }), true)
  assert.equal(gate.accepts(oldList), false)
  assert.equal(gate.acceptPush({ instanceId: 'new-server', revision: 2 }), true)
  assert.equal(gate.acceptPush({ instanceId: 'new-server', revision: 1 }), false)
  const currentList = gate.begin()
  assert.equal(gate.accepts(currentList), true)
  // Older hosts never included either field; their pushes remain compatible.
  assert.equal(gate.acceptPush({}), true)
  assert.equal(gate.accepts(currentList), false)
  gate.reset()
  assert.equal(gate.acceptPush({ revision: 0 }), true)
})
