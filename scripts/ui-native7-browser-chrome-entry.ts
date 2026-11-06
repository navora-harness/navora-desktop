import {app,BrowserWindow,WebContentsView,NativePanel,Menu,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import type {NativePanelContent,NativePanelShow,NativeMenuShow} from '../shared/native-ui'
import type {BrowserTreeWindow} from '../shared/types'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_native7_browser_chrome'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('An explicit isolated data root is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true});fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'原生 .7 浏览器栏隔离验收',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const inactive=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)}inactive.call(this)};BrowserWindow.prototype.focus=function(){}
const requests:NativePanelShow[]=[],updates:NativePanelContent[]=[],menus:Menu[]=[],menuRequests:NativeMenuShow[]=[],menuUpdates:any[]=[],commands:any[]=[],panels:NativePanel[]=[],nativeVisible=new Set<NativePanel>(),checks:string[]=[],errors:string[]=[],panelEvents:any[]=[],tabActions:any[]=[],panelLifecycle:any[]=[]
let previews=0,failNextMenu=false,rejectNextMenuUpdate=false,presentationPageId='',presentationPatch:Partial<BrowserTreeWindow>|undefined
const originalHandle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){args[0]={...args[0],focusMode:'none',dismissOnOutsideClick:false,dismissOnEscape:false};requests.push(structuredClone(args[0]))}
  if(channel==='navora:native-ui.update'&&args[2]?.content)updates.push(structuredClone(args[2].content))
  if(channel==='navora:native-ui.menu'){menuRequests.push(structuredClone(args[0]));if(failNextMenu){failNextMenu=false;throw Error('isolated_native_menu_display_failure')}}
  if(channel==='navora:native-ui.updateMenu'){menuUpdates.push(structuredClone(args));if(rejectNextMenuUpdate){rejectNextMenuUpdate=false;return false}}
  if(channel==='navora:native-ui.hide'||channel==='navora:native-ui.destroy')panelLifecycle.push({channel,args:structuredClone(args),time:Date.now()})
  if(channel==='navora:browser.workspace.tabAction')tabActions.push(structuredClone(args))
  if(channel==='navora:browser.workspace.command')commands.push(structuredClone(args))
  if(channel==='navora:browser.workspace.preview')previews++
  const result=await listener(event,...args)
  if(presentationPatch&&(channel==='navora:browser.workspace.state'||channel==='navora:browser.workspace.tabState')){
    const value=structuredClone(result),patch=(page:BrowserTreeWindow)=>page.windowId===presentationPageId?{...page,...presentationPatch}:page
    value.pages=value.pages.map((entry:any)=>entry.windows?{...entry,windows:entry.windows.map(patch)}:patch(entry));return value
  }
  return result
})
const nativeShow=NativePanel.prototype.show,nativeHide=NativePanel.prototype.hide,nativeDestroy=NativePanel.prototype.destroy
NativePanel.prototype.show=function(options){panels.push(this);nativeVisible.add(this);return nativeShow.call(this,options)}
NativePanel.prototype.hide=function(){nativeVisible.delete(this);return nativeHide.call(this)}
NativePanel.prototype.destroy=function(){nativeVisible.delete(this);return nativeDestroy.call(this)}
// Exercise real Menu construction, controls and application routing without an OS
// popup stealing the user's input. This suite makes no visual Menu claim.
const menuOptions=new WeakMap<Menu,Electron.PopupOptions>()
Menu.prototype.popup=function(options={}){menus.push(this);menuOptions.set(this,options)}
Menu.prototype.closePopup=function(){const options=menuOptions.get(this);menuOptions.delete(this);options?.callback?.()}
const local=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end('<!doctype html><title>原生界面样本</title><input id="draft" value="保留页面草稿"><div style="height:1800px"></div><script>window.identity=crypto.randomUUID();window.framesPainted=0;requestAnimationFrame(function tick(){window.framesPainted++;requestAnimationFrame(tick)})</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/native7`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let n=0;n<150;n++){if(await check())return;await wait(50)}throw Error('Timed out: '+label)}
const nodes=(root:NativePanelContent):NativePanelContent[]=>[root,...(root.children||[]).flatMap(nodes)]
let started=false
app.on('browser-window-created',(_event,win)=>{
  const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>{if(channel==='navora:native-ui.event')panelEvents.push({detail:structuredClone(args[0]),time:Date.now()});return send(channel,...args)}
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code),click=async(selector:string)=>{await js(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!element)throw Error('Missing visible control');element.click()})()`);await wait(70)}
    const latest=(id:string)=>[...updates].reverse().find(content=>content.id===id)||[...requests].reverse().find(request=>request.content.id===id)!.content
    try{
      win.setContentSize(1500,930);await until(()=>js('!!document.querySelector(".composer")'),'application ready')
      assert.equal(await js('window.navora.nativeUi.capabilities().then(c=>c.distributionVersion==="45.0.0-cloudbypass.10"&&c.panelItems&&c.menuControls&&c.panelScrollbars)'),true)
      const pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:native7',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true);return id})()`)
      let guest:Electron.WebContents|undefined
      await until(()=>{guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url&&!wc.isLoading());return !!guest},'committed browser page');guest!.setBackgroundThrottling(false)
      const identity=await guest!.executeJavaScript('window.identity'),state=()=>js(`window.navora.browser.workspace.tabState(${JSON.stringify(chat)})`),owner=(await state()).pages.find((page:any)=>page.windowId===pageId).automation.owner,wcCount=webContents.getAllWebContents().length
      const view=()=>{const walk=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(walk)];return walk(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents===guest) as WebContentsView|undefined}
      await until(()=>!!view()?.getVisible(),'visible native view')
      guest!.focus();guest!.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']});guest!.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:['control']})
      await until(()=>js('document.querySelector(".browser-address-bar").classList.contains("is-focused")'),'address focus command')
      await js('(()=>{const input=document.querySelector("[aria-label=浏览器地址]");input.value="github";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
      await until(()=>updates.some(content=>content.id==='address-suggestions-root'&&JSON.stringify(content).includes('github')),'address input query applied')
      await js('document.querySelector("[aria-label=浏览器地址]").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
      await until(()=>requests.some(request=>request.content.id==='address-suggestions-root')&&updates.some(content=>content.id==='address-suggestions-root'&&nodes(content).some(node=>node.selected)),'selected native address row')
      const address=latest('address-suggestions-root'),oldAddress=nodes(address).find(node=>node.type==='item')!,addressPanel=panels.at(-1)!
      assert.equal(address.scrollbarPlacement,'gutter');assert.equal(oldAddress.selected,true);assert.equal(nodes(address).some(node=>node.type==='button'),false)
      assert.ok(Math.abs(address.width!-await js('document.querySelector(".browser-address-bar").getBoundingClientRect().width'))<=1)
      assert.equal(await js('document.activeElement===document.querySelector("[aria-label=浏览器地址]")'),true);checks.push('native-address-items-use-real-selection-and-field-width-with-host-input-focus')
      const shows=requests.length,beforeCommands=commands.length
      await js('(()=>{const input=document.querySelector("[aria-label=浏览器地址]");input.value="other query";input.dispatchEvent(new Event("input",{bubbles:true}));input.setSelectionRange(2,5)})()')
      await until(()=>updates.some(content=>content.id==='address-suggestions-root'&&JSON.stringify(content).includes('other query')),'new address query applied')
      addressPanel.emit('action',{id:oldAddress.id,type:'click'});await wait(100)
      assert.equal(commands.length,beforeCommands);assert.equal(requests.length,shows);assert.equal(await js('document.querySelector("[aria-label=浏览器地址]").selectionStart'),2);checks.push('stale-address-query-actions-reject-and-updates-preserve-selection-without-reopening')
      await js('(()=>{const input=document.querySelector("[aria-label=浏览器地址]");input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))})()');await wait(100)
      assert.equal(commands.length,beforeCommands);assert.equal(nativeVisible.size,0);checks.push('address-composition-hides-candidates-and-blocks-navigation-even-without-key-isComposing-flag')
      await js('(()=>{const input=document.querySelector("[aria-label=浏览器地址]");input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));input.blur()})()');await wait(100)
      const zoomOwner=(await state()).pages.find((page:any)=>page.windowId===pageId).automation.owner
      failNextMenu=true;await click('.browser-page-more');await until(()=>!failNextMenu,'injected native menu failure');await wait(100)
      assert.equal(await js('document.querySelectorAll(".ui-action-menu-overlay,.browser-frozen-frame,.browser-preview-unavailable").length'),0);assert.equal(view()?.getVisible(),true);assert.equal(previews,0);checks.push('failed-browser-native-menu-keeps-live-view-and-retry-control-without-HTML-fallback')
      await click('.browser-page-more');await until(()=>menus.some(menu=>menu.getMenuItemById('zoom')),'native browser menu controls')
      let menu=menus.at(-1)!
      const zoomCommands=()=>commands.filter(args=>args[1]==='zoom')
      assert.deepEqual(menu.getMenuItemById('zoom')?.controls?.slice(0,3).map(control=>control.group),[1,1,1]);assert.equal(menu.getMenuItemById('zoom')?.controls?.find(control=>control.id==='value')?.label,'100%')
      await wait(80);rejectNextMenuUpdate=true;menu.emit('control-action',{itemId:'zoom',controlId:'in'})
      await until(()=>!rejectNextMenuUpdate,'rejected menu refresh');await until(()=>js('document.querySelector(".browser-page-more").getAttribute("aria-expanded")==="false"'),'rejected refresh dismisses stale popup')
      assert.equal(zoomCommands().length,0);assert.equal(guest!.getZoomFactor(),1);checks.push('failed-native-menu-refresh-blocks-the-pending-zoom-command')
      const beforeRetry=menus.length;await click('.browser-page-more');await until(()=>menus.length>beforeRetry,'native menu retry after rejected refresh');menu=menus.at(-1)!
      const menuCount=menus.length
      menu.emit('control-action',{itemId:'zoom',controlId:'in'});await until(()=>zoomCommands().length===1&&menu.getMenuItemById('zoom')?.controls?.find(control=>control.id==='value')?.label==='110%','first native zoom control')
      menu.emit('control-action',{itemId:'zoom',controlId:'in'});menu.emit('control-action',{itemId:'zoom',controlId:'reset'})
      await until(()=>zoomCommands().length===3&&menu.getMenuItemById('zoom')?.controls?.find(control=>control.id==='value')?.label==='100%','serialized repeat and reset')
      assert.deepEqual(zoomCommands().map(args=>args[2]),[1.1,1.25,1]);assert.equal(menus.length,menuCount);assert.ok(menuUpdates.length>=3);assert.equal(guest!.getZoomFactor(),1)
      assert.equal((await state()).pages.find((page:any)=>page.windowId===pageId).automation.owner,zoomOwner);checks.push('native-inline-zoom-repeats-and-resets-with-real-values-without-reopening-or-changing-Agent-owner')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},action:'new',key:'browser:native7-second',url:'about:blank'})`)
      await until(async()=>(await state()).activeId!==pageId,'new active tab')
      const beforeStale=zoomCommands().length;menu.emit('control-action',{itemId:'zoom',controlId:'in'});await wait(140);assert.equal(zoomCommands().length,beforeStale);assert.equal(guest!.getZoomFactor(),1);checks.push('old-menu-actions-do-not-follow-a-new-active-tab')
      await js(`(async()=>{for(let n=0;n<6;n++)await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:native7-extra-'+n,'about:blank')})()`)
      win.setContentSize(940,830);await until(()=>js('[...document.querySelectorAll(".browser-tab-list-button")].some(node=>node.checkVisibility()&&!node.inert)'),'overflow native tab list')
      await click('.browser-tab-list-button');await until(()=>requests.some(request=>request.content.id==='tab-list-root'),'native tab search shown')
      const tabPanel=panels.at(-1)!,initialTabs=requests.filter(request=>request.content.id==='tab-list-root').at(-1)!.content,oldTab=nodes(initialTabs).find(node=>node.type==='item')!
      assert.ok(nodes(initialTabs).filter(node=>node.type==='item').length>1);assert.equal(nodes(initialTabs).filter(node=>node.type==='item'&&node.selected).length,1)
      tabPanel.emit('action',{id:'tab-list-query',type:'change',value:'原生界面样本'})
      await until(()=>updates.some(content=>content.id==='tab-list-root'&&nodes(content).filter(node=>node.type==='item').length===1),'filtered native tabs')
      const filtered=[...updates].reverse().find(content=>content.id==='tab-list-root')!,queryNode=nodes(filtered).find(node=>node.id==='tab-list-query')!
      assert.equal('value' in queryNode,false);tabPanel.emit('action',{id:oldTab.id,type:'click'});await wait(100);assert.notEqual((await state()).activeId,pageId)
      tabPanel.emit('action',{id:nodes(filtered).find(node=>node.type==='item')!.id,type:'click'});await until(async()=>(await state()).activeId===pageId,'selected filtered tab')
      checks.push('native-tab-search-preserves-IME-input-value-and-rejects-prior-query-rows')
      assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'保留页面草稿');assert.equal(previews,0);assert.equal(await js('document.querySelectorAll(".browser-frozen-frame,.browser-preview-unavailable").length'),0);assert.deepEqual(errors,[])
      checks.push('browser-chrome-paths-preserve-live-page-draft-and-never-request-background-preview')
      const beforeReloadMenu=menus.length;await click('.browser-page-more');await until(()=>menus.length>beforeReloadMenu,'native menu before deliberate same-URL reload')
      const reloadedMenu=menus.at(-1)!,epoch=(await state()).pages.find((page:any)=>page.windowId===pageId).automation.documentEpoch,beforeReloadZoom=zoomCommands().length
      guest!.reload();await until(async()=>!guest!.isLoading()&&await guest!.executeJavaScript('window.identity')!==identity,'explicit reload commits another document at the same URL')
      await until(async()=>(await state()).pages.find((page:any)=>page.windowId===pageId).automation.documentEpoch!==epoch,'new document epoch')
      reloadedMenu.emit('control-action',{itemId:'zoom',controlId:'in'});await wait(100);assert.equal(zoomCommands().length,beforeReloadZoom);assert.equal(previews,0);checks.push('same-URL-document-replacement-invalidates-old-menu-actions')
      await until(()=>js('document.querySelector(".browser-page-more").getAttribute("aria-expanded")==="false"'),'old document menu closed')
      const beforeState=await state(),beforePresentation=beforeState.pages.find((page:any)=>page.windowId===pageId),stableRevision=beforePresentation.automation.stateRevision,stableEpoch=beforePresentation.automation.documentEpoch,stableZoom=beforePresentation.zoomFactor
      presentationPageId=pageId
      const publishPresentation=async()=>{const snapshot=await js('window.navora.browser.workspace.state()');win.webContents.send('navora:browser.treeUpdated',{chatId:chat,tree:snapshot.pages,counts:{}})}
      const beforeStateMenu=menus.length;await click('.browser-page-more');await until(()=>menus.length>beforeStateMenu,'menu for presentation-state changes');const stateMenu=menus.at(-1)!,sameMenuCount=menus.length
      assert.equal(stateMenu.getMenuItemById('forward')?.enabled,false);assert.equal(stateMenu.getMenuItemById('find')?.enabled,true)
      presentationPatch={canGoForward:true};await publishPresentation()
      await until(()=>js('document.querySelector(".browser-forward").disabled===false'),'renderer accepted history snapshot')
      await until(()=>stateMenu.getMenuItemById('forward')?.enabled===true,'open menu follows history-only state change')
      const afterHistory=(await state()).pages.find((page:any)=>page.windowId===pageId);assert.equal(afterHistory.automation.stateRevision,stableRevision);assert.equal(afterHistory.automation.documentEpoch,stableEpoch);assert.equal(afterHistory.zoomFactor,stableZoom)
      assert.equal(menus.length,sameMenuCount)
      presentationPatch=undefined;await publishPresentation()
      await until(()=>stateMenu.getMenuItemById('forward')?.enabled===false,'same menu restores real history availability')
      assert.equal(menus.length,sameMenuCount);assert.equal((await state()).pages.find((page:any)=>page.windowId===pageId).automation.stateRevision,stableRevision);checks.push('open-native-menu-refreshes-history-availability-without-stateRevision-or-zoom-change')
      await js(`window.navora.nativeUi.closeMenu(${JSON.stringify(menuRequests.at(-1)!.requestId)})`)
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},action:'new',url:'about:blank'})`)
      await until(()=>js('[...document.querySelectorAll(".browser-start-page")].some(page=>page.checkVisibility())'),'actual blank start page')
      const beforeBlankMenu=menus.length;await click('.browser-page-more');await until(()=>menus.length>beforeBlankMenu,'actual start-page menu');assert.equal(menus.at(-1)!.getMenuItemById('find')?.enabled,false);checks.push('actual-blank-start-page-native-menu-disables-find')
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,previews,menuUpdates:menuUpdates.length,panelShows:requests.length,nativeUpdates:updates.length,initialWebContents:wcCount,initialOwner:owner,zoomOwner,boundaries:['Uses the actual packaged application renderer/preload/main and real NativePanel widgets in a temporary profile.','OS Menu.popup display is suppressed; real Menu objects, control schema, callbacks and business zoom are exercised. Menu visuals/physical controls are not covered.','NativePanel activation, outside-click dismissal and Escape dismissal are disabled only in this unattended fixture to isolate external desktop input. Native actions/composition events are injected; physical native IME, mouse input and DPI visual acceptance remain separate.','History availability changes use a controlled browser-state IPC/tree snapshot boundary. Actual URL, document epoch, Agent stateRevision and zoom remain unchanged; this is renderer/Menu synchronization coverage, not a real history transaction. The final blank page is real.','The injected guest Ctrl+L follows existing real-input ownership policy. Zoom ownership is compared before/after its own actions.','Local RAF and retained form state are checked; video decoding and an active model run are not started.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,previews,requests,updates,menuRequests,menuUpdates,commands,panelEvents,panelLifecycle,tabActions,tabState:await js(`window.navora.browser.workspace.tabState(${JSON.stringify(chat)})`).catch(()=>null),renderer:await js('({text:document.body.innerText.slice(-1600),active:document.activeElement?.outerHTML?.slice(0,1000),tabs:[...document.querySelectorAll("[role=tab]")].map(tab=>({id:tab.dataset.fileKey,page:tab.dataset.pageId,selected:tab.ariaSelected}))})').catch(()=>null)},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
