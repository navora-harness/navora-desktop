import test from 'node:test'
import assert from 'node:assert/strict'
import {performBrowserPageAddressAction} from './browser-page-address'
import type {BrowserPageAddressContext} from '../../shared/browser-page-address'

const context:BrowserPageAddressContext={pageId:'page',chatId:'chat',hostId:'host',documentEpoch:3,kind:'current',url:'https://example.test/'}
test('system launch is awaited and failed launches are reported without a successful result',async()=>{
  let settle!:()=>void,completed=false
  const pending=performBrowserPageAddressAction(context,'external',{current:()=>context,allowed:()=>true,copy:()=>assert.fail(),external:()=>new Promise<void>(resolve=>{settle=resolve})}).then(()=>{completed=true})
  await Promise.resolve();assert.equal(completed,false);settle();await pending;assert.equal(completed,true)
  await assert.rejects(performBrowserPageAddressAction(context,'external',{current:()=>context,allowed:()=>true,copy:()=>assert.fail(),external:async()=>{throw Error('no default browser')}}),/external_open_failed/)
})
test('a menu cannot act on a navigated, transferred, closed or differently owned page',async()=>{
  for(const current of [undefined,{...context,url:'https://other.test/'},{...context,hostId:'new'},{...context,documentEpoch:4},{...context,chatId:'other'}]){
    await assert.rejects(performBrowserPageAddressAction(context,'external',{current:()=>current,allowed:()=>true,external:async()=>assert.fail('must not open'),copy:()=>assert.fail()}),/address_changed/)
  }
})
test('copy validates every target before one ordered clipboard update; external launch is single-target only',async()=>{
  const second={...context,pageId:'second',url:'https://second.test/'}
  let copied=''
  const options={current:(expected:BrowserPageAddressContext)=>expected,allowed:()=>true,external:async()=>assert.fail(),copy:(value:string)=>{copied=value}}
  await performBrowserPageAddressAction([context,second],'copy',options);assert.equal(copied,'https://example.test/\nhttps://second.test/')
  copied='retained'
  await assert.rejects(performBrowserPageAddressAction([context,second],'copy',{...options,current:expected=>expected.pageId==='second'?undefined:expected}),/address_changed/);assert.equal(copied,'retained')
  await assert.rejects(performBrowserPageAddressAction([context,second],'external',options),/invalid_browser_address_action/)
})
test('URL access policy still applies to external and copy actions',async()=>{
  for(const action of ['copy','external'] as const)await assert.rejects(performBrowserPageAddressAction(context,action,{current:()=>context,allowed:()=>false,external:async()=>assert.fail(),copy:()=>assert.fail()}),/url_not_allowed/)
})
