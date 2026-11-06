import test from 'node:test'
import assert from 'node:assert/strict'
import type {BrowserWindow,WebContents} from 'electron'
import {createAppLinkService,type AppLinkOptions} from './app-links'

function fixture(mode:'window'|'tab'|'external'='window') {
  const calls:unknown[][]=[]
  let allowed=true,exists=true
  const sender={} as WebContents
  const page={id:'new-page',isDestroyed:()=>false,loadURL:async(url:string)=>{calls.push(['load',url])}}
  const registry={
    resolveSession:async(chatId:string)=>{calls.push(['session',chatId]);return{sessionId:'sess_default'}},
    createWindow:(id:string,input:unknown)=>{calls.push(['create',id,input]);return{windowId:page.id}},
    getWindowRecord:()=>({win:page}),markDesiredUrl:()=>{},
    hosts:{hostForSender:()=>undefined,detach:()=>{calls.push(['detach'])},present:()=>{calls.push(['present'])}},
  }
  const service=createAppLinkService({registry:registry as unknown as AppLinkOptions['registry'],getConfig:()=>({browser:{link_open_mode:mode,url_allowlist:[]}} as unknown as ReturnType<AppLinkOptions['getConfig']>),chatExists:()=>exists,trusted:()=>allowed?{} as BrowserWindow:undefined,external:async url=>{calls.push(['external',url])}})
  return{calls,sender,service,revoke:()=>{allowed=false},deleteChat:()=>{exists=false}}
}

test('default user links create a public-session page in a new window without reusing an Agent page',async()=>{
  const f=fixture()
  const result=await f.service.open(f.sender,{url:'https://example.test/',chatId:'owner'})
  assert.deepEqual(result,{ok:true,pageId:'new-page'})
  assert.deepEqual(f.calls.map(call=>call[0]),['session','create','detach','load','present'])
  assert.deepEqual(f.calls[1],['create','sess_default',{chatId:'owner',url:'https://example.test/',show:false,deferLoad:true}])
})

test('explicit external actions override preference without creating a page or requiring a chat',async()=>{
  const f=fixture('window')
  assert.deepEqual(await f.service.open(f.sender,{url:'https://example.test/',mode:'external'}),{ok:true})
  assert.deepEqual(f.calls,[['external','https://example.test/']])
})

test('missing/deleted owners, untrusted senders and unsafe protocols never open anything',async()=>{
  for(const change of ['missing','deleted','untrusted','unsafe'] as const){
    const f=fixture()
    if(change==='deleted')f.deleteChat()
    if(change==='untrusted')f.revoke()
    const result=await f.service.open(f.sender,{url:change==='unsafe'?'file:///C:/private':'https://example.test/',chatId:change==='missing'?undefined:'owner'})
    assert.equal(result.ok,false)
    assert.deepEqual(f.calls,[])
  }
})
