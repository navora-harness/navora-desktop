import test from 'node:test'
import assert from 'node:assert/strict'
import {browserAddress,browserRect,browserTabShortcut,stableBrowserTabOrder,browserTabAfterRemoval,browserLoadFailureHint} from './browser-workspace'

test('browser addresses accept local development servers and deny privileged protocols or embedded credentials',()=>{
  assert.equal(browserAddress('localhost:3000/settings'),'http://localhost:3000/settings')
  assert.equal(browserAddress('127.0.0.1:8080'),'http://127.0.0.1:8080/')
  assert.equal(browserAddress('example.com:8443/page'),'https://example.com:8443/page')
  assert.equal(browserAddress('example.com'),'https://example.com/')
  assert.equal(browserAddress('about:blank'),'about:blank')
  for(const value of ['javascript:alert(1)','file:///C:/private','https://user:password@example.com/','data:text/html,test',''])assert.throws(()=>browserAddress(value))
})

test('load failure guidance distinguishes network, service and certificate problems',()=>{
  assert.match(browserLoadFailureHint(-106),/断开/)
  assert.match(browserLoadFailureHint(-105),/未找到/)
  assert.match(browserLoadFailureHint(-102),/服务/)
  assert.match(browserLoadFailureHint(-118),/超时/)
  for(const code of [-200,-202,-299])assert.match(browserLoadFailureHint(code),/证书/)
  for(const code of [undefined,-2,-300])assert.match(browserLoadFailureHint(code),/检查网址/)
})

test('native browser layout rejects non-finite input and clamps offscreen scroll without changing page identity',()=>{
  assert.throws(()=>browserRect({x:NaN,y:0,width:400,height:600}))
  assert.throws(()=>browserRect({x:0,y:0,width:'400',height:600}))
  assert.deepEqual(browserRect({x:-10,y:70.4,width:300.2,height:600,scrollLeft:-4,scrollTop:9000}),{x:0,y:70,width:300,height:600,scrollLeft:0,scrollTop:4320})
})

test('new tabs append after the visible reordered tabs and stale entries disappear',()=>{
  assert.deepEqual(stableBrowserTabOrder(['c','a','b'],['a','b','c','d']),['c','a','b','d'])
  assert.deepEqual(stableBrowserTabOrder(['c','a','a','b'],['a','b','d','d']),['a','b','d'])
})

test('closing the selected tab picks the following neighbor then the preceding neighbor',()=>{
  assert.equal(browserTabAfterRemoval(['c','a','b'],'a',['c','b']),'b')
  assert.equal(browserTabAfterRemoval(['c','a','b'],'b',['c','a']),'a')
  assert.equal(browserTabAfterRemoval(['c','a','b'],'c',['c','b']),'c')
  assert.equal(browserTabAfterRemoval(['a'],'a',[]),'')
})

test('tab shortcuts accept platform modifiers and reject typing or unsupported combinations',()=>{
  assert.equal(browserTabShortcut({key:'T',control:true}),'new')
  assert.equal(browserTabShortcut({key:'w',meta:true}),'close')
  assert.equal(browserTabShortcut({key:'Tab',control:true}),'next')
  assert.equal(browserTabShortcut({key:'Tab',meta:true,shift:true}),'previous')
  for(const input of [{key:'t'},{key:'t',control:true,shift:true},{key:'w',control:true,alt:true},{key:'w',control:true,isComposing:true},{key:'t',control:true,isAutoRepeat:true}])assert.equal(browserTabShortcut(input),undefined)
})
