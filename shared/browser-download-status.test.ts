import test from 'node:test'
import assert from 'node:assert/strict'
import {downloadNeedsLog,pendingBrowserDownloadReply} from './browser-download-status'
import type {BrowserDownloadEntry} from './types'
const base={id:'native-1',chatId:'chat',sessionId:'session',filename:'setup.exe',state:'started',receivedBytes:0} as BrowserDownloadEntry
test('zero-byte progress and repeated terminal callbacks never duplicate native download logs',()=>{
  assert.equal(downloadNeedsLog(undefined,base),true)
  assert.equal(downloadNeedsLog(base.state,{...base,receivedBytes:0}),false)
  assert.equal(downloadNeedsLog(base.state,{...base,receivedBytes:42}),false)
  const done={...base,state:'completed'} as BrowserDownloadEntry
  assert.equal(downloadNeedsLog(base.state,done),true)
  assert.equal(downloadNeedsLog(done.state,done),false)
  assert.equal(downloadNeedsLog(undefined,{...base,id:'ignored_1'}),false)
})
test('pending output reports measured progress and never assumes an existing file is complete',()=>{
  assert.match(pendingBrowserDownloadReply([{...base,receivedBytes:1048576,totalBytes:99999999}])!,/已接收 1.0 MB/)
  assert.match(pendingBrowserDownloadReply([{...base,state:'paused'}])!,/已暂停/)
  assert.equal(pendingBrowserDownloadReply([{...base,state:'completed'}]),null)
  assert.ok(pendingBrowserDownloadReply([{...base,filename:'[link](https://example.com)'}])!.includes('\\[link\\]'),'Filenames stay text instead of becoming Markdown links')
})
