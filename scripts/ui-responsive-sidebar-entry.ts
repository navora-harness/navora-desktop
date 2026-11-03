import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
const profile=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,project=process.env.NAVORA_UI_PROJECT!
app.setPath('userData',profile)
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true});fs.mkdirSync(path.join(profile,'workspace','chat_layout'),{recursive:true})
fs.writeFileSync(path.join(profile,'workspace','chat_layout','layout.md'),'# 工作区布局资料\n\n保持相同文件实例。')
const now=Date.now()
for(let n=0;n<45;n++)fs.writeFileSync(path.join(profile,'chats',`chat_layout${n||''}.json`),JSON.stringify({id:`chat_layout${n||''}`,title:n?`布局历史对话 ${n}`:'工作区响应式检查',createdAt:now-n*60000,updatedAt:now-n*60000,draft:n?'':'保留父对话草稿',messages:n?[]:[{id:'layout_user',role:'user',content:'检查工作区布局。',createdAt:now-1},{id:'layout_answer',role:'assistant',content:'[布局资料](layout.md)'+Array.from({length:35},(_,i)=>`\n\n阅读段落 ${i}：展开与还原时保留内容。`).join(''),createdAt:now}]}))
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if(process.env.NAVORA_UI_REDUCED_MOTION==='1')app.commandLine.appendSwitch('force-prefers-reduced-motion')
const show=BrowserWindow.prototype.showInactive
const placedWindows=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placedWindows.has(this)){placedWindows.add(this);this.setPosition(-8000,-8000)};show.call(this)};BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:string[]=[],metrics:unknown[]=[],errors:string[]=[]
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string)=>win.webContents.executeJavaScript(code)
    const until=async(code:string,label=code)=>{for(let n=0;n<150;n++){if(await js(code))return;await wait(60)}throw Error('UI did not settle: '+label)}
    const click=async(selector:string)=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(160)}
    const capture=async(name:string)=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())
    const geometry=()=>js('(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {main:r(".main"),workspace:r(".file-workspace"),sidebar:r("aside.sidebar"),editor:r(".composer"),expanded:document.querySelector(".main").dataset.workspaceExpansion,single:document.querySelector(".main").classList.contains("workspace-single"),floating:document.querySelector(".main-shell").classList.contains("sidebar-floating")}})()')
    const resize=async(width:number)=>{win.setContentSize(width,950);await wait(600)}
    const drag=async(targetX:number,cancel=false)=>{
      const r=await js('document.querySelector(".file-workspace-resizer").getBoundingClientRect().toJSON()'),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2)
      await js('(()=>{window.layoutPointerTrace=[];for(const type of ["pointerdown","pointermove","pointerup","pointercancel","lostpointercapture"])document.addEventListener(type,event=>window.layoutPointerTrace.push({type,x:event.clientX,y:event.clientY,buttons:event.buttons,target:event.target.className,trusted:event.isTrusted}),{capture:true,once:true});window.layoutHit=document.elementFromPoint('+x+','+y+')?.className})()')
      metrics.push({dragFrom:r,targetX,zoom:win.webContents.getZoomFactor(),hit:await js('window.layoutHit')})
      win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(targetX),y,button:'left'});await wait(120)
      metrics.push({pointer:await js('window.layoutPointerTrace'),preview:await js('document.querySelector(".workspace-expand-preview")?.textContent')})
      assert.equal(await js('!!document.querySelector(".workspace-expand-preview")'),true,'Real pointer movement reaches the expansion preview')
      if(cancel){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})}
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(targetX),y});await wait(300)
      metrics.push({afterPointer:await js('window.layoutPointerTrace'),afterGeometry:await geometry(),previewAfter:await js('document.querySelector(".workspace-expand-preview")?.textContent')})
    }
    try{
      await resize(1680);await until('!!document.querySelector(".composer")','initial composer')
      const header=await js('(()=>{const menus=[...document.querySelectorAll(".window-titlebar .application-menu-trigger")],button=document.querySelector(".window-sidebar-toggle");return {menuRight:menus.at(-1).getBoundingClientRect().right,buttonLeft:button.getBoundingClientRect().left}})()');assert.ok(header.buttonLeft>header.menuRight);checks.push('sidebar-toggle-stays-on-right-of-titlebar-menus')
      await js('document.querySelector("[data-panel=chats]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:25,clientY:100}))');await until('!!document.querySelector(".sidebar-ctx-panel [role=menuitemcheckbox]")','rail context menu')
      await click('.sidebar-ctx-panel [role=menuitemcheckbox]');await until('document.querySelector(".main-shell").classList.contains("sidebar-collapsed")','rail menu hides sidebar');await click('.window-sidebar-toggle');checks.push('rail-context-menu-controls-same-sidebar-visibility')
      await js('[...document.querySelectorAll(".window-titlebar .application-menu-trigger")].find(button=>button.textContent.trim()==="视图").click()');await until('!!document.querySelector("[data-command=\\"view.sidebar\\"]")','view menu')
      assert.equal(await js('document.querySelector("[data-command=\\"view.sidebar\\"]").getAttribute("aria-checked")'),'true');assert.equal(await js('document.querySelector("[data-command=\\"view.sidebarPinned\\"]").getAttribute("aria-checked")'),'true');await click('[data-command="view.sidebar"]');await until('document.querySelector(".main-shell").classList.contains("sidebar-collapsed")','view menu hides sidebar');await click('.window-sidebar-toggle');checks.push('view-menu-shares-visible-and-pinned-state-with-rail-and-toggle')
      await js('window.layoutList=document.querySelector(".chat-list");window.layoutEditor=document.querySelector(".composer [contenteditable=true]");window.layoutList.scrollTop=130')
      await click('.messages a[href="layout.md"]');await until('!!document.querySelector(".file-workspace-resizer")','split file workspace')
      let g=await geometry();assert.equal(g.single,false);assert.ok(g.workspace.width>=400&&g.main.width-g.workspace.width>=479);metrics.push(g);checks.push('wide-window-split-respects-both-minima')
      const key=await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").dataset.fileKey')
      await resize(1100);await until('document.querySelector(".main").classList.contains("workspace-single")','automatic expansion')
      assert.equal(await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").dataset.fileKey'),key)
      assert.equal(await js('!!document.querySelector(".file-workspace [data-conversation-tab]")'),true)
      assert.equal((await geometry()).expanded,'viewport');checks.push('narrow-budget-expands-with-conversation-first-tab-and-preserves-selected-file');await capture('01-automatic-workspace')
      await resize(1680);await until('!document.querySelector(".main").classList.contains("workspace-single")','automatic split recovery');checks.push('automatic-expansion-recovers-after-hysteresis')
      await click('.workspace-expand');await resize(1100);await resize(1680);assert.equal((await geometry()).single,true);checks.push('manual-expansion-survives-window-resize')
      await click('.workspace-expand');await until('!!document.querySelector(".file-workspace-resizer")','explicit split restore')
      g=await geometry();const width=g.workspace.width
      await drag(g.main.x+150,true);assert.equal((await geometry()).single,false);assert.ok(Math.abs((await geometry()).workspace.width-width)<2);checks.push('escape-cancels-real-pointer-resize-without-saving-preview')
      await drag(g.main.x+150);await until('document.querySelector(".main").classList.contains("workspace-single")','divider workspace expansion');assert.equal((await geometry()).expanded,'divider');checks.push('left-drag-commits-workspace-expansion-after-pointer-up')
      await click('.workspace-expand');await until('!!document.querySelector(".file-workspace-resizer")','split before expanding conversation');g=await geometry()
      await drag(g.main.right-200);await until('document.querySelector(".main").classList.contains("workspace-chat-active")','divider conversation expansion');checks.push('right-drag-expands-conversation-first-tab')
      await click('.workspace-expand');await until('!!document.querySelector(".file-workspace-resizer")','split after conversation expansion')
      await click('[aria-label="切换为悬浮侧栏"]');await until('document.querySelector(".main-shell").classList.contains("sidebar-floating")','floating sidebar')
      assert.equal(await js('document.querySelector(".chat-list")===window.layoutList'),true);assert.equal(await js('document.querySelector(".composer [contenteditable=true]")===window.layoutEditor'),true)
      await until('Math.abs(document.querySelector(".main").getBoundingClientRect().left-document.querySelector(".activity-rail").getBoundingClientRect().right)<2','floating grid transition settled')
      g=await geometry();assert.ok(g.sidebar.x>=52&&g.sidebar.right<g.main.right);assert.ok(Math.abs(g.main.x-52)<2);metrics.push(g);checks.push('floating-sidebar-reuses-list-and-editor-without-reserving-content-width');await capture('02-floating-sidebar')
      const gutter=await js('(()=>{const list=document.querySelector(".chat-list"),row=list.querySelector(".chat-item"),l=list.getBoundingClientRect(),r=row.getBoundingClientRect();return {gap:l.right-r.right,scroll:list.scrollHeight>list.clientHeight,nested:[...list.querySelectorAll("*")].filter(e=>e.scrollHeight>e.clientHeight+2&&/auto|scroll/.test(getComputedStyle(e).overflowY)).length}})()');assert.ok(gutter.gap>=8);assert.equal(gutter.scroll,true);assert.equal(gutter.nested,0);metrics.push(gutter);checks.push('sidebar-native-scroll-gutter-remains-outside-row-background')
      await js('document.querySelector(".main").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');await until('document.querySelector(".main-shell").classList.contains("sidebar-collapsed")','floating outside dismiss')
      await click('.window-sidebar-toggle');await until('!document.querySelector(".main-shell").classList.contains("sidebar-collapsed")','same-position show');assert.equal(await js('document.querySelector(".chat-list")===window.layoutList'),true)
      await click('[aria-label="固定侧栏"]');await until('!document.querySelector(".main-shell").classList.contains("sidebar-floating")','pin sidebar');await js('document.querySelector(".main").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');assert.equal(await js('document.querySelector(".main-shell").classList.contains("sidebar-collapsed")'),false);checks.push('floating-dismiss-and-pin-preference-are-independent-from-visibility')
      await resize(740);assert.equal((await geometry()).floating,true);assert.equal(await js('JSON.parse(localStorage.getItem("navora.sidebar.presentation.v1")).mode'),'fixed');await resize(1680);await until('!document.querySelector(".main-shell").classList.contains("sidebar-floating")','temporary floating recovery');checks.push('narrow-sidebar-temporarily-floats-without-overwriting-fixed-preference')
      await click('[aria-label="切换为悬浮侧栏"]');await click('.sidebar-settings-btn');await until('!!document.querySelector(".settings-workspace")','settings entered from floating')
      assert.equal(await js('document.querySelector(".main-shell").classList.contains("sidebar-floating")'),false)
      await click('.sidebar-settings-btn');await until('!document.querySelector(".settings-workspace")','settings returned');assert.equal((await geometry()).floating,true);checks.push('settings-return-restores-floating-preference-and-existing-content')
      assert.equal(await js('document.querySelector(".chat-list")===window.layoutList'),true);assert.equal(await js('document.querySelector(".composer [contenteditable=true]")===window.layoutEditor'),true)
      assert.equal(await js('document.querySelector(".composer [contenteditable=true]").textContent.includes("保留父对话草稿")'),true)
      const persisted=await js('JSON.parse(localStorage.getItem("navora.workspace-tabs.v2"))');assert.equal(persisted.version,2);assert.equal(persisted.workspaces[0][1].tabs[0].path,'layout.md');checks.push('versioned-workspace-metadata-and-parent-draft-preserved')
      await resize(800);await until('!!document.querySelector("[data-conversation-tab]")','narrow workspace before composition');await click('[data-conversation-tab]')
      await js('(()=>{const editor=document.querySelector(".composer [contenteditable=true]");editor.focus();editor.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))})()');await resize(1680)
      assert.equal(await js('!!document.querySelector("[data-conversation-tab]")'),true,'Composition defers optional split recovery')
      await js('document.querySelector(".composer [contenteditable=true]").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));document.activeElement.blur()');await until('!document.querySelector("[data-conversation-tab]")','split recovers after composition settles');checks.push('composition-defers-optional-reflow-without-permanently-locking-expanded-layout')
      await capture('03-return-preserves-layout');assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,metrics,errors,reduced:process.env.NAVORA_UI_REDUCED_MOTION==='1',limitations:['Real renderer pointer capture; no physical OS mouse or display migration','Isolated actual application and local files; no model calls']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
    }catch(error){await capture('failure');fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,metrics,errors},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
