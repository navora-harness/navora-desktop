import {app,BrowserWindow,NativePanel,WebContentsView,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {defaultModelCapabilities} from '../shared/model-capabilities'
import {composerNativeModelControlId} from '../shared/composer-native-panels'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_native_composer_fixture'
if(!profile||!path.isAbsolute(profile)||!project||!output)throw Error('Explicit isolated data root and output are required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.ai_generate_chat_title=false;config.remote.enabled=false;config.files.custom_root=path.join(profile,'workspaces')
const capabilities=defaultModelCapabilities('Alpha');capabilities.reasoning.enabled=true
config.ai.providers=[{id:'native-first',type:'openai_compatible',label:'服务商甲',base_url:'http://127.0.0.1:9/v1',api_key_ref:'secrets/native-first',model:'alpha',models:['alpha'],model_settings:{alpha:capabilities},timeout_ms:1000},{id:'native-second',type:'openai_compatible',label:'服务商乙',base_url:'http://127.0.0.1:9/v1',api_key_ref:'secrets/native-second',model:'beta',models:['beta'],model_settings:{beta:{...capabilities,label:'Beta'}},timeout_ms:1000}];config.ai.default_provider='native-first'
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'原生输入面板集成验收',createdAt:Date.now(),updatedAt:Date.now(),draft:'保持选区和草稿',providerId:'native-first',model:'alpha',executionMode:'auto',messages:[]}))
const otherChat=chat+'_other';fs.writeFileSync(path.join(profile,'chats',otherChat+'.json'),JSON.stringify({id:otherChat,title:'延迟权限回包的另一个对话',createdAt:Date.now()-60000,updatedAt:Date.now()-60000,draft:'另一个对话的草稿',providerId:'native-first',model:'alpha',executionMode:'auto',messages:[]}))
const show=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)};show.call(this)};BrowserWindow.prototype.focus=function(){}

