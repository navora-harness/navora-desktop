import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { executeAgentTool, type ToolExecContext } from '../electron/modules/browser-tools'
import { createDefaultConfig } from '../shared/config'
import { PluginStore } from '../electron/modules/plugin-store'
import { ChatStore } from '../electron/modules/chat-store'
import { AgentRuntime } from '../electron/modules/agent-runtime'
import { BrowserRegistry } from '../electron/modules/browser-registry'
import { createPluginHostApi } from '../electron/modules/plugin-host'
import type { PageSnapshot } from '../shared/page-index'

const root = process.env.NAVORA_SMOKE_ROOT!
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
void app.whenReady().then(async () => {
console.log('[browser-smoke] Electron ready')
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
const win = new BrowserWindow({show:false,width:1000,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})
win.webContents.on('console-message',(event: unknown) => {
  const message = event as { level?: string; message?: string }
  if (message.level === 'error') console.error('[fixture renderer]',message.message)
})
const config = createDefaultConfig()
config.browser.wait.load = false
config.browser.wait.network_idle = false
config.browser.wait.delay_ms = 0
config.browser.action_timeout_ms = 3000
const controller = new AbortController()
let permissionChecks = 0
let fixtureServer: http.Server | undefined
let crossFrameServer: http.Server | undefined
const context = {
  chatId:'fixture',signal:controller.signal,getConfig:() => config,
  registry:{
    assertWindowOwned(chatId: string, windowId: string) { assert.equal(chatId,'fixture');assert.equal(windowId,'window');return {win} },
    getTree() {return []},
  },
  gate:{async check(){permissionChecks++;return {ok:true}}},
} as unknown as ToolExecContext
const call = async (name: string, args: Record<string, unknown> = {}) => {
  console.log(`[browser-smoke] ${name} ${String(args.what || '')}`)
  return await executeAgentTool(name,{windowId:'window',waitUntil:'none',...args},context) as Record<string, any>
}

try {
  // Terminal status must not destroy a retained page or login. Exercise the real
  // finalizer and registry, then explicitly release through the Agent tools.
  const lifetimeRegistry = new BrowserRegistry(() => config)
  const lifetimeRuntime = new AgentRuntime({
    chats: titleChats, registry: lifetimeRegistry, getConfig: () => config, emit: () => {},
  } as unknown as ConstructorParameters<typeof AgentRuntime>[0])
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
  const parentSession = lifetimeRegistry.createSession(titleChat.id)
  lifetimeRegistry.createWindow(parentSession.sessionId, { show: false })
  const owners = [titleChat.id]
  try {
    for (const status of ['done', 'failed', 'cancelled'] as const) {
      const child = titleChats.create('Browser lifetime fixture', { kind: 'sub', parentChatId: titleChat.id })
      owners.push(child.id)
      const session = lifetimeRegistry.createSession(child.id)
      const page = lifetimeRegistry.createWindow(session.sessionId, { show: false })
      const wc = lifetimeRegistry.assertWindowOwned(child.id, page.windowId).win.webContents
      if (wc.isLoadingMainFrame()) await new Promise<void>(resolve => wc.once('did-finish-load', () => resolve()))
      const ses = lifetimeRegistry.assertSessionOwned(child.id, session.sessionId).ses
      await ses.cookies.set({ url: 'https://example.com', name: 'lifetime-fixture', value: 'retained' })
      ;(lifetimeRuntime as unknown as { finalizeSubchat(id: string, status: string): void }).finalizeSubchat(child.id, status)
      assert.equal(titleChats.get(child.id)?.spawnStatus, status)
      assert.equal(lifetimeRegistry.getTree(child.id)[0]?.windows.length, 1, status + ' keeps the browser until Agent release')
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' }))[0]?.value, 'retained', status + ' retains session state')
      const toolContext = { ...context, chatId: child.id, registry: lifetimeRegistry, network: { disposeSession() {} } } as unknown as ToolExecContext
      await executeAgentTool('browser_window_close', { windowId: page.windowId }, toolContext)
      assert.equal(lifetimeRegistry.getTree(child.id)[0]?.windows.length, 0, 'Agent can release a page separately')
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' })).length, 1, 'Window release keeps the reusable Session')
      await executeAgentTool('browser_session_close', { sessionId: session.sessionId }, toolContext)
      assert.equal(lifetimeRegistry.getTree(child.id).length, 0, 'Agent can explicitly release the entire Session')
      assert.equal((await ses.cookies.get({ name: 'lifetime-fixture' })).length, 0, 'Explicit Session release clears its data')
      assert.equal(lifetimeRegistry.getTree(titleChat.id)[0]?.windows.length, 1, 'Releasing a child does not affect its parent')
    }
  } finally {
    for (const id of owners) await lifetimeRegistry.clearChat(id)
  }
  crossFrameServer = http.createServer((_request,response) => {
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.end(`<button id="frame-action" onclick="parent.postMessage({type:'frame-click',trusted:event.isTrusted},'*')">Frame action</button>`)
  })
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
  fixtureServer = http.createServer((request, response) => {
    if(request.url==='/broken'){response.destroy();return}
    response.setHeader('Content-Type','text/html; charset=utf-8')
    if (request.url === '/loading') {
      response.write('<title>Loading fixture</title><p>Partial document')
      setTimeout(() => response.end('</p>'), 500)
      return
    }
    response.end(request.url === '/next' ? '<title>Next</title><button>Next document</button>' : request.url === '/benchmark'
      ? '<title>Index benchmark</title><main>' + Array.from({length:250},(_, i) => `<article><h2>商品 ${i}</h2><p>商品 ${i} 的参数和说明</p><a href="https://example.com/products/${i}">商品 ${i} 详情</a><button>选择商品 ${i}</button></article>`).join('') + '</main>'
      : html)
  })
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
  assert.equal(win.webContents.session.listenerCount('will-download'),downloadListeners,'Failed navigation detaches its temporary download observer')
  const loading = win.loadURL(fixtureUrl + '/loading')
  await new Promise(resolve => setTimeout(resolve, 30))
  const listeners = win.webContents.listenerCount('did-fail-load')
  const startedWaiting = Date.now()
  setTimeout(() => win.webContents.emit('did-fail-load', {}, -3, '', fixtureUrl + '/loading', true), 10)
  const partial = await call('browser_wait', { waitUntil: 'load', timeoutMs: 80 })
  assert.equal(partial.ok, true, 'Cancelled intermediate navigation is not a load failure')
  assert.equal(partial.partial, true)
  assert.ok(Date.now() - startedWaiting < 250, 'One deadline bounds the wait')
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
  assert.equal(clicked.method,'clickSelector')
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
  context.plugins = plugins
  assert.ok(plugins.enabledToolsForChat('fixture').some((tool) => tool.function.name === 'fixture_read_page'))
  const pluginResult = await call('fixture_read_page')
  assert.equal(pluginResult.ok,true)
  assert.ok(pluginResult.value.entries.length > 0)
  const api = createPluginHostApi(context,['get_page'])
  const denied = await api.runTool('browser_click',{windowId:'window',selector:'#save'}) as {ok:boolean;error:string}
  assert.equal(denied.error,'plugin_capability_not_declared:click')

  await win.loadURL(fixtureUrl + '/next')
  assert.equal((await call('browser_click',{ref:input.ref})).error,'stale_element_ref')
  await win.loadURL(fixtureUrl + '/benchmark')
  const captureTimes: number[] = []
  const queryTimes: number[] = []
  let cacheHits = 0
  for(let i=0;i<10;i++) {
    const started = performance.now()
    const result = await executeAgentTool('browser_get',{windowId:'window',what:'snapshot',refresh:true,query:'商品 200',waitUntil:'none'},context) as Record<string, any>
    captureTimes.push(performance.now()-started)
    assert.ok(result.value.entries.some((entry: {url?:string}) => entry.url === 'https://example.com/products/200'))
  }
  let lastPayload = 0
  for(let i=0;i<20;i++) {
    const started = performance.now()
    const result = await executeAgentTool('browser_get',{windowId:'window',what:'snapshot',query:'商品 200',waitUntil:'none'},context) as Record<string, any>
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
  await win.webContents.loadURLWithResponse(fixtureUrl + '/native',{
    statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8'},body:'<title>Native document</title><h1>Injected document fixture</h1>',
  })
  assert.equal(win.webContents.getTitle(),'Native document')
  assert.equal(win.webContents.debugger.isAttached(),false)
  console.log(JSON.stringify({ok:true,electron:process.versions.electron,capabilities:capabilities.value,
    checks:['agent-controlled-browser-lifetime','terminal-subchat-retains-page-and-cookie','explicit-window-and-session-release','title-provenance-manual-rename','weather-permissions','cancelled-navigation-soft-wait','wait-deadline-listener-cleanup','snapshot','cache','trusted-click','typed-input','open-shadow','closed-shadow-query','cross-origin-frame-query-click','no-arbitrary-frame-click','native-file-input-navigation','native-dialog','native-document-response','semantic-stale-ref','navigation-stale-ref','plugin-load-execute','plugin-permissions','no-debugger'],
    captureMs:snapshot.captureMs,permissionChecks,benchmark}))
} catch(error) {
  console.error(error)
  process.exitCode = 1
} finally {
  win.destroy()
  fixtureServer?.close()
  crossFrameServer?.close()
  app.exit(Number(process.exitCode) || 0)
}
})
