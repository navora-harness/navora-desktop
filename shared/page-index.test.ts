import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactPageSnapshot, searchPageIndex, type PageIndexEntry, type PageSnapshot } from './page-index'
import { browserCapabilities } from '../electron/modules/browser-capabilities'

const entries: PageIndexEntry[] = [
  {ref:'d1e1',role:'text',name:'Learn more about search documentation',tag:'p',selector:'p'},
  {ref:'d1e2',role:'button',name:'Search',tag:'button',selector:'#search'},
  {ref:'d1e3',role:'link',name:'登录账号',tag:'a',selector:'#login',url:'https://example.com/login'},
  {ref:'d1e4',role:'button',name:'Search',tag:'button',selector:'#other-search'},
]

test('page retrieval ranks exact actions before incidental text, retaining duplicates', () => {
  assert.deepEqual(searchPageIndex(entries, 'search').slice(0, 2).map((e) => e.ref), ['d1e2', 'd1e4'])
  assert.equal(searchPageIndex(entries, '登录')[0]?.ref, 'd1e3')
  assert.equal(searchPageIndex(entries, 'missing').length, 0)
  assert.equal(searchPageIndex(entries, 'Ｓｅａｒｃｈ')[0]?.ref, 'd1e2')
  assert.equal(searchPageIndex(entries, '登录设置')[0]?.ref, 'd1e3')
})

test('large navigation menus do not crowd input controls out of default snapshots', () => {
  const navigation = Array.from({length:100},(_, i) => ({...entries[2]!,ref:`nav${i}`,name:`Navigation ${i}`}))
  const snapshot = searchPageIndex([...navigation,entries[1]!], '', 10)
  assert.ok(snapshot.some((entry) => entry.ref === 'd1e2'))
  assert.ok(snapshot.length <= 10)
})

test('specific queries exclude records matching only a common word', () => {
  const products = Array.from({length:250},(_, i) => ({...entries[2]!,ref:`item${i}`,name:`商品 ${i} 详情`,url:`https://example.com/products/${i}`}))
  const result = searchPageIndex(products, '商品 200', 80)
  assert.equal(result[0]?.ref, 'item200')
  assert.equal(result.length, 1)
})

test('snapshots stay within budget at record boundaries', () => {
  const snapshot: PageSnapshot = {
    documentId:'d1',url:'https://example.com/',title:'Fixture',text:'article '.repeat(5000),
    entries:Array.from({length:300}, (_, i) => ({...entries[2]!, ref:`d1e${i}`,name:`登录账号 ${i}`})),
    capturedAt:1,revision:1,reused:false,scanned:300,truncated:false,captureMs:1,
    coverage:{mainFrame:true,openShadow:true,closedShadow:false,frameContents:false},
  }
  const compact = compactPageSnapshot(snapshot, {maxChars:4000, query:'登录', limit:80})
  assert.ok(JSON.stringify(compact).length <= 4000)
  assert.ok(compact.entries.length > 0)
  assert.equal(compact.entries[0]?.url, 'https://example.com/login')
  assert.equal(compact.truncated, true)
  assert.ok(snapshot.entries.length === 300)
})

test('native capabilities reflect callable methods, without version assumptions', () => {
  const capabilities = browserCapabilities({ querySelectorDeep() {}, clickSelector:'unavailable' })
  assert.equal(capabilities.queryDeep, true)
  assert.equal(capabilities.trustedClick, false)
  assert.equal(capabilities.pageIndex.closedShadow, false)
  assert.equal(capabilities.debuggerRequired, false)
})
