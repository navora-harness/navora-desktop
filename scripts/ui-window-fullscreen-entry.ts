import {app,BrowserWindow,WebContentsView,webContents,screen,session} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'

// This imports the real application after supplying only disposable data. No
// production permission handler, focus predicate or fullscreen API is replaced.
const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_window_fullscreen_fixture'
if(!profile||!path.isAbsolute(profile)||!project||!output)throw Error('Explicit isolated profile/project/output required')
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.appearance_mode='light';config.app.close_to_tray=false;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'全屏窗口隔离检查',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const checks:string[]=[],observations:unknown[]=[],errors:string[]=[],permissions:unknown[]=[]
const boundsCalls:unknown[]=[],setBounds=BrowserWindow.prototype.setBounds
BrowserWindow.prototype.setBounds=function(bounds,animate){
  const before=this.getBounds(),normal=this.getNormalBounds(),fullscreen=this.isFullScreen()
  setBounds.call(this,bounds,animate);boundsCalls.push({window:this.id,requested:bounds,before,normal,fullscreen,after:this.getBounds()})
}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile)
let guest:Electron.WebContents|undefined,started=false,main:BrowserWindow|undefined,detached:BrowserWindow|undefined
// Record real permission decisions without changing the handler or its answer.
app.once('ready',()=>{
  const prototype=Object.getPrototypeOf(session.defaultSession) as Electron.Session
  const checkPermission=prototype.setPermissionCheckHandler
  prototype.setPermissionCheckHandler=function(handler){
    return checkPermission.call(this,handler?((wc,permission,origin,details)=>{const allowed=handler(wc,permission,origin,details);if(String(permission).includes('fullscreen'))permissions.push({kind:'check',wc:wc?.id,permission,allowed});return allowed}):null)
  }
  const requestPermission=prototype.setPermissionRequestHandler
  prototype.setPermissionRequestHandler=function(handler){
    return requestPermission.call(this,handler?((wc,permission,callback,details)=>handler(wc,permission,allowed=>{if(String(permission).includes('fullscreen'))permissions.push({kind:'request',wc:wc.id,permission,allowed});callback(allowed)},details)):null)
  }
})
const local=createServer((_req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'})
  res.end(`<!doctype html><meta charset="utf-8"><title>全屏隔离样本</title><style>html{background:#f3f7fc;color:#18304b;font:18px system-ui}body{margin:24px}button,input{font:inherit;padding:12px;margin:8px}#canvas{height:160px;background:linear-gradient(125deg,#c2deff,#f2e6ff);border-radius:12px;padding:24px}:fullscreen{background:#f3f7fc}</style><h1>真实网页全屏验证</h1><button id="request-fullscreen">进入网页全屏</button><button id="exit-fullscreen">退出网页全屏</button><p><input id="draft" value="临时测试草稿"></p><section id="canvas">同一网页 / 同一 WebContents / 持续绘制</section><script>window.identity=crypto.randomUUID();window.paints=0;window.fullscreenEvents=[];window.fullscreenErrors=[];document.addEventListener('fullscreenchange',()=>window.fullscreenEvents.push(!!document.fullscreenElement));document.querySelector('#request-fullscreen').onclick=()=>document.documentElement.requestFullscreen().catch(e=>window.fullscreenErrors.push(e.name+': '+e.message));document.querySelector('#exit-fullscreen').onclick=()=>document.exitFullscreen().catch(e=>window.fullscreenErrors.push(e.name+': '+e.message));requestAnimationFrame(function tick(){window.paints++;requestAnimationFrame(tick)})</script>`)
})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/fullscreen`
async function until(check:()=>Promise<unknown>|unknown,label:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
function viewIn(win:BrowserWindow){
  const walk=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(walk)]
  return walk(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents===guest) as WebContentsView|undefined
}
const state=(win:BrowserWindow)=>({id:win.id,contents:win.webContents.id,bounds:win.getBounds(),normal:win.getNormalBounds(),fullscreen:win.isFullScreen(),maximized:win.isMaximized(),focused:win.isFocused(),visible:win.isVisible()})
async function finish(code:number){local.closeAllConnections();app.exit(code)}
function f11(wc:Electron.WebContents){wc.sendInputEvent({type:'keyDown',keyCode:'F11'});wc.sendInputEvent({type:'keyUp',keyCode:'F11'})}
async function activate(win:BrowserWindow,wc=win.webContents){win.show();win.focus();wc.focus();await until(()=>win.isFocused(),'actual foreground owner window')}
async function press(selector:string){
  const point=await guest!.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  guest!.sendInputEvent({type:'mouseMove',...point});guest!.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});guest!.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
}
async function capture(win:BrowserWindow,name:string){
  await wait(220)
  // DOM capture is kept separately from HWND PrintWindow, never a synthetic
  // composite presented as an actual native window image.
  fs.writeFileSync(path.join(output,name+'-host.png'),(await win.webContents.capturePage()).toPNG())
  const handle=win.getNativeWindowHandle(),hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE())
  const result=await run('python',[path.join(project,'scripts/ui-window-fullscreen-capture.py'),'--pid',String(process.pid),'--hwnd',hwnd,'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:15000})
  observations.push({capture:name,...JSON.parse(result.stdout)})
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  if(started)return;started=true;main=win
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    try{
      const area=screen.getPrimaryDisplay().workArea
      win.setBounds({x:area.x+40,y:area.y+40,width:Math.min(1320,area.width-80),height:Math.min(900,area.height-80)})
      await until(()=>js('!!document.querySelector(".composer-box")'),'main application')
      const pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:fullscreen',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true);return id})()`)
      await until(()=>{guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url&&!wc.isLoading());return !!guest&&viewIn(win)?.getVisible()},'embedded local webpage')
      guest!.setBackgroundThrottling(false);await guest!.executeJavaScript('document.querySelector("#draft").value="应保留的临时测试草稿"')
      const identity=await guest!.executeJavaScript('window.identity'),guestId=guest!.id,mainContents=win.webContents.id
      const intact=async()=>{assert.equal(guest!.id,guestId);assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'应保留的临时测试草稿');assert.equal(win.webContents.id,mainContents)}
      await js('window.fullscreenNotifications=[];void window.navora.app.onFullscreen(value=>window.fullscreenNotifications.push(value))')
      await activate(win);await wait(300);const normal=win.getBounds();await capture(win,'01-main-normal')
      assert.deepEqual(await js('window.navora.app.isFullscreen()'),{fullscreen:false})
      assert.deepEqual(await js('window.navora.app.toggleFullscreen()'),{ok:true,fullscreen:true})
      await until(()=>win.isFullScreen(),'main API enters fullscreen');await intact();await capture(win,'02-main-fullscreen')
      await js('window.navora.app.toggleFullscreen()');await until(()=>!win.isFullScreen(),'main API exits fullscreen');await wait(250)
      assert.deepEqual(win.getBounds(),normal);assert.equal(win.isMaximized(),false)
      assert.ok((await js('window.fullscreenNotifications')).includes(true));assert.equal((await js('window.fullscreenNotifications')).at(-1),false)
      checks.push('main-native-fullscreen-API-and-events-restore-normal-bounds-without-recreating-page')
      win.maximize();await until(()=>win.isMaximized(),'main maximize');await wait(180)
      await js('window.navora.app.toggleFullscreen()');await until(()=>win.isFullScreen(),'maximized fullscreen');await js('window.navora.app.toggleFullscreen()');await until(()=>!win.isFullScreen()&&win.isMaximized(),'maximized restoration')
      win.unmaximize();await until(()=>!win.isMaximized(),'normal window restored');await wait(250);assert.deepEqual(win.getBounds(),normal);await intact()
      checks.push('maximized-to-fullscreen-restores-maximized-and-original-normal-rectangle')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'detach'})`)
      await until(()=>{detached=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&!candidate.isDestroyed()&&candidate.webContents.getURL().includes('/browser-host/'));return !!detached&&viewIn(detached)?.getVisible()},'detached same live webpage')
      const host=detached!,hostJs=(code:string):Promise<any>=>host.webContents.executeJavaScript(code),hostContents=host.webContents.id
      host.setBounds({x:area.x+80,y:area.y+70,width:Math.min(1200,area.width-120),height:Math.min(820,area.height-120)})
      await until(()=>hostJs('!!document.querySelector(".browser-host-tab.active")'),'detached toolbar')
      await activate(host,guest!);await intact();assert.equal(viewIn(win),undefined)
      const page=(await hostJs('window.navora.browser.workspace.state()')).pages.flatMap((s:any)=>s.windows).find((p:any)=>p.windowId===pageId)
      assert.equal(page.presentation,'detached');assert.equal((await hostJs('window.navora.browser.workspace.state()')).embedded,false)
      checks.push('detach-transfers-original-WebContents-and-draft-to-actual-detached-owner')
      // First request precedes any input in this document, so this tests genuine
      // absence of transient activation rather than an expired assumption.
      const noGesture=await guest!.executeJavaScript('(async()=>{try{await document.documentElement.requestFullscreen();return {allowed:true}}catch(e){return {allowed:false,name:e.name,message:e.message}}})()')
      assert.equal(noGesture.allowed,false);assert.equal(await guest!.executeJavaScript('!!document.fullscreenElement'),false);assert.equal(host.isFullScreen(),false)
      observations.push({noGesture});checks.push('HTML-fullscreen-without-document-user-gesture-is-denied')
      await hostJs('window.ownerEvents=[];void window.navora.app.onFullscreen(v=>window.ownerEvents.push(v))')
      const hostNormal=host.getBounds()
      await hostJs(`document.querySelector('button[aria-label="进入全屏（F11）"]').click()`);await until(()=>host.isFullScreen(),'visible detached fullscreen button');await wait(180)
      assert.equal(win.isFullScreen(),false);assert.deepEqual(await hostJs('window.navora.app.isFullscreen()'),{fullscreen:true});assert.equal(host.webContents.id,hostContents)
      await until(()=>hostJs('document.querySelector(".detached-window-bar").classList.contains("is-fullscreen")'),'caption fullscreen state')
      assert.equal(await hostJs('getComputedStyle(document.querySelector(".detached-window-bar")).getPropertyValue("--detached-caption-width").trim()'),'0px')
      assert.ok(await hostJs('parseFloat(getComputedStyle(document.querySelector(".detached-window-bar")).paddingRight)<=8'),'fullscreen removes the Windows caption reservation');await capture(host,'04-detached-fullscreen')
      await hostJs('window.navora.app.toggleFullscreen()');await until(()=>!host.isFullScreen(),'detached owner exit');await wait(250);assert.deepEqual(host.getBounds(),hostNormal);assert.equal(win.isFullScreen(),false)
      checks.push('detached-visible-button-and-owner-IPC-only-affect-own-window-and-caption-reservation')
      await activate(host);f11(host.webContents);await until(()=>host.isFullScreen(),'host F11 enters');f11(host.webContents);await until(()=>!host.isFullScreen(),'host F11 exits');await intact()
      checks.push('host-before-input-F11-toggles-own-native-window-without-page-recreation')
      await activate(host,guest!);f11(guest!);await until(()=>host.isFullScreen(),'guest F11 enters owner');assert.equal(win.isFullScreen(),false);f11(guest!);await until(()=>!host.isFullScreen(),'guest F11 exits owner');await intact()
      checks.push('foreground-guest-F11-routes-to-its-own-detached-window')
      host.maximize();await until(()=>host.isMaximized(),'detached maximize');await wait(200);await hostJs('window.navora.app.toggleFullscreen()');await until(()=>host.isFullScreen(),'detached maximized fullscreen');await hostJs('window.navora.app.toggleFullscreen()');await until(()=>!host.isFullScreen()&&host.isMaximized(),'detached maximized restore');host.unmaximize();await until(()=>!host.isMaximized(),'detached normal restore');await wait(250);assert.deepEqual(host.getBounds(),hostNormal)
      checks.push('detached-fullscreen-restores-both-maximized-and-original-normal-state')
      await activate(host,guest!);await press('#request-fullscreen');await until(()=>guest!.executeJavaScript('!!document.fullscreenElement'),'actual trusted pointer click requests HTML fullscreen');await until(()=>host.isFullScreen(),'HTML fullscreen owner window');await wait(250)
      assert.deepEqual(viewIn(host)?.getBounds(),{x:0,y:0,width:host.getContentSize()[0],height:host.getContentSize()[1]});assert.equal(win.isFullScreen(),false);await intact();await capture(host,'05-html-fullscreen')
      f11(guest!);await until(async()=>!await guest!.executeJavaScript('!!document.fullscreenElement')&&!host.isFullScreen(),'F11 exits HTML and window fullscreen')
      checks.push('trusted-page-click-enters-HTML-fullscreen-over-owner-surface-and-guest-F11-exits-both')
      await activate(host);f11(host.webContents);await until(()=>host.isFullScreen(),'preexisting F11 window state');await activate(host,guest!);await press('#request-fullscreen');await until(()=>guest!.executeJavaScript('!!document.fullscreenElement'),'nested HTML fullscreen')
      await guest!.executeJavaScript('document.exitFullscreen()');await until(async()=>!await guest!.executeJavaScript('!!document.fullscreenElement'),'nested HTML exit');assert.equal(host.isFullScreen(),true)
      f11(host.webContents);await until(()=>!host.isFullScreen(),'preexisting F11 exit');checks.push('document-exit-preserves-preexisting-F11-window-fullscreen-state')
      await activate(host,guest!);await press('#request-fullscreen');await until(()=>guest!.executeJavaScript('!!document.fullscreenElement'),'HTML reentry before navigation');await guest!.loadURL(url+'?navigated=1');await until(()=>!host.isFullScreen(),'navigation revokes-document-fullscreen');assert.equal(guest!.id,guestId);assert.equal(await guest!.executeJavaScript('!!document.fullscreenElement'),false)
      assert.notEqual(await guest!.executeJavaScript('window.identity'),identity);checks.push('navigation-exits-document-owned-fullscreen-without-replacing-WebContents')
      await until(()=>viewIn(host)?.getVisible(),'post-navigation view visible');await activate(host);await wait(200)
      const toolbar=await hostJs(`(()=>{const el=document.querySelector('button[aria-label="进入全屏（F11）"]'),r=el.getBoundingClientRect();return {visible:el.checkVisibility(),x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth,disabled:el.disabled}})()`)
      assert.equal(toolbar.visible,true);assert.equal(toolbar.disabled,false);assert.ok(toolbar.x>=0&&toolbar.y>=0&&toolbar.width>0&&toolbar.x+toolbar.width<=toolbar.viewport)
      await capture(host,'08-detached-window');checks.push('actual-detached-window-fullscreen-button-is-visible-enabled-and-inside-toolbar')
      // Returning to the main window must not grant the now-background guest F11
      // control over another window or silently refocus its previous owner.
      await activate(win);assert.equal(host.isFocused(),false);f11(guest!);await wait(250);assert.equal(host.isFullScreen(),false);assert.equal(win.isFullScreen(),false);assert.equal(win.isFocused(),true)
      checks.push('background-guest-F11-does-not-fullscreen-or-focus-either-window')
      observations.push({main:state(win),detached:state(host),pageId,guestId,hostContents,toolbar,permissions,fullscreenEvents:await guest!.executeJavaScript('window.fullscreenEvents')})
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,errors,scope:'Actual Vue/preload/main, native BrowserWindows and WCV with isolated synthetic chat/local page. Host/guest F11 and HTML button clicks use targeted Electron sendInputEvent; actual native foreground ownership is required, never mocked. PrintWindow screenshots capture only a validated fixture PID top-level HWND, no desktop sampling. Host DOM screenshots are separate. Physical OS F11 and NativePanel-focused F11 are outside this fixture.'},null,2))
      await finish(0)
    }catch(error){console.error(error);try{fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,permissions,observations,boundsCalls,windows:[main,detached].filter((w):w is BrowserWindow=>!!w&&!w.isDestroyed()).map(state),guest:guest&&!guest.isDestroyed()?{id:guest.id,url:guest.getURL(),fullscreen:await guest.executeJavaScript('!!document.fullscreenElement'),pageErrors:await guest.executeJavaScript('window.fullscreenErrors')}:undefined},null,2))}catch{}await finish(1)}
  })())
})
await import('../electron/main')
