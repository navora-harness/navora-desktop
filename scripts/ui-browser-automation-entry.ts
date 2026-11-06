import {app,BrowserWindow,NativePanel,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createDefaultConfig} from '../shared/config'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import {dispatchPointerMotion} from '../electron/modules/pointer-motion'
import type {BrowserDownloadEntry} from '../shared/types'
import {APPEARANCE_THEMES} from '../shared/appearance'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if(process.env.NAVORA_UI_REDUCED_MOTION==='1')app.commandLine.appendSwitch('force-prefers-reduced-motion')
app.setPath('userData',root)
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
fs.mkdirSync(path.join(root,'chats'),{recursive:true})
const chatId='chat_automation_ui',otherChat='chat_automation_other'
const fixtureTime=Date.now()
for(const [id,title] of [[chatId,'浏览器自动化验收'],[otherChat,'其他对话下载']])fs.writeFileSync(path.join(root,'chats',id+'.json'),JSON.stringify({id,title,createdAt:fixtureTime+(id===chatId?1000:0),updatedAt:fixtureTime+(id===chatId?1000:0),messages:[]}))
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>,label:string){for(let n=0;n<120;n++){if(await check())return;await wait(50)}throw Error('Timed out: '+label)}
const patches:unknown[]=[]
const commands:unknown[]=[]
type FixturePanel={senderId:number;request:NativePanelShow;session:string;panel:Electron.NativePanel;open:boolean}
const nativePanels=new Map<string,FixturePanel>()
const watchedPanels=new WeakSet<Electron.NativePanel>()
const panelKey=(senderId:number,id:string)=>`${senderId}:${id}`
let showingPanel:{panel?:Electron.NativePanel}|undefined
const nativeShow=NativePanel.prototype.show,nativeHide=NativePanel.prototype.hide,nativeDestroy=NativePanel.prototype.destroy
NativePanel.prototype.show=function(options){nativeShow.call(this,options);if(showingPanel)showingPanel.panel=this}
NativePanel.prototype.hide=function(){nativeHide.call(this);for(const row of nativePanels.values())if(row.panel===this)row.open=false}
NativePanel.prototype.destroy=function(){nativeDestroy.call(this);for(const row of nativePanels.values())if(row.panel===this)row.open=false}
const panelNodes=(node:NativePanelContent):NativePanelContent[]=>[node,...(node.children||[]).flatMap(panelNodes)]
// Download data stays inside this isolated fixture. Production handlers are used
// by the backend tests; here deterministic updates exercise the actual Vue UI.
let downloadFixture=false,downloadEntries:BrowserDownloadEntry[]=[],downloadVersion=0,hangPreview=false,previewRequests=0
let delayDownloadList=false,releaseDownloadList:(()=>void)|undefined
const previewResolvers:Array<(value:null)=>void>=[]
function pushDownloads(entries:BrowserDownloadEntry[]){downloadEntries=structuredClone(entries);downloadVersion++;for(const target of BrowserWindow.getAllWindows())if(!target.isDestroyed())target.webContents.send('navora:downloads.changed',{downloads:downloadEntries,revision:downloadVersion})}
function download(id:string,receivedBytes:number|undefined,totalBytes:number|undefined,state:BrowserDownloadEntry['state']='started',owner=chatId):BrowserDownloadEntry{return {id,chatId:owner,sessionId:'ui-fixture',source:'browser',url:'https://example.invalid/'+id,filename:id+'.zip',state,receivedBytes,totalBytes,createdAt:1000+Number(id.replace(/\D/g,'')||0),updatedAt:Date.now(),canPause:state==='started',canResume:state==='paused',canCancel:state==='started'||state==='paused'}}
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){
    // Exercise the real native tree and handlers without activating an OS window.
    const request:NativePanelShow={...args[0],focusMode:'none'};args[0]=request
    const previous=showingPanel,current:{panel?:Electron.NativePanel}={};showingPanel=current
    let pending:unknown
    try{pending=listener(event,...args)}finally{showingPanel=previous}
    const result=await pending as {supported:boolean;session:string}
    if(result.supported){
      assert.ok(current.panel,'A supported native panel must use its real runtime instance')
      const key=panelKey(event.sender.id,request.id),panel=current.panel
      nativePanels.set(key,{senderId:event.sender.id,request:structuredClone(request),session:result.session,panel,open:true})
      if(!watchedPanels.has(panel)){watchedPanels.add(panel);const closed=()=>{for(const row of nativePanels.values())if(row.panel===panel)row.open=false};panel.on('dismissed',closed);panel.on('closed',closed)}
    }
    return result
  }
  if(channel==='navora:config.save')patches.push(structuredClone(args[0]))
  if(channel==='navora:config.commit')patches.push(structuredClone(args[0].patch))
  if(channel==='navora:browser.workspace.command')commands.push(structuredClone(args))
  if(channel==='navora:browser.workspace.preview'){previewRequests++;if(hangPreview)return new Promise<null>(resolve=>previewResolvers.push(resolve))}
  if(downloadFixture&&channel==='navora:downloads.list'){
    const owner=args[0],snapshot=structuredClone(owner?downloadEntries.filter(item=>item.chatId===owner):downloadEntries)
    if(delayDownloadList){delayDownloadList=false;return new Promise<BrowserDownloadEntry[]>(resolve=>{releaseDownloadList=()=>resolve(snapshot)})}
    return snapshot
  }
  if(downloadFixture&&channel==='navora:downloads.clear'){
    const before=downloadEntries.length,owner=args[0];pushDownloads(downloadEntries.filter(item=>(owner&&item.chatId!==owner)||!['completed','failed','cancelled'].includes(item.state)))
    return {ok:true,removed:before-downloadEntries.length}
  }
  const result=await listener(event,...args)
  const panel=nativePanels.get(panelKey(event.sender.id,args[0]))
  if(panel&&channel==='navora:native-ui.update'&&result)panel.request={...panel.request,...structuredClone(args[2])}
  if(panel&&(channel==='navora:native-ui.hide'||channel==='navora:native-ui.destroy'))panel.open=false
  return result
})
const server=createServer((_request,response)=>{
  response.setHeader('Content-Type','text/html;charset=utf-8')
  response.end('<title>本地资料页面</title><style>body{margin:32px;color:#25364a;font:15px system-ui;background:#fff}h1{font-size:22px}p{color:#718096}button{padding:10px 20px;margin:20px 0;background:#edf3fa;border:1px solid #bdcde0;border-radius:8px}input{display:block;padding:10px;border:1px solid #dce4ed;border-radius:6px;width:260px}</style><h1>项目资料</h1><p>本地验收页面，所有输入只作用于此处。</p><button id="target">查看资料</button><input value="保留页面上的内容"><script>window.inputEvents=0;document.addEventListener("mousemove",()=>window.inputEvents++);document.addEventListener("mousedown",()=>window.inputEvents++);document.addEventListener("mouseup",()=>window.inputEvents++)</script>')
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  const errors:string[]=[],checks:string[]=[]
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const activePanel=`[...document.querySelectorAll('.browser-tab-panel')].find(el=>el.checkVisibility())`
    const control='[data-browser-agent-control]',agentPanel='[data-browser-agent-panel]',downloadTrigger='.browser-page-tools .browser-downloads-trigger'
    const nativePanel=(rootId='agent-root',target=win)=>[...nativePanels.values()].reverse().find(row=>row.senderId===target.webContents.id&&row.open&&row.request.content.id===rootId)
    const panelVisible=async(rootId='agent-root',target=win)=>!!nativePanel(rootId,target)||await target.webContents.executeJavaScript(`!![...document.querySelectorAll(${JSON.stringify(rootId==='agent-root'?agentPanel:'.dl-panel')})].find(el=>el.checkVisibility())`)
    const agentText=async(target=win)=>{const panel=nativePanel('agent-root',target);return panel?panelNodes(panel.request.content).map(node=>node.text||node.accessibleName||'').join('\n'):target.webContents.executeJavaScript(`document.querySelector('${agentPanel}')?.textContent||''`)}
    const click=async(selector:string,target=win)=>{
      if(selector===control)await until(()=>target.webContents.executeJavaScript(`(async()=>{const panel=${activePanel},state=await window.navora.browser.workspace.state(),page=state.pages.flatMap(s=>s.windows).find(page=>page.hostActive),selected=document.querySelector('[role="tab"][aria-selected="true"][data-page-id]');return !!panel&&!!page&&(!selected||selected.dataset.pageId===page.windowId)&&panel.dataset.controlOwner===page.automation?.owner&&panel.dataset.controlActivity===page.automation?.activity})()`),'Agent state is rendered before clicking its current action')
      await target.webContents.executeJavaScript(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})],el=nodes.find(el=>el.checkVisibility());if(!el)throw Error('Missing visible element '+${JSON.stringify(selector)});if(${JSON.stringify(selector)}==='${control}')(window.automationPrimaryClicks||=[]).push({time:performance.now(),label:el.getAttribute('aria-label'),selected:document.querySelector('[role="tab"][aria-selected="true"][data-page-id]')?.dataset.pageId});el.click()})()`);await wait(90)
    }
    const keyboard=async(selector:string,key:string,extra:Record<string,unknown>={},target=win)=>{await target.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing keyboard target');el.focus({preventScroll:true});el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(extra)}}))})()`);await wait(80)}
    const openAgent=async(method:'right'|'keyboard'|'arrow'='right',target=win)=>{
      const before=commands.length
      if(method==='right')await target.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll('${control}')].find(el=>el.checkVisibility());el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))})()`)
      else await keyboard(control,method==='keyboard'?'F10':'ArrowDown',method==='keyboard'?{shiftKey:true}:{},target)
      await until(()=>panelVisible('agent-root',target),'Agent panel opens with '+method)
      assert.equal(await target.webContents.executeJavaScript(`!![...document.querySelectorAll('${control}')].find(el=>el.checkVisibility()&&el.getAttribute('aria-expanded')==='true')`),true,'The visible Agent entry reports its expanded details')
      assert.equal(commands.length,before,'Opening Agent details never dispatches a control command')
    }
    const closeAgent=async(target=win)=>{const panel=nativePanel('agent-root',target);if(panel){panel.panel.hide();panel.panel.emit('dismissed',{reason:'escape'})}else if(await panelVisible('agent-root',target))await keyboard(agentPanel,'Escape',{},target);await until(async()=>!await panelVisible('agent-root',target)&&await target.webContents.executeJavaScript(`![...document.querySelectorAll('${control}')].some(el=>el.checkVisibility()&&el.getAttribute('aria-expanded')==='true')`),'Agent panel closes and its trigger reflects dismissal')}
    const panelAction=async(label:string,target=win,rootId='agent-root')=>{
      const native=nativePanel(rootId,target)
      if(native){const node=panelNodes(native.request.content).find(node=>['button','iconButton','item'].includes(node.type)&&(node.text===label||node.accessibleName===label));assert.ok(node,'Missing native action '+label);assert.notEqual(node.disabled,true,'Disabled native action '+label);native.panel.emit('action',{id:node.id,type:'click'})}
      else await target.webContents.executeJavaScript(`(()=>{const panel=document.querySelector(${JSON.stringify(rootId==='agent-root'?agentPanel:'.dl-panel')}),el=[...panel.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(label)}||el.getAttribute('aria-label')===${JSON.stringify(label)});if(!el)throw Error('Missing panel action '+${JSON.stringify(label)});if(el.disabled)throw Error('Disabled panel action '+${JSON.stringify(label)});el.click()})()`)
      await wait(90)
    }
    let screenshotGuest:Electron.WebContents|undefined
    const capture=async(name:string,target=win)=>{
      await wait(100)
      const raw=(await target.webContents.capturePage()).toPNG()
      // Native child views have their own compositor surface. Keep the host-only
      // original and compose a review preview using actual child pixels, never a
      // simulated cursor or invented page content.
      if(!screenshotGuest){fs.writeFileSync(path.join(output,name+'.png'),raw);return}
      fs.writeFileSync(path.join(output,name+'-host.png'),raw)
      const native=(await screenshotGuest.capturePage(undefined,{stayHidden:true,stayAwake:true})).toDataURL()
      const inserted=await target.webContents.executeJavaScript(`(async()=>{const slot=[...document.querySelectorAll('.browser-native-slot')].find(el=>el.checkVisibility());if(!slot)return false;const rect=slot.closest('.browser-viewport-area').getBoundingClientRect();const img=document.createElement('img');img.dataset.uiNativePreview='true';Object.assign(img.style,{position:'fixed',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px',objectFit:'fill',pointerEvents:'none',zIndex:'2'});img.src=${JSON.stringify(native)};document.body.append(img);await img.decode();return true})()`)
      try{fs.writeFileSync(path.join(output,name+'.png'),(await target.webContents.capturePage()).toPNG())}
      finally{if(inserted)await target.webContents.executeJavaScript('document.querySelector("[data-ui-native-preview]")?.remove()')}
    }
    let pageId=''
    const state=(id=pageId,target=win)=>target.webContents.executeJavaScript(`window.navora.browser.workspace.state().then(state=>state.pages.flatMap(session=>session.windows).find(page=>page.windowId===${JSON.stringify(id)}))`)
    const geometry=(target=win)=>target.webContents.executeJavaScript(`(()=>{const panel=${activePanel};const area=panel.querySelector('.browser-viewport-area').getBoundingClientRect(),bar=panel.querySelector('.browser-automation-status'),frame=panel.querySelector('.browser-view-frame'),toolbar=panel.querySelector('.browser-tab-toolbar').getBoundingClientRect();return {x:area.x,y:area.y,width:area.width,height:area.height,statusPresent:!!bar,border:getComputedStyle(frame).borderTopWidth,toolbarHeight:toolbar.height}})()`)
    const downloadState=(target=win)=>target.webContents.executeJavaScript(`(()=>{const trigger=[...document.querySelectorAll(${JSON.stringify(downloadTrigger)})].find(el=>el.checkVisibility()),ring=trigger?.querySelector('.dl-progress-ring');return {visible:!!trigger,label:trigger?.getAttribute('aria-label'),progress:ring?.getAttribute('data-progress'),unknown:!!ring?.classList.contains('indeterminate'),animation:ring?getComputedStyle(ring).animationName:'none',badge:!!trigger?.querySelector('.dl-badge'),rect:trigger?.getBoundingClientRect().toJSON()}})()`)
    try{
      await until(()=>js('!!document.querySelector(".composer")'),'main application')
      await js(`(()=>{window.automationChromeEvents=[];window.addEventListener('navora:browser-chrome-open',event=>window.automationChromeEvents.push({time:performance.now(),id:event.detail,focused:document.activeElement?.outerHTML.slice(0,180)}))})()`)
      win.setContentSize(1540,1000)
      await click('.sidebar-settings-btn')
      await until(()=>js('!!document.querySelector(".settings-page")'),'settings page')
      await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(el=>el.textContent.includes("浏览器")).click()')
      await until(()=>js('!!document.querySelector(".browser-automation-settings")'),'automation settings')
      assert.deepEqual(await js('(async()=>{const c=(await window.navora.config.get()).browser.automation;return [c.show_virtual_cursor,c.smooth_pointer,c.show_control_feedback,c.protect_input]})()'),[true,true,true,true])
      await js('(()=>{const input=document.querySelector("input[max=\\"300000\\"]");input.value="99000";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
      await js('window.navora.config.save({browser:{default_width:1515,automation:{cursor_fps:30}}})')
      await click('.browser-automation-settings input[aria-label="显示虚拟光标"]')
      await until(()=>js('window.navora.config.get().then(c=>c.browser.automation.show_virtual_cursor===false)'),'cursor preference saved')
      const saved=await js('window.navora.config.get()')
      assert.equal(saved.browser.default_width,1515)
      assert.equal(saved.browser.automation.cursor_fps,30)
      assert.equal(saved.browser.automation.protect_input,true,'Disabling the cursor retains the stored protection preference')
      assert.equal(await js(`(()=>{const settings=document.querySelector('.browser-automation-settings'),status=settings.querySelector('[data-automation-isolation-state]');return settings.textContent.includes('后台独立操作')&&status?.checkVisibility()&&status.textContent==='始终开启'&&!settings.querySelector('input[aria-label="防止操作相互干扰"]')})()`),true,'Background isolation stays visibly enabled when cursor drawing is off')
      await capture('01-automation-cursor-disabled')
      assert.equal(saved.browser.navigation_timeout_ms,config.browser.navigation_timeout_ms,'A waiting-time draft requires its own group commit')
      const uiPatch=patches.find((patch:any)=>patch.browser?.automation?.show_virtual_cursor===false)
      assert.deepEqual(uiPatch,{browser:{automation:{show_virtual_cursor:false}}},'Instant save contains only the changed automation leaf')
      await js('(()=>{const input=document.querySelector("#automation-speed");input.value="1.15";input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})()')
      await until(()=>js('window.navora.config.get().then(c=>Math.abs(c.browser.automation.speed_multiplier-1.15)<.001)'),'speed saved')
      await click('.browser-automation-settings input[aria-label="显示虚拟光标"]')
      await click('.automation-advanced-toggle')
      await until(()=>js('!!document.querySelector(".automation-advanced-fields")'),'advanced automation settings')
      await capture('01-automation-settings')
      checks.push('default-preferences-on','leaf-only-instant-save','concurrent-setting-preserved','unapplied-numeric-draft-preserved','fractional-speed-saved','cursor-off-retains-always-on-background-isolation')
      console.log('[browser-automation-ui] settings and saved preferences passed')
      await click('.settings-back')
      await js(`(async()=>{const session=await window.navora.browser.createSession(${JSON.stringify(chatId)},{persist:false}),page=await window.navora.browser.createWindow(session.sessionId,{url:'about:blank',show:false});await window.navora.browser.setVisible(page.windowId,true)})()`)
      await until(()=>js('!!document.querySelector(".browser-tab-panel")'),'browser panel')
      pageId=await js('(async()=>{const pages=(await window.navora.browser.workspace.state()).pages.flatMap(s=>s.windows);return (pages.find(page=>page.hostActive)||pages[0]).windowId})()')
      await js(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'navigate',${JSON.stringify(url)})`)
      await until(()=>Promise.resolve(webContents.getAllWebContents().some(w=>w.getURL()===url&&!w.isLoading())),'fixture document')
      const guest=webContents.getAllWebContents().find(w=>w.getURL()===url)!,controller=getBrowserAutomationController(guest)
      screenshotGuest=guest
      await until(()=>state().then(page=>!!page?.automation),'controller state transport')
      await until(()=>js(`!!${activePanel}?.querySelector('${control}')`),'Agent address button ready')
      if((await state()).automation.owner==='user'){
        await click(control)
        await until(()=>state().then(page=>page.automation.owner==='ai'),'allow AI after manual navigation')
      }
      await wait(250)
      const initial=await geometry();assert.equal(initial.statusPresent,false)
      assert.equal(await js('document.querySelectorAll(".browser-control,.browser-automation-status,.address-automation-badge").length'),0,'Old control buttons and status row are removed')
      assert.equal(await js(`(()=>{const panel=${activePanel},button=panel.querySelector('${control}');return !!button.closest('.browser-address-bar')&&button.getAttribute('aria-label').startsWith('Agent：')})()`),true,'The accessible Agent icon stays inside the address field')
      assert.equal(await js(`(()=>{const button=${activePanel}.querySelector('.browser-annotation-toggle');return !!button?.querySelector('.app-icon')&&button.querySelector('span')?.textContent==='批注'&&button.getAttribute('aria-pressed')==='false'&&!button.disabled})()`),true,'The current annotation toggle combines its icon, label and unarmed state')
      const scale=await js('devicePixelRatio')
      assert.ok(Math.abs(parseFloat(initial.border)-2)<1/scale,'The fixed 2 CSS-pixel border may round to a device pixel')
      await capture('02-browser-ready')

      for(const method of ['right','keyboard','arrow'] as const){await openAgent(method);assert.deepEqual(await geometry(),initial);await closeAgent()}
      const beforeLongPress=commands.length
      await js(`(()=>{const button=${activePanel}.querySelector('${control}'),r=button.getBoundingClientRect();button.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',pointerId:42,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}))})()`)
      await until(()=>panelVisible(),'touch long press opens Agent details')
      await js(`(()=>{const button=${activePanel}.querySelector('${control}');button.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',pointerId:42,button:0,bubbles:true}));button.click()})()`)
      assert.equal(commands.length,beforeLongPress,'The click following a touch long press never toggles ownership')
      await closeAgent()
      await js(`(()=>{const input=${activePanel}.querySelector('[aria-label="浏览器地址"]');input.focus();input.value='https://example.invalid/未提交的地址';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(8,15)})()`)
      const draft=await js(`(()=>{const input=${activePanel}.querySelector('[aria-label="浏览器地址"]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd}})()`)
      await openAgent();await closeAgent()
      assert.deepEqual(await js(`(()=>{const input=${activePanel}.querySelector('[aria-label="浏览器地址"]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd}})()`),draft,'Opening Agent details preserves the address draft and selection')
      assert.equal(guest.getURL(),url,'The unsubmitted address never navigates')
      checks.push('single-row-toolbar-no-legacy-status','agent-icon-inside-address','annotation-icon-and-label-toggle','right-click-does-not-toggle','keyboard-menu-opens-once','touch-long-press-suppresses-followup-click','address-draft-and-selection-preserved')

      const beforeAnnotation=(await state()).automation.owner
      await click('.browser-annotation-toggle')
      await until(()=>state().then(page=>page.annotationSelecting&&page.automation.owner==='user'&&page.automation.nativeConfirmed&&!page.automation.inputProtected&&!page.automation.isolateInput&&!page.automation.keepRendering),'annotation toggle arms manual selection with native input released')
      assert.equal(await js(`!!${activePanel}.querySelector('.browser-annotation-toggle[aria-pressed="true"]')`),true,'Annotation selection is reflected by the same toolbar toggle')
      assert.equal(await js(`!!${activePanel}.querySelector('${control}')?.checkVisibility()`),true,'Selecting an annotation keeps the Agent entry visible')
      await openAgent();await closeAgent()
      assert.equal((await state()).annotationSelecting,true,'Esc closes only the Agent panel, leaving annotation selection active')
      await click('.browser-annotation-toggle')
      await until(()=>state().then(page=>!page.annotationSelecting&&page.automation.owner===beforeAnnotation&&page.automation.nativeConfirmed),'same annotation toggle exits selection and restores prior ownership')
      assert.equal(await js(`!!${activePanel}.querySelector('.browser-annotation-toggle[aria-pressed="false"]')`),true,'Explicit cancellation disarms the current annotation toggle')
      await until(async()=>JSON.stringify(await geometry())===JSON.stringify(initial),'viewport restored after closing annotations')
      checks.push('annotation-toggle-arms-manual-input-without-AI-isolation','annotation-selection-keeps-agent-entry','agent-escape-does-not-cancel-annotation','same-annotation-toggle-restores-ownership-and-viewport')

      await controller.run({runId:'ui-task-ownership',label:'工具间控制权验收'},async()=>{})
      await until(()=>state().then(page=>page.automation.inputProtected&&page.automation.activity==='waiting'),'task retains protection between tools')
      assert.equal(controller.snapshot().cursorEnabled,false,'A task without native pointer input has no initial cursor')
      const hoverEpoch=controller.captureEpoch()
      guest.emit('before-mouse-event' as never,{} as never,{type:'mouseMove'} as never)
      guest.emit('before-mouse-event' as never,{} as never,{type:'mouseEnter'} as never)
      await wait(100)
      assert.equal(controller.captureEpoch(),hoverEpoch,'Hover cannot invalidate the task')
      assert.equal(controller.snapshot().owner,'ai')
      await js('window.navora.config.save({browser:{automation:{show_virtual_cursor:false}}})')
      await until(()=>state().then(page=>page.automation.cursorVisible===false&&page.automation.inputProtected&&!page.automation.cursorEnabled&&page.automation.isolateInput&&page.automation.keepRendering),'hidden native cursor preserves task isolation and input protection')
      await controller.run({runId:'ui-task-ownership'},operation=>operation.commit(()=>dispatchPointerMotion(guest,{action:'move',to:{x:45,y:45}})))
      assert.equal(controller.snapshot().cursorPositionValid,true)
      assert.equal(controller.snapshot().cursorEnabled,false,'An acknowledged pointer cannot override the hidden preference')
      await openAgent();await capture('03-task-cursor-hidden');await closeAgent()
      await js('window.navora.config.save({browser:{automation:{show_virtual_cursor:true,cursor_style:"precision-cross"}}})')
      await until(()=>state().then(page=>page.automation.cursorEnabled&&page.automation.cursorPositionValid&&page.automation.cursorVisible===undefined&&page.automation.cursorStyle==='precision-cross'&&page.automation.inputProtected),'native cursor style changes without claiming physical screen visibility')
      await controller.finishRun('stale-task')
      assert.equal(controller.snapshot().inputProtected,true)
      await controller.finishRun('ui-task-ownership')
      await until(()=>state().then(page=>page.automation.nativeConfirmed&&!page.automation.inputProtected&&!page.automation.cursorEnabled&&!page.automation.isolateInput&&!page.automation.keepRendering),'matching task finish confirms full native release')
      checks.push('whole-task-input-protection-between-tools','hover-does-not-handoff-task','cursor-off-keeps-native-isolation-and-input-protection','native-style-hot-apply-keeps-lease','stale-task-cannot-release-current-page','task-completion-releases-protection')
      checks.push('cursor-hidden-before-first-native-pointer','native-enabled-is-not-screen-visibility')
      await controller.run({runId:'ui-task-motion'},operation=>operation.commit(()=>dispatchPointerMotion(guest,{action:'move',to:{x:45,y:45}})))
      const movement=controller.run({runId:'ui-task-motion',label:'AI 正在移动光标'},async operation=>operation.commit(()=>dispatchPointerMotion(guest,{action:'move',from:{x:45,y:45},to:{x:340,y:190},motion:{durationMs:5000},signal:operation.signal}))).catch(error=>({error:String(error)}))
      await until(()=>state().then(page=>page.automation.activity==='acting'),'acting feedback')
      assert.equal(await js(`(()=>{const el=${activePanel}.querySelector('${control}');return !el.disabled&&el.getAttribute('aria-pressed')==='true'})()`),true,'Takeover stays available while AI input is active')
      const beforePanel=controller.snapshot()
      const previewsBeforeDetails=previewRequests
      hangPreview=true;await openAgent()
      if(nativePanel()){
        await until(()=>state().then(page=>page.visible),'Native Agent details preserve the live webpage')
        assert.equal(previewRequests,previewsBeforeDetails,'Native details do not request a frozen page preview')
      }else await until(()=>state().then(page=>!page.visible),'The compatibility overlay hides the native view without waiting for the preview')
      assert.equal(controller.snapshot().owner,beforePanel.owner)
      assert.equal(controller.snapshot().inputProtected,beforePanel.inputProtected,'Inspecting the Agent panel does not release input protection')
      assert.equal(controller.snapshot().isolateInput,beforePanel.isolateInput,'Inspecting details preserves virtual focus isolation')
      assert.equal(controller.snapshot().keepRendering,beforePanel.keepRendering,'Inspecting details preserves the long-lived rendering lease')
      assert.deepEqual(await geometry(),initial,'Opening details never changes the native viewport rectangle')
      await closeAgent();hangPreview=false;previewResolvers.splice(0).forEach(resolve=>resolve(null))
      await until(()=>state().then(page=>page.visible),'The native view restores without waiting for the preview')
      await capture('03-ai-moving')
      await click(control)
      await movement
      await until(()=>state().then(page=>page.automation.owner==='user'&&page.automation.nativeConfirmed&&!page.automation.nativePending&&!page.automation.inputProtected&&!page.automation.isolateInput&&!page.automation.keepRendering),'manual control confirms full native release')
      assert.deepEqual(await geometry(),initial,'Control feedback never changes the native viewport bounds')
      await capture('04-user-control')
      await click(control)
      await until(()=>state().then(page=>page.automation.owner==='ai'&&page.automation.needsObservation),'resumed with observation required')
      assert.equal(await js('window.navora.agent.isRunning("chat_automation_ui")'),false,'Resume does not start a chat run')
      await openAgent();await panelAction('暂停')
      await until(()=>state().then(page=>page.automation.owner==='paused'),'page automation paused')
      await closeAgent()
      assert.deepEqual(await geometry(),initial)
      await capture('05-browser-paused')
      await click(control)
      await until(()=>state().then(page=>page.automation.owner==='ai'),'page automation allowed')
      checks.push('fixed-frame-without-status-row','takeover-during-motion','native-view-does-not-shift','resume-needs-new-observation','resume-does-not-start-agent','paused-primary-click-resumes','pending-preview-never-blocks-panel','details-preserve-native-input-protection')

      let finishSubmitted!:()=>void
      const submitted=controller.run({label:'等待已经提交的原生输入'},operation=>operation.commit(()=>new Promise<void>(resolve=>{finishSubmitted=resolve}))).catch(error=>({error:String(error)}))
      await until(()=>Promise.resolve(typeof finishSubmitted==='function'),'submitted native work')
      await click(control)
      await until(()=>state().then(page=>page.automation.activity==='handoff'),'handoff state')
      const count=commands.length
      await click(control);assert.equal(commands.length,count,'Repeated primary clicks do not enqueue another handoff')
      await openAgent()
      if(nativePanel())assert.ok(panelNodes(nativePanel()!.request.content).some(node=>node.id==='agent-primary'),'The native details keep the primary control available during handoff')
      else assert.equal(await js(`document.querySelector('${agentPanel}').getAttribute('role')`),'dialog')
      assert.equal(controller.snapshot().owner,'ai','Handoff does not claim manual control before the submitted work settles')
      finishSubmitted();await submitted
      await until(()=>state().then(page=>page.automation.owner==='user'),'handoff settles before manual state')
      await closeAgent();await click(control)
      await until(()=>state().then(page=>page.automation.owner==='ai'),'allow AI after handoff')
      checks.push('handoff-details-stay-accessible','handoff-waits-for-native-ack','duplicate-toggle-suppressed')

      const nativeApi=guest as unknown as {resetAutomationOptions:()=>Promise<void>}
      const resetOptions=nativeApi.resetAutomationOptions
      nativeApi.resetAutomationOptions=async()=>{throw Error('UI fixture: release not confirmed')}
      try{
        await openAgent();await panelAction('暂停')
        await until(()=>state().then(page=>page.automation.error==='release_unconfirmed'&&!page.automation.nativeConfirmed),'release failure transported')
        await closeAgent();await click(control)
        await until(()=>panelVisible(),'Fault primary click opens recovery details')
        assert.equal(controller.snapshot().owner,'paused','Unconfirmed release never pretends manual control is ready')
        assert.equal(await js(`document.querySelector('${control}').disabled`),false,'A fault does not disable the details entry')
        assert.deepEqual(await geometry(),initial)
        await capture('06-release-unconfirmed')
      }finally{nativeApi.resetAutomationOptions=resetOptions}
      const inputEvents=await guest.executeJavaScript('window.inputEvents')
      await panelAction('重试解除控制')
      await until(()=>state().then(page=>page.automation.nativeConfirmed&&page.automation.owner==='paused'&&!page.automation.error),'release retry confirmed')
      assert.equal(await guest.executeJavaScript('window.inputEvents'),inputEvents,'Retrying release cannot replay pointer input')
      await panelAction('允许 AI 操作');await closeAgent()
      await until(()=>state().then(page=>page.automation.owner==='ai'),'allow new actions after release retry')
      checks.push('unconfirmed-release-keeps-control-blocked','release-retry-never-replays-input')

      const oldDocument=controller.captureDocumentEpoch()
      await controller.run({label:'输入清理失败验收'},async operation=>{operation.registerCleanup(async()=>{throw Error('UI fixture: cleanup not confirmed')})}).catch(()=>{})
      await until(()=>state().then(page=>page.automation.error==='cleanup_unconfirmed'&&page.automation.nativeConfirmed&&!page.automation.inputProtected),'cleanup failure with confirmed native unlock')
      assert.equal(controller.captureDocumentEpoch(),oldDocument,'A cleanup fault never reloads the document by itself')
      await click(control)
      await until(()=>panelVisible(),'cleanup recovery details')
      assert.equal((await agentText()).includes('未保存'),true,'Reload recovery explains potential loss of unsaved edits')
      await panelAction('重新加载页面')
      await until(()=>state().then(page=>page.automation.error!=='cleanup_unconfirmed'&&page.automation.documentEpoch>oldDocument&&!page.loading),'a committed reload clears the old cleanup fault')
      await closeAgent();await click(control)
      await until(()=>state().then(page=>page.automation.owner==='ai'&&page.automation.needsObservation),'AI can be allowed only after cleanup recovery navigation')
      checks.push('cleanup-fault-does-not-auto-reload','cleanup-recovery-explains-unsaved-data','committed-reload-unblocks-explicit-resume')
      console.log('[browser-automation-ui] Agent controls, annotation, native handoff and recovery passed')

      downloadFixture=true;pushDownloads([])
      await until(()=>downloadState().then(value=>!value.visible),'empty download entry hidden')
      pushDownloads([download('other1',20,100,'started',otherChat)])
      await wait(100);assert.equal((await downloadState()).visible,false,'Other-chat updates do not reveal this page download entry')
      pushDownloads([download('first1',50,100),download('other1',20,100,'started',otherChat)])
      await until(()=>downloadState().then(value=>value.visible&&Number(value.progress)===50),'first download appears from the retained subscription')
      assert.equal((await downloadState()).badge,false,'Download count is not a persistent badge')
      assert.deepEqual(await geometry(),initial,'Download entry appearing does not change the viewport')
      pushDownloads([download('first1',50,100),download('second2',900,900)])
      await until(()=>downloadState().then(value=>Number(value.progress)===95),'downloads use weighted byte progress')
      pushDownloads([download('almost2',100,100)])
      await until(()=>downloadState().then(value=>Number(value.progress)===99),'received bytes cannot report completion before the terminal event')
      pushDownloads([download('zero4',0,0)])
      await until(()=>downloadState().then(value=>value.unknown),'zero-sized active download has no false percentage')
      pushDownloads([download('first1',50,100),download('unknown3',20,undefined)])
      await until(()=>downloadState().then(value=>value.unknown),'unknown-size task switches to an indeterminate ring')
      pushDownloads([download('first1',50,100,'paused'),download('unknown3',20,undefined,'paused')])
      await until(()=>downloadState().then(value=>value.unknown&&value.animation==='none'),'all-paused downloads stop the unknown-size animation')
      pushDownloads([download('first1',100,100,'completed')])
      await until(()=>downloadState().then(value=>value.visible&&!value.unknown),'completed download remains accessible')
      delayDownloadList=true
      await click(downloadTrigger)
      await until(()=>Promise.resolve(!!releaseDownloadList),'download snapshot request is delayed')
      pushDownloads([])
      await until(()=>downloadState().then(value=>!value.visible),'cleared records hide the entry during an old list request')
      releaseDownloadList!();releaseDownloadList=undefined;await wait(150)
      assert.equal((await downloadState()).visible,false,'A late same-chat snapshot cannot resurrect cleared records')
      pushDownloads([download('first1',100,100,'completed')])
      await until(()=>downloadState().then(value=>value.visible),'download entry reappears before clear action')
      await click(downloadTrigger)
      await until(()=>panelVisible('downloads-root'),'download panel')
      await panelAction('清除记录',win,'downloads-root')
      await until(()=>downloadState().then(value=>!value.visible),'clearing the final record hides the entry')
      await until(async()=>!await panelVisible('downloads-root'),'clearing the final record closes the panel')
      assert.deepEqual(await geometry(),initial)
      checks.push('empty-download-hidden-subscription-retained','other-chat-download-isolated','first-download-auto-shows','download-byte-weighted-progress','active-download-capped-at-99-percent','zero-size-download-has-no-false-percentage','unknown-size-ring','paused-ring-stops','completed-download-retained','late-same-chat-snapshot-cannot-resurrect-records','clearing-last-download-hides-and-closes','download-entry-does-not-resize-page')
      console.log('[browser-automation-ui] download visibility, progress and late snapshots passed')

      // Use the production tab service, never renderer-only list mutations.
      const second=await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'new',pageId:${JSON.stringify(pageId)},url:${JSON.stringify(url+'second')}})`)
      const secondId=second.pageId as string
      await until(()=>js(`window.navora.browser.workspace.state().then(state=>state.pages.flatMap(s=>s.windows).some(page=>page.windowId===${JSON.stringify(secondId)}&&page.hostActive))`),'new tab becomes active')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'activate',pageId:${JSON.stringify(pageId)}})`)
      await until(()=>state().then(page=>page.hostActive),'return to the original tab')
      await openAgent()
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'activate',pageId:${JSON.stringify(secondId)}})`)
      await until(async()=>!await panelVisible(),'switching tabs closes the old Agent panel')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'activate',pageId:${JSON.stringify(pageId)}})`)
      await until(()=>state().then(page=>page.hostActive),'original active before multiselect')
      await js(`(()=>{const tab=document.querySelector('[role="tab"][data-page-id="'+${JSON.stringify(secondId)}+'"]');if(!tab)throw Error('Second browser tab not rendered');tab.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))})()`)
      await click(control)
      await until(()=>state().then(page=>page.automation.owner==='user'),'current page takeover with multiple tabs selected')
      assert.equal((await state(secondId)).automation.owner,'ai','Tag selection never expands a single-page Agent control command')
      const copied=await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'duplicate',pageId:${JSON.stringify(pageId)}})`)
      assert.notEqual(copied.pageId,pageId)
      await until(()=>state(copied.pageId).then(page=>page?.automation.owner==='ai'),'duplicate owns a fresh controller')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'close',pageId:${JSON.stringify(copied.pageId)}})`)
      const restored=await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'reopen'})`)
      assert.notEqual(restored.pageId,copied.pageId)
      await until(()=>state(restored.pageId).then(page=>page?.automation.owner==='ai'),'reopened page does not inherit the old control state')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'activate',pageId:${JSON.stringify(pageId)}})`)
      await until(()=>state().then(page=>page.hostActive),'original page before pin changes')
      await openAgent()
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'setPinned',pageId:${JSON.stringify(pageId)},value:true});window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'setMuted',pageId:${JSON.stringify(pageId)},value:false})`)
      assert.equal(await panelVisible(),true,'Ordinary pin/audio tree updates keep the current panel')
      assert.equal((await state()).automation.owner,'user')
      await closeAgent()
      checks.push('tab-switch-closes-source-panel','multiselect-does-not-expand-control','duplicate-has-fresh-control-state','reopen-has-new-page-identity','pin-and-audio-updates-retain-panel')
      console.log('[browser-automation-ui] tab identities, selection, duplication and reopen passed')

      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chatId)},action:'detach',pageId:${JSON.stringify(pageId)}})`)
      await until(()=>Promise.resolve(BrowserWindow.getAllWindows().some(w=>w!==win&&w.webContents.getURL().includes('browser-host'))),'detached browser host')
      const host=BrowserWindow.getAllWindows().find(w=>w!==win&&w.webContents.getURL().includes('browser-host'))!
      await until(()=>host.webContents.executeJavaScript(`!!document.querySelector('${control}')`),'detached Agent icon')
      await until(()=>host.webContents.executeJavaScript('window.navora.browser.workspace.state().then(state=>state.pages.flatMap(session=>session.windows).some(page=>page.visible))'),'detached native page visible')
      assert.equal((await state(pageId,host)).automation.owner,'user','A host transfer preserves the controller owner')
      await openAgent('right',host);await closeAgent(host)
      await capture('07-detached-browser',host)
      // Detached hosts currently enforce a 500 DIP minimum width; exercise
      // their supported narrow size instead of assuming a mobile-sized host.
      const minimumHostSize=host.getMinimumSize()
      host.setContentSize(Math.max(390,minimumHostSize[0]),700);await wait(200)
      assert.equal((await geometry(host)).statusPresent,false)
      assert.equal(await host.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('${control}')].find(el=>el.checkVisibility());if(!button)return false;const rect=button.getBoundingClientRect();return rect.x>=0&&rect.right<=innerWidth})()`),true)
      const narrowAnnotation=await host.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.browser-annotation-toggle')].find(el=>el.checkVisibility());if(!button)return null;return {iconVisible:!!button.querySelector('.app-icon')?.checkVisibility(),labelVisible:!!button.querySelector('span')?.checkVisibility(),label:button.querySelector('span')?.textContent,rect:button.getBoundingClientRect().toJSON(),panelWidth:button.closest('.browser-tab-panel').getBoundingClientRect().width,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`)
      assert.ok(narrowAnnotation?.iconVisible,'The visible annotation entry retains its icon at the supported minimum host width')
      assert.ok(narrowAnnotation.rect.x>=0&&narrowAnnotation.rect.right<=narrowAnnotation.viewportWidth&&narrowAnnotation.rect.y>=0&&narrowAnnotation.rect.bottom<=narrowAnnotation.viewportHeight,'The visible annotation entry stays inside the supported narrow host')
      if(narrowAnnotation.panelWidth<=420)assert.equal(narrowAnnotation.labelVisible,false,'The current compact container rule hides the annotation label below 420 CSS pixels')
      else if(narrowAnnotation.labelVisible)assert.equal(narrowAnnotation.label,'批注','The current wider toolbar can retain its annotation label')
      await openAgent('keyboard',host)
      const narrowNative=nativePanel('agent-root',host)
      if(narrowNative){
        const bounds=await host.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})'),anchor=narrowNative.request.anchor
        assert.ok(anchor.x>=0&&anchor.y>=0&&anchor.x+anchor.width<=bounds.width&&anchor.y+anchor.height<=bounds.height,'The native Agent panel retains a valid anchor inside the narrow host')
        assert.ok(panelNodes(narrowNative.request.content).some(node=>node.id==='agent-primary'),'The narrow native panel retains its primary ownership action')
        assert.equal(await host.webContents.executeJavaScript(`!!document.querySelector('${agentPanel}')`),false,'Native details do not create a duplicate DOM panel')
      }else assert.equal(await host.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('${agentPanel}').getBoundingClientRect();return rect.x>=0&&rect.right<=innerWidth&&rect.y>=0&&rect.bottom<=innerHeight})()`),true,'The compatibility Agent panel fits a narrow host')
      await capture('08-narrow-browser',host)
      await closeAgent(host)
      checks.push('detached-control-state','narrow-viewport-keeps-takeover','minimum-host-width-preserves-visible-annotation-entry')
      const beforeZoom=await geometry(host)
      await host.webContents.executeJavaScript(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'zoom',1.25)`)
      await until(()=>state(pageId,host).then(page=>page.zoomFactor===1.25),'125% guest zoom')
      assert.deepEqual(await geometry(host),beforeZoom,'Guest zoom does not resize the host viewport or toolbar')
      await openAgent('arrow',host);await closeAgent(host)
      await host.webContents.executeJavaScript(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'zoom',1)`)
      await until(()=>state(pageId,host).then(page=>page.zoomFactor===1),'guest zoom restored')
      checks.push('web-zoom-125-keeps-host-viewport')
      for(const mode of ['light','dark'] as const)for(const theme of APPEARANCE_THEMES){
        await js(`window.navora.config.save({app:{appearance_mode:${JSON.stringify(mode)},appearance_theme:${JSON.stringify(theme.id)}}})`)
        await until(()=>host.webContents.executeJavaScript(`document.documentElement.dataset.navoraTheme===${JSON.stringify(theme.id)}&&document.documentElement.dataset.navoraColorScheme===${JSON.stringify(mode)}`),'detached theme '+theme.id+' '+mode)
        await openAgent('right',host)
        const themedNative=nativePanel('agent-root',host)
        const colors=themedNative?{button:await host.webContents.executeJavaScript(`getComputedStyle(document.querySelector('${control}')).color`),panel:themedNative.request.theme?.background}:await host.webContents.executeJavaScript(`(()=>{const button=document.querySelector('${control}'),panel=document.querySelector('${agentPanel}');return {button:getComputedStyle(button).color,panel:getComputedStyle(panel).backgroundColor}})()`)
        assert.ok(colors.panel,'The actual panel receives a background for the current theme')
        assert.notEqual(colors.button,'rgba(0, 0, 0, 0)');assert.notEqual(colors.panel,'rgba(0, 0, 0, 0)')
        await closeAgent(host)
      }
      await openAgent('right',host);await capture('09-agent-dark-theme',host);await closeAgent(host)
      checks.push('all-project-themes-light-dark-and-detached')
      assert.deepEqual(errors.filter(message=>!/ERR_CONNECTION_REFUSED|ERR_FILE_NOT_FOUND|UI fixture: release not confirmed|release_unconfirmed/.test(message)),[],'No unexpected renderer errors')
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,initial,displayScale:scale,patches,commands,errors,previewRequests,downloadFixture:true,narrowHost:{minimumSize:minimumHostSize,annotation:narrowAnnotation},nativePanels:[...nativePanels.values()].map(({senderId,request,open})=>({senderId,root:request.content.id,open,theme:request.theme,anchor:request.anchor})),boundaries:['Native panels use the actual runtime instances, trees, IPC and business handlers with focusMode:none. Action and Escape dismissal events are injected; physical native keyboard/mouse interaction is unverified.','For native panels the narrow-host check validates the source anchor and retained ownership action. Actual native popup bounds are managed by the runtime and are not exposed by this API.'],screenshotComposition:'Browser previews combine original host captures (-host.png) with actual native child frame captures. Native popup windows and virtual cursor pixels are not verified by these composed captures.'},null,2))
      console.log('Browser automation UI checks passed: '+checks.length)
      app.exit(0)
    }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failure-state.json'),JSON.stringify({error:String(error),state:await state().catch(()=>undefined),dom:await js(`({owner:${activePanel}?.dataset.controlOwner,panel:document.querySelector('${agentPanel}')?.textContent,control:${activePanel}?.querySelector('${control}')?.outerHTML,downloads:[...document.querySelectorAll('.browser-downloads-trigger')].find(el=>el.checkVisibility())?.outerHTML,annotation:${activePanel}?.querySelector('.browser-annotation-toggle')?.outerHTML,focused:document.activeElement?.outerHTML,draft:${activePanel}?.querySelector('[aria-label="浏览器地址"]')?.value,suggestions:!!document.querySelector('.browser-address-suggestions'),chrome:window.automationChromeEvents,clicks:window.automationPrimaryClicks})`).catch(()=>undefined),nativePanels:[...nativePanels.values()].map(({senderId,request,open})=>({senderId,request,open})),commands,patches,errors},null,2));await capture('failure').catch(()=>{});app.exit(1)}
    finally{server.close()}
  })())
})
await import('../electron/main')
