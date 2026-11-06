import test from 'node:test'
import assert from 'node:assert/strict'
import {browserHttpAddress,browserPageAddressState,sameBrowserPageAddress} from './browser-page-address'

const page={windowId:'page',chatId:'chat',hostWindowId:'host',url:'https://example.test/final',desiredUrl:'https://example.test/draft',loading:false,automation:{documentEpoch:7} as any}
test('current-page actions use committed URL, not desired URL or an address draft',()=>{
  assert.equal(browserPageAddressState(page).context?.url,'https://example.test/final')
  assert.equal(browserPageAddressState({...page,loading:true}).context,undefined)
  assert.equal(browserPageAddressState({...page,crashed:true}).context,undefined)
  assert.equal(browserPageAddressState({...page,automation:undefined}).context,undefined)
})
test('failed navigation gets an explicit action bound to failure URL, never the old live URL',()=>{
  const state=browserPageAddressState({...page,loadError:{code:-105,url:'https://failed.test/',description:'not found'}})
  assert.equal(state.context?.kind,'failed');assert.equal(state.context?.url,'https://failed.test/')
  assert.equal(state.label,'在外部浏览器中尝试打开此网址');assert.equal(state.copyLabel,'复制访问失败的网址')
})
test('internal pages, non-HTTP schemes, credentials and malformed addresses cannot escape through browser menus',()=>{
  for(const value of ['about:blank','file:///c:/private','javascript:alert(1)','data:text/html,hello','mailto:a@example.test','blob:https://example.test/abc','https://user:secret@example.test/','not a URL']){
    assert.equal(browserHttpAddress(value),undefined);assert.equal(browserPageAddressState({...page,url:value}).visible,false)
  }
  assert.equal(browserHttpAddress('HTTPS://Example.Test'),'https://example.test/')
})
test('page URL, document, host, owner and failure kind all form the menu identity',()=>{
  const context=browserPageAddressState(page).context!
  assert.ok(sameBrowserPageAddress(context,{...context}))
  for(const change of [{url:'https://other.test/'},{documentEpoch:8},{hostId:'moved'},{chatId:'other'},{pageId:'other'},{kind:'failed' as const}])assert.equal(sameBrowserPageAddress(context,{...context,...change}),false)
})
