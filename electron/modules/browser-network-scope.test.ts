import test from 'node:test'
import assert from 'node:assert/strict'
import {BrowserNetworkScopes,FETCH_SCOPE_HEADER} from './browser-network-scope'

function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
const request=(id:number,url='https://fixture.invalid/data',webContentsId?:number)=>({id,url,method:'GET',webContentsId})
const scopes=()=>new BrowserNetworkScopes({isShared:()=>true,resolveOwner:(_session,details)=>details.webContentsId===10?{chatId:'a',pageId:'page-a'}:details.webContentsId===20?{chatId:'b',pageId:'page-b'}:null})

test('same-URL concurrent host fetches use one-time request proof, never URL attribution',async()=>{
  const store=scopes(),a=deferred(),b=deferred()
  let proofA='',proofB=''
  const runA=store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{proofA=headers[FETCH_SCOPE_HEADER]!;await a.promise})
  const runB=store.withFetchScope('shared','b','https://fixture.invalid/data','GET',undefined,async headers=>{proofB=headers[FETCH_SCOPE_HEADER]!;await b.promise})
  store.start('shared',request(1));store.start('shared',request(2));store.start('shared',request(3))
  const headersB={[FETCH_SCOPE_HEADER]:proofB},headersA={[FETCH_SCOPE_HEADER.toUpperCase()]:proofA}
  assert.equal(store.beforeHeaders('shared',request(2),headersB).owner?.chatId,'b')
  assert.equal(store.beforeHeaders('shared',request(1),headersA).owner?.chatId,'a')
  assert.deepEqual(headersA,{});assert.deepEqual(headersB,{})
  assert.equal(store.beforeHeaders('shared',request(3),{}).owner,null,'Unknown worker with the same URL has no chat scope')
  assert.equal(store.beforeHeaders('shared',request(4),{[FETCH_SCOPE_HEADER]:proofA}).cancel,true,'A proof is single-use')
  for(const id of [1,2,3,4])store.finish('shared',id)
  a.resolve();b.resolve();await Promise.all([runA,runB])
})

test('host scope follows a request ID through redirects and never overrides a different page owner',async()=>{
  const store=scopes(),hold=deferred();let proof=''
  const run=store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{proof=headers[FETCH_SCOPE_HEADER]!;await hold.promise})
  store.start('shared',request(1));assert.equal(store.beforeHeaders('shared',request(1),{[FETCH_SCOPE_HEADER]:proof}).owner?.chatId,'a')
  const redirect=request(1,'https://other.invalid/next')
  assert.equal(store.start('shared',redirect).owner?.chatId,'a')
  assert.equal(store.beforeHeaders('shared',redirect,{}).owner?.chatId,'a')
  const restored={[FETCH_SCOPE_HEADER]:proof}
  assert.equal(store.beforeHeaders('shared',redirect,restored).owner?.chatId,'a')
  assert.deepEqual(restored,{})
  assert.equal(store.beforeHeaders('shared',request(99),{[FETCH_SCOPE_HEADER]:proof}).cancel,true,'A restored redirect proof cannot authorize another request')
  store.finish('shared',99)
  store.finish('shared',1);hold.resolve();await run
  await store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    store.start('shared',request(2,undefined,20))
    assert.equal(store.beforeHeaders('shared',request(2,undefined,20),headers).cancel,true)
    assert.deepEqual(headers,{})
    store.finish('shared',2)
  })
})

test('forged, duplicate and wrong-session proofs fail closed and are always removed',async()=>{
  const store=scopes()
  const forged={[FETCH_SCOPE_HEADER]:'not-registered',Other:'visible'}
  assert.equal(store.beforeHeaders('shared',request(1),forged).cancel,true)
  assert.deepEqual(forged,{Other:'visible'})
  await store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    const token=headers[FETCH_SCOPE_HEADER]!,other={[FETCH_SCOPE_HEADER]:token}
    assert.equal(store.beforeHeaders('another-session',request(2),other).cancel,true)
    assert.equal(store.beforeHeaders('shared',request(3),headers).cancel,true)
  })
  await store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async headers=>{
    const token=headers[FETCH_SCOPE_HEADER]!,duplicate={[FETCH_SCOPE_HEADER]:token,[FETCH_SCOPE_HEADER.toUpperCase()]:token}
    assert.equal(store.beforeHeaders('shared',request(4),duplicate).cancel,true)
    assert.deepEqual(duplicate,{})
    assert.equal(store.beforeHeaders('shared',request(5),headers).cancel,true)
  })
  for(const id of [1,3,4,5])store.finish('shared',id);store.finish('another-session',2)
})

