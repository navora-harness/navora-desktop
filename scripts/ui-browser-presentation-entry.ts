import {app,BrowserWindow,WebContentsView,webContents,ipcMain,NativePanel,Menu} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {APPEARANCE_THEMES} from '../shared/appearance'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_presentation_fixture'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('Explicit isolated data root required')
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'窗口呈现验收',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const inactive=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)}inactive.call(this)}
BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:string[]=[],observations:unknown[]=[],errors:string[]=[],layoutCalls:any[]=[],invalidations:any[]=[],panelRequests:any[]=[],panelUpdates:any[]=[],tabActions:any[]=[],pinRequests:any[]=[],menuResults:any[]=[]
let previews=0,guest:Electron.WebContents|undefined,started=false
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:browser.workspace.layout')layoutCalls.push({sender:event.sender.id,args:structuredClone(args)})
  if(channel==='navora:browser.workspace.preview')previews++
  if(channel==='navora:native-ui.show'){args[0]={...args[0],focusMode:'none'};panelRequests.push(structuredClone(args[0]))}
  if(channel==='navora:native-ui.update'&&args[2]?.content)panelUpdates.push(structuredClone(args[2].content))
  if(channel==='navora:browser.workspace.tabAction')tabActions.push(structuredClone(args[0]))
  if(channel==='navora:browser.workspace.setAlwaysOnTop')pinRequests.push({sender:event.sender.id,value:args[0]})
  if(channel==='navora:native-ui.closeMenu')menuResults.push({sender:event.sender.id,close:args[0]})
  const result=await listener(event,...args)
  if(channel==='navora:native-ui.menu')menuResults.push({sender:event.sender.id,result})
  return result
})
const nativePanels:NativePanel[]=[]
const nativeShow=NativePanel.prototype.show
NativePanel.prototype.show=function(options){nativePanels.push(this);return nativeShow.call(this,options)}
// Keep real Menu construction and callbacks without activating a desktop popup.
// Native window pinning itself below still uses the actual BrowserWindow API.
const menus:Menu[]=[],menuOptions=new WeakMap<Menu,Electron.PopupOptions>()
Menu.prototype.popup=function(options={}){menus.push(this);menuOptions.set(this,options)}
Menu.prototype.closePopup=function(){const options=menuOptions.get(this);menuOptions.delete(this);options?.callback?.()}
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>窗口恢复样本</title><style>body{height:2400px;background:#d9eafa}</style><input id="draft"><p>原生网页持续绘制</p><script>window.identity=crypto.randomUUID();window.paints=0;requestAnimationFrame(function tick(){window.paints++;requestAnimationFrame(tick)})</script>')})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref()
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/presentation`
async function finish(code:number){for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.destroy();await wait(250);app.exit(code)}
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let n=0;n<140;n++){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
function viewIn(win:BrowserWindow):WebContentsView|undefined{
  const walk=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(walk)]
  return walk(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents===guest)as WebContentsView|undefined
}
const paletteScript=`(()=>{const tab=[...document.querySelectorAll('.workspace-tab-item')].find(tab=>tab.checkVisibility()&&tab.querySelector('[role=tab][aria-selected=true]'));const style=getComputedStyle(tab),barNode=tab.closest('.file-workspace-head,.browser-host-tabs'),bar=getComputedStyle(barNode),root=document.documentElement,header=getComputedStyle(root).getPropertyValue('--appearance-header').trim(),transparent=barNode.matches('.browser-host-tabs')&&root.dataset.navoraWindowMaterial==='acrylic';if(!/^#[a-f0-9]{6}$/i.test(header))throw Error('Missing explicit header palette');const opaque='rgb('+[1,3,5].map(i=>parseInt(header.slice(i,i+2),16)).join(', ')+')',expected=transparent?'rgba(0, 0, 0, 0)':opaque;if(bar.backgroundColor!==expected)throw Error('Tab strip does not match its material policy: '+bar.backgroundColor+' vs '+expected);return {background:style.backgroundColor,border:style.borderColor,color:style.color,radius:style.borderRadius,height:style.height}})()`
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false)
  const send=win.webContents.send.bind(win.webContents)
  win.webContents.send=(channel,...args)=>{if(channel==='navora:browser.layout-invalidated')invalidations.push({window:win.id,value:structuredClone(args[0])});return send(channel,...args)}
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  if(started)return;started=true
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string)=>win.webContents.executeJavaScript(code)
    try{
      win.setContentSize(1600,950);await until(()=>js('!!window.navora&&!!document.querySelector(".composer")'),'actual main UI')
      const pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:presentation',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true);return id})()`)
      await until(()=>{guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url&&!wc.isLoading());return !!guest&&viewIn(win)?.getVisible()},'live embedded page')
      await guest!.executeJavaScript('document.querySelector("#draft").value="保留草稿";scrollTo(0,200)')
      const identity=await guest!.executeJavaScript('window.identity'),guestId=guest!.id
      const state=(host:BrowserWindow)=>host.webContents.executeJavaScript(`window.navora.browser.workspace.state().then(state=>state.pages.flatMap(s=>s.windows).find(p=>p.windowId===${JSON.stringify(pageId)}))`)
      const owner=(await state(win)).automation.owner
      await wait(700)
      // An unchanged native size must never hide a correctly committed page.
      win.emit('resize');assert.equal(viewIn(win)?.getVisible(),true)
      await wait(50);assert.equal(viewIn(win)?.getVisible(),true)
      checks.push('native-resize-with-unchanged-DOM-bounds-preserves-visible-page')
      for(const size of [[1500,900],[1420,870],[1560,930]])win.setContentSize(size[0]!,size[1]!)
      await until(()=>!!viewIn(win)?.getVisible(),'real rapid resize recovers')
      checks.push('rapid-real-window-resizes-commit-current-geometry')
      const embeddedPalette=await js(paletteScript)
      const embeddedHeader=await js('(()=>{const r=document.querySelector(".file-workspace-head").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.ceil(r.height)}})()')
      fs.writeFileSync(path.join(output,'workspace-tabs.png'),(await win.webContents.capturePage(embeddedHeader)).toPNG())
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'detach'})`)
      let detached:BrowserWindow|undefined
      await until(()=>{detached=BrowserWindow.getAllWindows().find(host=>host!==win&&host.webContents.getURL().includes('/browser-host/'));return !!detached&&viewIn(detached)?.getVisible()},'single detached page visible immediately')
      const host=detached!,hostJs=(code:string)=>host.webContents.executeJavaScript(code)
      await until(()=>hostJs('!!document.querySelector(".browser-host-tab.active")'),'active detached label')
      assert.deepEqual(await hostJs(paletteScript),embeddedPalette)
      fs.writeFileSync(path.join(output,'detached-tabs.png'),(await host.webContents.capturePage({x:0,y:0,width:host.getContentSize()[0],height:44})).toPNG())
      checks.push('selected-tabs-share-theme-and-strips-follow-explicit-material-policy')
      const hostControls=await hostJs(`(()=>{const selectors=['.browser-host-restore','.browser-host-pin','.browser-host-tablist','[aria-label="新建浏览器标签页"]'];return selectors.map(selector=>{const node=document.querySelector(selector),rect=node.getBoundingClientRect(),style=getComputedStyle(node),icon=node.querySelector('.app-icon');return {x:rect.x,width:rect.width,height:rect.height,radius:style.borderRadius,icon:icon&&getComputedStyle(icon).width}})})()`)
      assert.ok(hostControls[0].x<hostControls[1].x&&hostControls[1].x<hostControls[2].x&&hostControls[2].x<hostControls[3].x)
      for(const index of [0,1])assert.deepEqual({...hostControls[index],x:0},{...hostControls[3],x:0})
      assert.equal(host.isAlwaysOnTop(),false);assert.equal(win.isAlwaysOnTop(),false)
      await assert.rejects(js('window.navora.browser.workspace.setAlwaysOnTop(true)'),/detached_browser_window_required/)
      await assert.rejects(hostJs('window.navora.browser.workspace.setAlwaysOnTop("yes")'),/invalid_window_pin/)
      checks.push('detached-return-and-pin-precede-tabs-with-new-tab-button-dimensions-and-source-validation')
      await hostJs('document.querySelector(".browser-host-pin").click()')
      await until(()=>host.isAlwaysOnTop(),'native detached window pin enabled')
      await until(()=>hostJs('document.querySelector(".browser-host-pin").getAttribute("aria-pressed")==="true"'),'pin button synchronized')
      assert.equal((await hostJs('window.navora.browser.workspace.state()')).alwaysOnTop,true)
      assert.equal(win.isAlwaysOnTop(),false)
      host.webContents.send('navora:browser.always-on-top',{hostId:'obsolete-host',enabled:false});await wait(80)
      assert.equal(await hostJs('document.querySelector(".browser-host-pin").getAttribute("aria-pressed")'), 'true')
      await until(()=>hostJs('!document.querySelector(".browser-host-pin").disabled'),'pin request completely settled before opening view menu')
      await wait(200)
      const pinMenuCount=menus.length
      host.webContents.send('navora:app.menu-focus',{menu:'view',pageId})
      await until(()=>menus.length>pinMenuCount&&menus.at(-1)?.getMenuItemById('view.windowPinned'),'detached view menu exposes window pin')
      const pinMenu=menus.at(-1)!,pinItem=pinMenu.getMenuItemById('view.windowPinned')!
      assert.equal(pinItem.type,'checkbox');assert.equal(pinItem.checked,true);assert.equal(pinItem.enabled,true)
      pinItem.click(pinItem,host,{} as any)
      await until(()=>!host.isAlwaysOnTop(),'view menu changes actual native window pin')
      await until(()=>hostJs('document.querySelector(".browser-host-pin").getAttribute("aria-pressed")==="false"'),'view menu updates titlebar pin')
      host.setAlwaysOnTop(true)
      await until(()=>hostJs('document.querySelector(".browser-host-pin").getAttribute("aria-pressed")==="true"'),'external native pin event updates titlebar')
      host.setAlwaysOnTop(false)
      await until(()=>hostJs('document.querySelector(".browser-host-pin").getAttribute("aria-pressed")==="false"'),'external native unpin event updates titlebar')
      assert.equal(viewIn(host)?.getVisible(),true);assert.equal(previews,0);assert.equal(guest!.id,guestId)
      checks.push('titlebar-and-view-menu-share-real-always-on-top-with-native-event-sync-and-stale-host-rejection')
      for(let n=0;n<3;n++){
        host.emit('resize');await until(()=>!!viewIn(host)?.getVisible(),'detached unchanged rectangle recovery')
        host.hide();host.show();host.emit('restore');await until(()=>!!viewIn(host)?.getVisible(),'detached show and restore')
        await js(`window.navora.browser.setVisible(${JSON.stringify(pageId)},true)`)
        await until(()=>!!viewIn(host)?.getVisible(),'resource entry presents same detached tab')
      }
      assert.equal(await hostJs('document.querySelectorAll("[role=tab]").length'),1)
      checks.push('single-detached-tab-repeated-show-restore-and-resource-open-without-switch-or-reload')
      const current=invalidations.filter(item=>item.window===host.id).at(-1)!.value,previous=layoutCalls.length
      host.webContents.send('navora:browser.layout-invalidated',{...current,owner:'obsolete-owner',hostGeneration:current.hostGeneration+100})
      host.webContents.send('navora:browser.layout-invalidated',{...current,hostGeneration:0})
      await wait(160);assert.equal(layoutCalls.length,previous)
      checks.push('old-owner-and-old-host-generation-notifications-do-not-submit-layout')
      // All saved themes propagate to existing renderers; collect both hosts'
      // color computations with a separate embedded tab, without reloading guest.
      const sibling=await js(`window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:theme-reference','about:blank')`)
      await js(`window.navora.browser.setVisible(${JSON.stringify(sibling)},true)`)
      await until(()=>js('!!document.querySelector(".file-workspace-head .workspace-tab-item.active")'),'embedded theme reference')
      const extra=await js(`window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:pin-isolation','about:blank')`)
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(extra)},action:'detach'})`)
      let secondHost:BrowserWindow|undefined
      await until(()=>{secondHost=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&candidate!==host&&candidate.webContents.getURL().includes('/browser-host/'));return !!secondHost},'second detached window')
      await until(()=>secondHost!.webContents.executeJavaScript('!!document.querySelector(".browser-host-pin")'),'second detached pin button ready')
      await hostJs('window.navora.browser.workspace.setAlwaysOnTop(true)')
      assert.equal(host.isAlwaysOnTop(),true);assert.equal(secondHost!.isAlwaysOnTop(),false);assert.equal(win.isAlwaysOnTop(),false)
      await secondHost!.webContents.executeJavaScript('window.navora.browser.workspace.setAlwaysOnTop(true)')
      await hostJs('window.navora.browser.workspace.setAlwaysOnTop(false)')
      assert.equal(host.isAlwaysOnTop(),false);assert.equal(secondHost!.isAlwaysOnTop(),true)
      // The sole-page host is destroyed after transfer. Observe completion from
      // the surviving main window instead of awaiting a reply in its dead frame.
      await secondHost!.webContents.executeJavaScript(`void window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(extra)},action:'attach'}).catch(()=>{})`)
      await until(async()=>{const tree=await js('window.navora.browser.workspace.state().then(state=>state.pages.flatMap(session=>session.windows))');return tree.some((page:any)=>page.windowId===extra&&page.presentation==='embedded')},'second window transfer finishes in main host')
      await js(`window.navora.browser.setVisible(${JSON.stringify(sibling)},true)`)
      checks.push('two-detached-windows-pin-independently-and-do-not-pin-the-main-window')
      for(const theme of APPEARANCE_THEMES)for(const mode of ['light','dark']){
        await js(`window.navora.config.save({app:{appearance_theme:${JSON.stringify(theme.id)},appearance_mode:${JSON.stringify(mode)}}})`)
        await until(()=>hostJs(`document.documentElement.dataset.navoraTheme===${JSON.stringify(theme.id)}&&document.documentElement.dataset.navoraColorScheme===${JSON.stringify(mode)}`),'theme broadcast')
        await until(()=>js(`document.documentElement.dataset.navoraTheme===${JSON.stringify(theme.id)}&&document.documentElement.dataset.navoraColorScheme===${JSON.stringify(mode)}`),'main theme broadcast')
        // Theme events and CSS transitions cross process/frame boundaries. Wait
        // for matching settled colors rather than racing a single frame timer.
        await until(async()=>JSON.stringify(await js(paletteScript))===JSON.stringify(await hostJs(paletteScript)),`settled palette ${theme.id}/${mode}`)
        const left=await js(paletteScript),right=await hostJs(paletteScript);assert.deepEqual(right,left,`${theme.id}/${mode}`)
        observations.push({theme:theme.id,mode,palette:right})
      }
      checks.push('all-saved-themes-light-and-dark-match-across-existing-hosts')
      host.setContentSize(600,700)
      for(let n=0;n<3;n++)await hostJs(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'new',background:true})`)
      await until(()=>hostJs('!document.querySelector(".browser-tab-list-button").disabled'),'real tab overflow')
      await hostJs('document.querySelector(".browser-tab-list-button").click()')
      await until(()=>panelRequests.some(request=>request.content.id==='tab-list-root'),'native tab search')
      assert.equal(await hostJs('document.querySelectorAll(".browser-tab-list-panel,.browser-tab-list-scrim").length'),0)
      assert.equal(viewIn(host)?.getVisible(),true);assert.equal(previews,0)
      const shownTree=panelRequests.at(-1)!.content,findButton=(node:any):any=>node.type==='button'||node.type==='item'?node:(node.children||[]).map(findButton).find(Boolean),oldChoice=findButton(shownTree),actionsBefore=tabActions.length
      assert.ok(oldChoice,'Native tab search exposes an actionable row')
      nativePanels.at(-1)!.emit('action',{id:'tab-list-query',type:'change',value:'不匹配查询'})
      await until(()=>panelUpdates.some(content=>JSON.stringify(content).includes('没有匹配的标签页')),'native search filters results')
      nativePanels.at(-1)!.emit('action',{id:oldChoice.id,type:'click'});await wait(100);assert.equal(tabActions.length,actionsBefore)
      nativePanels.at(-1)!.hide();nativePanels.at(-1)!.emit('dismissed',{reason:'escape'})
      checks.push('tab-search-uses-native-controls-and-no-DOM-overlay')
      checks.push('native-query-updates-results-and-rejects-removed-choice-actions')
      const beforePaint=await guest!.executeJavaScript('window.paints');await wait(150)
      assert.equal(viewIn(host)?.getVisible(),true);assert.equal(guest!.id,guestId);assert.equal(await guest!.executeJavaScript('window.identity'),identity)
      assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'保留草稿');assert.ok(await guest!.executeJavaScript('window.paints')>beforePaint)
      assert.equal((await state(host)).automation.owner,owner);assert.equal(previews,0)
      checks.push('guest-identity-draft-rendering-control-and-zero-overlay-preview-preserved')
      await hostJs(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'attach'})`)
      await until(()=>!!viewIn(win)?.getVisible(),'return live page to workspace')
      const menuCount=menus.length,layoutCount=layoutCalls.length
      await js('document.querySelector(".chat-more-trigger").click()')
      await until(()=>menus.length>menuCount,'chat resources use real native Menu')
      const menu=menus.at(-1)!
      assert.equal(menu.getMenuItemById('pin')?.type,'checkbox')
      assert.equal(menu.getMenuItemById('search')?.accelerator,'CommandOrControl+F')
      assert.equal(await js('document.querySelectorAll(".conversation-actions-menu").length'),0)
      assert.equal(previews,0);assert.equal(viewIn(win)?.getVisible(),true)
      assert.equal(layoutCalls.slice(layoutCount).some(call=>!call.args[1]),false)
      menu.getMenuItemById('search')!.click(menu.getMenuItemById('search')!,win,{} as any)
      await until(()=>js('!!document.querySelector(".conversation-find")'),'native menu dispatches actual chat find action')
      checks.push('chat-more-is-native-with-checkbox-shortcuts-and-no-preview-or-blank-layout')
      checks.push('native-chat-find-action-reaches-existing-inline-search')
      await js('document.querySelector("[aria-label=关闭当前聊天查找]").click()')
      const rowMenus=menus.length
      await js('document.querySelector(".chat-item .chat-more-btn").click()')
      await until(()=>menus.length>rowMenus,'sidebar chat row uses native menu')
      const rowMenu=menus.at(-1)!
      assert.equal(rowMenu.getMenuItemById('export')?.enabled,false)
      assert.equal(await js('document.querySelectorAll(".chat-more-panel").length'),0)
      rowMenu.getMenuItemById('rename')!.click(rowMenu.getMenuItemById('rename')!,win,{} as any)
      await until(()=>js('!!document.querySelector(".chat-item-title-input")'),'row rename targets original chat')
      await js('document.querySelector(".chat-item-title-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
      assert.equal(viewIn(win)?.getVisible(),true);assert.equal(previews,0)
      checks.push('sidebar-row-native-menu-preserves-disabled-export-and-inline-rename-without-preview')
      const info=await js(`window.navora.workspace.info(${JSON.stringify(chat)})`),workspaceRoot=fs.realpathSync(info.absolutePath)
      assert.ok(workspaceRoot.startsWith(fs.realpathSync(profile)+path.sep),'Fixture file writes remain inside isolated profile')
      fs.writeFileSync(path.join(workspaceRoot,'native-menu-preview.md'),'# 原生文件菜单样本\n\n保留原文和预览。')
      await hostJs(`window.navora.fileTabs.open(${JSON.stringify(chat)},'native-menu-preview.md')`)
      await until(()=>js('document.querySelector(".preview-markdown")?.textContent.includes("原生文件菜单样本")'),'real file preview')
      const displayMenus=menus.length
      await js('document.querySelector("[aria-label=文件显示方式]").click()')
      await until(()=>menus.length>displayMenus,'native file display menu')
      const displayMenu=menus.at(-1)!
      assert.equal(displayMenu.getMenuItemById('preview')?.checked,true)
      displayMenu.getMenuItemById('source')!.click(displayMenu.getMenuItemById('source')!,win,{} as any)
      await until(()=>js('document.querySelector(".preview-code")?.textContent.includes("# 原生文件菜单样本")'),'native source action retains Markdown text')
      checks.push('file-display-native-radio-menu-switches-existing-preview-to-source')
      const openMenus=menus.length
      await js('document.querySelector("[aria-label=打开文件选项]").click()')
      await until(()=>menus.length>openMenus,'native file open options')
      const openMenu=menus.at(-1)!
      assert.equal(openMenu.getMenuItemById('reveal')?.enabled,true);assert.equal(openMenu.getMenuItemById('save')?.enabled,true)
      assert.equal(await js('document.querySelectorAll(".preview-open-menu").length'),0)
      openMenu.closePopup(win);assert.equal(previews,0)
      checks.push('file-open-options-use-native-menu-without-creating-DOM-overlay-or-page-preview')
      await until(()=>!viewIn(win)?.getVisible(),'actual file content suspends browser presentation')
      win.emit('focus');win.emit('restore');await wait(100)
      assert.equal(viewIn(win)?.getVisible(),false)
      checks.push('focus-and-restore-never-reopen-browser-over-intentionally-active-file-content')
      const remainingHostIds=await hostJs('window.navora.browser.workspace.state().then(state=>state.pages.flatMap(session=>session.windows).map(page=>page.windowId))')
      assert.ok(remainingHostIds.length>1)
      await hostJs('document.querySelector(".browser-host-restore").click()')
      await until(async()=>{const tree=await js('window.navora.browser.workspace.state().then(state=>state.pages.flatMap(session=>session.windows))');return remainingHostIds.every((id:string)=>tree.some((page:any)=>page.windowId===id&&page.presentation==='embedded'))},'titlebar return attaches all existing host tabs')
      assert.equal(guest!.isDestroyed(),false);assert.equal(await guest!.executeJavaScript('window.identity'),identity)
      checks.push('left-titlebar-return-moves-all-window-tabs-and-retains-existing-guest-instances')
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,invalidations,layoutCalls:layoutCalls.length,previews,boundaries:['Actual built renderer/preload/main and native Views; windows outside desktop, software compositor.','Native panel uses focusMode none and injected native actions; real Menu objects and application callbacks are used while OS popup display is suppressed. Physical menu input, focus, IME and multi-monitor DPI are not claimed.','Window pinning and external pin changes use actual BrowserWindow.setAlwaysOnTop/isAlwaysOnTop and native events.','RAF checks continuous rendering, not video decoding.']},null,2))
      console.log(JSON.stringify({ok:true,checks:checks.length,output}));await finish(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,invalidations,layoutCalls,tabActions,previews,errors,pinRequests,menuResults,windows:await Promise.all(BrowserWindow.getAllWindows().filter(host=>!host.isDestroyed()).map(async host=>({id:host.id,pinned:host.isAlwaysOnTop(),text:await host.webContents.executeJavaScript('document.body.innerText.slice(0,900)').catch(()=>null),tabs:await host.webContents.executeJavaScript(`({scheme:document.documentElement.dataset.navoraColorScheme,tabs:[...document.querySelectorAll('.workspace-tab-item')].map(tab=>{const style=getComputedStyle(tab);return {classes:tab.className,visible:tab.checkVisibility(),selected:tab.querySelector('[role=tab]')?.getAttribute('aria-selected'),key:tab.querySelector('[role=tab]')?.dataset.fileKey,page:tab.querySelector('[role=tab]')?.dataset.pageId,background:style.backgroundColor,color:style.color,active:style.getPropertyValue('--tab-active-bg'),ink:style.getPropertyValue('--tab-active-ink'),appearance:style.getPropertyValue('--appearance-ink'),parent:tab.parentElement.className}})})`).catch(()=>null)})))},null,2));console.error(error);await finish(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
