import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {BrowserStartStore} from './browser-start-store'

function fixture(t:import('node:test').TestContext){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-browser-start-')),file=path.join(root,'start.json'),store=new BrowserStartStore(file)
  t.after(()=>{store.flush();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('navora-browser-start-'));fs.rmSync(root,{recursive:true,force:true})})
  return {root,file,store}
}
test('quick links persist across services, normalize addresses and preserve identities when edited',t=>{
  const {file,store}=fixture(t),first=store.saveLink({title:'文档',url:'docs.example'})
  assert.equal(first.url,'https://docs.example/')
  assert.equal(store.saveLink({title:'新名称',url:'https://docs.example'}).id,first.id)
  assert.throws(()=>store.saveLink({title:'bad',url:'javascript:alert(1)'}))
  assert.throws(()=>store.saveLink({id:'missing',title:'missing',url:'https://example.com'}),/not_found/)
  const second=store.saveLink({title:'另一个',url:'https://other.example'})
  assert.throws(()=>store.saveLink({id:second.id,title:'duplicate',url:first.url}),/quick_link_exists/)
  assert.equal(new BrowserStartStore(file).state('another-chat').links[0]!.title,'新名称')
  store.removeLink(first.id);assert.equal(new BrowserStartStore(file).state('chat').links.length,1)
})
test('history records only web addresses, deduplicates revisits and isolates conversation clearing',t=>{
  const {store,file}=fixture(t)
  store.visit({chatId:'one',url:'https://example.com',title:'First'})
  store.visit({chatId:'one',url:'about:blank',title:'Blank'})
  store.visit({chatId:'one',url:'file:///secret',title:'Private'})
  store.visit({chatId:'one',url:'https://example.com/',title:'Updated'})
  store.visit({chatId:'two',url:'https://example.com/',title:'Another chat'})
  store.flush()
  const restored=new BrowserStartStore(file)
  assert.equal(restored.state('one').history.length,1)
  assert.equal(restored.state('one').history[0]!.title,'Updated')
  restored.clearHistory('one','https://example.com/')
  assert.equal(restored.state('one').history.length,0)
  assert.equal(restored.state('two').history.length,1)
  restored.clearHistory('two');assert.equal(restored.state('two').history.length,0)
})
test('link and history bounds remain stable after restart',t=>{
  const {store,file}=fixture(t)
  for(let i=0;i<12;i++)store.saveLink({title:String(i),url:`https://example.com/${i}`})
  assert.throws(()=>store.saveLink({title:'overflow',url:'https://overflow.example'}),/quick_link_limit/)
  for(let i=0;i<205;i++)store.visit({chatId:'chat',title:String(i),url:`https://example.com/${i}`})
  store.flush();const restored=new BrowserStartStore(file)
  assert.equal(restored.state('chat').history.length,200)
  assert.equal(restored.state('chat').history[0]!.title,'204')
})
test('invalid store bytes are retained and a new record can be saved',t=>{
  const {file,root}=fixture(t)
  fs.writeFileSync(file,'{broken record')
  const store=new BrowserStartStore(file)
  assert.deepEqual(store.state('chat'),{links:[],history:[]})
  const original=fs.readdirSync(root).find(name=>name.includes('.corrupt-'))!
  assert.equal(fs.readFileSync(path.join(root,original),'utf8'),'{broken record')
  store.saveLink({title:'Recovered',url:'https://example.com'})
  assert.equal(new BrowserStartStore(file).state('chat').links.length,1)
})

test('a delayed address-row delete cannot remove a newer visit or another conversation',t=>{
  const {store,file}=fixture(t),url='https://example.com/'
  t.mock.method(Date,'now',()=>1700000000000)
  store.visit({chatId:'one',url,title:'First'})
  const old=store.state('one').history[0]!
  store.visit({chatId:'one',url,title:'New visit'})
  store.visit({chatId:'two',url,title:'Other conversation'})
  assert.ok(store.state('one').history[0]!.visitedAt>old.visitedAt)
  assert.throws(()=>store.clearHistory('one',url,old.visitedAt),/browser_history_changed/)
  assert.equal(store.state('one').history[0]!.title,'New visit')
  assert.throws(()=>store.clearHistory('one',undefined,old.visitedAt),/invalid_browser_history_entry/)
  const latest=store.state('one').history[0]!
  store.clearHistory('one',url,latest.visitedAt)
  assert.equal(new BrowserStartStore(file).state('one').history.length,0)
  assert.equal(store.state('two').history.length,1)
})
