import test from 'node:test'
import assert from 'node:assert/strict'
import {BrowserNetworkManager} from './browser-network'
import {FETCH_SCOPE_HEADER} from './browser-network-scope'
import {createDefaultConfig} from '../../shared/config'

type Details={id:number;url:string;method:string;resourceType:string;webContentsId?:number;requestHeaders:Record<string,string>;uploadData?:{bytes:Buffer}[];statusCode?:number;responseHeaders?:Record<string,string[]>;error?:string}
function fixture(){
  const handlers:Record<string,(details:Details,callback?:(result:Record<string,unknown>)=>void)=>void>={},binds:Record<string,number>={}
  const names=['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred']
  const ses={webRequest:Object.fromEntries(names.map(name=>[name,(...args:unknown[])=>{const handler=args.at(-1);if(typeof handler==='function'){handlers[name]=handler as typeof handlers[string];binds[name]=(binds[name]||0)+1}else delete handlers[name]}]))}
  const config=createDefaultConfig(),manager=new BrowserNetworkManager(()=>config,()=>ses as unknown as Electron.Session,()=>'',{isShared:()=>true,resolveOwner:(_session,details)=>details.webContentsId===10?{chatId:'a',pageId:'page-a'}:details.webContentsId===20?{chatId:'b',pageId:'page-b'}:null})
  manager.touch('shared')
  const details=(id:number,wc?:number,url='https://fixture.invalid/data',headers:Record<string,string>={}):Details=>({id,url,method:'GET',resourceType:'xhr',webContentsId:wc,requestHeaders:headers})
  function emit(name:string,value:Details){let result:Record<string,unknown>|undefined;handlers[name]!(value,response=>{result=response});return result}
  function finish(value:Details){emit('onHeadersReceived',{...value,statusCode:200,responseHeaders:{'Set-Cookie':['private-cookie'],'X-Reply':['fixture']}});emit('onCompleted',{...value,statusCode:200})}
  return{manager,config,handlers,binds,details,emit,finish}
}

test('public rules and logs require chat scope and cannot be read or removed by another chat',()=>{
  const f=fixture(),a=f.manager.add('shared',{id:'a-rule',kind:'observe',urlPattern:'*'},'a')
  f.manager.add('shared',{id:'b-rule',kind:'observe',urlPattern:'*'},'b')
  assert.throws(()=>f.manager.add('shared',{kind:'block',urlPattern:'*'}),/network_scope_required/)
  assert.deepEqual(f.manager.list('shared'),[]);assert.deepEqual(f.manager.getLog('shared'),[])
  assert.equal(f.manager.remove('shared',a.id,'b'),false)
  const requestA=f.details(1,10),requestB=f.details(2,20)
  for(const request of [requestA,requestB]){f.emit('onBeforeRequest',request);f.emit('onBeforeSendHeaders',request);f.finish(request)}
  assert.equal(f.manager.getLog('shared',{},'a').length,1);assert.equal(f.manager.getLog('shared',{},'b').length,1)
  assert.equal(f.manager.getLog('shared',{},'a')[0]!.chatId,'a')
  assert.match(f.manager.getLog('shared',{},'a')[0]!.responseHeaders!['Set-Cookie']!,/redacted/)
  f.manager.clear('shared','a');assert.equal(f.manager.list('shared','a').length,0);assert.equal(f.manager.list('shared','b').length,1)
  f.manager.clearLog('shared','a');assert.equal(f.manager.getLog('shared',{},'a').length,0);assert.equal(f.manager.getLog('shared',{},'b').length,1)
  assert.equal(f.binds.onBeforeSendHeaders,1,'Rule edits must not rebind and lose in-flight scope')
})

test('page headers and blocking affect only their originating chat; unknown workers inherit neither',()=>{
  const f=fixture()
  f.manager.add('shared',{kind:'modify',urlPattern:'*',headers:{'X-Chat':'a',[FETCH_SCOPE_HEADER]:'must-not-leak'}},'a')
  f.manager.add('shared',{kind:'block',urlPattern:'https://blocked.invalid/*'},'a')
  for(const [id,wc,expected] of [[1,10,'a'],[2,20,undefined],[3,undefined,undefined]] as const){
    const request=f.details(id,wc);f.emit('onBeforeRequest',request)
    const result=f.emit('onBeforeSendHeaders',request)!,headers=result.requestHeaders as Record<string,string>
    assert.equal(headers['X-Chat'],expected);assert.equal(headers[FETCH_SCOPE_HEADER],undefined);f.finish(request)
  }
  assert.equal(f.emit('onBeforeRequest',f.details(4,10,'https://blocked.invalid/x'))!.cancel,true)
  assert.notEqual(f.emit('onBeforeRequest',f.details(5,20,'https://blocked.invalid/x'))!.cancel,true)
  assert.notEqual(f.emit('onBeforeRequest',f.details(6,undefined,'https://blocked.invalid/x'))!.cancel,true)
  for(const id of [4,5,6])f.emit('onErrorOccurred',{...f.details(id),error:'fixture-terminal'})
})

