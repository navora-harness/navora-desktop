import {app,BrowserWindow,NativePanel,WebContentsView,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'
import {browserNativeId} from '../shared/browser-native-panels'
import type {BrowserDownloadEntry} from '../shared/types'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_native_browser_fixture'
const fallback=process.env.NAVORA_NATIVE_FALLBACK==='1'
const pageInfoVisual=process.env.NAVORA_NATIVE_PAGEINFO_VISUAL==='1'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('Explicit isolated data root is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'原生浏览器面板集成验收',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const show=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)};show.call(this)};BrowserWindow.prototype.focus=function(){}

// Actual schema, widgets and application handlers; only disable native activation.
// This unattended suite does not claim physical keys or OS IME coverage.
const requests:NativePanelShow[]=[],commands:unknown[]=[],downloadActions:unknown[]=[],nativeVisible=new Set<NativePanel>(),panels:NativePanel[]=[],contentUpdates:NativePanelContent[]=[]
const panelDiagnostics:unknown[]=[]
let previewRequests=0,downloadVersion=0,downloads:BrowserDownloadEntry[]=[],observingPageInfo=false,pageInfoConstructed=0,nativeVisualShows=0
const pageInfoAnchors:unknown[]=[]
const originalHandle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,...args)=>{
  if(fallback&&channel==='navora:native-ui.capabilities'){const capabilities=await listener(event,...args);return {...capabilities,panels:false,pageInfo:false}}
  if(fallback&&channel==='navora:native-ui.pageInfo')return false
  if(channel==='navora:native-ui.pageInfo'){observingPageInfo=true;try{return await listener(event,...args)}finally{observingPageInfo=false}}
  if(channel==='navora:native-ui.show'){args[0]={...args[0],focusMode:'none'};requests.push(structuredClone(args[0]))}
  if(channel==='navora:native-ui.update'&&args[2]?.content)contentUpdates.push(structuredClone(args[2].content))
  if(channel==='navora:native-ui.hide'||channel==='navora:native-ui.destroy')panelDiagnostics.push({channel,id:args[0],time:Date.now()})
  if(channel==='navora:browser.workspace.command')commands.push(structuredClone(args))
  if(channel==='navora:browser.workspace.preview')previewRequests++
  if(channel==='navora:downloads.list')return structuredClone(downloads.filter(item=>!args[0]||item.chatId===args[0]))
  if(channel==='navora:downloads.pause'){downloadActions.push(structuredClone(args));downloads=downloads.map(item=>item.id===args[0]?{...item,state:'paused',canPause:false,canResume:true}:item);pushDownloads();return {ok:true}}
  return listener(event,...args)
})
const nativeShow=NativePanel.prototype.show,nativeHide=NativePanel.prototype.hide,nativeDestroy=NativePanel.prototype.destroy
NativePanel.prototype.show=function(options){if(observingPageInfo){pageInfoConstructed++;assert.ok(Object.values(options.anchorBounds).every(Number.isFinite));assert.ok(options.anchorBounds.width>0&&options.anchorBounds.height>0);pageInfoAnchors.push(options.anchorBounds);if(!pageInfoVisual){panels.push(this);return}}nativeShow.call(this,options);nativeVisualShows++;nativeVisible.add(this);panels.push(this)}
NativePanel.prototype.hide=function(){nativeHide.call(this);nativeVisible.delete(this)}
NativePanel.prototype.destroy=function(){nativeDestroy.call(this);nativeVisible.delete(this)}
function pushDownloads(){downloadVersion++;for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('navora:downloads.changed',{downloads,revision:downloadVersion})}
const local=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end('<!doctype html><title>原生面板本地资料</title><h1>原网页连续显示</h1><input id="draft" value="网页草稿"><div id="pulse" style="width:200px;height:60px"></div><script>window.framesPainted=0;window.documentIdentity=crypto.randomUUID();function tick(){window.framesPainted++;document.querySelector("#pulse").style.background=window.framesPainted%2?"#dff2fc":"#f8eacd";requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/fixture`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:string[]=[],errors:string[]=[],metrics:unknown[]=[]
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let n=0;n<150;n++){if(await check())return;await wait(60)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const click=async(selector:string)=>{await js(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!element)throw Error('Missing visible trigger');element.click()})()`);await wait(100)}
    const focusAddress=async()=>{guest!.focus();guest!.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']});guest!.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:['control']});await until(()=>js('document.querySelector(".browser-address-bar").classList.contains("is-focused")'),'address focus command')}
    const latest=(name:string)=>[...requests].reverse().find(request=>request.content.id===name)
    const dismiss=async()=>{const panel=panels.at(-1)!;panel.hide();panel.emit('dismissed',{reason:'escape'});await wait(120)}
    let guest:Electron.WebContents|undefined,pageId='',view:Electron.WebContentsView|undefined
    try{
      win.setContentSize(1600,960);await until(()=>js('!!document.querySelector(".composer")'),'application ready')
      assert.equal(await js('window.navora.nativeUi.capabilities().then(value=>value.panels&&value.pageInfo)'),!fallback)
      await js(`(async()=>{window.nativeBrowserChat=${JSON.stringify(chat)};window.nativeBrowserPage=await window.navora.browser.workspace.ensure(window.nativeBrowserChat,'browser:native-panel-browser');await window.navora.browser.workspace.command(window.nativeBrowserPage,'navigate',${JSON.stringify(url)});await window.navora.browser.setVisible(window.nativeBrowserPage,true)})()`)
      pageId=await js('window.nativeBrowserPage');await until(()=>{guest=webContents.getAllWebContents().find(item=>item.getURL()===url&&!item.isLoading());return !!guest},'committed local document');guest!.setBackgroundThrottling(false)
      await js('document.querySelector("[aria-label=浏览器地址]")?.blur()')
      const descendants=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(descendants)]
      await until(()=>{view=descendants(win.contentView).find(item=>item instanceof WebContentsView&&item.webContents.id===guest!.id)as Electron.WebContentsView;return !!view&&view.getVisible()},'visible native webpage')
      await until(()=>js('!!document.querySelector(".browser-agent-trigger")'),'rendered browser chrome')
      const state=()=>js(`window.navora.browser.workspace.state().then(value=>value.pages.flatMap(group=>group.windows).find(page=>page.windowId===${JSON.stringify(pageId)}))`),baselineBounds=view!.getBounds(),identity=await guest!.executeJavaScript('window.documentIdentity'),baselineWc=webContents.getAllWebContents().length,owner=(await state()).automation.owner
      if(fallback){
        const before=commands.length
        await js('document.querySelector(".browser-agent-trigger").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2}))');await until(()=>js('!!document.querySelector("[data-browser-agent-panel]")'),'fallback Agent panel');await until(()=>!view!.getVisible(),'fallback reserves DOM overlay')
        assert.ok(previewRequests>0);assert.equal(nativeVisible.size,0);assert.equal(commands.length,before);checks.push('unsupported-runtime-Agent-retains-explicit-DOM-preview-fallback-without-control-command')
        await click('[aria-label="关闭 Agent 面板"]');await until(()=>view!.getVisible(),'fallback restored live page')
        await click('.address-site-info');await until(()=>js('!!document.querySelector(".address-site-popover")'),'fallback site information');await click('[aria-label="关闭连接信息"]');checks.push('unsupported-runtime-site-info-retains-DOM-connection-method-description')
        await focusAddress();await js('(()=>{const field=document.querySelector("[aria-label=浏览器地址]");field.value="兼容模式";field.dispatchEvent(new Event("input",{bubbles:true}))})()');await until(()=>js('!!document.querySelector(".browser-address-suggestions")'),'fallback address suggestions');assert.equal(requests.length,0);checks.push('unsupported-runtime-address-suggestions-use-original-DOM-input-and-list');await js('document.querySelector("[aria-label=浏览器地址]").blur()');await until(()=>view!.getVisible(),'fallback after address blur')
        downloads=[{id:'fallback-download',chatId:chat,sessionId:'fixture',state:'completed',source:'browser',filename:'兼容下载.txt',url,createdAt:1,updatedAt:1}];pushDownloads();await until(()=>js('document.querySelector(".browser-page-tools .browser-downloads-trigger").checkVisibility()'),'fallback download trigger');await click('.browser-page-tools .browser-downloads-trigger');await until(()=>js('!!document.querySelector(".browser-downloads-menu .dl-panel")'),'fallback download panel');checks.push('unsupported-runtime-downloads-retain-scoped-DOM-list')
        assert.equal(guest!.isDestroyed(),false);assert.equal(await guest!.executeJavaScript('window.documentIdentity'),identity);assert.equal((await state()).automation.owner,owner)
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,mode:'forced-unsupported-compatibility',checks,previewRequests,errors},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0);return
      }
      async function continuous(label:string){const before=await guest!.executeJavaScript('window.framesPainted');await wait(150);assert.equal(guest!.isDestroyed(),false);assert.equal(view!.getVisible(),true);assert.deepEqual(view!.getBounds(),baselineBounds);assert.equal(await guest!.executeJavaScript('window.documentIdentity'),identity);assert.ok(await guest!.executeJavaScript('window.framesPainted')>before);assert.equal(await js('document.querySelectorAll(".browser-frozen-frame,.browser-preview-unavailable").length'),0);assert.equal(previewRequests,0);assert.equal(webContents.getAllWebContents().length,baselineWc);assert.equal((await state()).automation.owner,owner);checks.push(label)}

      const commandStart=commands.length
      await js('document.querySelector(".browser-agent-trigger").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2}))')
      await until(()=>!!latest('agent-root')&&nativeVisible.size>0,'Agent native panel')
      assert.equal(await js('document.querySelectorAll("[data-browser-agent-panel]").length'),0);assert.equal(commands.length,commandStart);await continuous('Agent-native-panel-keeps-original-webpage-visible-and-draws-without-preview-or-control-change')
      await guest!.executeJavaScript('window.nativeDirectedMoves=[];document.addEventListener("pointermove",event=>window.nativeDirectedMoves.push({trusted:event.isTrusted,x:event.clientX,y:event.clientY,buttons:event.buttons,time:performance.now()}),{capture:true})')
      const directedSteps:Electron.InputSequenceMouseStep[]=Array.from({length:11},(_,index)=>({kind:'mouse',type:'mouseMoved',position:{x:40+index*10,y:180+index*3},button:'none',buttons:0,atMs:index*50}))
      const directedSequence=await guest!.dispatchInputSequence(directedSteps,{timeoutMs:5000})
      assert.equal(directedSequence.status,'completed');assert.equal(directedSequence.dispatchedCount,directedSteps.length);assert.equal(directedSequence.mouseCount,directedSteps.length);assert.ok(directedSequence.executionMs>=350)
      const directedMoves=await guest!.executeJavaScript('structuredClone(window.nativeDirectedMoves)')
      assert.ok(directedMoves.length>0&&directedMoves.every((event:{trusted:boolean;buttons:number})=>event.trusted&&event.buttons===0));assert.ok(nativeVisible.size>0);assert.equal(await js('document.querySelector(".browser-agent-trigger").getAttribute("aria-expanded")'),'true');assert.equal(commands.length,commandStart)
      metrics.push({directedSequence,directedMoves});await continuous('native-directed-mouse-sequence-completes-with-trusted-pointermove-while-Agent-native-panel-is-open')
      // Motion speed lives in settings, rather than the compact Agent summary.
      const agentShows=requests.filter(request=>request.content.id==='agent-root').length,agentPanel=panels.at(-1)!
      await js('window.navora.config.save({browser:{automation:{speed_multiplier:1.15}}})');await wait(160)
      assert.equal(requests.filter(request=>request.content.id==='agent-root').length,agentShows);assert.equal(nativeVisible.has(agentPanel),true);checks.push('Agent-settings-update-retains-native-instance')
      await dismiss();assert.equal(commands.length,commandStart);checks.push('Agent-dismissal-does-not-request-takeover')

      await click('.address-site-info');await until(()=>pageInfoConstructed>0,'real page-info construction');assert.equal(await js('document.querySelectorAll(".address-site-popover").length'),0);await continuous(pageInfoVisual?'real-page-info-dialog-overlays-live-webpage':'page-info-delegates-to-real-runtime-constructor-without-DOM-fallback-display-not-exercised');if(pageInfoVisual)await dismiss();else panels.at(-1)!.destroy();await wait(100)
      await js('(()=>{window.nativeAddressTrace=[];for(const type of ["focusin","focusout","navora:native-ui-open","navora:browser-chrome-open"])window.addEventListener(type,event=>window.nativeAddressTrace.push({type,target:event.target?.outerHTML?.slice(0,200),detail:event.detail,time:performance.now()}))})()')
      await focusAddress();await js('(()=>{const field=document.querySelector("[aria-label=浏览器地址]");field.value="原生面板";field.dispatchEvent(new Event("input",{bubbles:true}));field.setSelectionRange(1,3)})()')
      await until(()=>!!latest('address-suggestions-root')&&nativeVisible.size>0,'native address suggestions');assert.equal(await js('document.querySelectorAll(".browser-address-suggestions").length'),0);await continuous('native-address-suggestions-preserve-live-view')
      const addresses=requests.filter(request=>request.content.id==='address-suggestions-root').length
      await js('(()=>{const field=document.querySelector("[aria-label=浏览器地址]");field.value="原生面板继续输入";field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))})()');await until(()=>contentUpdates.some(content=>content.id==='address-suggestions-root'&&JSON.stringify(content).includes('原生面板继续输入')),'address updates after typing')
      assert.equal(requests.filter(request=>request.content.id==='address-suggestions-root').length,addresses);assert.equal(await js('document.activeElement===document.querySelector("[aria-label=浏览器地址]")'),true);checks.push('address-input-and-arrow-selection-update-native-controls-without-reopening-or-losing-focus')
      await js('document.querySelector("[aria-label=浏览器地址]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}))');assert.equal(guest!.getURL(),url);checks.push('address-composition-Enter-never-navigates')
      await dismiss();await js('document.querySelector("[aria-label=浏览器地址]").blur()')

      downloads=[{id:'native-download-a',chatId:chat,sessionId:'fixture',state:'started',source:'browser',filename:'本地下载.zip',url,createdAt:1,updatedAt:1,receivedBytes:25,totalBytes:100,canPause:true,canCancel:true}];pushDownloads();await until(()=>js('document.querySelector(".browser-page-tools .browser-downloads-trigger").checkVisibility()'),'download trigger')
      await click('.browser-page-tools .browser-downloads-trigger');await until(()=>!!latest('downloads-root')&&nativeVisible.size>0,'native downloads');assert.equal(await js('document.querySelectorAll(".browser-downloads-menu .dl-panel").length'),0);await continuous('native-download-list-preserves-live-view')
      const downloadPanel=panels.at(-1)!,downloadShows=requests.filter(request=>request.content.id==='downloads-root').length
      downloads=[{...downloads[0]!,receivedBytes:75,updatedAt:2}];pushDownloads();await until(()=>contentUpdates.some(content=>content.id==='downloads-root'&&JSON.stringify(content).includes('0.75')),'live download progress')
      assert.equal(requests.filter(request=>request.content.id==='downloads-root').length,downloadShows);checks.push('download-progress-updates-reuse-native-panel-and-stable-controls')
      downloadPanel.emit('action',{id:`${browserNativeId('download','native-download-a')}-pause`,type:'click'});await until(()=>downloadActions.length===1,'explicit download action reaches existing service');assert.equal(downloads[0]!.state,'paused');checks.push('explicit-native-download-action-reaches-current-scoped-business-handler')
      downloads=[];pushDownloads();await until(()=>nativeVisible.size===0,'empty downloads dismiss native panel');downloadPanel.emit('action',{id:`${browserNativeId('download','native-download-a')}-pause`,type:'click'});await wait(150);assert.equal(downloadActions.length,1);checks.push('removed-download-late-action-is-discarded')
      await continuous('all-browser-panel-paths-leave-page-identity-and-control-owner-unchanged')
      const beforeExplicit=commands.length
      await js('document.querySelector(".browser-agent-trigger").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2}))');await until(()=>nativeVisible.size>0,'Agent before explicit action')
      panels.at(-1)!.emit('action',{id:'agent-primary',type:'click'});await until(async()=>commands.length>beforeExplicit&&(await state()).automation.owner===(owner==='ai'?'user':'ai'),'explicit Agent action')
      assert.ok(JSON.stringify(commands.slice(beforeExplicit)).includes(owner==='ai'?'takeControl':'resume'));checks.push('only-explicit-native-Agent-action-changes-controller-owner')
      metrics.push({identity,pageId,guestWebContentsId:guest!.id,bounds:baselineBounds,previewRequests,webContents:baselineWc,nativePanelShowCalls:panels.length,nativeVisualShows,nativeContentUpdates:contentUpdates.length,pageInfoConstructed,pageInfoAnchors,pageInfoVisual,errors})
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,metrics,boundaries:['NativePanel focusMode is overridden to none in this unattended fixture to avoid foreground activation.',pageInfoVisual?'Explicit PageInfo visual mode enabled; runtime controls its native activation.':'PageInfo uses the real runtime constructor and application delegation; its show is skipped to avoid activation. PageInfo visual display and focus are unverified.','Native button action and dismissal events are injected; physical mouse, native keyboard traversal and OS IME are not covered.','The page uses actual RAF and a changing visual block; this is not a video decoding test.','No active model run is started; control continuity assertions cover the actual idle controller.','Download list and pause IPC responses use isolated simulated data; the production renderer and preload channel are exercised, not the backend download transport.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
    }catch(error){const renderer=await js('({address:document.querySelector(".browser-address-bar")?.outerHTML,active:document.activeElement?.outerHTML,trace:window.nativeAddressTrace})').catch(()=>null);fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,requests,metrics,errors,previewRequests,renderer,contentUpdates,panelDiagnostics},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