// Run the actual native widgets without activating another foreground window.
// The explicit action events below test the application handlers, not OS input.
const requests:NativePanelShow[]=[],updates:{id:string;content:NativePanelContent}[]=[],nativeVisible=new Set<NativePanel>(),panels:NativePanel[]=[],writes:string[]=[],commands:unknown[]=[],nativeEvents:unknown[]=[],ipcEvents:unknown[]=[],nativeCalls:unknown[]=[]
let previewRequests=0,taskRequests=0
let holdPermissionResponse=false,permissionBackendWritten=false,releasePermission:(()=>void)|undefined
const originalHandle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){requests.push(structuredClone(args[0]));args[0]={...args[0],focusMode:'none'}}
  if(channel==='navora:native-ui.update'&&args[2]?.content)updates.push({id:args[0],content:structuredClone(args[2].content)})
  if(['navora:native-ui.show','navora:native-ui.hide','navora:native-ui.destroy'].includes(channel))nativeCalls.push({channel,args:structuredClone(args)})
  if(channel==='navora:browser.workspace.preview')previewRequests++
  if(channel==='navora:browser.workspace.command')commands.push(structuredClone(args))
  if(['navora:chats.setProvider','navora:chats.setExecutionMode','navora:chats.setPermissions'].includes(channel))writes.push(channel)
  if(['navora:agent.run','navora:agent.submit','navora:agent.retry','navora:agent.queue.resume'].includes(channel)){taskRequests++;throw Error('This fixture must never start a model request')}
  if(channel==='navora:chats.setPermissions'&&holdPermissionResponse){const result=await listener(event,...args);permissionBackendWritten=true;await new Promise<void>(resolve=>{releasePermission=resolve});return result}
  return listener(event,...args)
})
const nativeShow=NativePanel.prototype.show,nativeHide=NativePanel.prototype.hide,nativeDestroy=NativePanel.prototype.destroy
const observed=new WeakSet<NativePanel>()
NativePanel.prototype.show=function(options){if(!observed.has(this)){observed.add(this);for(const event of ['action','dismissed','closed'])this.on(event as 'action',(detail:unknown)=>{nativeEvents.push({event,detail});if(event==='dismissed'||event==='closed')nativeVisible.delete(this)})}nativeShow.call(this,options);nativeVisible.add(this);panels.push(this)}
NativePanel.prototype.hide=function(){nativeHide.call(this);nativeVisible.delete(this)}
NativePanel.prototype.destroy=function(){nativeDestroy.call(this);nativeVisible.delete(this)}
const local=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end('<!doctype html><title>输入区原生浮层资料</title><h1>页面保持实时显示</h1><div id="pulse" style="width:120px;height:70px"></div><script>window.framesPainted=0;window.documentIdentity=crypto.randomUUID();function paint(){window.framesPainted++;document.querySelector("#pulse").style.background=window.framesPainted%2?"#dff2fc":"#f8eacd";requestAnimationFrame(paint)}requestAnimationFrame(paint)</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/fixture`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:string[]=[],errors:string[]=[],metrics:unknown[]=[]
const controls=(node:NativePanelContent):NativePanelContent[]=>[node,...(node.children||[]).flatMap(controls)]
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let index=0;index<150;index++){if(await check())return;await wait(60)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
 if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
 const originalSend=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>{if(channel==='navora:native-ui.event')ipcEvents.push(structuredClone(args[0]));return originalSend(channel,...args)}
 win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
  // Native visibility is set inside the main IPC handler, before its renderer
  // promise receives the new display credential. Yield the main handler, then
  // cross a renderer task before injecting an action, as actual OS input does.
  const acknowledge=async()=>{await wait(0);await js('new Promise(resolve=>setTimeout(resolve,0))')}
  const click=async(selector:string)=>{await js(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!element)throw Error('Missing visible trigger ${selector.replaceAll("'",'')}');element.click()})()`);await wait(120)}
  const latest=(name:string)=>[...requests].reverse().find(request=>request.content.id===name)
  const dismiss=async()=>{const panel=panels.at(-1)!;panel.hide();panel.emit('dismissed',{reason:'escape'});await wait(150)}
  let guest:Electron.WebContents|undefined,view:Electron.WebContentsView|undefined,pageId=''
  try{
   win.setContentSize(1800,1000);await until(()=>js('!!document.querySelector(".composer .composer-richtext")'),'real composer ready')
   await until(()=>js('window.navora.nativeUi.capabilities().then(value=>value.panels)'),'native capability')
   await js(`(async()=>{window.nativeComposerChat=${JSON.stringify(chat)};window.nativeComposerPage=await window.navora.browser.workspace.ensure(window.nativeComposerChat,'browser:native-composer-browser');await window.navora.browser.workspace.command(window.nativeComposerPage,'navigate',${JSON.stringify(url)});await window.navora.browser.setVisible(window.nativeComposerPage,true)})()`)
   pageId=await js('window.nativeComposerPage');await until(()=>{guest=webContents.getAllWebContents().find(item=>item.getURL()===url&&!item.isLoading());return !!guest},'committed fixture page');guest!.setBackgroundThrottling(false)
   const descendants=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(descendants)]
   const ancestors=(root:Electron.View,target:Electron.View,chain:Electron.View[]=[]):Electron.View[]|undefined=>{if(root===target)return [...chain,root];for(const child of root.children){const found=ancestors(child,target,[...chain,root]);if(found)return found}return undefined}
   await until(()=>{view=descendants(win.contentView).find(item=>item instanceof WebContentsView&&item.webContents.id===guest!.id)as Electron.WebContentsView;return !!view&&view.getVisible()},'visible real browser view')
   await until(()=>js('document.querySelector(".composer .composer-richtext")?.checkVisibility()'),'chat and browser split')
   await until(()=>js('document.querySelector(".model-panel-trigger")?.textContent.includes("Alpha")'),'configured model loaded');await wait(500)
   const state=()=>js(`window.navora.browser.workspace.state().then(value=>value.pages.flatMap(group=>group.windows).find(page=>page.windowId===${JSON.stringify(pageId)}))`),readChat=()=>js(`window.navora.chats.get(${JSON.stringify(chat)})`),identity=await guest!.executeJavaScript('window.documentIdentity'),owner=(await state()).automation.owner,baselineWc=webContents.getAllWebContents().length,baselineBounds=view!.getBounds(),baselineWrites=writes.length,baselineCommands=commands.length,viewChain=()=>ancestors(win.contentView,view!)!.map(item=>item.getBounds()),baselineChain=viewChain()
   const slot=await js('(()=>{const r=[...document.querySelectorAll(".browser-native-slot")].find(node=>node.checkVisibility()).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()'),absolute=baselineChain.reduce((sum,rect)=>({x:sum.x+rect.x,y:sum.y+rect.y}),{x:0,y:0}),zoom=win.webContents.getZoomFactor();assert.ok(Math.abs(absolute.x-Math.round(slot.x*zoom))<=1&&Math.abs(absolute.y-Math.round(slot.y*zoom))<=1);checks.push('native-view-parent-chain-still-matches-the-real-browser-slot-origin')
   async function continuous(label:string){const before=await guest!.executeJavaScript('window.framesPainted');await wait(150);assert.equal(view!.getVisible(),true);assert.deepEqual(view!.getBounds(),baselineBounds);assert.deepEqual(viewChain(),baselineChain);assert.equal(await guest!.executeJavaScript('window.documentIdentity'),identity);assert.ok(await guest!.executeJavaScript('window.framesPainted')>before);assert.equal(previewRequests,0);assert.equal(await js('document.querySelectorAll(".browser-frozen-frame,.browser-preview-unavailable").length'),0);assert.equal(webContents.getAllWebContents().length,baselineWc);assert.equal((await state()).automation.owner,owner);assert.equal(commands.length,baselineCommands);checks.push(label)}

   await click('.model-panel-trigger');await until(()=>!!latest('composer:model')&&nativeVisible.size>0,'native model content')
   assert.equal(await js('document.querySelectorAll(".unified-model-panel,.composer-perm-menu.v-overlay--active").length'),0);assert.equal(writes.length,baselineWrites);assert.equal((await readChat()).model,'alpha');await continuous('native-model-panel-keeps-real-page-visible-without-capture-owner-change-or-renderer-growth')
   await acknowledge();const model=panels.at(-1)!,showCount=panels.length,modelRequest=latest('composer:model')!
   model.emit('action',{id:'model:search',type:'change',value:'服务商乙'});await until(()=>updates.some(item=>item.content.id==='composer:model'&&controls(item.content).some(node=>node.id==='model:search'&&node.value==='服务商乙')),'native model search update')
   assert.equal(panels.length,showCount);assert.equal(panels.at(-1),model);assert.ok(controls(modelRequest.content).some(node=>node.id==='model:search'));checks.push('model-search-updates-stable-native-controls-without-recreating-the-panel')
   model.emit('action',{id:composerNativeModelControlId('native-second::beta'),type:'click'});await until(async()=>{const row=await readChat();return row.providerId==='native-second'&&row.model==='beta'},'explicit model choice');assert.equal(writes.filter(channel=>channel==='navora:chats.setProvider').length,1);checks.push('explicit-native-model-action-reaches-current-provider-selection-service')
   await until(()=>{const current=[...updates].reverse().find(item=>item.content.id==='composer:model');return current&&controls(current.content).some(node=>node.id==='model:reasoning'&&!node.disabled)&&controls(current.content).some(node=>node.id===composerNativeModelControlId('native-second::beta')&&node.text?.startsWith('✓'))},'reasoning enabled after model save')
   model.emit('action',{id:'model:reasoning',type:'change',value:'high'});await until(async()=>(await readChat()).reasoningLevel==='high','explicit reasoning choice');checks.push('native-reasoning-option-updates-real-chat-settings')
   await dismiss();await continuous('model-dismissal-keeps-original-webpage-and-draft')

   const modeBefore=(await readChat()).executionMode,modeWrites=writes.length
   await click('.execution-mode-button');await until(()=>!!latest('composer:mode')&&nativeVisible.size>0,'native reply mode');assert.equal((await readChat()).executionMode,modeBefore);assert.equal(writes.length,modeWrites);await dismiss();assert.equal((await readChat()).executionMode,modeBefore);checks.push('reply-mode-open-and-dismiss-do-not-change-chat-configuration')
   await click('.execution-mode-button');await until(()=>nativeVisible.size>0,'reply mode explicit action');await acknowledge();panels.at(-1)!.emit('action',{id:'mode:chat',type:'click'});await until(async()=>(await readChat()).executionMode==='chat','explicit reply mode');checks.push('only-explicit-native-reply-mode-action-changes-chat-mode')
   const permissionBefore=JSON.stringify((await readChat()).permissions),permissionWrites=writes.length
   await click('[aria-label="本会话权限预设"]');await until(()=>!!latest('composer:permission')&&nativeVisible.size>0,'native permission');await dismiss();assert.equal(JSON.stringify((await readChat()).permissions),permissionBefore);assert.equal(writes.length,permissionWrites);checks.push('permission-open-and-dismiss-preserve-the-existing-permission-preset')
   await click('[aria-label="本会话权限预设"]');await until(()=>nativeVisible.size>0,'permission explicit action');await acknowledge();panels.at(-1)!.emit('action',{id:'permission:conservative',type:'click'});await until(async()=>(await readChat()).permissions?.preset==='conservative','explicit permission choice');checks.push('explicit-native-permission-action-reaches-real-chat-permission-service')
   await continuous('reply-and-permission-panels-do-not-change-webview-control')

   await click('.usage-ring-btn');await until(()=>!!latest('composer:usage')&&nativeVisible.size>0,'native context usage');const usage=latest('composer:usage')!.content
   assert.ok(controls(usage).some(node=>node.id==='usage:actual-empty'&&node.text?.includes('尚未返回')));assert.ok(!controls(usage).some(node=>node.id==='usage:actual-total'));assert.equal(await js('document.querySelectorAll(".composer-usage-panel").length'),0);checks.push('actual-native-context-panel-shows-unknown-provider-usage-as-unknown');await continuous('context-usage-panel-keeps-live-webpage-and-zero-capture');await dismiss()

   const attachmentShows=panels.length
   await click('.composer-attach-trigger');await until(()=>js('!!document.querySelector(".composer-attachment-menu")'),'HTML attachment list');assert.equal(panels.length,attachmentShows)
   assert.equal(await js('(()=>{const a=document.querySelector(".composer-box").getBoundingClientRect(),p=document.querySelector(".composer-attachment-menu").getBoundingClientRect();return p.bottom<=a.top-6&&Math.abs(p.left-a.left)<2})()'),true);await continuous('HTML-attachment-is-above-left-without-native-panel-or-hiding-adjacent-webpage')
   await js('(()=>{const input=document.querySelector(".composer-attachment-search input");window.originalAttachmentSearch=input;input.value="浏览器";input.dispatchEvent(new Event("input",{bubbles:true}))})()');await until(()=>js('!!document.querySelector("#composer-attach-page")&&!document.querySelector("#composer-attach-file")'),'HTML attachment filtering');assert.equal(await js('document.querySelector(".composer-attachment-search input")===window.originalAttachmentSearch'),true);assert.equal(panels.length,attachmentShows);checks.push('HTML-attachment-search-reuses-input-without-creating-native-controls');await js('document.querySelector(".composer-attachment-search input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');await until(()=>js('!document.querySelector(".composer-attachment-menu")'),'attachment closes with Escape')

   await js('(()=>{const root=document.querySelector(".composer .composer-richtext");root.focus();const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){const at=node.textContent.indexOf("选区");if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+2);const selected=getSelection();selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event("selectionchange"));return}})()')
   await until(()=>!!latest('selection:root')&&nativeVisible.size>0,'native selection tools');assert.equal(latest('selection:root')!.focusMode,'none');assert.equal(await js('document.querySelectorAll(".composer-selection-panel").length'),0);await continuous('actual-native-selection-tools-keep-live-page-and-passive-focus')
   await acknowledge();const selection=panels.at(-1)!
   selection.emit('action',{id:'selection:bold',type:'click'});await until(()=>js('document.querySelector(".composer .composer-richtext strong")?.textContent==="选区"'),'native format applies to document');checks.push('native-bold-action-updates-only-the-preserved-editor-selection')
   selection.emit('action',{id:'selection:style',type:'change',value:'h2'});await until(()=>js('document.querySelector(".composer .composer-richtext h2")?.textContent.includes("保持选区和草稿")'),'native heading applies');checks.push('native-heading-option-updates-real-editor-block-without-losing-content');await dismiss();await continuous('formatting-keeps-original-webpage-and-does-not-request-takeover')

   // Explicit source selection opens the separately documented multi-line editor.
   // Its old DOM compatibility path is deliberately outside the zero-capture claim.
   await js('(()=>{const root=document.querySelector(".composer .composer-richtext");root.focus();const node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(node,0);range.collapse(true);const selected=getSelection();selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event("selectionchange"))})()')
   const beforeSlash=requests.length;win.webContents.sendInputEvent({type:'keyDown',keyCode:'/'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'/'});await until(()=>js('!!document.querySelector(".composer-attachment-menu")'),'real slash HTML attachment');assert.equal(requests.length,beforeSlash);await continuous('slash-trigger-opens-HTML-attachment-with-zero-capture-and-no-native-request')
   await click('#composer-attach-file');await until(()=>js('!!document.querySelector(".composer-source-picker")'),'explicit source opens the separate source editor');assert.equal(await js('document.querySelector(".composer .composer-richtext").textContent.startsWith("/")'),false);checks.push('explicit-HTML-source-action-consumes-only-the-live-slash-and-opens-the-existing-source-editor')
   await click('[aria-label="关闭附加"]');await until(()=>view!.getVisible(),'source editor closes and restores real webpage');assert.equal(await guest!.executeJavaScript('window.documentIdentity'),identity);assert.equal((await state()).automation.owner,owner);checks.push('separate-source-editor-return-preserves-page-instance-and-controller')

   holdPermissionResponse=true;await click('[aria-label="本会话权限预设"]');await until(()=>nativeVisible.size>0,'permission before delayed return');await acknowledge();panels.at(-1)!.emit('action',{id:'permission:open',type:'click'});await until(()=>permissionBackendWritten&&!!releasePermission,'real permission handler finishes before held response')
   await js('(()=>{const button=[...document.querySelectorAll(".chat-item-main")].find(button=>button.textContent.includes("延迟权限回包的另一个对话"));if(!button)throw Error("Other chat missing");button.click()})()');await until(()=>js('document.querySelector(".composer .composer-richtext")?.textContent.includes("另一个对话的草稿")'),'switch to different chat before permission return');checks.push('chat-switch-remains-available-while-a-real-permission-response-is-delayed')
   releasePermission!();await wait(200);await acknowledge();assert.equal(await js('document.querySelector(".composer .composer-richtext")?.textContent.includes("另一个对话的草稿")'),true);assert.equal(await js('document.querySelector(".chat-item.active .chat-item-title-text")?.textContent.trim()'), '延迟权限回包的另一个对话');assert.equal((await readChat()).permissions?.preset,'open');assert.equal((await js(`window.navora.chats.get(${JSON.stringify(otherChat)})`)).permissions,undefined);checks.push('late-permission-response-updates-original-chat-without-replacing-current-chat-or-draft')
   assert.equal(taskRequests,0);assert.deepEqual(errors,[]);checks.push('no-model-task-or-renderer-exception')
   metrics.push({identity,pageId,bounds:baselineBounds,parentViewBounds:baselineChain,slot,zoom,webContents:baselineWc,nativeShows:panels.length,uniquePanels:new Set(panels).size,nativeContentUpdates:updates.length,previewRequestsIncludingExplicitSourceEditor:previewRequests,configurationWrites:writes,taskRequests})
   fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,metrics,boundaries:['Actual built main/preload/renderer and real NativePanel widgets are used.','NativePanel focusMode is overridden to none only at IPC entry to avoid foreground activation; request focus modes remain recorded.','Native action and dismissed events are injected after an IPC/renderer task acknowledgement. Physical native mouse/keyboard, OS IME and screen appearance are not proven.','The visible webpage uses real RAF and a changing color block; no video decoder or active model run is exercised.','The zero-capture checks apply to migrated native panels. Explicitly opening the multi-line source editor uses its retained DOM compatibility path.','The delayed permission response uses the actual handler and persisted result, holding only its return delivery until after a real chat switch.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
  }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,requests,updates,metrics,errors,previewRequests,writes,commands,taskRequests,nativeEvents,ipcEvents,nativeCalls,ui:await js('({text:document.body.innerText.slice(-1200),editor:document.querySelector(".composer .composer-richtext")?.innerHTML})').catch(()=>undefined)},null,2));console.error(error);app.exit(1)}
 })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