test('scoped fetch proof is removed before upstream headers and never appears in scoped logs',async()=>{
  const f=fixture()
  f.manager.add('shared',{kind:'observe',urlPattern:'*'},'a');f.manager.add('shared',{kind:'modify',urlPattern:'*',headers:{'X-Chat':'a'}},'a')
  await f.manager.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    const request=f.details(1,undefined,undefined,{...headers,Authorization:'secret-fixture'})
    f.emit('onBeforeRequest',request)
    const sent=f.emit('onBeforeSendHeaders',request)!.requestHeaders as Record<string,string>
    assert.equal(sent[FETCH_SCOPE_HEADER],undefined);assert.equal(sent['X-Chat'],'a')
    f.finish(request)
  })
  const log=f.manager.getLog('shared',{},'a')
  assert.equal(log.length,2);assert.equal(f.manager.getLog('shared',{},'b').length,0)
  assert.doesNotMatch(JSON.stringify(log),/x-navora-internal-fetch-scope|secret-fixture/)
})

test('every host redirect hop checks its chat block rules and configured URL allowlist',async()=>{
  const f=fixture();f.config.browser.url_allowlist=['fixture.invalid']
  await f.manager.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    const first=f.details(1,undefined,undefined,headers);f.emit('onBeforeRequest',first);assert.notEqual(f.emit('onBeforeSendHeaders',first)!.cancel,true)
    const redirect=f.details(1,undefined,'https://other.invalid/next')
    f.emit('onBeforeRequest',redirect);assert.equal(f.emit('onBeforeSendHeaders',redirect)!.cancel,true)
    f.emit('onErrorOccurred',{...redirect,error:'blocked'})
  })
  f.config.browser.url_allowlist=[];f.manager.add('shared',{kind:'block',urlPattern:'https://blocked.invalid/*'},'a')
  await f.manager.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    const first=f.details(2,undefined,undefined,headers);f.emit('onBeforeRequest',first);f.emit('onBeforeSendHeaders',first)
    const redirect=f.details(2,undefined,'https://blocked.invalid/next')
    assert.equal(f.emit('onBeforeRequest',redirect)!.cancel,true);f.emit('onErrorOccurred',{...redirect,error:'blocked'})
  })
})

test('unattributed traffic still obeys application URL policy without gaining a chat log',()=>{
  const f=fixture();f.config.browser.url_allowlist=['fixture.invalid']
  f.manager.add('shared',{kind:'observe',urlPattern:'*'},'a')
  const unknown=f.details(1,undefined,'https://outside.invalid/worker')
  assert.equal(f.emit('onBeforeRequest',unknown)!.cancel,true)
  assert.equal(f.emit('onBeforeSendHeaders',unknown)!.cancel,true)
  assert.equal(f.manager.getLog('shared',{},'a').length,0)
  const coverage=f.manager.coverage('shared')
  assert.equal(coverage.complete,false);assert.equal(coverage.unattributed,'application-baseline-only-no-chat-rules-or-logs')
  assert.deepEqual(coverage.sources,['owned-page','scoped-fetch'])
})

test('removing a chat scope clears only its rules, logs and pending observations without rebinding the shared session',()=>{
  const f=fixture()
  for(const chat of ['a','b'])f.manager.add('shared',{kind:'observe',urlPattern:'*'},chat)
  const a=f.details(1,10),b=f.details(2,20)
  for(const request of [a,b]){f.emit('onBeforeRequest',request);f.emit('onBeforeSendHeaders',request)}
  f.manager.removeChatScope('shared','a')
  f.finish(a);f.finish(b)
  assert.deepEqual(f.manager.list('shared','a'),[]);assert.equal(f.manager.list('shared','b').length,1)
  assert.equal(f.manager.getLog('shared',{includePending:true},'a').length,0)
  assert.equal(f.manager.getLog('shared',{},'b').length,1)
  assert.equal(f.binds.onBeforeSendHeaders,1)
})
