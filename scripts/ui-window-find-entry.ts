import {app,BrowserWindow,NativePanel,WebContentsView,ipcMain,screen,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'
const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_window_find_fixture'
if(!profile||!path.isAbsolute(profile))throw Error('An isolated profile is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.appearance_mode='light';config.remote.enabled=false;config.ai.providers=[];config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'))
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'搜索界面检查',createdAt:Date.now(),updatedAt:Date.now(),messages:[{id:'find-user',role:'user',content:'请核对 keyword 对应的资料。',createdAt:Date.now()-1000},{id:'find-answer',role:'assistant',content:'## 查找资料\n\n这里是 **keyword**，正文还有一个 keyword。\n\n[预览资料](fixture.md)',createdAt:Date.now()}]}))
fs.mkdirSync(path.join(config.files.custom_root,chat),{recursive:true});fs.writeFileSync(path.join(config.files.custom_root,chat,'fixture.md'),'# 工作区资料\n\nMarkdown keyword 第一处。\n\n第二处 keyword。')
const showInactive=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);showInactive.call(this)};BrowserWindow.prototype.focus=function(){}
let panel:NativePanel|undefined,request:NativePanelShow|undefined,guestId=0,hiddenCalls=0,previewRequests=0,findContentUpdates=0
const panels=new Map<string,NativePanel>(),requests=new Map<string,NativePanelShow>(),sessions=new Map<string,string>(),checks:string[]=[],errors:string[]=[],observations:unknown[]=[],liveInputValues:unknown[]=[]
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){request=structuredClone(args[0]);requests.set(args[0].id,request!)}
  if(channel==='navora:native-ui.update'){const current=requests.get(args[0]);if(current){if(args[2]?.content){if(current.content.id==='window-find'){findContentUpdates++;const query=nodes(args[2].content).find(node=>node.id==='find-query');if(query&&'value' in query)liveInputValues.push(query.value)}current.content=structuredClone(args[2].content)}if(args[2]?.anchor)current.anchor=structuredClone(args[2].anchor);if(args[2]?.icons)current.icons=structuredClone(args[2].icons)}}
  if(channel==='navora:browser.workspace.preview')previewRequests++
  const result=await listener(event,...args)
  if(channel==='navora:native-ui.show'&&result?.session)sessions.set(args[0].id,result.session)
  return result
})
const nativeShow=NativePanel.prototype.show,observedPanels=new WeakSet<NativePanel>()
NativePanel.prototype.show=function(options){if(!observedPanels.has(this)){observedPanels.add(this);const id=request?.id;this.on('dismissed',details=>observations.push({phase:'native-panel-dismissed',id,reason:details.reason}));this.on('closed',()=>observations.push({phase:'native-panel-closed',id}))}nativeShow.call(this,options);panel=this;if(request)panels.set(request.id,this)}
const setVisible=WebContentsView.prototype.setVisible
WebContentsView.prototype.setVisible=function(visible){if(this.webContents.id===guestId&&!visible)hiddenCalls++;setVisible.call(this,visible)}
const local=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>网页查找检查</title><h1>网页保持实时显示</h1><p>keyword first keyword second</p><input value="未保存的网页草稿"><script>window.framesPainted=0;window.identity=crypto.randomUUID();function tick(){window.framesPainted++;requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile)
async function until(check:()=>Promise<unknown>|unknown,label:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
const nodes=(root:NativePanelContent):NativePanelContent[]=>[root,...(root.children||[]).flatMap(nodes)]
const diagnostic=(target=panel)=>{assert.ok(target);return (target as unknown as {_getState():any})._getState()}
async function capture(name:string){
  for(let attempt=0;attempt<3;attempt++){
    await wait(attempt?250:180);const state=diagnostic();fs.writeFileSync(path.join(output,name+'-state.json'),JSON.stringify(state,null,2))
    try{
      const imagePath=path.join(output,name+'.png'),capture=await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',imagePath],{windowsHide:true,timeout:15000})
      const measured=await run('python',['-c',`import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\ncolor=tuple(bytes.fromhex(sys.argv[2].lstrip('#'))[:3])\npoints=[(x,y) for y in range(im.height) for x in range(im.width) if max(abs(a-b) for a,b in zip(im.getpixel((x,y)),color))<=2]\nbounds=None if not points else {'x':min(x for x,y in points),'y':min(y for x,y in points),'width':max(x for x,y in points)-min(x for x,y in points)+1,'height':max(y for x,y in points)-min(y for x,y in points)+1}\nprint(json.dumps({'imageWidth':im.width,'imageHeight':im.height,'coloredSurfaceBounds':bounds,'surfaceColor':sys.argv[2]}))`,imagePath,state.theme.background],{windowsHide:true,timeout:15000})
      const metrics={name,capture:JSON.parse(capture.stdout),pixels:JSON.parse(measured.stdout),native:{bounds:state.bounds,contentBounds:state.contentBounds,contentHeight:state.contentHeight,viewportHeight:state.viewportHeight,shadowVisible:state.shadowVisible,query:state.controls.find((item:any)=>item.id==='find-query')?.bounds,main:state.controls.find((item:any)=>item.id==='find-main')?.bounds}}
      fs.writeFileSync(path.join(output,name+'-measurement.json'),JSON.stringify(metrics,null,2));observations.push(metrics);return
    }
    catch(error){if(attempt===2||!String((error as {stdout?:string}).stdout).includes('uniform compositor surface'))throw error}
  }
}
async function input(args:string[]){const state=diagnostic();await run('python',[path.join(project,'scripts/native-panel-test-input.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),...args],{windowsHide:true,timeout:12000})}
function clickNative(id:string){assert.ok(request&&nodes(request.content).some(node=>node.id===id&&!node.disabled),id);panel!.emit('action',{id,type:'click'})}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const click=(selector:string)=>js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click()})()`)
    const findRequest=()=>[...requests.values()].find(item=>item.content.id==='window-find')
    const compactRequest=(twoScopes=false,current=findRequest()!)=>{
      assert.equal(current.contentInset,8);assert.equal(current.radius,20);assert.equal((current as NativePanelShow&{shadow?:boolean}).shadow,false)
      const all=nodes(current.content);assert.equal(all.find(node=>node.id==='find-main')?.height,28);assert.equal(all.find(node=>node.id==='find-query')?.height,28)
      const scopes=all.filter(node=>node.id.startsWith('find-scope-'));assert.equal(scopes.length,twoScopes?2:0);for(const scope of scopes)assert.equal(scope.style?.background,undefined,'Scope controls stay unfilled')
      const buttonImages=all.filter(node=>node.type==='iconButton'&&node.icon).map(node=>{const image=current.icons?.[node.icon!];assert.ok(image&&typeof image==='object','Find button images carry explicit logical size');assert.equal(image.logicalSize,20);const pixelWidth=Buffer.from(image.dataUrl.slice(22),'base64').readUInt32BE(16);assert.ok(pixelWidth>=20);return{id:node.id,logicalSize:image.logicalSize,pixelWidth}})
      const state=diagnostic(),root=state.controls.find((item:any)=>item.id==='window-find').bounds
      assert.equal(state.shadowVisible,false)
      for(const control of state.controls){if(control.id==='window-find')continue;const b=control.bounds;assert.ok(b.x>=root.x&&b.y>=root.y&&b.x+b.width<=root.x+root.width+1&&b.y+b.height<=root.y+root.height+1,`${control.id} stays inside native content`)}
      observations.push({phase:twoScopes?'two-scopes':'single-scope',request:{contentInset:current.contentInset,radius:current.radius,shadow:(current as NativePanelShow&{shadow?:boolean}).shadow,mainHeight:all.find(node=>node.id==='find-main')?.height,inputHeight:all.find(node=>node.id==='find-query')?.height,buttonImages},native:{root,query:state.controls.find((item:any)=>item.id==='find-query')?.bounds,contentHeight:state.contentHeight,shadowVisible:state.shadowVisible}})
    }
    try{
      win.setContentSize(1440,920);await until(()=>js('!!document.querySelector(".composer-box")'),'main application')
      const sidebar=await js('document.querySelector(".shell").className')
      await click('button[aria-label="在当前聊天中查找"]');await until(()=>request?.content.id==='window-find'&&diagnostic().visible,'current chat native search')
      assert.equal(request!.dismissOnOutsideClick,false);assert.equal(diagnostic().focusedId,'find-query');assert.equal(await js('document.querySelector(".shell").className'),sidebar)
      assert.equal(findRequest()!.anchor.y,22);checks.push('current-content-search-starts-halfway-down-44px-titlebar')
      compactRequest();await capture('01-chat-search-empty-light');checks.push('single-chat-scope-is-hidden-and-empty-search-requests-28px-input-8px-inset-no-shadow')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})');await until(()=>diagnostic().theme.mode==='dark','empty dark search theme');compactRequest();await capture('01a-chat-search-empty-dark')
      assert.equal(diagnostic().controls.find((item:any)=>item.id==='find-query').value,'');assert.equal(diagnostic().controls.find((item:any)=>item.id==='find-query').composing,false)
      await js('window.navora.config.save({app:{appearance_mode:"light"}})');await until(()=>diagnostic().theme.mode==='light','restore light search theme');checks.push('empty-light-and-dark-capsules-keep-native-input-lifecycle')
      // Capturing an off-screen HWND can outlast its OS activation. Explicitly
      // reopen through the public toolbar before exercising targeted typing.
      const emptyPanel=panel;await click('button[aria-label="在当前聊天中查找"]');await until(()=>panel!==emptyPanel&&diagnostic().focusedId==='find-query','refocus after offscreen capture')
      await input(['--text','资料']);await until(()=>diagnostic().controls.find((item:any)=>item.id==='find-query')?.value==='资料','native CJK text retained')
      await input(['--key','8']);await input(['--key','8']);await until(()=>diagnostic().controls.find((item:any)=>item.id==='find-query')?.value==='','clear native CJK query');checks.push('native-CJK-character-input-remains-editable')
      const cjkPanel=panel;await click('button[aria-label="在当前聊天中查找"]');await until(()=>panel!==cjkPanel&&diagnostic().focusedId==='find-query','fresh native typing session after CJK verification')
      await input(['--text','keyword']);await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 3 个结果'),'typed native query searches chat')
      assert.ok(await js('[...CSS.highlights].some(([name,ranges])=>name.endsWith("-active")&&ranges.size>0)'));compactRequest();await capture('02-chat-search-results-light');checks.push('Win32-text-messages-reach-first-input-and-highlight-rendered-chat')
      clickNative('find-options');await until(()=>diagnostic().controls.some((item:any)=>item.id==='find-settings'),'expanded native find options');compactRequest();await capture('02a-chat-search-options-light')
      const expandedState=diagnostic(),settingsBounds=expandedState.controls.find((item:any)=>item.id==='find-settings').bounds
      assert.ok(settingsBounds.y+settingsBounds.height<=expandedState.contentBounds.y+expandedState.contentBounds.height-7,'Expanded settings retain bottom breathing room')
      clickNative('find-options');await until(()=>!diagnostic().controls.some((item:any)=>item.id==='find-settings'),'collapse find options');checks.push('expanded-find-options-keep-visible-bottom-padding')
      if(process.env.NAVORA_FIND_SPACING_ONLY==='1'){
        assert.deepEqual(errors,[])
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,errors,scope:'Focused spacing review: actual Vue/preload/main and NativePanel with isolated synthetic chat. Empty light/dark, editable text, results and expanded settings; excludes later shortcut, browser and window lifecycle groups.'},null,2));local.closeAllConnections();app.exit(0);return
      }
      const resultsPanel=panel;await click('button[aria-label="在当前聊天中查找"]');await until(()=>panel!==resultsPanel&&diagnostic().focusedId==='find-query','refocus native Enter after capture')
      await input(['--key','13']);await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='2 / 3 个结果'),'native Enter navigates')
      win.webContents.focus();await js('document.querySelector(".composer-richtext").focus()');await wait(180);assert.equal(diagnostic().visible,true);assert.equal(diagnostic().controls.find((item:any)=>item.id==='find-query').value,'keyword');checks.push('focus-loss-keeps-search-card-and-query')
      const previous=panel;await click('button[aria-label="在当前聊天中查找"]');await until(()=>panel!==previous&&diagnostic().focusedId==='find-query','reopen refocus');checks.push('repeat-open-creates-fresh-public-input-session')
      clickNative('find-close');await until(()=>!diagnostic().visible,'close find')
      await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:find-fixture',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true)})()`)
      await until(()=>webContents.getAllWebContents().some(wc=>wc.getURL()===url&&!wc.isLoading()),'live local webpage')
      const guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;guestId=guest.id;guest.setBackgroundThrottling(false)
      const descendants=(view:Electron.View):Electron.View[]=>[view,...view.children.flatMap(descendants)]
      const view=descendants(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents.id===guest.id) as WebContentsView
      await until(()=>view.getVisible(),'visible webpage');await wait(250)
      const identity=await guest.executeJavaScript('window.identity'),frames=await guest.executeJavaScript('window.framesPainted'),bounds=view.getBounds(),count=webContents.getAllWebContents().length
      previewRequests=0;hiddenCalls=0
      guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']})
      await until(()=>request?.content.id==='window-find'&&diagnostic().visible,'guest Ctrl F native search');await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 2 个结果'),'workspace browser matches')
      compactRequest(true);await capture('03-workspace-browser-search-light');assert.equal(view.getVisible(),true);assert.deepEqual(view.getBounds(),bounds);assert.equal(await guest.executeJavaScript('window.identity'),identity);assert.ok(await guest.executeJavaScript('window.framesPainted')>frames);assert.equal(previewRequests,0);assert.equal(hiddenCalls,0);assert.equal(webContents.getAllWebContents().length,count)
      assert.equal(await js('document.querySelectorAll(".browser-frozen-frame,.browser-find-bar,.conversation-find").length'),0);observations.push({phase:'browser-search',previewRequests,hiddenCalls,guestId,bounds,webContents:count});checks.push('workspace-browser-search-keeps-original-view-live-without-capture-or-hide')
      guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'Escape'});guest.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(180);assert.equal(diagnostic().visible,true);checks.push('Escape-in-webpage-keeps-unfocused-search-card')
      clickNative('find-scope-chat');await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 3 个结果'),'scope chat results');clickNative('find-scope-workspace');await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 2 个结果'),'scope workspace results');checks.push('scope-switch-retains-query-and-replaces-results')
      await click('[aria-label="展开工作区"]');await until(()=>js('!document.querySelector(".composer").checkVisibility()'),'expanded workspace hides conversation')
      clickNative('find-scope-chat');await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 3 个结果'),'hidden chat scope')
      panel!.emit('action',{id:'find-query',type:'change',value:'keyword '});await wait(250);assert.equal(await js('document.querySelector(".composer").checkVisibility()'),false)
      panel!.emit('action',{id:'find-query',type:'change',value:'keyword'});await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 3 个结果'),'hidden chat query stats');assert.equal(await js('document.querySelector(".composer").checkVisibility()'),false)
      await js('(()=>{window.findTargetNavigation=[];const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){if(this.dataset?.msgId)window.findTargetNavigation.push(this.dataset.msgId);return original.apply(this,args)}})()')
      clickNative('find-next');await until(()=>js('document.querySelector(".composer").checkVisibility()'),'explicit result navigation reveals chat');await until(()=>js('window.findTargetNavigation.includes("find-answer")'),'revealed chat locates requested match');checks.push('hidden-chat-query-keeps-workspace-until-explicit-result-navigation')
      await click('.file-workspace [role=tab][data-page-id]');await click('[aria-label="收起工作区（恢复分栏）"]');clickNative('find-scope-workspace');await until(()=>nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 2 个结果'),'restored browser scope')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})');await until(()=>diagnostic().theme.mode==='dark','workspace dark search theme');compactRequest(true);await capture('04-workspace-browser-search-dark')
      const offscreenBounds=win.getBounds(),workArea=screen.getPrimaryDisplay().workArea
      win.setContentSize(1040,760);win.setPosition(workArea.x+Math.max(8,Math.floor((workArea.width-1040)/2)),workArea.y+Math.max(8,Math.floor((workArea.height-760)/2)));showInactive.call(win)
      await wait(400);const beforeRefocus=panel;guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});await until(()=>panel!==beforeRefocus&&diagnostic().focusedId==='find-query','onscreen fixture find refocus')
      await until(()=>diagnostic().bounds.x>workArea.x+10&&diagnostic().bounds.y>workArea.y+10,'unclamped native search placement');await wait(250)
      const restoredPanel=panel,restoredRequest=findRequest()!,session=sessions.get(restoredRequest.id),beforeCount=nodes(restoredRequest.content).find(node=>node.id==='find-count')?.text
      let beforeMinimize=diagnostic()
      const contentOrigin=win.getContentBounds(),zoom=win.webContents.getZoomFactor(),caption=await js('(()=>{const area=navigator.windowControlsOverlay?.getTitlebarAreaRect();return{width:innerWidth,controlsLeft:area&&area.width>0?area.x+area.width:innerWidth-138}})()')
      const anchorScreen={x:contentOrigin.x+restoredRequest.anchor.x*zoom,y:contentOrigin.y+restoredRequest.anchor.y*zoom},nativeRight=beforeMinimize.bounds.x+beforeMinimize.bounds.width,frameExtra=nativeRight-anchorScreen.x-restoredRequest.content.width!*zoom,captionGap=contentOrigin.x+caption.controlsLeft*zoom-nativeRight
      observations.push({phase:'unclamped-native-caption-clearance',owner:contentOrigin,viewport:caption,zoom,anchor:restoredRequest.anchor,anchorScreen,nativeAnchor:beforeMinimize.anchorBounds,nativeBounds:beforeMinimize.bounds,contentWidth:restoredRequest.content.width,measuredRightFrameExtra:frameExtra,measuredCaptionGap:captionGap})
      assert.ok(Math.abs(beforeMinimize.anchorBounds.x-anchorScreen.x)<=1,'Measured normal native anchor agrees with owner coordinates');assert.ok(captionGap>=20,'Normal native search clears caption controls')
      await capture('04b-local-search-unclamped-before-minimize-dark')
      beforeMinimize=diagnostic()
      const updatesBeforeRestore=findContentUpdates
      win.minimize();await until(()=>win.isMinimized(),'fixture owner minimized');await until(()=>!diagnostic().visible,'search hidden while fixture minimized')
      win.restore();showInactive.call(win);await until(()=>!win.isMinimized()&&diagnostic().visible,'fixture search restored');await wait(350)
      const afterMinimize=diagnostic();assert.equal(panel,restoredPanel,'Minimize/restore keeps the native instance');assert.equal(sessions.get(restoredRequest.id),session,'Minimize/restore keeps the IPC session');if(beforeMinimize.focusedId)assert.equal(afterMinimize.focusedId,beforeMinimize.focusedId,'Minimize/restore keeps the input focus state');assert.equal(afterMinimize.controls.find((item:any)=>item.id==='find-query').value,'keyword');assert.deepEqual(afterMinimize.controls.find((item:any)=>item.id==='find-query').selection,beforeMinimize.controls.find((item:any)=>item.id==='find-query').selection,'Minimize/restore keeps the input caret and selection');assert.equal(nodes(findRequest()!.content).find(node=>node.id==='find-count')?.text,beforeCount)
      assert.equal(findContentUpdates,updatesBeforeRestore,'Restore with unchanged local geometry does not resend the native control tree')
      observations.push({phase:'restore-content-refresh',before:updatesBeforeRestore,after:findContentUpdates});checks.push('restore-does-not-repaint-unchanged-find-content')
      for(const field of ['x','y','width','height'])assert.ok(Math.abs(afterMinimize.bounds[field]-beforeMinimize.bounds[field])<=2,`Restored native ${field} matches its previous placement`)
      assert.ok(afterMinimize.bounds.x>workArea.x+10&&afterMinimize.bounds.y>workArea.y+10,'Restored popup does not jump to work-area origin');assert.equal(await guest.executeJavaScript('window.identity'),identity);assert.ok(await guest.executeJavaScript('window.framesPainted')>frames)
      observations.push({phase:'minimize-restore',session,before:beforeMinimize.bounds,after:afterMinimize.bounds,query:afterMinimize.controls.find((item:any)=>item.id==='find-query').value,count:beforeCount,nativeInstancePreserved:panel===restoredPanel});await capture('04c-local-search-after-minimize-dark');checks.push('minimize-restore-preserves-native-instance-session-query-count-and-unclamped-placement')
      clickNative('find-close');await until(()=>!diagnostic().visible,'close before another minimize cycle');win.minimize();await until(()=>win.isMinimized(),'closed-search fixture minimized');win.restore();showInactive.call(win);await until(()=>!win.isMinimized(),'closed-search fixture restored');await wait(350);assert.equal(diagnostic().visible,false);checks.push('closed-search-is-not-reopened-by-minimize-restore')
      if(process.env.NAVORA_FIND_RESTORE_ONLY==='1'){
        assert.deepEqual(errors,[])
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,errors,scope:'Focused restore integration: actual Vue/preload/main/NativePanel with isolated chat and local webpage. Includes real minimize/restore, preserved input/session/position and no unchanged-content replay. Excludes subsequent fullscreen and native Escape groups.'},null,2));local.closeAllConnections();app.exit(0);return
      }
      win.setBounds(offscreenBounds);await wait(350);guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});await until(()=>diagnostic().visible&&diagnostic().controls.find((item:any)=>item.id==='find-query')?.value==='keyword','resume offscreen search after lifecycle verification')
      win.setContentSize(720,920);await wait(300);compactRequest(true);await capture('04a-local-search-narrow-dark');checks.push('two-unfilled-scope-controls-and-narrow-local-search-stay-inside-native-content');win.setContentSize(1440,920);await wait(300)
      const activePanel=panel;await js('window.navora.app.toggleFullscreen()');await until(()=>win.isFullScreen(),'window fullscreen');await wait(300);assert.equal(panel,activePanel);assert.equal(diagnostic().visible,true);assert.equal(findRequest()!.anchor.y,8);assert.equal(await guest.executeJavaScript('window.identity'),identity);await capture('05-search-fullscreen-dark');await js('window.navora.app.toggleFullscreen()');await until(()=>!win.isFullScreen(),'exit fullscreen');checks.push('window-fullscreen-keeps-native-search-and-page-identity')
      const escapePanel=panel;guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});await until(()=>panel!==escapePanel&&diagnostic().focusedId==='find-query','refocus native Escape after fullscreen capture')
      await input(['--key','27']);await until(()=>!diagnostic().visible,'native Escape closes');checks.push('native-Escape-closes-search')
      await js('[...document.querySelectorAll(".msg-md-content a")].find(el=>el.textContent.includes("预览资料")).click()')
      await until(()=>js('document.querySelector(".preview-markdown")?.textContent.includes("keyword")'),'workspace Markdown preview')
      const expanded=()=>js('document.querySelector(".main").classList.contains("workspace-single")')
      assert.equal(await expanded(),false)
      await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(expanded,'double click expands workspace')
      await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(async()=>!await expanded(),'double click restores split')
      await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").closest(".workspace-tab-item").querySelector(".workspace-tab-close").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');assert.equal(await expanded(),false);checks.push('tab-double-click-expands-and-restores-with-close-button-excluded')
      win.webContents.focus();await js('(()=>{const el=document.querySelector(".preview-content");el.tabIndex=0;el.focus()})()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']})
      await until(()=>request?.content.id==='window-find'&&diagnostic().visible&&nodes(findRequest()!.content).some(node=>node.id==='find-count'&&node.text==='1 / 2 个结果'),'Markdown workspace search')
      assert.ok(await js('[...CSS.highlights].some(([name,ranges])=>name.startsWith("navora-file-find")&&ranges.size>0)'));await capture('07-workspace-markdown-search-dark');checks.push('current-Markdown-preview-search-highlights-visible-text')
      clickNative('find-close');await until(()=>!diagnostic().visible,'close file find')
      await click('[aria-label="搜索对话"]');await until(()=>request?.content.id==='chat-search-root'&&diagnostic().visible,'global native search');assert.equal(diagnostic().focusedId,'chat-search-query');await input(['--text','搜索界面']);await until(()=>diagnostic().controls.find((item:any)=>item.id==='chat-search-query')?.value==='搜索界面','global native typing');await capture('06-global-search-dark');checks.push('global-search-autofocus-and-native-input')
      const globalPanel=panel;await click('[aria-label="搜索对话"]');await until(()=>panel!==globalPanel&&diagnostic().visible&&diagnostic().focusedId==='chat-search-query','global search repeated open refocus');assert.equal(diagnostic().controls.find((item:any)=>item.id==='chat-search-query')?.value,'搜索界面');checks.push('global-search-repeated-open-refocuses-input-with-query-retained')
      assert.equal(request!.anchor.y,22);win.setContentSize(720,920);await wait(300)
      const globalRequest=[...requests.values()].find(item=>item.content.id==='chat-search-root')!
      const narrowGeometry=await js('({width:innerWidth,captionReserve:Math.max(138,parseFloat(getComputedStyle(document.querySelector(".window-titlebar")).paddingRight)||0)})')
      assert.equal(globalRequest.anchor.y,22);assert.ok(globalRequest.anchor.x+globalRequest.content.width!+24<=narrowGeometry.width-narrowGeometry.captionReserve-8);observations.push({phase:'narrow-global-search',viewportWidth:narrowGeometry.width,captionReserve:narrowGeometry.captionReserve,anchor:globalRequest.anchor,contentWidth:globalRequest.content.width});await capture('08-global-search-narrow-dark');checks.push('global-search-shares-titlebar-height-and-reserves-native-caption-buttons-at-minimum-width')
      clickNative('chat-search-close');await until(()=>!diagnostic().visible,'close global before detached verification')
      const mainFindId=findRequest()!.id
      await js(`(async()=>{const state=await window.navora.browser.workspace.tabState(${JSON.stringify(chat)}),page=state.pages.find(page=>page.url===${JSON.stringify(url)});if(!page)throw Error('Missing fixture page to detach');await window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:page.windowId,action:'detach'})})()`)
      await until(()=>BrowserWindow.getAllWindows().some(candidate=>candidate!==win&&candidate.webContents.getURL().includes('#/browser-host/')),'isolated detached browser host')
      const detached=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&candidate.webContents.getURL().includes('#/browser-host/'))!
      detached.webContents.setBackgroundThrottling(false);detached.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
      await until(()=>detached.webContents.executeJavaScript('!!document.querySelector(".browser-host-page .browser-tab-panel")'),'detached browser Vue controls')
      detached.setContentSize(1040,760);await wait(300);guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']})
      await until(()=>request?.content.id==='window-find'&&request.id!==mainFindId&&diagnostic().visible,'detached native Ctrl F search')
      const detachedFind=()=>requests.get(request!.id)!
      compactRequest(false,detachedFind());assert.equal(nodes(detachedFind().content).find(node=>node.id==='find-query')?.placeholder,'搜索当前网页…');assert.equal(diagnostic().focusedId,'find-query')
      assert.equal(await guest.executeJavaScript('window.identity'),identity);await capture('09-detached-browser-empty-dark');checks.push('detached-browser-only-workspace-scope-hides-globe-and-retains-compact-native-input')
      const emptyDetached=panel;guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});await until(()=>panel!==emptyDetached&&diagnostic().focusedId==='find-query','refocus detached native query')
      await input(['--text','keyword']);await until(()=>nodes(detachedFind().content).some(node=>node.id==='find-count'&&node.text==='1 / 2 个结果'),'detached browser native typing');compactRequest(false,detachedFind());await capture('10-detached-browser-results-dark');checks.push('detached-browser-query-searches-original-live-page-without-scope-toggle')
      await detached.webContents.executeJavaScript('window.navora.config.save({app:{appearance_mode:"light"}})');await until(()=>diagnostic().theme.mode==='light','detached light native search');await capture('11-detached-browser-results-light')
      panel!.emit('action',{id:'find-close',type:'click'});await until(()=>!diagnostic().visible,'close detached find');detached.destroy()
      assert.deepEqual(liveInputValues,[],'Native count/theme/layout refreshes omit input values to preserve composition');checks.push('native-live-updates-omit-input-value-to-preserve-IME-composition');assert.deepEqual(errors,[])
      observations.push({phase:'after-explicit-chat-navigation-and-browser-to-file-tab-switch',previewRequests,hiddenCalls,webContents:count,guestId,sidebar})
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,errors,scope:'Actual Vue/preload/main and real NativePanel. Isolated synthetic chat/workspace/local webpage. Text/CJK/Enter/Escape use PID-restricted targeted Win32 messages; scope buttons inject native actions. Live updates are checked to omit input values; an actual OS IME composition session is not simulated. _getState is diagnostics only. Screenshots and pixel measurements use owned-popup PrintWindow. No personal data, model calls, physical/global input or F3/F11 shortcut probes.'},null,2));local.closeAllConnections();app.exit(0)
    }catch(error){console.error(error);try{fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,observations,request,state:panel?diagnostic():undefined,owner:{bounds:win.getBounds(),contentBounds:win.getContentBounds(),visible:win.isVisible(),minimized:win.isMinimized()},previewRequests,hiddenCalls},null,2))}catch{}local.closeAllConnections();app.exit(1)}
  })())
})
await import('../electron/main')
