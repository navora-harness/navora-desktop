import {app,BrowserWindow,Menu,clipboard,type ContextMenuParams} from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import http from 'node:http'
import {BrowserRegistry} from '../electron/modules/browser-registry'
import {BrowserTabsService} from '../electron/modules/browser-tabs-service'
import {registerBrowserPageContextMenus} from '../electron/modules/browser-page-context-menu'
import {BrowserAnnotationService} from '../electron/modules/browser-annotations'
import {WorkspaceFiles} from '../electron/modules/workspace-files'
import {createDefaultConfig} from '../shared/config'
import type {BrowserAnnotationTarget} from '../shared/browser-workspace'

const root=process.env.NAVORA_PAGE_MENU_ROOT!
if(!path.isAbsolute(root)||!path.basename(root).startsWith('navora-page-menu-'))throw Error('Isolated profile required')
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration()
void app.whenReady().then(async()=>{
  let window:BrowserWindow|undefined,registry:BrowserRegistry|undefined,server:http.Server|undefined,childServer:http.Server|undefined,otherWindow:BrowserWindow|undefined
  const checks:string[]=[],sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
  let popup:{menu:Menu;options:Electron.PopupOptions}|undefined,closed=0,nativeEvents=0
  const originalPopup=Menu.prototype.popup,originalClose=Menu.prototype.closePopup
  const originalRead=clipboard.readText,originalWrite=clipboard.writeText
  let copied='fixture-original'
  clipboard.readText=(async()=>copied) as typeof clipboard.readText
  clipboard.writeText=(async(text:string)=>{copied=text}) as typeof clipboard.writeText
  // Preserve actual Menu objects and callbacks; avoid opening OS menus on the user's desktop.
  Menu.prototype.popup=function(options){popup={menu:this,options:options||{}}}
  Menu.prototype.closePopup=function(parent){closed++;if(popup?.menu===this&&(!parent||popup.options.window===parent)){const current=popup;popup=undefined;current.options.callback?.()}}
  try{
    const config=createDefaultConfig();config.browser.show_agent_windows=false;config.browser.max_windows_total=12
    childServer=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<input id="child" value="frame text"><p>Frame selection</p>')})
    await new Promise<void>(resolve=>childServer!.listen(0,'127.0.0.1',resolve));const childOrigin=`http://127.0.0.1:${(childServer.address() as {port:number}).port}`
    server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<style>body{margin:0}p,input,a{display:block;margin:20px;height:35px}iframe{height:100px}</style><p id="blank">Page context</p><a id="link" href="/next">Open destination</a><input id="input" value="alpha beta"><input id="password" type="password" value="secret"><iframe src="${childOrigin}/child"></iframe><div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input id="shadow-input" value="guarded">'</script>`)})
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    registry=new BrowserRegistry(()=>config);window=new BrowserWindow({show:false,width:1000,height:750});const hostId=registry.hosts.bindMain(window),tabs=new BrowserTabsService(registry,()=>config,id=>id==='a'||id==='b')
    const annotations=new BrowserAnnotationService(registry,new WorkspaceFiles(root,()=>config)),menuActions:{action:string;target?:BrowserAnnotationTarget;message?:string}[]=[]
    const originalSend=window.webContents.send.bind(window.webContents)
    window.webContents.send=((channel:string,...args:any[])=>{if(channel==='navora:browser.page-menu')menuActions.push(args[0]);else originalSend(channel,...args)}) as typeof window.webContents.send
    registerBrowserPageContextMenus({registry,tabs,annotations,getConfig:()=>config})
    const session=registry.createSession('a',{persist:false}),created=registry.createWindow(session.sessionId,{chatId:'a',show:false}),page=registry.getWindowRecord(created.windowId)!.win,wc=page.webContents
    await wc.loadURL(origin);registry.hosts.activate(page)
    const layout=()=>{const owner=registry!.hosts.claimLayout(hostId,page.id);registry!.hosts.setLayout(hostId,page.id,{x:80,y:90,width:800,height:570},owner,1)}
    layout();wc.on('context-menu',(_event,params)=>{nativeEvents++;console.log('[page-menu/context]',params.menuSourceType,!!params.frame,params.x,params.y)})
    async function context(selector:string){
      popup?.menu.closePopup(window);popup=undefined
      for(let i=0;i<100&&page.automation.isBusy();i++)await sleep(15)
      if(!page.manualControl)await page.automation.takeControl()
      const found=await wc.getAgentSnapshot({selector,maxNodes:50,maxFrames:8})
      assert.ok(found.elements.length,selector)
      await wc.dispatchMouseEvent({type:'mousePressed',button:'right',buttons:2,clickCount:1,target:found.elements[0]!.target})
      await wc.dispatchMouseEvent({type:'mouseReleased',button:'right',buttons:0,clickCount:1,target:found.elements[0]!.target})
      for(let i=0;i<100&&!popup;i++)await sleep(15)
      assert.ok(popup,`Native context-menu event: ${selector}; events=${nativeEvents}; host=${JSON.stringify({ready:registry!.hosts.getHost(hostId)?.ready,active:registry!.hosts.getHost(hostId)?.active,suspended:registry!.hosts.getHost(hostId)?.suspended,visible:page.view.getVisible(),state:page.automation.snapshot()})}`)
      return popup
    }
    const select=(menu:Menu,id:string)=>{const item=menu.getMenuItemById(id);assert.ok(item,id);assert.equal(item.enabled,true,id);item.click(undefined,window,undefined as any)}
    let inspected=0,inspectionPoint:{x:number;y:number}|undefined
    wc.openDevTools=(()=>{}) as typeof wc.openDevTools
    wc.inspectElement=((x:number,y:number)=>{inspected++;inspectionPoint={x,y}}) as typeof wc.inspectElement
    let current=await context('#blank')
    assert.equal(current.menu.getMenuItemById('back')?.enabled,false);assert.equal(current.menu.getMenuItemById('forward')?.enabled,false)
    assert.equal(current.options.window,window);assert.ok(current.options.frame);assert.ok(current.options.x!>=80&&current.options.y!>=90)
    assert.equal(current.menu.getMenuItemById('annotate')?.label,'批注');assert.equal(current.menu.getMenuItemById('annotations'),null);assert.ok(current.menu.getMenuItemById('inspect'))
    checks.push('actual-guest-context-event-and-page-menu','view-offset-anchor','basic-disabled-history')
    const oldClipboard=await clipboard.readText();select(current.menu,'copyUrl');assert.equal(await clipboard.readText(),origin+'/');await clipboard.writeText(oldClipboard)
    checks.push('source-page-url-copy')
    const realLoading=wc.isLoading.bind(wc),realStop=wc.stop.bind(wc),realReload=wc.reload.bind(wc)
    let stops=0,reloads=0;wc.isLoading=()=>true;wc.stop=()=>{stops++};wc.reload=()=>{reloads++}
    current=await context('#blank');assert.equal(current.menu.getMenuItemById('reload')!.label,'停止加载');wc.isLoading=realLoading;select(current.menu,'reload');assert.equal(stops,1);assert.equal(reloads,0);wc.stop=realStop;wc.reload=realReload
    checks.push('stopped-load-menu-does-not-turn-into-reload')
    await wc.loadURL(origin+'/next');current=await context('#blank');assert.equal(current.menu.getMenuItemById('back')?.enabled,true);select(current.menu,'back');for(let i=0;i<100&&wc.getURL()!==origin+'/';i++)await sleep(15);assert.equal(wc.getURL(),origin+'/');await sleep(80)
    checks.push('native-history-back-from-user-owned-page')
    current=await context('#blank');select(current.menu,'inspect');for(let i=0;i<100&&!inspected;i++)await sleep(10);assert.equal(inspected,1);assert.ok(inspectionPoint)
    current=await context('#blank');await wc.executeJavaScript('document.querySelector("#blank").outerHTML="<p id=blank>Replaced node</p>"');select(current.menu,'inspect');await sleep(60);assert.equal(inspected,1)
    checks.push('inspect-retains-native-point-and-rejects-replaced-hit-node')
    for(const zoom of [1,1.5,2]){
      wc.setZoomFactor(zoom);await sleep(50);current=await context('#blank')
      assert.equal(await wc.executeJavaScriptInIsolatedWorld(1009,[{code:'globalThis.__navoraMenuPoint?.node.deref()?.id'}]),'blank',`Native point at ${zoom}`)
    }
    wc.setZoomFactor(1);await sleep(50);checks.push('native-point-to-css-conversion-at-100-150-200-percent-page-zoom')
    async function annotate(selector:string){
      const before=menuActions.length,menu=await context(selector);select(menu.menu,'annotate')
      for(let i=0;i<150&&menuActions.length===before;i++)await sleep(15)
      const action=menuActions.at(-1);assert.equal(action?.action,'annotate',action?.message);assert.ok(action.target);assert.equal(page.annotationSelecting,true)
      assert.equal(await wc.executeJavaScriptInIsolatedWorld(1008,[{code:'globalThis.__navoraAnnotations?.phase'}]),'target-ready')
      await annotations.cancel('a',page.id);await annotations.discardTarget('a',page.id,action.target.id,action.target.version)
      return action.target
    }
    const direct=await annotate('#blank');assert.equal(direct.selection.selector,'#blank');assert.equal(direct.selection.kind,'element');assert.equal(direct.selection.frameScope,'top');assert.equal(direct.selection.text,'Replaced node')
    checks.push('annotation-selects-retained-right-click-node-without-an-extra-page-click-and-removes-list-entry')
    const beforeRace=menuActions.length;current=await context('#blank');select(current.menu,'annotate')
    for(let i=0;i<150&&menuActions.length===beforeRace;i++)await sleep(15)
    const raceTarget=menuActions.at(-1)?.target;assert.ok(raceTarget)
    const written=annotations.writeTarget('a',raceTarget.id,raceTarget.version,{text:'Race regression',editorId:'race',sequence:1}),execute=wc.executeJavaScriptInIsolatedWorld.bind(wc)
    let releaseRead!:()=>void,readReady!:()=>void
    const readGate=new Promise<void>(resolve=>{releaseRead=resolve}),readStarted=new Promise<void>(resolve=>{readReady=resolve})
    wc.executeJavaScriptInIsolatedWorld=(async(world,scripts,...args)=>{
      const result=await execute(world,scripts,...args)
      if(world===1008&&scripts[0]?.code.includes('return s?{selection:s.selection,cancelled:s.cancelled')){readReady();await readGate}
      return result
    }) as typeof wc.executeJavaScriptInIsolatedWorld
    try{
      const collecting=annotations.collect('a',page.id);await readStarted
      await annotations.commitTarget('a',page.id,written.id,written.version);releaseRead()
      assert.equal((await collecting).phase,'armed')
      assert.deepEqual(annotations.listTargets('a',page.id),[])
      assert.deepEqual(await execute(1008,[{code:'({phase:globalThis.__navoraAnnotations.phase,capture:globalThis.__navoraAnnotations.capture,selection:globalThis.__navoraAnnotations.selection,visibility:document.querySelector("[data-navora-annotation-layer]").style.visibility})'}]),{phase:'armed',capture:false,selection:null,visibility:''})
    }finally{releaseRead();wc.executeJavaScriptInIsolatedWorld=execute;await annotations.cancel('a',page.id)}
    checks.push('committed-target-supersedes-an-in-flight-old-selection-read-without-recapture-or-stale-phase')
    const choose=async(selector:string)=>{
      const point=await wc.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      wc.sendInputEvent({type:'mouseMove',...point});wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await sleep(35)
    }
    await annotations.begin('a',page.id,'element');await choose('#blank')
    const oldCaptureId=await execute(1008,[{code:'globalThis.__navoraAnnotations.selection.targetId'}]),capture=wc.capturePage.bind(wc)
    let releaseCapture!:()=>void,captureReady!:()=>void
    const captureGate=new Promise<void>(resolve=>{releaseCapture=resolve}),captureStarted=new Promise<void>(resolve=>{captureReady=resolve})
    wc.capturePage=(async(...args)=>{const image=await capture(...args);captureReady();await captureGate;return image}) as typeof wc.capturePage
    try{
      const collecting=annotations.collect('a',page.id);await captureStarted
      await annotations.mode('a',page.id,'armed',oldCaptureId);await choose('#link')
      const nextId=await execute(1008,[{code:'globalThis.__navoraAnnotations.selection?.targetId'}]);assert.ok(nextId);assert.notEqual(nextId,oldCaptureId)
      releaseCapture();assert.equal((await collecting).phase,'target-ready')
      assert.deepEqual(annotations.listTargets('a',page.id),[])
      assert.deepEqual(await execute(1008,[{code:'({phase:globalThis.__navoraAnnotations.phase,capture:globalThis.__navoraAnnotations.capture,target:globalThis.__navoraAnnotations.selection?.targetId,visibility:document.querySelector("[data-navora-annotation-layer]").style.visibility})'}]),{phase:'target-ready',capture:false,target:nextId,visibility:''})
      wc.capturePage=capture
      const next=(await annotations.collect('a',page.id)).target;assert.equal(next?.id,nextId)
      await annotations.cancel('a',page.id);await annotations.discardTarget('a',page.id,next!.id,next!.version)
    }finally{releaseCapture();wc.capturePage=capture;await annotations.cancel('a',page.id)}
    checks.push('superseded-capture-preserves-next-target-phase-and-allows-its-fresh-capture')
    current=await context('#blank');const annotationEvents=menuActions.length
    await wc.executeJavaScript('document.querySelector("#blank").outerHTML="<p id=blank>New annotation node</p>"');select(current.menu,'annotate')
    for(let i=0;i<150&&(menuActions.length===annotationEvents||page.annotationSelecting);i++)await sleep(15)
    assert.equal(menuActions.at(-1)?.action,'error');assert.match(menuActions.at(-1)?.message||'',/browser_context_target_changed/);assert.equal(page.annotationSelecting,false);assert.deepEqual(annotations.listTargets('a',page.id),[])
    checks.push('annotation-rejects-replaced-right-click-target-and-releases-manual-session')
    current=await context('#shadow-input');assert.equal(await wc.executeJavaScriptInIsolatedWorld(1009,[{code:'globalThis.__navoraMenuPoint?.node.deref()?.id'}]),'shadow-input');select(current.menu,'selectAll');await sleep(40)
    assert.equal(await wc.executeJavaScript('document.querySelector("#shadow").shadowRoot.querySelector("input").selectionEnd'),7)
    current=await context('#shadow-input');await wc.executeJavaScript('const trap=document.querySelector("#password");trap.focus();globalThis.__navoraMenuEdit={node:new WeakRef(trap),start:trap.selectionStart,end:trap.selectionEnd};true');select(current.menu,'selectAll');await sleep(40)
    assert.equal(await wc.executeJavaScript('document.querySelector("#password").selectionEnd-document.querySelector("#password").selectionStart'),0)
    checks.push('open-shadow-target-and-isolated-edit-credential-reject-page-forgery')
    current=await context('#link');const before=registry.getTree('a').flatMap(s=>s.windows).length;select(current.menu,'openLink')
    for(let i=0;i<100&&registry.getTree('a').flatMap(s=>s.windows).length===before;i++)await sleep(10)
    const child=registry.getTree('a').flatMap(s=>s.windows).find(p=>p.windowId!==page.id)!
    assert.ok(child);assert.equal(registry.getWindowRecord(child.windowId)?.sessionId,session.sessionId);assert.equal(child.chatId,'a');assert.equal(registry.hosts.getHost(hostId)?.active,page.id)
    checks.push('background-link-inherits-storage-and-chat')
    current=await context('#input');assert.equal(current.menu.getMenuItemById('paste')?.enabled,true);assert.equal(wc.focusedFrame,wc.mainFrame)
    current=await context('#password');assert.equal(current.menu.getMenuItemById('copy')?.enabled,false);assert.equal(current.menu.getMenuItemById('cut')?.enabled,false);assert.equal(current.menu.getMenuItemById('search'),null)
    checks.push('editable-actions-and-password-exclusion')
    current=await context('#child');assert.notEqual(current.options.frame,wc.mainFrame);assert.equal(current.menu.getMenuItemById('selectAll')?.enabled,false);assert.equal(current.menu.getMenuItemById('delete')?.enabled,false);assert.equal(current.menu.getMenuItemById('inspect')?.enabled,false)
    const frame=wc.mainFrame.frames[0]!,iframeMenu=current.menu
    assert.equal(await frame.executeJavaScript('typeof globalThis.__navoraMenuEdit'),'undefined')
    await frame.executeJavaScript('document.body.insertAdjacentHTML("beforeend","<input id=trap value=traptext>");const node=document.querySelector("#trap");node.focus();globalThis.__navoraMenuEdit={node:new WeakRef(node),start:0,end:0};document.querySelector("#child").outerHTML="<input id=child value=changed>"')
    iframeMenu.getMenuItemById('selectAll')!.click(undefined,window,undefined as any);iframeMenu.getMenuItemById('inspect')!.click(undefined,window,undefined as any);await sleep(40)
    assert.equal(await frame.executeJavaScript('document.querySelector("#trap").selectionEnd-document.querySelector("#trap").selectionStart'),0);assert.equal(inspected,1)
    assert.equal(await wc.executeJavaScript('document.querySelector("#input").value'),'alpha beta')
    checks.push('subframe-forgery-and-replaced-point-cannot-authorize-unavailable-actions')
    const embedded=await annotate('#child');assert.equal(embedded.selection.frameScope,'embedded-container');assert.equal(embedded.selection.kind,'element')
    assert.equal(await frame.executeJavaScript('typeof globalThis.__navoraMenuAnnotation'),'undefined')
    checks.push('subframe-annotation-retains-top-document-frame-container-without-page-world-credential')
    current=await context('#input');await wc.mainFrame.frames[0]!.executeJavaScript('document.querySelector("#child").focus()');select(current.menu,'selectAll');await sleep(30)
    assert.equal(await wc.executeJavaScript('document.querySelector("#input").selectionEnd-document.querySelector("#input").selectionStart'),0)
    checks.push('changed-focused-frame-rejects-stale-edit')
    current=await context('#input');await wc.executeJavaScript('document.querySelector("#password").focus()');select(current.menu,'selectAll');await sleep(40)
    assert.equal(await wc.executeJavaScript('document.querySelector("#password").selectionEnd-document.querySelector("#password").selectionStart'),0)
    checks.push('changed-focused-control-rejects-stale-edit')
    current=await context('#blank');const stale=current.menu,closedBefore=closed;registry.hosts.activate(registry.getWindowRecord(child.windowId)!.win);assert.ok(closed>closedBefore);select(stale,'copyUrl');assert.equal(await clipboard.readText(),oldClipboard)
    checks.push('tab-switch-closes-and-rejects-delayed-action')
    registry.hosts.activate(page);layout();current=await context('#blank');const transferMenu=current.menu
    otherWindow=new BrowserWindow({show:false,width:1000,height:750});const destination=registry.hosts.bindMain(otherWindow)
    registry.hosts.transfer(page,destination,false,false);assert.equal(popup,undefined);select(transferMenu,'copyUrl');assert.equal(await clipboard.readText(),oldClipboard)
    registry.hosts.transfer(page,hostId,false,false);registry.hosts.activate(page);layout()
    checks.push('cross-host-transfer-closes-exact-source-window-menu')
    registry.hosts.activate(page);layout();current=await context('#blank');const released=current.menu;released.closePopup(window);select(released,'copyUrl');assert.equal(await clipboard.readText(),oldClipboard)
    checks.push('dismissed-menu-cannot-replay-action')
    current=await context('#blank');await page.automation.resume();assert.ok(!popup);await page.automation.claimRun('fixture');assert.ok(!popup);await page.automation.finishRun('fixture');layout()
    checks.push('agent-claim-supersedes-menu-without-takeover')
    await wc.debugger.attach('1.3');current=await context('#blank');assert.equal(current.menu.getMenuItemById('inspect')?.enabled,false);assert.equal(current.menu.getMenuItemById('devtools')?.enabled,false);wc.debugger.detach()
    checks.push('debugger-conflict-disables-development-actions')
    assert.ok(nativeEvents>=11)
    console.log(JSON.stringify({ok:true,checks:checks.length,items:checks,boundary:'Real customized Electron guest context-menu events, frames, target-bound annotation capture, navigation/session service and Menu objects. OS popup painting is intercepted; no physical keyboard/IME/multi-DPI claim.'}))
    app.exit(0)
  }catch(error){console.error(error);app.exit(1)}finally{Menu.prototype.popup=originalPopup;Menu.prototype.closePopup=originalClose;clipboard.readText=originalRead;clipboard.writeText=originalWrite;registry?.hosts.dispose();window?.destroy();otherWindow?.destroy();server?.close();childServer?.close()}
}).catch(error=>{console.error(error);app.exit(1)})
