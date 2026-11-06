import {BrowserAnnotationService} from '../electron/modules/browser-annotations'
import type {TrustedPointerOpts} from '../electron/modules/trusted-input'
import {WorkspaceFiles} from '../electron/modules/workspace-files'
import { app, BrowserWindow, webContents, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type {Socket} from 'node:net'
import { executeAgentTool, type ToolExecContext } from '../electron/modules/browser-tools'
import { createDefaultConfig } from '../shared/config'
import { requiresBrowserObservation } from '../shared/browser-tool-policy'
import { PluginStore } from '../electron/modules/plugin-store'
import { ChatStore } from '../electron/modules/chat-store'
import { AgentRuntime } from '../electron/modules/agent-runtime'
import { BrowserRegistry } from '../electron/modules/browser-registry'
import { createPluginHostApi } from '../electron/modules/plugin-host'
import type { PageSnapshot } from '../shared/page-index'
import { getBrowserAutomationController } from '../electron/modules/browser-automation-controller'
import { startOwnedNavigation } from '../electron/modules/browser-navigation-control'
import {makeFileTab} from '../shared/file-tabs'
import {detachedFileTabKey} from '../shared/detached-workspace'

// Manual annotation fixtures use the host's user-input path while Agent control
// is paused, matching the annotation UI fixture's simulated pointer events.
async function dispatchTrustedPointer(wc: Electron.WebContents, opts: TrustedPointerOpts): Promise<void> {
  const event:Electron.MouseInputEvent & {buttons:number}={
    type: opts.action === 'down' ? 'mouseDown' : opts.action === 'up' ? 'mouseUp' : 'mouseMove',
    x:opts.x,y:opts.y,...(opts.action==='move'?{}:{button:opts.button??'left'}),
    buttons:opts.buttons??(opts.action==='down'?1:0),clickCount:opts.action==='move'?0:opts.clickCount??1,
  }
  wc.sendInputEvent(event)
}

async function waitForAnnotationPhase(wc:Electron.WebContents,phase:'armed'|'target-ready'):Promise<void>{
  const deadline=Date.now()+2000
  let observed:unknown
  while(Date.now()<deadline){
    const state=await wc.executeJavaScriptInIsolatedWorld(1008,[{code:'(()=>{const s=globalThis.__navoraAnnotations;return s?{phase:s.phase,selection:s.selection,capture:s.capture,cancelled:s.cancelled}:null})()'}]) as {phase?:string;selection?:unknown}|null
    observed=state
    if(state?.phase===phase&&(phase!=='target-ready'||state.selection))return
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.fail(`Annotation input did not reach ${phase} within 2s: ${JSON.stringify(observed)}`)
}

const root = process.env.NAVORA_SMOKE_ROOT!
const fixtureSessions=new Set<Electron.Session>()
app.on('session-created',created=>fixtureSessions.add(created))
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
// This fixture owns shutdown after its windows, servers and report are settled.
app.on('window-all-closed',()=>{})
void app.whenReady().then(async () => {
fixtureSessions.add(session.defaultSession)
console.log('[browser-smoke] Electron ready')
app.once('quit',(_event,code)=>console.log('[browser-smoke/cleanup] app:quit',code))
const titleChats = new ChatStore(path.join(root,'title-regression'))
const titleChat = titleChats.create()
titleChats.appendMessage(titleChat.id,{role:'user',content:'请帮我看看未来几天天气。'})
assert.equal(titleChats.setProvisionalTitleFromFirstUser(titleChat.id,'请帮我看看未来几天天气。'),'未来几天天气')
assert.equal(titleChats.get(titleChat.id)?.titleSource,'auto')
titleChats.setTitle(titleChat.id,'我手动命名的对话',{fromUser:true})
titleChats.setTitle(titleChat.id,'迟到的后台标题',{fromAi:true})
assert.equal(titleChats.get(titleChat.id)?.title,'我手动命名的对话','Late automatic titles must not overwrite user names')
titleChats.flushChat(titleChat.id)
assert.equal(new ChatStore(path.join(root,'title-regression')).get(titleChat.id)?.titleSource,'user','Title provenance survives restart')
const legacyTitle = titleChats.create()
titleChats.appendMessage(legacyTitle.id,{role:'user',content:'看看未来几天天气'})
titleChats.setTitle(legacyTitle.id,'看看未来几天天气')
titleChats.flushChat(legacyTitle.id)
assert.equal(new ChatStore(path.join(root,'title-regression')).get(legacyTitle.id)?.titleSource,'auto','Only clear unlocked legacy titles regain automatic updates')
const config = createDefaultConfig()
config.browser.wait.load = false
config.browser.wait.network_idle = false
config.browser.wait.delay_ms = 0
config.browser.action_timeout_ms = 3000
const controller = new AbortController()
// Use the same real page/registry/lease model as production. A blank unobserved
// BrowserWindow used to stop at the blocker gate before reaching the network.
const primaryHost=new BrowserWindow({show:false,width:1000,height:800})
await primaryHost.loadURL('data:text/html,<title>Tool host fixture</title>')
primaryHost.show()
const primaryRegistry=new BrowserRegistry(()=>config),primaryHostId=primaryRegistry.hosts.bindMain(primaryHost),primarySession=primaryRegistry.createSession('fixture',{persist:false})
const primaryPage=primaryRegistry.createWindow(primarySession.sessionId,{chatId:'fixture',url:'about:blank',show:false})
const win=primaryRegistry.assertWindowOwned('fixture',primaryPage.windowId).win,fixtureWindowId=win.id
primaryRegistry.hosts.setLayout(primaryHostId,win.id,{x:0,y:0,width:1000,height:800})
await win.loadURL('data:text/html,<title>Ready fixture</title><main>Ordinary observed document</main>')
win.webContents.on('console-message',(event: unknown) => {
  const message=event as {level?:string;message?:string}
  if(message.level==='error')console.error('[fixture renderer]',message.message)
})
let permissionChecks = 0
let fixtureServer: http.Server | undefined
let crossFrameServer: http.Server | undefined
let persistenceServer: http.Server | undefined
let report:Record<string,unknown>|undefined
const fixtureRegistries:BrowserRegistry[]=[primaryRegistry],fixtureRuntimes:AgentRuntime[]=[]
let fixturePlugins:PluginStore|undefined
const fixtureServerSockets=new Map<http.Server,Set<Socket>>()
function activeHandles(){return (process as unknown as {_getActiveHandles:()=>Array<{constructor:{name:string}}>})._getActiveHandles()}
function activeResources(){return {resources:process.getActiveResourcesInfo(),handles:activeHandles().map(handle=>handle.constructor.name)}}
function trackFixtureServer(server:http.Server){
  const sockets=new Set<Socket>();fixtureServerSockets.set(server,sockets)
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))})
}
async function drainFixtureServerHandles(servers:ReadonlyArray<readonly [string,http.Server|undefined]>){
  const started=Date.now(),deadline=started+2000
  while(true){
    const handles=activeHandles(),pending=servers.filter(([,server])=>server&&(handles.includes(server)||(fixtureServerSockets.get(server)?.size||0)>0))
    if(!pending.length){console.log('[browser-smoke/cleanup] server-handles:drained',JSON.stringify({waitMs:Date.now()-started,resources:activeResources()}));return}
    if(Date.now()>=deadline)throw Error(`Fixture HTTP handles did not close: ${pending.map(([name,server])=>`${name}(sockets=${fixtureServerSockets.get(server!)?.size||0})`).join(', ')}`)
    // A close callback can precede libuv's close phase. A timer yields through
    // complete loop turns; checking owned handles proves completion, rather than
    // assuming one setImmediate callback has already reached that phase.
    await new Promise<void>(resolve=>setTimeout(resolve,10))
  }
}
const context = {
  chatId:'fixture',signal:controller.signal,getConfig:() => config,
  registry:primaryRegistry,
  gate:{async check(){permissionChecks++;return {ok:true}}},
} as unknown as ToolExecContext
const call = async (name: string, args: Record<string, unknown> = {}) => {
  console.log(`[browser-smoke] ${name} ${String(args.what || '')}`)
  if (requiresBrowserObservation(name)) {
    const observed = await executeAgentTool('browser_get',{windowId:fixtureWindowId,what:'text',waitUntil:'none'},context) as {ok?:boolean}
    assert.equal(observed.ok,true,'A normal input first observes the current document')
  }
  return await executeAgentTool(name,{windowId:fixtureWindowId,waitUntil:'none',...args},context) as Record<string, any>
}

