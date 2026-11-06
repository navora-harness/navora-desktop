import {app,BrowserWindow,session} from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import {BrowserNetworkManager} from '../electron/modules/browser-network'
import {FETCH_SCOPE_HEADER} from '../electron/modules/browser-network-scope'
import {createDefaultConfig} from '../shared/config'

const temporary=process.env.NAVORA_NETWORK_SCOPE_SMOKE_ROOT
if(!temporary||!path.isAbsolute(temporary)||!path.basename(temporary).startsWith('navora-network-scope-'))throw Error('An isolated test profile is required')
fs.mkdirSync(path.join(temporary,'profile'),{recursive:true});fs.mkdirSync(path.join(temporary,'sessions'),{recursive:true});app.setPath('userData',path.join(temporary,'profile'));app.setPath('sessionData',path.join(temporary,'sessions'))
app.disableHardwareAcceleration()

void app.whenReady().then(async()=>{
console.log('[network-scope] Isolated Electron application ready')
const upstream:{path:string;kind?:string;proof:boolean;chat?:string}[]=[],windows:BrowserWindow[]=[],owners=new Map<number,{chatId:string;pageId:string}>()
const sourceSamples:{kind:string;webContentsId:number|null;chatId:string|null}[]=[]
let server:http.Server|undefined
let checks=0
const check=(condition:unknown,message:string)=>{assert.ok(condition,message);checks++;console.log('[network-scope]',message)}
try{
  server=http.createServer((request,response)=>{
    const url=new URL(request.url||'/',`http://${request.headers.host}`)
    upstream.push({path:url.pathname,kind:url.searchParams.get('kind')||undefined,proof:FETCH_SCOPE_HEADER in request.headers,chat:request.headers['x-fixture-chat'] as string|undefined})
    if(url.pathname==='/redirect'){response.writeHead(302,{Location:'/echo?redirect=1'});response.end();return}
    if(url.pathname==='/redirect-block'){response.writeHead(302,{Location:'/blocked'});response.end();return}
    if(url.pathname==='/redirect-origin'){response.writeHead(302,{Location:`http://localhost:${(server!.address() as import('node:net').AddressInfo).port}/echo`});response.end();return}
    if(url.pathname==='/hold'){response.writeHead(200,{'Content-Type':'text/plain'});response.write('pending');return}
    if(url.pathname==='/dedicated-worker.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end('onmessage=async()=>{try{postMessage(await(await fetch("/echo?kind=dedicated-worker")).json())}catch(error){postMessage({error:String(error)})}}');return}
    if(url.pathname==='/service-worker.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end('addEventListener("install",event=>event.waitUntil(skipWaiting()));addEventListener("activate",event=>event.waitUntil(clients.claim()));addEventListener("message",event=>event.waitUntil(fetch(event.data==="blocked"?location.origin.replace("127.0.0.1","localhost")+"/echo?kind=blocked-service-worker":"/echo?kind=service-worker").then(response=>response.json()).catch(()=>({error:true})).then(data=>event.ports[0].postMessage(data))))');return}
    if(url.pathname==='/frame'||url.pathname==='/cross-frame'){response.writeHead(200,{'Content-Type':'text/html'});response.end(`<!doctype html><script>fetch("/echo?kind=${url.pathname==='/frame'?'iframe':'cross-origin-iframe'}").then(response=>response.json()).then(data=>parent.postMessage({type:"scope-frame",data},"*"))</script>`);return}
    if(url.pathname==='/empty'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Network scope fixture</title>');return}
    response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({chat:request.headers['x-fixture-chat']||null,sharedCookie:!!request.headers.cookie?.includes('shared-fixture=value')}))
  })
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const ses=session.fromPartition('network-scope-isolated'),config=createDefaultConfig()
  const manager=new BrowserNetworkManager(()=>config,()=>ses,()=>'',{isShared:()=>true,resolveOwner:(_id,details)=>{
    const owner=owners.get(details.webContentsId||-1)||null,kind=new URL(details.url).searchParams.get('kind')
    if(kind)sourceSamples.push({kind,webContentsId:details.webContentsId??null,chatId:owner?.chatId??null})
    return owner
  }})
  for(const chatId of ['a','b']){
    manager.add('shared',{kind:'observe',urlPattern:'*'},chatId)
    manager.add('shared',{kind:'modify',urlPattern:'*',headers:{'X-Fixture-Chat':chatId}},chatId)
  }
  const fetchScoped=(chatId:string,pathname:string,signal?:AbortSignal)=>manager.withFetchScope('shared',chatId,base+pathname,'GET',signal,async(headers,scopedSignal)=>{
    const response=await ses.fetch(base+pathname,{headers,signal:scopedSignal,bypassCustomProtocolHandlers:true})
    return{status:response.status,text:await response.text()}
  })
  console.log('[network-scope] Starting local scoped fetch checks')
  const concurrent=await Promise.all([fetchScoped('a','/echo?same=1'),fetchScoped('b','/echo?same=1')])
  check(JSON.parse(concurrent[0]!.text).chat==='a'&&JSON.parse(concurrent[1]!.text).chat==='b','Same-URL concurrent host fetches retain distinct chat scope')
  const beforeRedirect=manager.getLog('shared',{},'a').length
  const redirected=await fetchScoped('a','/redirect')
  check(JSON.parse(redirected.text).chat==='a','Host scope survives a real Chromium redirect')
  const redirectIds=manager.getLog('shared',{},'a').slice(beforeRedirect).filter(row=>row.action==='observe').map(row=>row.id.split('_')[1])
  check(redirectIds.length===2&&new Set(redirectIds).size===1,'Chromium uses the same webRequest ID across redirect hops')
  const beforeUnknown=manager.getLog('shared',{},'a').length+manager.getLog('shared',{},'b').length
  const unknown=await ses.fetch(base+'/echo?unknown=1');check(((await unknown.json()) as {chat:unknown}).chat===null,'Unattributed native requests inherit no chat header rule')
  check(manager.getLog('shared',{},'a').length+manager.getLog('shared',{},'b').length===beforeUnknown,'Unattributed requests enter neither chat log')
  manager.add('shared',{kind:'block',urlPattern:base+'/blocked'},'a')
  await assert.rejects(fetchScoped('a','/blocked'));checks++
  check((await fetchScoped('b','/blocked')).status===200,'A chat block does not block another chat sharing login state')
  await assert.rejects(fetchScoped('a','/redirect-block'));checks++
  check(!upstream.some(row=>row.path==='/blocked'&&row.chat==='a'),'A blocked redirect target is never requested upstream')
  config.browser.url_allowlist=['127.0.0.1']
  await assert.rejects(fetchScoped('a','/redirect-origin'));checks++
  config.browser.url_allowlist=[]
  await ses.cookies.set({url:base,name:'shared-fixture',value:'value'})
  for(const chatId of ['a','b']){
    const window=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}})
    windows.push(window);owners.set(window.webContents.id,{chatId,pageId:`page-${chatId}`})
    await window.loadURL(base+'/empty')
    const result=await window.webContents.executeJavaScript('fetch("/echo?page=1").then(response=>response.json())')
    check(result.chat===chatId&&result.sharedCookie,`Page ${chatId} shares cookies while its network scope stays local`)
  }
  const page=windows[0]!.webContents
  const iframeResult=await page.executeJavaScript(`new Promise((resolve,reject)=>{const frame=document.createElement('iframe');const timer=setTimeout(()=>reject(Error('iframe timed out')),5000);addEventListener('message',function handler(event){if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.type!=='scope-frame')return;removeEventListener('message',handler);clearTimeout(timer);resolve(event.data.data)});frame.src='/frame';document.body.append(frame)})`)
  check(iframeResult.chat==='a'&&iframeResult.sharedCookie,'An iframe keeps its actual owning page scope and shared login cookie')
  const crossFrameUrl=base.replace('127.0.0.1','localhost')+'/cross-frame'
  const crossFrameResult=await page.executeJavaScript(`new Promise((resolve,reject)=>{const frame=document.createElement('iframe');const timer=setTimeout(()=>reject(Error('cross-origin iframe timed out')),5000);addEventListener('message',function handler(event){if(event.source!==frame.contentWindow||event.origin!==${JSON.stringify(new URL(crossFrameUrl).origin)}||event.data?.type!=='scope-frame')return;removeEventListener('message',handler);clearTimeout(timer);resolve(event.data.data)});frame.src=${JSON.stringify(crossFrameUrl)};document.body.append(frame)})`)
  const crossFrameSource=sourceSamples.find(sample=>sample.kind==='cross-origin-iframe')
  check(!!crossFrameSource&&crossFrameResult.chat===(crossFrameSource.chatId||null),'Cross-origin iframe requests use their actual native owner without guessing')
  const workerResult=await page.executeJavaScript(`new Promise((resolve,reject)=>{const worker=new Worker('/dedicated-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(Error('worker timed out'))},5000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data)};worker.onerror=event=>reject(Error(event.message));worker.postMessage('probe')})`)
  const workerSource=sourceSamples.find(sample=>sample.kind==='dedicated-worker')
  check(!!workerSource&&workerResult.chat===(workerSource.chatId||null)&&workerResult.sharedCookie,'Dedicated worker fetch remains functional and uses only a real known owner')
  const serviceResult=await page.executeJavaScript(`(async()=>{await navigator.serviceWorker.register('/service-worker.js');const registration=await navigator.serviceWorker.ready;return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(Error('service worker timed out')),5000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)};registration.active.postMessage('probe',[channel.port2])})})()`)
  const serviceSource=sourceSamples.find(sample=>sample.kind==='service-worker')
  check(!!serviceSource&&serviceResult.chat===(serviceSource.chatId||null)&&serviceResult.sharedCookie,'Service worker fetch remains functional without guessing its chat owner')
  config.browser.url_allowlist=['127.0.0.1']
  const blockedService=await page.executeJavaScript(`(async()=>{const registration=await navigator.serviceWorker.ready;return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(Error('blocked service worker timed out')),5000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)};registration.active.postMessage('blocked',[channel.port2])})})()`)
  check(blockedService.error===true&&!upstream.some(row=>row.kind==='blocked-service-worker'),'Application URL allowlist blocks unknown service-worker traffic before it reaches the server')
  config.browser.url_allowlist=[]
  console.log('[network-scope] Native source samples',JSON.stringify(sourceSamples))
  const dedicated=session.fromPartition('network-scope-dedicated-isolated'),dedicatedSources:{webContentsId:number|null;source:string}[]=[]
  const privateManager=new BrowserNetworkManager(()=>config,()=>dedicated,()=>'',{isShared:()=>false,resolveOwner:(_id,details)=>{
    if(details.webContentsId!==undefined&&details.webContentsId>=0){const owner=owners.get(details.webContentsId);return owner?.chatId==='private'?owner:null}
    if(new URL(details.url).searchParams.get('kind')==='service-worker')dedicatedSources.push({webContentsId:details.webContentsId??null,source:'registered-dedicated-session-principal'})
    return{chatId:'private',source:'session-principal'}
  }})
  privateManager.add('dedicated',{kind:'observe',urlPattern:'*'},'private')
  privateManager.add('dedicated',{kind:'modify',urlPattern:'*',headers:{'X-Fixture-Chat':'private'}},'private')
  const privateWindow=new BrowserWindow({show:false,webPreferences:{session:dedicated,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}})
  windows.push(privateWindow);owners.set(privateWindow.webContents.id,{chatId:'private',pageId:'private-page'})
  await privateWindow.loadURL(base+'/empty')
  const privateWorker=await privateWindow.webContents.executeJavaScript(`(async()=>{await navigator.serviceWorker.register('/service-worker.js');const registration=await navigator.serviceWorker.ready;return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(Error('dedicated service worker timed out')),5000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)};registration.active.postMessage('probe',[channel.port2])})})()`)
  check(privateWorker.chat==='private'&&privateWorker.sharedCookie===false,'A dedicated session uses its registered unique owner for service-worker rules and isolates login cookies')
  check(dedicatedSources.some(sample=>sample.webContentsId===null)&&privateManager.getLog('dedicated',{},'private').some(row=>row.url.includes('kind=service-worker')),'A dedicated worker without webContents ID is observed only under its registered session owner')
  check(privateManager.coverage('dedicated').sources.includes('registered-dedicated-session-principal')&&privateManager.coverage('dedicated').complete===false,'Dedicated coverage states its source contract without claiming universal mechanism coverage')
  privateManager.disposeSession('dedicated')
  let fetchSettled=false
  const held=fetchScoped('a','/hold').finally(()=>{fetchSettled=true}).catch(()=>{})
  await new Promise(resolve=>setTimeout(resolve,100))
  let managementRan=false
  const management=manager.withSharedManagement('shared',undefined,async()=>{check(fetchSettled,'Management waits for the host fetch promise to settle');managementRan=true},5000)
  await assert.rejects(fetchScoped('b','/echo?during-management=1'),/management_busy/);checks++
  await Promise.all([held,management]);check(managementRan,'Shared management aborts and drains live host/native requests before mutation')
  check(upstream.every(row=>!row.proof),'One-time scope proof never reaches the HTTP server')
  check(!JSON.stringify([...manager.getLog('shared',{},'a'),...manager.getLog('shared',{},'b')]).includes(FETCH_SCOPE_HEADER),'Scope proof is absent from both chat logs')
  check(manager.getLog('shared').length===0&&manager.list('shared').length===0,'Unscoped callers cannot inspect public rules or logs')
  manager.disposeSession('shared')
  console.log(`[network-scope] ${checks} checks passed using ${process.versions.electron}`)
}catch(error){console.error(error);process.exitCode=1}
finally{
  for(const window of windows)if(!window.isDestroyed())window.destroy()
  if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()))}
  app.exit(Number(process.exitCode)||0)
}
}).catch(error=>{console.error(error);app.exit(1)})
