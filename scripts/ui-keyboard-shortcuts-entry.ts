import {app,BrowserWindow,webContents,type WebContents,type InputEvent} from 'electron'
import {createServer} from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {makeFileTab} from '../shared/file-tabs'
const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
// Simulate an existing installation with the retired setting still on disk.
Object.assign(config.browser.automation,{auto_mute:true})
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));app.setPath('userData',root)
fs.mkdirSync(path.join(root,'chats'),{recursive:true});fs.mkdirSync(path.join(root,'workspace','chat_shortcuts'),{recursive:true})
fs.writeFileSync(path.join(root,'workspace','chat_shortcuts','shortcuts.md'),'# 快捷键检查\n\n只读文件预览。')
const now=Date.now()
fs.writeFileSync(path.join(root,'chats','chat_shortcuts.json'),JSON.stringify({id:'chat_shortcuts',title:'快捷键设置检查',createdAt:now,updatedAt:now,messages:[{id:'shortcut_user',role:'user',content:'检查快捷键设置。',createdAt:now},{id:'shortcut_answer',role:'assistant',content:'[快捷键检查文件](shortcuts.md)',createdAt:now+1}]}))
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if(process.env.NAVORA_UI_REDUCED_MOTION==='1')app.commandLine.appendSwitch('force-prefers-reduced-motion')
const originalShowInactive=BrowserWindow.prototype.showInactive
const initiallyPositioned=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!initiallyPositioned.has(this)){initiallyPositioned.add(this);this.setPosition(-8000,-8000)}originalShowInactive.call(this)}
BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>,label:string){for(let n=0;n<120;n++){if(await check())return;await wait(60)}throw Error('UI did not settle: '+label)}
function key(wc:WebContents,keyCode:string,modifiers:InputEvent['modifiers']=['control']){wc.sendInputEvent({type:'keyDown',keyCode,modifiers});wc.sendInputEvent({type:'keyUp',keyCode,modifiers})}
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<title>Shortcut local fixture</title><input id="native-input"><script>window.shortcutKeys=[];document.addEventListener("keydown",e=>window.shortcutKeys.push(e.key))</script>')})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`
const checks:string[]=[],metrics:unknown[]=[],errors:string[]=[]
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string)=>win.webContents.executeJavaScript(code)
    const visible=(selector:string)=>js(`!!document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`)
    const helpOpen=()=>visible('.keyboard-shortcuts-panel')
    const capture=async(name:string,target=win)=>{await wait(200);fs.writeFileSync(path.join(output,name+'.png'),(await target.webContents.capturePage()).toPNG())}
    const click=async(selector:string)=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(100)}
    async function help(){key(win.webContents,'/');await until(helpOpen,'help opens');await wait(250)}
    async function closeHelp(){key(win.webContents,'/');await until(async()=>!await helpOpen(),'help closes');await wait(200)}
    async function menu(command:string){
      await js(`(()=>{const triggers=[...document.querySelectorAll('.application-menu-trigger')],label=${JSON.stringify(command.startsWith('help.')?'帮助':command.startsWith('conversation.search')?'编辑':'文件')};triggers.find(button=>button.textContent===label).click()})()`)
      await until(()=>visible(`[data-command="${command}"]`),'menu command '+command)
      await click(`[data-command="${command}"]`)
    }
    async function setShortcut(id:string,value:boolean){
      await js(`(()=>{const input=document.querySelector('[data-shortcut-id="${id}"] input');if(input.checked!==${value})input.click()})()`)
      await until(()=>js(`(async()=>{const config=await window.navora.config.get();return config.app.shortcuts?.[${JSON.stringify(id)}]===${value}&&!document.querySelector('[data-shortcut-id="${id}"] input').disabled})()`),id+' saved')
    }
    try{
      if(process.env.NAVORA_SETTINGS_AUDIO_ONLY==='1'){
        await until(()=>visible('.composer'),'main application ready')
        await click('.sidebar-settings-btn');await until(()=>visible('.settings-workspace'),'settings workspace')
        await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(button=>button.textContent.trim().startsWith("浏览器")).click()')
        await until(()=>visible('.browser-automation-settings'),'automation settings')
        assert.equal(await js('!!document.querySelector("input[aria-label*=自动静音]")'),false)
        assert.equal(await js('window.navora.config.get().then(config=>Object.hasOwn(config.browser.automation,"auto_mute"))'),false)
        assert.equal(await js('!!document.querySelector("input[aria-label=显示虚拟光标]")'),true)
        checks.push('legacy-auto-mute-discarded','auto-mute-switch-removed','cursor-settings-remain')
        await capture('browser-automation-without-auto-mute')
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,scope:'Targeted browser automation settings; full keyboard suite is separate',errors},null,2))
        console.log(JSON.stringify({ok:true,checks,output}));server.close();app.exit(0);return
      }
      await until(()=>visible('.composer'),'conversation ready');win.setContentSize(1100,850);await wait(250)
      await js('(()=>{window.shortcutOrigin=document.querySelector("[data-composer-editor] [contenteditable=true]");window.shortcutOrigin.focus()})()')
      assert.equal(await js('document.activeElement===window.shortcutOrigin'),true,'The original editor has real focus')
      await help();assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'搜索快捷键')
      const initial=await js('(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON(),list=document.querySelector(".keyboard-shortcuts-list");return {header:r(".keyboard-shortcuts-header"),footer:r(".keyboard-shortcuts-footer"),panel:r(".keyboard-shortcuts-panel"),client:list.clientHeight,scroll:list.scrollHeight,switches:document.querySelectorAll(".keyboard-shortcuts-panel [role=switch]").length}})()')
      assert.equal(initial.switches,4);assert.ok(initial.scroll>initial.client);metrics.push(initial)
      await capture('01-shortcuts-default')
      await js('document.querySelector(".keyboard-shortcuts-list").scrollTop=10000')
      const scrolled=await js('({header:document.querySelector(".keyboard-shortcuts-header").getBoundingClientRect().top,footer:document.querySelector(".keyboard-shortcuts-footer").getBoundingClientRect().bottom,top:document.querySelector(".keyboard-shortcuts-list").scrollTop})')
      assert.ok(scrolled.top>0);assert.ok(Math.abs(scrolled.header-initial.header.top)<.5);assert.ok(Math.abs(scrolled.footer-initial.footer.bottom)<.5)
      checks.push('ctrl-slash-open-search-focus','four-real-switches-only','fixed-header-footer-scrollable-middle')
      await js('(()=>{const input=document.querySelector("[aria-label=搜索快捷键]");input.value="加粗";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
      await until(()=>js('document.querySelectorAll(".keyboard-shortcut-row").length===1'),'shortcut filtering')
      assert.ok(await js('document.querySelector(".keyboard-shortcut-row").textContent.includes("加粗")'))
      await js('(()=>{const input=document.querySelector("[aria-label=搜索快捷键]");input.value="";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
      await until(()=>js('document.querySelectorAll(".keyboard-shortcut-row").length>20'),'shortcut filter reset');checks.push('search-filters-stable-catalog')
      for(const id of ['conversation.new','conversation.search','conversation.openFile','app.quit'])await setShortcut(id,false)
      await closeHelp()
      assert.equal(await js('document.activeElement===window.shortcutOrigin'),true,'Closing restores the original editor focus')
      await menu('help.shortcuts');await until(helpOpen,'help menu opens shortcuts');await wait(220)
      key(win.webContents,'Escape',[]);await until(async()=>!await helpOpen(),'Escape closes help');await wait(220)
      assert.equal(await js('document.activeElement===window.shortcutOrigin'),true,'Menu help also restores the original editor focus')
      checks.push('menu-help-and-escape-restore-focus')
      const before=await js('window.navora.chats.list().then(chats=>chats.length)')
      for(const code of ['N','K','O','Q']){key(win.webContents,code);await wait(150);assert.equal(await js('!!document.querySelector(".v-dialog.v-overlay--active")'),false)}
      assert.equal(await js('window.navora.chats.list().then(chats=>chats.length)'),before)
      checks.push('four-disabled-shortcuts-no-action','help-remains-available-when-all-disabled','close-restores-editor-focus')
      await menu('conversation.new');await until(()=>js(`window.navora.chats.list().then(chats=>chats.length===${before+1})`),'disabled shortcut leaves new-chat menu working')
      await menu('conversation.search');await until(()=>visible('.chat-search-panel'),'disabled shortcut leaves search menu working');key(win.webContents,'Escape',[]);await wait(200)
      await menu('conversation.openFile');await until(()=>visible('.workspace-file-picker'),'disabled shortcut leaves file menu working')
      key(win.webContents,'/');await wait(120);assert.equal(await helpOpen(),false,'A different modal blocks help shortcut')
      key(win.webContents,'Escape',[]);await until(async()=>!await visible('.workspace-file-picker'),'file picker closes')
      await menu('app.quit');await until(()=>js('[...document.querySelectorAll(".v-dialog.v-overlay--active")].some(element=>element.textContent.includes("确定要退出程序"))'),'disabled shortcut leaves quit menu working')
      await js('[...document.querySelectorAll(".v-dialog.v-overlay--active button")].find(button=>button.textContent.trim()==="取消").click()');await wait(200)
      checks.push('disabled-shortcuts-preserve-menu-actions','other-modal-blocks-help-shortcut')
      await js('window.navora.config.save({app:{show_run_logs:false},browser:{default_width:1599}})')
      await help();await click('.keyboard-shortcuts-footer button')
      await until(()=>js('(async()=>{const config=await window.navora.config.get();return ["conversation.new","conversation.search","conversation.openFile","app.quit"].every(id=>config.app.shortcuts[id]===true)})()'),'reset shortcuts')
      assert.deepEqual(await js('(async()=>{const c=await window.navora.config.get();return [c.app.show_run_logs,c.browser.default_width]})()'),[false,1599])
      checks.push('reset-only-shortcuts-preserves-other-settings')
      await closeHelp();key(win.webContents,'K');await until(()=>visible('.chat-search-panel'),'reenabled search works');key(win.webContents,'Escape',[]);await wait(180)
      await js('(()=>{const input=document.querySelector("[data-composer-editor]");input.dispatchEvent(new KeyboardEvent("keydown",{key:"/",ctrlKey:true,isComposing:true,bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"/",ctrlKey:true,repeat:true,bubbles:true,cancelable:true}))})()')
      await wait(100);assert.equal(await helpOpen(),false)
      await js('document.querySelector("[data-composer-editor]").dispatchEvent(new KeyboardEvent("keydown",{key:"/",metaKey:true,bubbles:true,cancelable:true}))')
      await until(helpOpen,'Cmd slash logical binding');await closeHelp();checks.push('ime-and-repeat-ignored','cmd-slash-logical-binding')
      await click('.sidebar-settings-btn');await until(()=>visible('.settings-workspace'),'settings view');await help();await closeHelp();assert.equal(await visible('.settings-workspace'),true);checks.push('help-toggles-inside-settings')
      await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(button=>button.textContent.trim().startsWith("浏览器")).click()')
      await until(()=>visible('.browser-automation-settings input[type=checkbox]'),'browser automation settings')
      assert.equal(await js('!!document.querySelector("input[aria-label*=自动静音]")'),false,'Retired automatic mute switch is absent')
      assert.equal(await js('window.navora.config.get().then(config=>Object.hasOwn(config.browser.automation,"auto_mute"))'),false,'Retired mute setting is absent from normalized config')
      checks.push('automatic-agent-muting-removed-from-settings-and-config')
      await capture('02-settings-browser-automation')
      await click('.settings-workspace [aria-label="返回上一页"]');await until(()=>visible('.composer'),'return to chat')
      win.setContentSize(1680,1000);await wait(220)
      await js('window.navora.chats.get("chat_shortcuts").then(()=>{document.querySelector(".chat-title-click")?.click()})')
      await js('window.navora.chats.setDraft("chat_shortcuts","原始草稿")')
      await js(`(async()=>{const chat=(await window.navora.chats.list()).find(chat=>chat.kind!=='sub');window.shortcutChat=chat.id;const session=await window.navora.browser.createSession(chat.id,{persist:false});const page=await window.navora.browser.createWindow(session.sessionId,{url:${JSON.stringify(url)},show:true});window.shortcutPage=page.windowId})()`)
      await until(()=>Promise.resolve(webContents.getAllWebContents().some(wc=>wc.getURL()===url)),'native local page')
      const guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!
      await guest.executeJavaScript('window.settingsPageState={value:17};document.querySelector("input").value="preserved draft"')
      const mainViewSnapshot=()=>js('(()=>{const main=document.querySelector(".main"),workspace=document.querySelector(".file-workspace"),active=workspace?.querySelector("[role=tab][aria-selected=true]");return {mode:main.className,workspace:workspace?.className||null,active:active?.getAttribute("data-page-id")||active?.getAttribute("data-file-key")||null,chat:document.querySelector(".chat-item.active .chat-item-title-text")?.textContent||null}})()')
      let browserMenuCaptured=false
      async function chooseBrowserSettings(source=win){
        const sourceJs=(code:string)=>source.webContents.executeJavaScript(code)
        await sourceJs('(()=>{const button=[...document.querySelectorAll("[aria-label=\\"浏览器更多操作\\"]")].find(button=>button.checkVisibility());button.click()})()')
        await until(()=>sourceJs('!!document.querySelector(".ui-action-menu[aria-label=\\"浏览器更多操作\\"]")?.checkVisibility()'),'browser more menu')
        await wait(240)
        const ordering=await sourceJs('(()=>{const menu=document.querySelector(".ui-action-menu[aria-label=\\"浏览器更多操作\\"]"),buttons=[...menu.querySelectorAll("button")],settings=buttons.find(button=>button.textContent.trim()==="浏览器设置");return {labels:buttons.map(button=>button.textContent.trim()),separate:settings.previousElementSibling?.classList.contains("ui-menu-divider"),gear:!!settings.querySelector("[data-icon=gear]")}})()')
        assert.ok(ordering.labels.indexOf('浏览器设置')>ordering.labels.indexOf('下载列表'))
        assert.ok(ordering.labels.indexOf('浏览器设置')<ordering.labels.findIndex((label:string)=>label==='移至独立窗口'||label==='移回主工作区'))
        assert.equal(ordering.separate,true);assert.equal(ordering.gear,true)
        if(source===win&&!browserMenuCaptured){await capture('browser-more-settings-menu');browserMenuCaptured=true}
        await sourceJs('[...document.querySelectorAll(".ui-action-menu[aria-label=\\"浏览器更多操作\\"] button")].find(button=>button.textContent.trim()==="浏览器设置").focus()')
        source.webContents.focus()
        assert.equal(await sourceJs('document.activeElement.textContent.trim()'),'浏览器设置')
        source.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
        source.webContents.sendInputEvent({type:'char',keyCode:'\r'})
        source.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
      }
      async function browserSettingsRoundTrip(label:string,source=win){
        const before=await mainViewSnapshot(),nativeId=guest.id
        await js('(()=>{window.browserSettingsFocusTrace=[];document.addEventListener("focusin",event=>window.browserSettingsFocusTrace.push({tag:event.target.tagName,cls:event.target.className,text:event.target.textContent?.slice(0,70)}))})()')
        await chooseBrowserSettings(source)
        await until(()=>js('document.querySelector(".settings-workspace .settings-current-title")?.textContent.trim()==="浏览器"'),'main browser settings from '+label)
        try{await until(()=>js('document.activeElement===document.querySelector(".settings-workspace .settings-current-title")'),'settings heading receives keyboard focus')}catch(cause){console.log(await js('JSON.stringify({active:document.activeElement.outerHTML.slice(0,500),heading:document.querySelector(".settings-workspace .settings-current-title").outerHTML,trace:window.browserSettingsFocusTrace})'));throw cause}
        assert.equal(await js('!!document.querySelector(".browser-automation-settings-dialog.v-overlay--active")'),false,'The new menu opens the main settings workspace')
        if(source!==win)assert.equal(await source.webContents.executeJavaScript('!!document.querySelector(".settings-page")'),false,'Detached source does not create a local settings dialog')
        await capture('browser-settings-'+label)
        await click('.settings-workspace [aria-label="返回上一页"]');await until(async()=>!await visible('.settings-workspace'),'browser settings returns from '+label);await wait(240)
        assert.deepEqual(await mainViewSnapshot(),before,'Settings keeps the main window mode, active chat and tab')
        assert.equal(guest.id,nativeId);assert.equal(await guest.executeJavaScript('window.settingsPageState.value'),17)
        assert.equal(await guest.executeJavaScript('document.querySelector("input").value'),'preserved draft')
        checks.push('browser-more-settings-'+label+'-returns-to-original-view')
      }
      await until(()=>js('(async()=>{const state=await window.navora.browser.workspace.state();return state.pages.flatMap(session=>session.windows).some(page=>page.windowId===window.shortcutPage&&page.hostActive)})()'),'native page active');await wait(200)
      key(guest,'/');await until(helpOpen,'native webview forwards Ctrl slash');await closeHelp();checks.push('native-webview-help-dispatch')
      await help();await setShortcut('conversation.new',false);await closeHelp()
      const nativeBefore=await js('window.navora.chats.list().then(chats=>chats.length)')
      key(guest,'N');await wait(220);assert.equal(await js('window.navora.chats.list().then(chats=>chats.length)'),nativeBefore)
      assert.equal(await guest.executeJavaScript('window.shortcutKeys.includes("n")||window.shortcutKeys.includes("N")'),false,'Disabled app binding is consumed before guest DOM')
      checks.push('native-webview-disabled-binding-consumed')
      assert.equal(await js('document.querySelector(".file-workspace").classList.contains("overlay")'),false,'The first browser-settings path uses a real split workspace')
      await browserSettingsRoundTrip('split')
      await click('[aria-label="展开工作区"]');await until(()=>js('document.querySelector(".main").classList.contains("workspace-single")'),'expanded workspace')
      await browserSettingsRoundTrip('expanded')
      await click('[aria-label="收起工作区（恢复分栏）"]')
      await click('[data-panel="browser"]');await until(()=>visible('.file-workspace.full-page'),'full browser resource view')
      await browserSettingsRoundTrip('full-browser')
      await click('[data-panel="chats"]');await until(()=>visible('.composer'),'back from full browser view')
      await js('window.navora.browser.workspace.tabAction({chatId:window.shortcutChat,action:"detach",pageId:window.shortcutPage})')
      await until(()=>Promise.resolve(BrowserWindow.getAllWindows().some(candidate=>candidate!==win&&candidate.webContents.getURL().includes('/browser-host/'))),'detached browser host')
      const detached=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&candidate.webContents.getURL().includes('/browser-host/'))!
      const detachedJs=(code:string)=>detached.webContents.executeJavaScript(code)
      await until(()=>detachedJs('!!document.querySelector(".browser-tab-panel")'),'detached browser panel')
      await wait(250);key(guest,'/');await until(()=>detachedJs('!!document.querySelector(".keyboard-shortcuts-panel")?.checkVisibility()'),'detached guest opens help')
      assert.equal(await detachedJs('document.querySelector("[data-shortcut-id=\\"conversation.new\\"] input").checked'),false,'Detached help sees saved preferences')
      await js('window.navora.config.save({app:{shortcuts:{"conversation.new":true}}})')
      await until(()=>detachedJs('document.querySelector("[data-shortcut-id=\\"conversation.new\\"] input").checked'),'live enabled preference broadcast to detached dialog')
      await js('window.navora.config.save({app:{shortcuts:{"conversation.new":false}}})')
      await until(()=>detachedJs('!document.querySelector("[data-shortcut-id=\\"conversation.new\\"] input").checked'),'live disabled preference broadcast to detached dialog')
      checks.push('live-preference-broadcast-to-detached-dialog')
      await capture('02-shortcuts-detached-browser',detached)
      key(detached.webContents,'/');await until(()=>detachedJs('!document.querySelector(".keyboard-shortcuts-panel")?.checkVisibility()'),'detached help closes')
      checks.push('detached-browser-native-help','cross-window-shortcut-preferences')
      await browserSettingsRoundTrip('detached',detached)
      await click('.sidebar-settings-btn');await until(()=>visible('.settings-workspace'),'existing settings opened')
      await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(button=>button.textContent.trim().startsWith("模型")).click()')
      await until(()=>visible('.settings-workspace input[type=password]'),'model connection key input')
      await js('(()=>{window.originalSettingsConfirm=window.confirm;window.settingsConfirmCalls=0;window.confirm=()=>{window.settingsConfirmCalls++;return false};const input=document.querySelector(".settings-workspace input[type=password]");input.value="fixture-unsaved-key";input.dispatchEvent(new Event("input",{bubbles:true}))})()');await wait(100)
      await chooseBrowserSettings(detached)
      try{await until(()=>js('window.settingsConfirmCalls===1'),'existing credential guard asks before changing settings category')}catch(cause){console.log(await js('JSON.stringify({confirms:window.settingsConfirmCalls,title:document.querySelector(".settings-current-title")?.textContent,inputLength:document.querySelector(".settings-workspace input[type=password]")?.value.length,route:location.hash})'));throw cause}
      assert.equal(await js('document.querySelector(".settings-workspace input[type=password]").value'),'fixture-unsaved-key')
      assert.ok((await js('document.querySelector(".settings-navigation .nav-item.active").textContent')).includes('模型'))
      await js('void(window.confirm=()=>{window.settingsConfirmCalls++;return true})')
      await chooseBrowserSettings(detached)
      await until(()=>js('document.querySelector(".settings-workspace .settings-current-title")?.textContent.trim()==="浏览器"'),'existing settings accepts browser category after guard')
      assert.equal(await js('window.settingsConfirmCalls'),2)
      await js('void(window.confirm=window.originalSettingsConfirm)')
      checks.push('browser-settings-menu-order-gear-and-keyboard','browser-settings-existing-category-watches-request','browser-settings-credential-guard-cancel-keeps-draft')
      await click('[aria-label="使用文档"]');await until(()=>visible('.docs-workspace'),'main window on usage guide')
      checks.push('browser-settings-nonsecret-draft-guard-permits-route-leave')
      await chooseBrowserSettings(detached)
      await until(()=>js('document.querySelector(".settings-workspace .settings-current-title")?.textContent.trim()==="浏览器"'),'detached browser opens settings from a different main route')
      assert.equal(await guest.executeJavaScript('window.settingsPageState.value'),17,'Changing the main app route does not reload the independent native page')
      assert.equal(await detachedJs('(async()=>{const state=await window.navora.browser.workspace.state();return state.pages.flatMap(session=>session.windows).find(page=>page.windowId===state.pages.flatMap(session=>session.windows)[0].windowId).presentation})()'),'detached')
      await click('.settings-workspace [aria-label="返回上一页"]');await until(async()=>!await visible('.settings-workspace'),'browser settings closes after returning from usage guide')
      checks.push('browser-settings-from-non-chat-main-route-retains-native-page')
      await js(`window.navora.fileTabs.detach(${JSON.stringify(makeFileTab('chat_shortcuts','shortcuts.md'))},'chat_shortcuts')`)
      await until(()=>Promise.resolve(BrowserWindow.getAllWindows().some(candidate=>candidate!==win&&candidate.webContents.getURL().includes('/file-host'))),'detached file host')
      const fileHost=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&candidate.webContents.getURL().includes('/file-host'))!
      await until(()=>fileHost.webContents.executeJavaScript('!!document.querySelector(".file-host-tabs [role=tab]")'),'file host ready')
      key(fileHost.webContents,'/');await until(()=>fileHost.webContents.executeJavaScript('!!document.querySelector(".keyboard-shortcuts-panel")?.checkVisibility()'),'detached file opens help')
      key(fileHost.webContents,'/');await until(()=>fileHost.webContents.executeJavaScript('!document.querySelector(".keyboard-shortcuts-panel")?.checkVisibility()'),'detached file closes help')
      checks.push('detached-file-help-toggle')
      // Reload tests the settings App handshake, not an unrelated automatic tab-selection preference.
      const guestBeforeReload=guest.id
      const freshDocument=new Promise<void>(resolve=>win.webContents.once('did-finish-load',()=>resolve()));win.webContents.reload();await freshDocument;await until(()=>js('!!window.navora?.app?.openSettings'),'fresh preload after main reload')
      await js('void(window.reloadSettingsPromise=window.navora.app.openSettings("browser").then(result=>window.reloadSettingsResult=result))')
      await until(()=>js('window.reloadSettingsResult?.ok===true&&document.querySelector(".settings-workspace .settings-current-title")?.textContent.trim()==="浏览器"'),'fresh main document completes the real settings handshake')
      assert.equal(guest.id,guestBeforeReload);assert.equal(await guest.executeJavaScript('window.settingsPageState.value'),17);assert.equal(await guest.executeJavaScript('document.querySelector("input").value'),'preserved draft')
      await click('.settings-workspace [aria-label="返回上一页"]');await until(async()=>!await visible('.settings-workspace'),'settings closes after real main reload')
      checks.push('settings-fresh-document-handshake','main-reload-retains-independent-native-page-and-draft')
      await js('window.navora.config.save({app:{appearance_theme:"graphite",appearance_mode:"dark"}})');await help();await wait(180);await capture('03-shortcuts-dark');await closeHelp()
      // The product main window has a 720px minimum. Relax it only inside this
      // isolated fixture to exercise the dialog's actual sub-520px CSS layout.
      win.setMinimumSize(350,500);win.setContentSize(420,760);await wait(200);await help()
      const narrow=await js('(()=>{const p=document.querySelector(".keyboard-shortcuts-panel").getBoundingClientRect(),list=document.querySelector(".keyboard-shortcuts-list"),footer=document.querySelector(".keyboard-shortcuts-footer").getBoundingClientRect();return {left:p.left,right:p.right,bottom:p.bottom,width:innerWidth,height:innerHeight,scroll:list.scrollHeight,client:list.clientHeight,footerBottom:footer.bottom}})()')
      assert.ok(narrow.width<520,'The narrow fixture really reaches the responsive CSS breakpoint');assert.ok(narrow.left>=0&&narrow.right<=narrow.width&&narrow.footerBottom<=narrow.height);assert.ok(narrow.scroll>narrow.client);metrics.push(narrow)
      await capture('04-shortcuts-narrow-dark');await closeHelp();checks.push('dark-theme','narrow-layout-no-horizontal-overflow')
      assert.deepEqual(errors,[],'No renderer errors')
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,metrics,electron:process.versions.electron,rendererBundle:fs.readFileSync(path.resolve('dist/index.html'),'utf8').match(/assets\/index-[^"\s]+\.js/)?.[0],limitations:['Windows native key forwarding verified; Cmd binding is a renderer event fixture, not a physical macOS keyboard test','Application fixture never calls a model and uses isolated temporary data','Windows are positioned offscreen for native composition','The isolated fixture relaxes the main window minimum width to test the dialog at an actual sub-520px CSS viewport']},null,2))
      console.log(JSON.stringify({ok:true,checks:checks.length,output}));server.close();app.exit(0)
    }catch(error){console.error(error);await capture('failure');server.close();app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(process.env.NAVORA_UI_PROJECT!,'dist-electron','main.js')).href)