try {
  // Exercise the production page registry with real native WebContentsViews.
  const embedded=new BrowserRegistry(()=>config),host=new BrowserWindow({show:false,width:1100,height:800})
  // The fixture keeps its host off screen; manual layout/input still needs a
  // live compositor independently of an Agent automation lease.
  host.webContents.setBackgroundThrottling(false)
  fixtureRegistries.push(embedded)
  await host.loadURL('data:text/html,<title>Browser host fixture</title>')
  host.show()
  const mainHostId=embedded.hosts.bindMain(host)
  const embeddedSession=embedded.createSession(titleChat.id,{persist:false})
  const resource=embedded.createWindow(embeddedSession.sessionId,{url:'about:blank',show:false})
  const page=embedded.assertWindowOwned(titleChat.id,resource.windowId).win,wc=page.webContents
  wc.setBackgroundThrottling(false)
  embedded.hosts.setLayout(mainHostId,page.id,{x:400,y:100,width:650,height:600})
  const hiddenResource=embedded.createWindow(embeddedSession.sessionId,{url:'about:blank',show:false}),hiddenPage=embedded.assertWindowOwned(titleChat.id,hiddenResource.windowId).win
  assert.equal(page.view.getVisible(),true,'Background page creation cannot replace the visible page')
  assert.equal(hiddenPage.view.getVisible(),false,'A hidden page never flashes at stale bounds')
  hiddenPage.destroy()
  embedded.hosts.setLayout(mainHostId,page.id,null)
  embedded.hosts.present(page)
  assert.equal(page.view.getVisible(),false,'Present waits for the renderer to confirm its visible region')
  embedded.hosts.setLayout(mainHostId,page.id,{x:400,y:100,width:650,height:600})
  assert.equal(page.view.getVisible(),true,'A fresh layout resumes the same native page')
  await wc.loadURLWithResponse('https://example.com/embedded-fixture',{statusCode:200,headers:{'Content-Type':'text/html'},body:'<title>Embedded fixture</title><style>body{height:2000px}button{margin-top:40px}</style><input id="draft"><button id="annotate">Annotate target</button>'})
  await wc.executeJavaScript('window.__retained={value:42};document.querySelector("input").value="draft survives";scrollTo(0,50)')
  const contentsId=wc.id,originalScroll=await wc.executeJavaScript('scrollY')
  const detachedHost=embedded.hosts.detach(page)
  assert.notEqual(detachedHost,mainHostId)
  assert.equal(wc.id,contentsId)
  assert.equal(await wc.executeJavaScript('window.__retained.value'),42)
  assert.equal(await wc.executeJavaScript('document.querySelector("input").value'),'draft survives')
  assert.equal(await wc.executeJavaScript('scrollY'),originalScroll)
  embedded.hosts.attachMain(page)
  assert.equal(page.hostId,mainHostId)
  assert.equal(page.view.getVisible(),false,'Returning to embedded content waits for a fresh renderer layout')
  embedded.hosts.setLayout(mainHostId,page.id,{x:400,y:100,width:650,height:600})
  assert.equal(embedded.hosts.getHost(detachedHost),undefined,'Empty detached host is released')
  assert.throws(()=>embedded.hosts.transfer(page,'missing-host'),/unavailable/)
  assert.equal(page.hostId,mainHostId,'Invalid transfer keeps original ownership')
  embedded.hosts.resizePage(page,{x:0,y:0,width:390,height:844})
  assert.deepEqual(page.getContentSize(),[390,844],'Fixed viewport remains separate from the host clipping area')
  const annotationFiles=new WorkspaceFiles(path.join(root,'annotations'),()=>config)
  const annotationService=new BrowserAnnotationService(embedded,annotationFiles)
  await wc.executeJavaScript('scrollTo(0,0)')
  await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})
  await wc.executeJavaScript(`(()=>{window.__annotationInputTrace=[];for(const type of ['pointermove','pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','mousemove','mousedown','mouseup','click'])document.addEventListener(type,event=>window.__annotationInputTrace.push({type:event.type,x:event.clientX,y:event.clientY,button:event.button,buttons:event.buttons,isPrimary:event.isPrimary,trusted:event.isTrusted,target:event.target.id||event.target.tagName,annotationLayer:event.target.hasAttribute?.('data-navora-annotation-layer')}),true);addEventListener('blur',()=>window.__annotationInputTrace.push({type:'window-blur'}))})()`)
  await annotationService.begin(titleChat.id,page.id,'element')
  await waitForAnnotationPhase(wc,'armed')
  const readable=await executeAgentTool('browser_get',{windowId:page.id,what:'title'}, {...context,chatId:titleChat.id,registry:embedded}) as {ok:boolean}
  assert.equal(readable.ok,true,'Read-only inspection remains available during annotation selection')
  const blocked=await executeAgentTool('browser_click',{windowId:page.id,selector:'#annotate',waitUntil:'none'}, {...context,chatId:titleChat.id,registry:embedded}) as {error:string}
  assert.equal(blocked.error,'browser_manual_control','Selection still rejects Agent input without clearing the manual gate')
  const target=await wc.executeJavaScript('(()=>{const r=document.querySelector("button").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
  console.log('[browser-smoke/annotation-input] before',JSON.stringify({zoom:wc.getZoomFactor(),bounds:page.view.getBounds(),visible:page.view.getVisible(),target,
    dom:await wc.executeJavaScript('(()=>{const r=document.querySelector("button").getBoundingClientRect();return {button:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,focus:document.activeElement?.outerHTML}})()')}))
  await dispatchTrustedPointer(wc,{action:'move',...target});await dispatchTrustedPointer(wc,{action:'down',...target});await dispatchTrustedPointer(wc,{action:'up',...target})
  await waitForAnnotationPhase(wc,'target-ready')
  const collected=await annotationService.collect(titleChat.id,page.id)
  console.log('[browser-smoke/annotation-input] after',JSON.stringify({events:await wc.executeJavaScript('window.__annotationInputTrace'),
    annotation:await wc.executeJavaScriptInIsolatedWorld(1008,[{code:'(()=>{const s=globalThis.__navoraAnnotations;return s?{phase:s.phase,selection:s.selection,capture:s.capture,cancelled:s.cancelled}:null})()'}]),collected}))
  assert.ok(collected.target,'Real pointer selection creates a retained temporary target')
  assert.equal(collected.target.selection.text,'Annotate target')
  assert.equal(annotationService.list(titleChat.id).length,0,'Selecting never writes an empty saved annotation')
  assert.equal(page.manualControl,true,'Selecting and editing stay inside the same explicit manual session')
  const targetDraft=annotationService.writeTarget(titleChat.id,collected.target.id,collected.target.version,{text:'Align this button',editorId:'native-smoke',sequence:1})
  const committed=await annotationService.commitTarget(titleChat.id,page.id,targetDraft.id,targetDraft.version)
  assert.equal((await annotationService.commitTarget(titleChat.id,page.id,targetDraft.id,targetDraft.version)).id,committed.id,'A saved target cannot create a duplicate annotation on retry')
  assert.equal(annotationService.listTargets(titleChat.id,page.id).length,0,'Successful save consumes the target draft')
  const annotation=annotationService.update(titleChat.id,committed.id,1,{taskState:'pending'})
  assert.equal(annotation.revision,2)
  assert.throws(()=>annotationService.update(titleChat.id,annotation.id,1,{comment:'stale write'}),/revision_conflict/)
  assert.ok(fs.existsSync(annotationFiles.resolve(titleChat.id,annotation.screenshotPath)))
  assert.equal((await annotationService.collect(titleChat.id,page.id)).target,undefined,'A committed target returns to selection mode')
  assert.equal(page.manualControl,true,'Saving does not prematurely resume AI while annotation mode is still open')
  await annotationService.cancel(titleChat.id,page.id)
  assert.equal(page.manualControl,false,'Explicit exit restores the valid original AI control state')
  const resized=await executeAgentTool('browser_window_set_bounds',{windowId:page.id,width:420,height:600},{...context,chatId:titleChat.id,registry:embedded}) as {width:number;height:number}
  if (resized.width !== 420) console.log('[browser-smoke] resize result',JSON.stringify(resized))
  assert.equal(resized.width,420);assert.equal(resized.height,600);assert.deepEqual(page.getContentSize(),[420,600],'Legacy bounds tool commits its viewport before returning')
  assert.equal(await annotationService.locate(titleChat.id,annotation.id),true,'A matching current element can be highlighted')
  const annotationRef={kind:'annotation' as const,annotationId:annotation.id,annotationRevision:annotation.revision,windowId:page.id,sessionId:annotation.sessionId,label:annotation.comment}
  fs.writeFileSync(annotationFiles.resolve(titleChat.id,`browser-annotations/${annotation.id}-r${annotation.revision}.json`),JSON.stringify(annotation))
  titleChats.appendMessage(titleChat.id,{role:'user',content:'Review the selected button',meta:{refs:[annotationRef]}})
  annotationService.update(titleChat.id,annotation.id,2,{comment:'A newer unsent edit'})
  const evidenceRuntime=new AgentRuntime({chats:titleChats,files:annotationFiles,registry:embedded,getConfig:()=>config,emit:()=>{}} as unknown as ConstructorParameters<typeof AgentRuntime>[0])
  fixtureRuntimes.push(evidenceRuntime)
  const evidenceMessages:import('../shared/openai-types').ChatMessageParam[]=[]
  const appendEvidence=(evidenceRuntime as unknown as {appendAnnotationEvidence(chatId:string,messages:typeof evidenceMessages,seen:Set<string>,images:boolean):Promise<void>}).appendAnnotationEvidence.bind(evidenceRuntime)
  const evidenceSeen=new Set<string>()
  await appendEvidence(titleChat.id,evidenceMessages,evidenceSeen,true)
  assert.ok(Array.isArray(evidenceMessages[0]!.content),'Image-capable models receive actual image content')
  assert.ok(JSON.stringify(evidenceMessages).includes('data:image/png;base64,'))
  assert.ok(JSON.stringify(evidenceMessages).includes('Align this button'))
  assert.ok(!JSON.stringify(evidenceMessages).includes('A newer unsent edit'),'Edits never rewrite already-sent evidence')
  annotationService.markReview(titleChat.id,evidenceSeen)
  assert.equal(annotationService.get(titleChat.id,annotation.id).taskState,'pending','An old task cannot mark a newer opinion as reviewed')
  const textOnly:typeof evidenceMessages=[];await appendEvidence(titleChat.id,textOnly,new Set(),false)
  assert.ok(!JSON.stringify(textOnly).includes('data:image/'),'Text-only models receive an explicit image capability fallback')
  await annotationService.begin(titleChat.id,page.id,'region')
  await waitForAnnotationPhase(wc,'armed')
  await dispatchTrustedPointer(wc,{action:'down',x:20,y:20});await dispatchTrustedPointer(wc,{action:'move',x:120,y:70,buttons:1});await dispatchTrustedPointer(wc,{action:'up',x:120,y:70})
  await waitForAnnotationPhase(wc,'target-ready')
  const region=(await annotationService.collect(titleChat.id,page.id)).target
  console.log('[browser-smoke/annotation-input] region',JSON.stringify({events:await wc.executeJavaScript('window.__annotationInputTrace'),
    annotation:await wc.executeJavaScriptInIsolatedWorld(1008,[{code:'(()=>{const s=globalThis.__navoraAnnotations;return s?{phase:s.phase,selection:s.selection,capture:s.capture,cancelled:s.cancelled}:null})()'}])}))
  assert.equal(region?.selection.kind,'region');assert.ok(Math.abs((region?.selection.rect.width||0)-100)<1)
  await annotationService.cancel(titleChat.id,page.id)

  await page.automation.takeControl()
  await annotationService.begin(titleChat.id,page.id,'element')
  await waitForAnnotationPhase(wc,'armed')
  const beforeCancellation=annotationService.list(titleChat.id).length
  const cancelledPoint=await wc.executeJavaScript('(()=>{const r=document.querySelector("#annotate").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
  await dispatchTrustedPointer(wc,{action:'down',...cancelledPoint});await dispatchTrustedPointer(wc,{action:'up',...cancelledPoint})
  assert.equal(await annotationService.cancel(titleChat.id,page.id),true,'Cancelling a selection keeps prior manual control')
  assert.equal((await annotationService.collect(titleChat.id,page.id)).annotation,undefined,'A queued collection cannot resurrect the cancelled selection')
  assert.equal(annotationService.list(titleChat.id).length,beforeCancellation)
  await annotationService.begin(titleChat.id,page.id,'region')
  await waitForAnnotationPhase(wc,'armed')
  await assert.rejects(annotationService.begin(titleChat.id,page.id,'element'),/browser_busy_finish_action_first/)
  await annotationService.cancel(titleChat.id,page.id,true)
  assert.equal(page.manualControl,true,'A legacy cancel flag cannot override the original manual owner')
  await page.automation.resume()
  assert.equal(page.manualControl,false,'Only explicit controller resume grants AI operations')

  assert.equal(wc.debugger.isAttached(),false,'Annotations and migration never attach debugger')
  // Queue a former guest's shortcuts after all manual-ownership restoration
  // assertions: an actual before-input event also conservatively pauses its AI.
  const keyboardHostId=embedded.hosts.detach(page),mixedFile=makeFileTab(titleChat.id,'fixture/keyboard.md')
  embedded.hosts.addFile(keyboardHostId,{tab:mixedFile,viewerChatId:titleChat.id})
  const mixedHost=embedded.hosts.getHost(keyboardHostId)!,beforePages=embedded.hosts.hostPages(keyboardHostId)
  let suppressedKeys=0
  for(const key of ['w','t','Tab','l'])wc.emit('before-input-event',{preventDefault(){suppressedKeys++}},{type:'keyDown',key,control:true,meta:false,shift:false,alt:false,isComposing:false,isAutoRepeat:false})
  assert.equal(suppressedKeys,4,'Late native guest shortcuts are suppressed while a file owns the detached host')
  assert.equal(mixedHost.activeTab,detachedFileTabKey(mixedFile.key))
  assert.deepEqual(embedded.hosts.hostPages(keyboardHostId),beforePages,'Hidden Ctrl W/T/Tab/L cannot mutate pages or wake the old native tab')
  assert.equal(page.isDestroyed(),false)
  embedded.hosts.removeFile(keyboardHostId,mixedFile.key)
  await embedded.closeSession(embeddedSession.sessionId,true);host.destroy()
  let restoredDocumentRequests=0
  persistenceServer=http.createServer((request,response)=>{
    if(request.url==='/restored-fixture')restoredDocumentRequests++
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.end('<title>Restored fixture</title>')
  })
  trackFixtureServer(persistenceServer)
  await new Promise<void>(resolve=>persistenceServer!.listen(0,'127.0.0.1',resolve))
  const restoredUrl=`http://127.0.0.1:${(persistenceServer.address() as {port:number}).port}/restored-fixture`
  const persistenceFile=path.join(root,'browser-workspace.json')
  const persistentRegistry=new BrowserRegistry(()=>config),persistentHost=new BrowserWindow({show:false})
  fixtureRegistries.push(persistentRegistry)
  persistentRegistry.hosts.bindMain(persistentHost);persistentRegistry.restorePersistent(persistenceFile,()=>true)
  const persistentSession=persistentRegistry.createSession(titleChat.id,{persist:true})
  const persistentPage=persistentRegistry.createWindow(persistentSession.sessionId,{url:'about:blank',show:false})
  await persistentRegistry.getWindowRecord(persistentPage.windowId)!.win.webContents.loadURLWithResponse(restoredUrl,{statusCode:200,headers:{'Content-Type':'text/html'},body:'<title>Restored fixture</title>'})
  const blankPage=persistentRegistry.createWindow(persistentSession.sessionId,{url:'about:blank',show:false})
  persistentRegistry.getWindowRecord(persistentPage.windowId)!.tabKey='browser:restored-fixture'
  persistentRegistry.savePersistent();persistentRegistry.shutdown();persistentHost.destroy()
  const restoredRegistry=new BrowserRegistry(()=>config),restoredHost=new BrowserWindow({show:false})
  fixtureRegistries.push(restoredRegistry)
  restoredRegistry.hosts.bindMain(restoredHost);restoredRegistry.restorePersistent(persistenceFile,()=>true)
  const restoredSession=restoredRegistry.getTree(titleChat.id).find(session=>session.sessionId===persistentSession.sessionId)
  assert.ok(restoredSession,'The saved dedicated session is recovered beside the lazy public default')
  const restoredPage=restoredSession.windows.find(page=>page.windowId===persistentPage.windowId)!
  assert.equal(restoredPage.windowId,persistentPage.windowId,'Page identity is recovered from the saved workspace')
  assert.equal(restoredPage.tabKey,'browser:restored-fixture')
  assert.equal(restoredSession.windows.some(page=>page.windowId===blankPage.windowId),false,'Untouched blank pages are excluded from restart recovery')
  assert.equal(restoredSession.windows.length,1,'Only the submitted real page returns after restart')
  assert.equal(restoredSession.partition,persistentSession.partition,'Persistent login partition is retained')
  const restoredWindow=restoredRegistry.getWindowRecord(restoredPage.windowId)!.win
  // Restoration loads lazily on activation. Its document belongs to this local
  // server rather than relying on an injected response to survive a restart.
  await new Promise<void>((resolve,reject)=>{
    const contents=restoredWindow.webContents
    const finish=(error?:Error)=>{
      clearTimeout(timer)
      contents.removeListener('did-finish-load',loaded)
      contents.removeListener('did-fail-load',failed)
      if(error)reject(error);else resolve()
    }
    const loaded=()=>finish()
    const failed=(_event:Electron.Event,_code:number,description:string,url:string,mainFrame:boolean)=>{if(mainFrame)finish(new Error(`Restored fixture load failed: ${description} ${url}`))}
    const timer=setTimeout(()=>finish(new Error('Restored fixture did not load within 3s')),3000)
    contents.once('did-finish-load',loaded)
    contents.on('did-fail-load',failed)
    restoredRegistry.hosts.activate(restoredWindow)
  })
  assert.equal(restoredWindow.webContents.getURL(),restoredUrl,'Activation reloads the saved local address')
  assert.equal(restoredWindow.webContents.getTitle(),'Restored fixture')
  assert.ok(restoredDocumentRequests>0,'Restoration actually requests the fixture document')
  restoredRegistry.shutdown();restoredHost.destroy()
  console.log('[browser-smoke] embedded transfer, retained state, fixed viewport and annotations passed')

  // Terminal status must not destroy a retained page or login. Exercise the real
  // finalizer and registry, then explicitly release through the Agent tools.
  const lifetimeRegistry = new BrowserRegistry(() => config)
  fixtureRegistries.push(lifetimeRegistry)
  const lifetimeRuntime = new AgentRuntime({
    chats: titleChats, registry: lifetimeRegistry, getConfig: () => config, emit: () => {},
  } as unknown as ConstructorParameters<typeof AgentRuntime>[0])
  fixtureRuntimes.push(lifetimeRuntime)
  const manualCloseState = lifetimeRuntime as unknown as {runs:Map<string,AbortController>;pendingEvents:Map<string,string[]>}
  const historyBeforeClose = titleChats.get(titleChat.id)!.messages.length
  lifetimeRuntime.notifyWindowClosed(titleChat.id, 'idle-window')
  assert.equal(titleChats.get(titleChat.id)!.messages.length, historyBeforeClose, 'Idle manual closure does not add a chat log')
  assert.equal(manualCloseState.pendingEvents.has(titleChat.id), false, 'Idle closures do not leak into a future task')
  manualCloseState.runs.set(titleChat.id, new AbortController())
  lifetimeRuntime.notifyWindowClosed(titleChat.id, 'active-window')
  assert.equal(titleChats.get(titleChat.id)!.messages.length, historyBeforeClose, 'Active manual closure stays out of the visible transcript')
  assert.match(manualCloseState.pendingEvents.get(titleChat.id)![0]!, /active-window/, 'The active Agent still learns which window was removed')
  lifetimeRuntime.notifySessionClosed(titleChat.id, 'active-session')
  assert.equal(titleChats.get(titleChat.id)!.messages.length, historyBeforeClose, 'Manual Session release also stays out of chat logs')
  assert.match(manualCloseState.pendingEvents.get(titleChat.id)![1]!, /active-session/, 'Session release is still known to the active Agent')
  manualCloseState.runs.delete(titleChat.id)
  manualCloseState.pendingEvents.delete(titleChat.id)
  const downloadRuntime=lifetimeRuntime as unknown as {runContexts:Map<string,{id:string;turnId?:string;sequence:number}>;pendingEvents:Map<string,string[]>}
  const origin={id:'download-run',turnId:'download-user',sequence:0}
  downloadRuntime.runContexts.set(titleChat.id,origin)
  const nativeDownload={id:'native-fixture',chatId:titleChat.id,sessionId:'download-session',state:'started' as const,url:'http://127.0.0.1/file',filename:'fixture.txt',relPath:'downloads/fixture.txt',createdAt:Date.now(),updatedAt:Date.now()}
  lifetimeRuntime.trackBrowserDownload(nativeDownload)
  lifetimeRuntime.recordBrowserDownload(nativeDownload,{summary:'Download started',content:'Download started'})
  const later={id:'later-run',turnId:'later-user',sequence:0}
  downloadRuntime.runContexts.set(titleChat.id,later)
  downloadRuntime.pendingEvents.delete(titleChat.id)
  lifetimeRuntime.recordBrowserDownload({...nativeDownload,state:'completed',receivedBytes:123},{summary:'Download completed',content:'Download completed'})
  const terminal=titleChats.get(titleChat.id)!.messages.at(-1)!
  assert.equal(terminal.meta?.runId,origin.id,'A native download finishing in a later task keeps its original run')
  assert.equal(terminal.meta?.turnId,origin.turnId)
  assert.equal(terminal.meta?.runSequence,1,'Late completion continues its original sequence')
  assert.equal(downloadRuntime.pendingEvents.has(titleChat.id),false,'An old completion never interrupts a new model request')
  assert.equal((terminal.meta?.download as {receivedBytes:number}).receivedBytes,123)
  downloadRuntime.runContexts.delete(titleChat.id)
  const parentSession = lifetimeRegistry.createSession(titleChat.id,{persist:false})
  lifetimeRegistry.createWindow(parentSession.sessionId, { show: false })
  const owners = [titleChat.id]
  try {
    for (const status of ['done', 'failed', 'cancelled'] as const) {
      const child = titleChats.create('Browser lifetime fixture', { kind: 'sub', parentChatId: titleChat.id })
      owners.push(child.id)
      const session = lifetimeRegistry.createSession(child.id,{persist:false})
      const page = lifetimeRegistry.createWindow(session.sessionId, { show: false })
      const wc = lifetimeRegistry.assertWindowOwned(child.id, page.windowId).win.webContents
      if (wc.isLoadingMainFrame()) await new Promise<void>(resolve => wc.once('did-finish-load', () => resolve()))
      const ses = lifetimeRegistry.assertSessionOwned(child.id, session.sessionId).ses
      await ses.cookies.set({ url: 'https://example.com', name: 'lifetime-fixture', value: 'retained' })
      ;(lifetimeRuntime as unknown as { finalizeSubchat(id: string, status: string): void }).finalizeSubchat(child.id, status)
      assert.equal(titleChats.get(child.id)?.spawnStatus, status)
      assert.equal(lifetimeRegistry.getTree(child.id).find(item=>item.sessionId===session.sessionId)?.windows.length, 1, status + ' keeps the browser until Agent release')
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' }))[0]?.value, 'retained', status + ' retains session state')
      const toolContext = { ...context, chatId: child.id, registry: lifetimeRegistry, network: { disposeSession() {} } } as unknown as ToolExecContext
      await executeAgentTool('browser_window_close', { windowId: page.windowId }, toolContext)
      assert.equal(lifetimeRegistry.getTree(child.id).find(item=>item.sessionId===session.sessionId)?.windows.length, 0, 'Agent can release a page separately')
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' })).length, 1, 'Window release keeps the reusable Session')
      await executeAgentTool('browser_session_close', { sessionId: session.sessionId }, toolContext)
      const releasedTree=lifetimeRegistry.getTree(child.id)
      assert.equal(releasedTree.some(item=>item.sessionId===session.sessionId),false,'Agent can explicitly release the entire dedicated Session')
      assert.equal(releasedTree.length,1,'Releasing a dedicated Session retains only the public default entry')
      assert.equal(releasedTree[0]!.scope,'default')
      assert.equal(releasedTree[0]!.initialized,false,'Explicit release does not initialize the lazy public Session')
      assert.equal(releasedTree[0]!.windows.length,0)
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' })).length, 0, 'Explicit Session release clears its data')
      assert.equal(lifetimeRegistry.getTree(titleChat.id).find(item=>item.sessionId===parentSession.sessionId)?.windows.length, 1, 'Releasing a child does not affect its parent')
    }
  } finally {
    for (const id of owners) await lifetimeRegistry.clearChat(id)
  }
  crossFrameServer = http.createServer((_request,response) => {
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.end(`<button id="frame-action" onclick="parent.postMessage({type:'frame-click',trusted:event.isTrusted},'*')">Frame action</button>`)
  })
  trackFixtureServer(crossFrameServer)
  await new Promise<void>((resolve) => crossFrameServer!.listen(0,'127.0.0.1',resolve))
  const crossPort = (crossFrameServer.address() as {port:number}).port
  const html = `<!doctype html><meta charset="utf-8"><base href="https://example.com/"><title>Index fixture</title>
    <main><h1>测试页面</h1><label for="search">搜索产品</label><input id="search"><input type="password" value="DO_NOT_INDEX_PASSWORD">
    <button id="save">保存</button><button disabled>不可用</button><a href="/product?id=1">产品详情</a>
    <p hidden>DO_NOT_INDEX_HIDDEN</p><input id="upload" type="file"><open-widget></open-widget><closed-widget></closed-widget>
    <iframe id="cross-frame" title="Frame fixture" src="http://127.0.0.1:${crossPort}/"></iframe></main>
    <script>
      document.querySelector('#save').addEventListener('click',event=>window.savedTrusted=event.isTrusted);
      document.querySelector('open-widget').attachShadow({mode:'open'}).innerHTML='<button>Shadow action</button><input aria-label="Shadow input">';
      document.querySelector('closed-widget').attachShadow({mode:'closed'}).innerHTML='<button id="closed-button">Closed action</button>';
      addEventListener('message',event=>{if(event.data?.type==='frame-click')window.frameTrusted=event.data.trusted});
    </script>`
  let slowNavigation = false,brokenRequests=0
  let slowRequestStarted: (() => void) | undefined
  fixtureServer = http.createServer((request, response) => {
    if(request.url==='/broken'){brokenRequests++;response.destroy();return}
    response.setHeader('Content-Type','text/html; charset=utf-8')
    if (request.url?.startsWith('/history-')) {
      response.setHeader('Cache-Control','no-store')
      const title = request.url === '/history-slow' ? 'History slow' : request.url === '/history-a' ? 'History A' : request.url === '/history-b' ? 'History B' : 'User navigation'
      if (slowNavigation && request.url === '/history-slow') {
        slowRequestStarted?.(); slowRequestStarted = undefined
        setTimeout(() => response.end('<title>Late navigation</title><p>Late response must never replace the user document</p>'), 350)
      } else response.end(`<title>${title}</title><p>${title}</p>`)
      return
    }
    if (request.url === '/loading') {
      response.write('<title>Loading fixture</title><p>Partial document')
      setTimeout(() => response.end('</p>'), 500)
      return
    }
    response.end(request.url === '/next' ? '<title>Next</title><button>Next document</button>' : request.url === '/benchmark'
      ? '<title>Index benchmark</title><main>' + Array.from({length:250},(_, i) => `<article><h2>商品 ${i}</h2><p>商品 ${i} 的参数和说明</p><a href="https://example.com/products/${i}">商品 ${i} 详情</a><button>选择商品 ${i}</button></article>`).join('') + '</main>'
      : html)
  })
  trackFixtureServer(fixtureServer)
  await new Promise<void>((resolve) => fixtureServer!.listen(0,'127.0.0.1',resolve))
  const address = fixtureServer.address() as {port:number}
  const fixtureUrl = `http://127.0.0.1:${address.port}`
  const permissionCheck = context.gate.check
  const checked: string[] = []
  context.gate.check = async (_chatId, capability) => { checked.push(capability); return { ok: capability !== 'browser.geolocation', reason: 'fixture_denied' } }
  const deniedWeather = await call('weather_get')
  assert.equal(deniedWeather.error, 'fixture_denied')
  assert.deepEqual(checked, ['session.fetch', 'browser.geolocation'], 'Local weather retains BOTH network and location permissions')
  context.gate.check = permissionCheck
  const downloadListeners=win.webContents.session.listenerCount('will-download')
  await assert.rejects(call('browser_navigate',{url:fixtureUrl+'/broken',timeoutMs:1200}),/ERR_/,'A real page failure never becomes a successful download')
  assert.ok(brokenRequests>0,'The navigation failure came from the fixture HTTP server, after the page gate dispatched navigation')
  assert.equal(win.webContents.session.listenerCount('will-download'),downloadListeners,'Failed navigation detaches its temporary download observer')
  const loading = win.loadURL(fixtureUrl + '/loading')
  await new Promise(resolve => setTimeout(resolve, 30))
  const listeners = win.webContents.listenerCount('did-fail-load')
  const startedWaiting = Date.now()
  let waitSettledAt=0
  const removeWaitListener=win.webContents.removeListener
  // Electron's native EventEmitter does not emit Node's removeListener meta
  // event. Observe the real cleanup call, then restore the exact method.
  win.webContents.removeListener=((eventName:string,listener:(...args:any[])=>void)=>{
    const result=removeWaitListener.call(win.webContents,eventName as never,listener as never)
    if(!waitSettledAt&&eventName==='did-fail-load'&&win.webContents.listenerCount('did-fail-load')===listeners)waitSettledAt=Date.now()
    return result
  }) as typeof win.webContents.removeListener
  setTimeout(() => win.webContents.emit('did-fail-load', {}, -3, '', fixtureUrl + '/loading', true), 10)
  const partial = await call('browser_wait', { load:true, waitUntil: 'load', timeoutMs: 80 }).finally(()=>{win.webContents.removeListener=removeWaitListener})
  assert.equal(partial.ok, true, 'Cancelled intermediate navigation is not a load failure')
  assert.equal(partial.partial, true)
  assert.equal(partial.waitTimedOut,true,'The fixture explicitly requests load waiting and reaches the 80ms deadline')
  assert.ok(waitSettledAt>0&&waitSettledAt-startedWaiting<250,`One deadline bounds the actual wait before the independent blocker check (detach=${waitSettledAt?waitSettledAt-startedWaiting:'unobserved'}ms, total=${Date.now()-startedWaiting}ms)`)
  assert.equal(win.webContents.listenerCount('did-fail-load'), listeners, 'Timed-out waits detach their listeners')
  await loading
  await win.loadURL(fixtureUrl)
  const capabilities = await call('browser_get',{what:'capabilities'})
  assert.equal(capabilities.value.queryDeep,true)
  assert.equal(capabilities.value.trustedClick,true)
  const snapshotResult = await call('browser_get',{what:'snapshot',refresh:true})
  assert.equal(snapshotResult.ok,true)
  const snapshot = snapshotResult.value as PageSnapshot
  assert.ok(snapshot.entries.some((entry) => entry.name === 'Shadow action'))
  assert.ok(snapshot.entries.some((entry) => entry.name === '搜索产品'))
  assert.ok(!JSON.stringify(snapshot).includes('DO_NOT_INDEX_PASSWORD'))
  assert.ok(!JSON.stringify(snapshot).includes('DO_NOT_INDEX_HIDDEN'))
  assert.equal(snapshot.coverage.closedShadow,false)
  assert.equal(snapshot.coverage.frameContents,false)
  const cached = await call('browser_get',{what:'snapshot'})
  assert.equal(cached.value.reused,true)
  const save = snapshot.entries.find((entry) => entry.name === '保存')!
  const clicked = await call('browser_click',{ref:save.ref})
  assert.equal(clicked.ok,true)
  assert.equal(clicked.method,capabilities.value.pointerTrajectory ? 'dispatchInputSequence+target_clickElement' : 'clickElement')
  assert.equal(await win.webContents.executeJavaScript('window.savedTrusted'),true)
  const input = snapshot.entries.find((entry) => entry.name === '搜索产品')!
  assert.equal((await call('browser_type',{ref:input.ref,text:'Navora'})).ok,true)
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("#search").value'),'Navora')
  const shadow = snapshot.entries.find((entry) => entry.name === 'Shadow action')!
  assert.equal((await call('browser_click',{ref:shadow.ref})).ok,true)
  const shadowInput = snapshot.entries.find((entry) => entry.name === 'Shadow input')!
  assert.equal((await call('browser_type',{ref:shadowInput.ref,text:'shadow text'})).ok,true)
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("open-widget").shadowRoot.querySelector("input").value'),'shadow text')
  const closed = await call('browser_query_deep',{selector:'closed-widget >>> #closed-button'})
  assert.equal(closed.ok,true)
  assert.ok(closed.element.backendNodeId > 0)
  const framed = await call('browser_query_deep',{selector:'iframe#cross-frame #frame-action',acrossDocuments:true})
  assert.equal(framed.ok,true)
  const frameClicked = await call('browser_click',{iframeSelector:'#cross-frame',innerSelector:'#frame-action'})
  assert.equal(frameClicked.ok,true)
  assert.equal(frameClicked.method,'iframe-native-selector')
  for(let i=0;i<20;i++) {
    if(await win.webContents.executeJavaScript('window.frameTrusted === true')) break
    await new Promise((resolve) => setTimeout(resolve,10))
  }
  console.log('[browser-smoke] frame',JSON.stringify({query:framed.element,clicked:frameClicked}))
  assert.equal(await win.webContents.executeJavaScript('window.frameTrusted'),true)
  const missingFrame = await call('browser_click',{iframeSelector:'#cross-frame',innerSelector:'#missing-action'})
  assert.equal(missingFrame.ok,false)
  assert.equal(missingFrame.error,'iframe_element_not_found')
  const upload = path.join(root,'upload.txt')
  fs.writeFileSync(upload,'fixture upload')
  const uploaded = await call('browser_upload',{selector:'#upload',paths:[upload]})
  assert.equal(uploaded.ok,true)
  assert.equal(uploaded.method,'setFileInputFiles')
  console.log('[browser-smoke] uploaded',await win.webContents.executeJavaScript('JSON.stringify({count:document.querySelector("#upload").files.length})'))
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("#upload").files[0].name'),'upload.txt')
  console.log('[browser-smoke] native file input passed')
  win.webContents.setJsDialogHandler!(() => ({accept:true,promptText:'fixture answer'}))
  assert.equal(await win.webContents.executeJavaScript('prompt("fixture question")'),'fixture answer')
  win.webContents.setJsDialogHandler!(null)
  await win.webContents.executeJavaScript('document.querySelector("#save").textContent="Delete"')
  assert.equal((await call('browser_click',{ref:save.ref})).error,'stale_element_ref')
  const searched = await call('browser_find',{text:'产品详情'})
  assert.equal(searched.matches[0].url,'https://example.com/product?id=1')

  const pluginDir = path.join(root,'plugins','fixture-reader')
  fs.mkdirSync(pluginDir,{recursive:true})
  fs.writeFileSync(path.join(pluginDir,'plugin.json'),JSON.stringify({id:'fixture-reader',name:'Fixture reader',version:'1.0.0',description:'Contract fixture',main:'main.cjs',defaultEnabled:true}))
  fs.writeFileSync(path.join(pluginDir,'main.cjs'),`module.exports={
    tools:[{type:'function',function:{name:'fixture_read_page',description:'Read a page',parameters:{type:'object',properties:{windowId:{type:'string'}},required:['windowId']}}}],
    planPermissions(){return {capabilities:['get_page']}},
    async execute(name,args,api){if(api.ctx!==api)throw Error('legacy ctx missing');return api.runTool('browser_get',{windowId:args.windowId,what:'snapshot',waitUntil:'none'})}
  }`)
  const plugins = new PluginStore(root)
  fixturePlugins=plugins
  context.plugins = plugins
  assert.ok(plugins.enabledToolsForChat('fixture').some((tool) => tool.function.name === 'fixture_read_page'))
  const pluginResult = await call('fixture_read_page')
  assert.equal(pluginResult.ok,true)
  assert.ok(pluginResult.value.entries.length > 0)
  const api = createPluginHostApi(context,['get_page'])
  const denied = await api.runTool('browser_click',{windowId:fixtureWindowId,selector:'#save'}) as {ok:boolean;error:string}
  assert.equal(denied.error,'plugin_capability_not_declared:click')

  await win.loadURL(fixtureUrl + '/next')
  assert.equal((await call('browser_click',{ref:input.ref})).error,'stale_element_ref')
  await win.loadURL(fixtureUrl + '/benchmark')
  const captureTimes: number[] = []
  const queryTimes: number[] = []
  let cacheHits = 0
  for(let i=0;i<10;i++) {
    const started = performance.now()
    const result = await executeAgentTool('browser_get',{windowId:fixtureWindowId,what:'snapshot',refresh:true,query:'商品 200',waitUntil:'none'},context) as Record<string, any>
    captureTimes.push(performance.now()-started)
    assert.ok(result.value.entries.some((entry: {url?:string}) => entry.url === 'https://example.com/products/200'))
  }
  let lastPayload = 0
  for(let i=0;i<20;i++) {
    const started = performance.now()
    const result = await executeAgentTool('browser_get',{windowId:fixtureWindowId,what:'snapshot',query:'商品 200',waitUntil:'none'},context) as Record<string, any>
    queryTimes.push(performance.now()-started)
    if(result.value.reused) cacheHits++
    lastPayload = JSON.stringify(result.value).length
    assert.ok(lastPayload <= 16000)
  }
  assert.ok(cacheHits > 0)
  const percentile = (values: number[], fraction: number) => {
    const sorted = [...values].sort((a,b) => a-b)
    return Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]! * 100) / 100
  }
  const benchmark = {fixtureProducts:250,captureSamples:10,querySamples:20,
    captureP50Ms:percentile(captureTimes,.5),captureP95Ms:percentile(captureTimes,.95),
    queryP50Ms:percentile(queryTimes,.5),queryP95Ms:percentile(queryTimes,.95),cacheHits,lastPayloadChars:lastPayload,
    measurement:'host tool round trip, local HTML fixture; excludes model and external sites'}

  await win.loadURL(fixtureUrl + '/history-a')
  await win.loadURL(fixtureUrl + '/history-b')
  assert.equal((await call('browser_back')).ok,true)
  assert.equal(win.webContents.getTitle(),'History A','Back waits for its actual target document')
  assert.equal((await call('browser_forward')).ok,true)
  assert.equal(win.webContents.getTitle(),'History B','Forward waits for its actual target document')
  assert.equal((await call('browser_reload')).ok,true)
  assert.equal(win.webContents.getTitle(),'History B','Reload waits for its actual document')
  // Native back deliberately skips script-created history without user activation.
  // Wait for these entries' own browser events before submitting a new history action.
  const historyEntriesCreated = new Promise<void>(resolve => {
    const observe = (_event: unknown, url: string, mainFrame: boolean) => {
      if (mainFrame && url.endsWith('#two')) { win.webContents.removeListener('did-navigate-in-page',observe); resolve() }
    }
    win.webContents.on('did-navigate-in-page',observe)
  })
  await win.webContents.executeJavaScript('history.pushState({},"","#one");history.pushState({},"","#two")',true)
  await historyEntriesCreated
  const sameDocumentBack = await call('browser_back')
  if (!win.webContents.getURL().endsWith('#one')) console.log('[browser-smoke] same-document back result',JSON.stringify(sameDocumentBack),win.webContents.getURL())
  assert.equal(sameDocumentBack.ok,true)
  assert.ok(win.webContents.getURL().endsWith('#one'),'Same-document back retains history semantics')
  assert.equal((await call('browser_forward')).ok,true)
  assert.ok(win.webContents.getURL().endsWith('#two'),'Same-document forward retains history semantics')

  await win.loadURL(fixtureUrl + '/history-slow')
  slowNavigation = true
  const abortedReload = new AbortController()
  const reloadStarted = new Promise<void>(resolve => { slowRequestStarted = resolve })
  const reloading = executeAgentTool('browser_reload',{windowId:fixtureWindowId,waitUntil:'none',timeoutMs:3000},
    {...context,signal:abortedReload.signal}) as Promise<Record<string,any>>
  await reloadStarted
  abortedReload.abort()
  assert.equal((await reloading).status,'cancelled','Cancelling reload retains its control cancellation result')
  assert.equal(win.webContents.isLoadingMainFrame(),false,'Reload cancellation acknowledges stopped loading')
  // This is the later user's navigation, outside the cancelled Agent lease.
  await win.webContents.loadURL(fixtureUrl + '/history-user')
  await new Promise(resolve => setTimeout(resolve,400))
  assert.equal(win.webContents.getTitle(),'User navigation','A cancelled delayed reload never replaces a later user page')

  const nativeController = getBrowserAutomationController(win.webContents)
  const initialStarted = new Promise<void>(resolve => { slowRequestStarted = resolve })
  const initialNavigation = startOwnedNavigation(win.webContents,undefined,() => win.webContents.loadURL(fixtureUrl + '/history-slow'))
  const initialFailure = initialNavigation.then(() => undefined,error => error)
  await initialStarted
  const handoff = await nativeController.takeControl()
  assert.match(String(await initialFailure),/ERR_(?:ABORTED|FAILED)/,'Native stop rejects the pending initial navigation')
  assert.equal(handoff.owner,'user','Takeover waits for an initial navigation submitted before acquiring an operation')
  assert.equal(win.webContents.isLoadingMainFrame(),false)
  await win.webContents.loadURL(fixtureUrl + '/history-user')
  await new Promise(resolve => setTimeout(resolve,400))
  assert.equal(win.webContents.getTitle(),'User navigation','An initial navigation stopped by takeover never arrives late')
  await nativeController.resume()

  slowNavigation = false
  await win.loadURL(fixtureUrl + '/history-slow')
  slowNavigation = true
  const timedReload = await call('browser_reload',{timeoutMs:40})
  assert.equal(timedReload.ok,true)
  assert.equal(timedReload.waitTimedOut,true,'A navigation deadline remains a partial result')
  assert.equal(win.webContents.isLoadingMainFrame(),false,'A timed-out reload stops before releasing its operation')
  await new Promise(resolve => setTimeout(resolve,400))
  assert.notEqual(win.webContents.getTitle(),'Late navigation','A timeout never leaves a background reload to commit later')
  slowNavigation = false
  await win.webContents.loadURLWithResponse(fixtureUrl + '/native',{
    statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8'},body:'<title>Native document</title><h1>Injected document fixture</h1>',
  })
  assert.equal(win.webContents.getTitle(),'Native document')
  assert.equal(win.webContents.debugger.isAttached(),false)
  report={ok:true,electron:process.versions.electron,capabilities:capabilities.value,
    checks:['embedded-transfer-retains-webcontents-form-js-scroll','transfer-failure-preserves-source','fixed-viewport','annotation-pointer-snapshot-storage-revisions','annotation-manual-control','annotation-region','immutable-annotation-model-image-evidence','text-model-fallback','persistent-workspace-restoration','agent-controlled-browser-lifetime','terminal-subchat-retains-page-and-cookie','explicit-window-and-session-release','title-provenance-manual-rename','weather-permissions','cancelled-navigation-soft-wait','wait-deadline-listener-cleanup','snapshot','cache','trusted-click','typed-input','open-shadow','closed-shadow-query','cross-origin-frame-query-click','no-arbitrary-frame-click','native-file-input-navigation','native-dialog','native-document-response','semantic-stale-ref','navigation-stale-ref','plugin-load-execute','plugin-permissions','native-history-and-in-page-completion','cancelled-reload-never-arrives-late','takeover-stops-initial-navigation','reload-timeout-stops-background-work','no-debugger'],
    captureMs:snapshot.captureMs,permissionChecks,benchmark}
} catch(error) {
  console.error(error)
  process.exitCode = 1
} finally {
  console.log('[browser-smoke/cleanup] active-before-dispose',JSON.stringify(activeResources()))
  await fixturePlugins?.dispose()
  for(const runtime of fixtureRuntimes)runtime.stopAll()
  for(const registry of fixtureRegistries)registry.shutdown()
  titleChats.flushAll()
  console.log('[browser-smoke/cleanup] services:disposed')
  // The fixture owns these Chromium pools as well as its Node HTTP servers.
  // Release connections without changing the cookies or stored page data.
  console.log('[browser-smoke/cleanup] sessions:drain',fixtureSessions.size)
  for(const [index,fixtureSession] of [...fixtureSessions].entries()){
    try{
      console.log(`[browser-smoke/cleanup] session-${index}:flush-cookies`)
      await fixtureSession.cookies.flushStore()
      console.log(`[browser-smoke/cleanup] session-${index}:cookies-flushed`)
    }catch(error){console.error(`[browser-smoke/cleanup] session-${index}:cookies-flush-failed`,error);process.exitCode=1}
    try{
      console.log(`[browser-smoke/cleanup] session-${index}:close-connections`)
      await fixtureSession.closeAllConnections()
      console.log(`[browser-smoke/cleanup] session-${index}:connections-closed`)
    }catch(error){console.error(`[browser-smoke/cleanup] session-${index}:connections-failed`,error);process.exitCode=1}
    try{
      console.log(`[browser-smoke/cleanup] session-${index}:flush-storage`)
      fixtureSession.flushStorageData()
      console.log(`[browser-smoke/cleanup] session-${index}:storage-flush-requested`)
    }catch(error){console.error(`[browser-smoke/cleanup] session-${index}:storage-flush-failed`,error);process.exitCode=1}
  }
  console.log('[browser-smoke/cleanup] live-resources',JSON.stringify({windows:BrowserWindow.getAllWindows().map(window=>window.id),contents:webContents.getAllWebContents().map(contents=>({id:contents.id,type:contents.getType(),state:contents.getAutomationState()}))}))
  // Closing the final window starts Electron shutdown. Drain the fixture's HTTP
  // handles before that boundary so its quit event never runs with live servers.
  const ownedServers=[['fixture',fixtureServer],['cross-frame',crossFrameServer],['persistence',persistenceServer]] as const
  for(const [name,server] of ownedServers){
    if(!server)continue
    console.log(`[browser-smoke/cleanup] ${name}-server:close`)
    try{
      const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
      server.closeAllConnections()
      await closed
      console.log(`[browser-smoke/cleanup] ${name}-server:closed`)
    }catch(error){console.error(`[browser-smoke/cleanup] ${name}-server:failed`,error);process.exitCode=1}
  }
  try{await drainFixtureServerHandles(ownedServers)}catch(error){console.error('[browser-smoke/cleanup] server-handles:failed',error);process.exitCode=1}
  console.log('[browser-smoke/cleanup] destroy-window:start',JSON.stringify({id:win.id,destroyed:win.isDestroyed()}))
  win.destroy()
  primaryHost.destroy()
  console.log('[browser-smoke/cleanup] destroy-window:returned')
  console.log('[browser-smoke/cleanup] active-before-exit',JSON.stringify(activeResources()))
  if(!process.exitCode&&report)fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({...report,cleanupComplete:true}))
  console.log('[browser-smoke/cleanup] app-exit',Number(process.exitCode)||0)
  // Leave the native storage/close promise callback before asking Chromium to
  // tear down its event loop. No fixture server or window remains at this point.
  setImmediate(()=>app.exit(Number(process.exitCode)||0))
}
})