test('management waits for the host promise and native terminal event, and blocks new requests',async()=>{
  const store=scopes(),settled=deferred(),hold=deferred();let aborted=false,managed=false
  const run=store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async(headers,signal)=>{
    store.start('shared',request(1));store.beforeHeaders('shared',request(1),headers)
    signal.addEventListener('abort',()=>{aborted=true;settled.resolve()},{once:true})
    await hold.promise
  })
  const management=store.withManagement('shared',undefined,async()=>{managed=true},500)
  await settled.promise
  assert.equal(aborted,true);assert.equal(managed,false)
  assert.equal(store.start('shared',request(2,undefined,10)).cancel,true)
  await assert.rejects(store.withFetchScope('shared','b','https://fixture.invalid/data','GET',undefined,async()=>{}),/management_busy/)
  hold.resolve();await run
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(managed,false,'Settling fetch alone cannot fake native drain')
  store.finish('shared',1);await management;assert.equal(managed,true)
  assert.equal(store.start('shared',request(3,undefined,10)).cancel,false);store.finish('shared',3)
})

test('unconfirmed page drain and cancelled management do not run destructive management actions',async()=>{
  const store=scopes();let changes=0
  store.start('shared',request(1,undefined,10))
  await assert.rejects(store.withManagement('shared',undefined,async()=>{changes++},20),/network_drain_unconfirmed/)
  assert.equal(changes,0);assert.equal(store.isManaging('shared'),false)
  const abort=new AbortController();abort.abort()
  await assert.rejects(store.withManagement('shared',abort.signal,async()=>{changes++}),/aborted/)
  store.finish('shared',1)
  await store.withManagement('shared',undefined,async()=>{changes++});assert.equal(changes,1)
})

test('chat cancellation does not cancel another chat in the shared session',async()=>{
  const store=scopes(),hold=deferred();let abortedA=false,abortedB=false
  const a=store.withFetchScope('shared','a','https://fixture.invalid/data','GET',undefined,async(_headers,signal)=>{signal.addEventListener('abort',()=>{abortedA=true});await hold.promise})
  const b=store.withFetchScope('shared','b','https://fixture.invalid/data','GET',undefined,async(_headers,signal)=>{signal.addEventListener('abort',()=>{abortedB=true});await hold.promise})
  store.cancelChat('shared','a');assert.equal(abortedA,true);assert.equal(abortedB,false)
  hold.resolve();await Promise.all([a,b])
})

test('only an explicitly dedicated session can use its registered owner for a request without webContents',()=>{
  const owner={chatId:'private-owner',source:'session-principal' as const}
  const dedicated=new BrowserNetworkScopes({isShared:()=>false,resolveOwner:()=>owner})
  assert.equal(dedicated.start('dedicated',request(1)).owner?.chatId,'private-owner')
  assert.equal(dedicated.start('dedicated',request(2,undefined,-1)).owner?.source,'session-principal')
  assert.equal(dedicated.start('dedicated',request(3,undefined,999)).owner,null,'An unknown positive webContents ID cannot fall back to session owner')
  assert.equal(dedicated.start('dedicated',request(4,undefined,0)).owner,null)
  const shared=new BrowserNetworkScopes({isShared:()=>true,resolveOwner:()=>owner})
  assert.equal(shared.start('shared',request(1)).owner,null,'Public session creator is never an authority for worker requests')
  const unregistered=new BrowserNetworkScopes({resolveOwner:()=>owner})
  assert.equal(unregistered.start('unknown',request(1)).owner,null,'A missing explicit dedicated-session contract is not registration')
})
