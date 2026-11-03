import test from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserDownloadEntry } from './types'
import { downloadProgress, downloadRelativePath, downloadStatus, mergeWorkspaceDownloads } from './workspace-downloads'

const item: BrowserDownloadEntry = { id:'d1',chatId:'chat',sessionId:'browser',state:'started',filename:'report.txt',relPath:'downloads/reports/report.txt',url:'https://example.com/report.txt',receivedBytes:25,totalBytes:100,createdAt:1,updatedAt:2 }
const file = { path:item.relPath!,name:'report.txt',type:'file' as const,size:100 }

test('pending downloads appear in their actual folder before a target file exists',()=>{
  const root=mergeWorkspaceDownloads([], '', 'chat', [item])
  assert.deepEqual(root.map(row=>[row.path,row.type,row.virtual,row.activeDownloads]),[['downloads','dir',true,1]])
  const rows=mergeWorkspaceDownloads([], 'downloads/reports', 'chat', [item])
  assert.equal(rows[0]?.path,file.path)
  assert.equal(rows[0]?.download?.state,'started')
  assert.equal(rows[0]?.virtual,true)
})

test('pause and completion update the same file row without duplicating an existing file',()=>{
  for(const state of ['started','paused','completed'] as const){
    const rows=mergeWorkspaceDownloads([file], 'downloads/reports', 'chat', [{...item,state}])
    assert.equal(rows.length,1)
    assert.equal(rows[0]?.path,file.path)
    assert.equal(rows[0]?.download?.state,state)
    assert.equal(rows[0]?.virtual,undefined)
  }
  assert.equal(mergeWorkspaceDownloads([file], 'downloads/reports', 'chat', [])[0]?.download,undefined)
})

test('old completed records never recreate deleted files; in-flight disk refresh preserves identity',()=>{
  const completed={...item,state:'completed' as const}
  assert.deepEqual(mergeWorkspaceDownloads([], '', 'chat', [completed]),[])
  assert.deepEqual(mergeWorkspaceDownloads([], 'downloads/reports', 'chat', [completed]),[])
  assert.equal(mergeWorkspaceDownloads([], 'downloads/reports', 'chat', [completed],new Set([item.id]))[0]?.path,file.path)
})

test('only the temporary file belonging to a known active download is suppressed',()=>{
  const partial={...file,path:file.path+'.crdownload',name:'report.txt.crdownload'}
  const unrelated={...file,path:'downloads/reports/other.crdownload',name:'other.crdownload'}
  const rows=mergeWorkspaceDownloads([partial,unrelated], 'downloads/reports', 'chat', [item])
  assert.deepEqual(rows.map(row=>row.path),[unrelated.path,file.path])
  assert.equal(mergeWorkspaceDownloads([partial], 'downloads/reports', 'other-chat', [item])[0]?.path,partial.path)
})

test('download status is isolated by chat and full path and prefers the most recent attempt',()=>{
  const older={...item,id:'older',state:'failed' as const,updatedAt:1}
  const other={...item,id:'other',chatId:'other-chat',updatedAt:100}
  const second={...item,id:'second',relPath:'elsewhere/report.txt'}
  const rows=mergeWorkspaceDownloads([file], 'downloads/reports', 'chat', [older,item,other,second])
  assert.equal(rows[0]?.download?.id,item.id)
  assert.equal(rows.length,1)
  assert.equal(mergeWorkspaceDownloads([], 'elsewhere', 'chat', [second])[0]?.download?.id,'second')
})

test('downloads without a valid destination stay virtual and never become a filesystem path',()=>{
  for(const relPath of [undefined,'../report.txt','C:\\report.txt','/tmp/report.txt','a/../report.txt']){
    const unknown={...item,relPath,state:'intercepted' as const}
    assert.equal(downloadRelativePath(unknown),null)
    const row=mergeWorkspaceDownloads([], '', 'chat', [unknown])[0]!
    assert.equal(row.path,':download/d1')
    assert.equal(row.virtual,true)
    assert.equal(row.download?.state,'intercepted')
  }
  assert.equal(downloadRelativePath({...item,relPath:'.\\downloads\\report.txt'}),'downloads/report.txt')
})

test('recursive search includes pending destinations and annotates nested completed files',()=>{
  const rows=mergeWorkspaceDownloads([file], '', 'chat', [{...item,state:'completed'}],new Set(),true)
  assert.equal(rows[0]?.download?.state,'completed')
  assert.equal(mergeWorkspaceDownloads([], '', 'chat', [item],new Set(),true)[0]?.path,file.path)
  assert.deepEqual(mergeWorkspaceDownloads([], 'other', 'chat', [item],new Set(),true),[])
})

test('progress stays below 100 until completion and unknown totals remain indeterminate',()=>{
  assert.equal(downloadProgress(item),25)
  assert.equal(downloadProgress({...item,receivedBytes:100}),99)
  assert.equal(downloadProgress({...item,totalBytes:0}),null)
  assert.equal(downloadProgress({...item,receivedBytes:NaN}),null)
  assert.equal(downloadProgress({...item,state:'completed',receivedBytes:100}),100)
  assert.equal(downloadStatus({...item,state:'failed'}),'下载失败')
})
