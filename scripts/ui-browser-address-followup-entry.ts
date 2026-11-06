import {app,BrowserWindow,NativePanel,WebContentsView,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'
import type {BrowserAutomationState} from '../shared/browser-automation'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_address_followup'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('Explicit isolated data root required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true});fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'地址建议独立验收',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const inactive=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)}inactive.call(this)};BrowserWindow.prototype.focus=function(){}
const requests:NativePanelShow[]=[],updates:NativePanelContent[]=[],panels:NativePanel[]=[],visible=new Set<NativePanel>(),deletes:unknown[][]=[],commands:unknown[][]=[],checks:string[]=[],errors:string[]=[]
let previews=0,failDelete=false,deleteGate:Promise<void>|undefined,patch:Partial<BrowserAutomationState>|undefined,pageId=''
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){args[0]={...args[0],focusMode:'none',dismissOnOutsideClick:false,dismissOnEscape:false};requests.push(structuredClone(args[0]))}
  if(channel==='navora:native-ui.update'&&args[2]?.content)updates.push(structuredClone(args[2].content))
  if(channel==='navora:browser.workspace.preview')previews++
  if(channel==='navora:browser.workspace.command')commands.push(structuredClone(args))
  if(channel==='navora:browser.workspace.start.clearHistory'){deletes.push(structuredClone(args));if(failDelete){failDelete=false;throw Error('isolated_history_persistence_failure')}if(deleteGate)await deleteGate}
  const result=await listener(event,...args)
  if(patch&&(channel==='navora:browser.workspace.state'||channel==='navora:browser.workspace.tabState')){
    const value=structuredClone(result),change=(page:any)=>page.windowId===pageId?{...page,automation:{...page.automation,...patch}}:page
    value.pages=value.pages.map((page:any)=>page.windows?{...page,windows:page.windows.map(change)}:change(page));return value
  }
  return result
})
const nativeShow=NativePanel.prototype.show,nativeHide=NativePanel.prototype.hide,nativeDestroy=NativePanel.prototype.destroy
NativePanel.prototype.show=function(options){panels.push(this);visible.add(this);return nativeShow.call(this,options)}
NativePanel.prototype.hide=function(){visible.delete(this);return nativeHide.call(this)}
NativePanel.prototype.destroy=function(){visible.delete(this);return nativeDestroy.call(this)}
const local=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end('<!doctype html><title>地址建议本地网页</title><input value="网页草稿"><script>window.identity=crypto.randomUUID();window.paints=0;requestAnimationFrame(function tick(){window.paints++;requestAnimationFrame(tick)})</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const origin=`http://127.0.0.1:${(local.address() as {port:number}).port}`,url=origin+'/page'
fs.writeFileSync(path.join(profile,'browser-start.json'),JSON.stringify({links:[],history:[1,2,3].map(index=>({chatId:chat,url:origin+'/history-'+index,title:'sample 历史 '+index,visitedAt:index}))}))
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),nodes=(tree:NativePanelContent):NativePanelContent[]=>[tree,...(tree.children||[]).flatMap(nodes)]
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let index=0;index<150;index++){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code),field='document.querySelector("[aria-label=浏览器地址]")'
    const input=async(value:string)=>{await js(`(()=>{const field=${field};field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(75)}
    const key=(key:string,shift=false)=>js(`${field}.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${shift},bubbles:true,cancelable:true}))`)
    const latest=()=>[...updates].reverse().find(tree=>tree.id==='address-suggestions-root')||[...requests].reverse().find(request=>request.content.id==='address-suggestions-root')!.content
    const deleteControls=()=>nodes(latest()).filter(node=>node.type==='iconButton')
    try{
      win.setContentSize(1450,900);await until(()=>js('!!document.querySelector(".composer")'),'main renderer')
      pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:address-followup',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true);return id})()`)
      let guest:Electron.WebContents|undefined
      await until(()=>{guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url&&!wc.isLoading());return !!guest},'local webpage')
      const walk=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(walk)],view=()=>walk(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents===guest) as WebContentsView|undefined
      await until(()=>!!view()?.getVisible(),'live webpage');const identity=await guest!.executeJavaScript('window.identity')
      guest!.focus();guest!.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']});guest!.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:['control']})
      await until(()=>js('document.querySelector(".browser-address-bar").classList.contains("is-focused")'),'real address-focus shortcut')
      const owner=await js(`window.navora.browser.workspace.tabState(${JSON.stringify(chat)}).then(state=>state.pages.find(page=>page.windowId===${JSON.stringify(pageId)}).automation.owner)`)
      await wait(100);await key('ArrowDown');await key('ArrowUp');await wait(100)
      assert.equal(requests.filter(request=>request.content.id==='address-suggestions-root').length,0);checks.push('focus-selection-and-arrows-do-not-open-history-without-new-input')
      await input('sample');await until(()=>requests.some(request=>request.content.id==='address-suggestions-root')&&deleteControls().length===3,'typed query with three scoped history rows')
      assert.equal(nodes(latest()).filter(node=>node.type==='item').length,4)
      for(const row of nodes(latest()).filter(node=>node.type==='item'))assert.equal(row.style?.align,'center')
      assert.equal(nodes(latest()).filter(node=>node.type==='icon'&&node.icon==='clock').length,3)
      assert.equal(await js(`document.activeElement===${field}`),true);assert.equal(previews,0);assert.equal(view()?.getVisible(),true)
      checks.push('typed-query-shows-native-history-with-centered-semantic-icons-and-separate-delete-controls')
      const originalDelete=deleteControls()[0]!.id,panel=panels.at(-1)!,beforeCommands=commands.length
      await input('another');await input('sample');panel.emit('action',{id:originalDelete,type:'click'});await wait(100)
      assert.equal(deletes.length,0);checks.push('previous-query-delete-events-cannot-act-after-the-same-query-is-retyped')
      await js(`${field}.setSelectionRange(2,4)`);failDelete=true
      const retryId=deleteControls()[0]!.id
      panel.emit('action',{id:retryId,type:'click'})
      await until(()=>deletes.length===1&&nodes(latest()).some(node=>node.id==='address-delete-error'),'failed delete remains retryable')
      assert.equal(deleteControls().length,3);assert.equal(commands.length,beforeCommands);assert.equal(await js(`${field}.value`),'sample');assert.equal(await js(`${field}.selectionStart`),2)
      let release!:()=>void;deleteGate=new Promise<void>(resolve=>release=resolve)
      panel.emit('action',{id:retryId,type:'click'});panel.emit('action',{id:retryId,type:'click'})
      await until(()=>deletes.length===2&&deleteControls().some(node=>node.id===retryId&&node.disabled),'duplicate delete disabled while pending')
      await wait(100);assert.equal(deletes.length,2);await js(`${field}.setSelectionRange(1,1)`);release();deleteGate=undefined
      await until(()=>deleteControls().length===2,'successful retry removes only its record')
      assert.equal(commands.length,beforeCommands);assert.equal(await js(`${field}.value`),'sample');assert.equal(await js(`${field}.selectionStart`),1)
      assert.ok(deletes.every(args=>args.length===3&&args[0]===chat&&typeof args[1]==='string'&&args[1].includes('/history-')&&Number.isSafeInteger(args[2])))
      checks.push('history-delete-failure-retry-and-double-click-preserve-query-selection-and-never-navigate-or-clear-all')
      deleteGate=new Promise<void>(resolve=>release=resolve);const delayedId=deleteControls()[0]!.id
      panel.emit('action',{id:delayedId,type:'click'});await until(()=>deletes.length===3,'delete dispatched before new edit')
      await input('unrelated');await js(`${field}.setSelectionRange(1,1)`);release();deleteGate=undefined;await wait(150)
      assert.equal(await js(`${field}.value`),'unrelated');assert.equal(await js(`${field}.selectionStart`),1);assert.equal(commands.length,beforeCommands)
      checks.push('late-delete-success-cannot-overwrite-a-new-query-or-selection')
      await input('sample');await until(()=>deleteControls().length===1,'last history result')
      await key('ArrowDown');await key('ArrowDown');await key('Delete');assert.equal(deletes.length,3)
      await key('Delete',true);await until(()=>deletes.length===4&&deleteControls().length===0,'Shift Delete removes selected real history row')
      assert.equal(nodes(latest()).filter(node=>node.type==='item').length,1);checks.push('ordinary-Delete-edits-text-while-Shift-Delete-removes-only-the-selected-history')
      await key('Escape');await wait(70);const shows=requests.length;await key('ArrowDown');await wait(70);assert.equal(requests.length,shows);assert.equal(visible.size,0)
      await input('   ');await wait(70);assert.equal(visible.size,0)
      await input('保留草稿');await js(`${field}.blur();${field}.focus()`);await wait(100);assert.equal(await js(`${field}.value`),'保留草稿');assert.equal(visible.size,0)
      checks.push('Escape-empty-input-and-refocus-close-suggestions-without-clearing-drafts')
      await js(`${field}.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`)
      await input('输入法');await key('Enter');assert.equal(visible.size,0);assert.equal(commands.length,beforeCommands)
      await js(`${field}.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);await until(()=>visible.size>0,'committed composition opens suggestions');await js(`${field}.blur()`)
      checks.push('composition-suspends-native-results-and-navigation-until-commit')
      const publish=async()=>{const tree=await js('window.navora.browser.workspace.state()');win.webContents.send('navora:browser.treeUpdated',{chatId:chat,tree:tree.pages,counts:{}})}
      patch={owner:'ai',activity:'handoff',nativePending:true,activeOperations:0,nativeConfirmed:true};await publish()
      await until(()=>js('!!document.querySelector(".browser-agent-status.is-busy")'),'rendered busy status')
      const dimensions=await js(`(()=>{const main=document.querySelector('.browser-agent-main-icon'),badge=document.querySelector('.browser-agent-status-icon');return {main:getComputedStyle(main).width,badge:getComputedStyle(badge).width,statuses:document.querySelectorAll('.browser-agent-status').length}})()`)
      assert.deepEqual(dimensions,{main:'18px',badge:'10px',statuses:1})
      patch={...patch,controlWait:{stage:'native',startedAt:Date.now()-20000,elapsedMs:20000,overdue:true,committedInputs:0,pendingNavigation:0}};await publish()
      await until(()=>js('!!document.querySelector(".browser-agent-status.is-warning")'),'overdue status uses warning')
      assert.equal(await js('document.querySelector(".browser-agent-status-icon").classList.contains("is-spinning")'),false)
      patch=undefined;await publish();checks.push('actual-Agent-trigger-keeps-18px-main-and-10px-badge-with-one-prioritized-nonspinning-overdue-warning')
      const before=await guest!.executeJavaScript('window.paints');await wait(100)
      assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.ok(await guest!.executeJavaScript('window.paints')>before);assert.equal(view()?.getVisible(),true);assert.equal(previews,0);assert.equal(commands.length,beforeCommands)
      assert.equal(await js(`window.navora.browser.workspace.tabState(${JSON.stringify(chat)}).then(state=>state.pages.find(page=>page.windowId===${JSON.stringify(pageId)}).automation.owner)`),owner)
      // Commit an old row's delete only after the page was revisited. The store's
      // atomic visitedAt guard must retain the newer visit, even across IPC delay.
      await js(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'navigate',${JSON.stringify(origin+'/history-race')})`)
      await until(()=>guest!.getURL()===origin+'/history-race'&&!guest!.isLoading(),'first race visit committed')
      const raceVisit=await js(`window.navora.browser.workspace.startPage(${JSON.stringify(chat)}).then(state=>state.history.find(visit=>visit.url===${JSON.stringify(origin+'/history-race')}))`)
      guest!.focus();guest!.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']});guest!.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:['control']})
      await until(()=>js('document.querySelector(".browser-address-bar").classList.contains("is-focused")'),'race address focus');await input('history-race')
      await until(()=>deleteControls().length===1,'race history row visible')
      deleteGate=new Promise<void>(resolve=>release=resolve);panels.at(-1)!.emit('action',{id:deleteControls()[0]!.id,type:'click'})
      await until(()=>deletes.length===5,'old race deletion dispatched')
      await js(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'navigate',${JSON.stringify(origin+'/history-race?new=1')})`)
      await until(()=>guest!.getURL()===origin+'/history-race?new=1'&&!guest!.isLoading(),'intermediate race visit')
      await js(`window.navora.browser.workspace.command(${JSON.stringify(pageId)},'navigate',${JSON.stringify(origin+'/history-race')})`)
      await until(()=>guest!.getURL()===origin+'/history-race'&&!guest!.isLoading(),'newer race visit committed')
      const newerVisit=await js(`window.navora.browser.workspace.startPage(${JSON.stringify(chat)}).then(state=>state.history.find(visit=>visit.url===${JSON.stringify(origin+'/history-race')}))`)
      assert.ok(newerVisit.visitedAt>raceVisit.visitedAt)
      release();deleteGate=undefined;await wait(180)
      const retained=await js(`window.navora.browser.workspace.startPage(${JSON.stringify(chat)}).then(state=>state.history.find(visit=>visit.url===${JSON.stringify(origin+'/history-race')}))`)
      assert.equal(retained.visitedAt,newerVisit.visitedAt);checks.push('atomic-history-visit-identity-preserves-a-newer-visit-when-an-old-delete-arrives-late')
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,deletes,previews,boundaries:['Actual built renderer/preload/main and real NativePanel widgets in an isolated temporary profile.','Native activation and dismissal are disabled and native action/DOM composition events injected; physical mouse, OS IME and multi-DPI visual acceptance are not claimed.','The initial guest Ctrl+L follows normal input-ownership policy. Subsequent address interactions preserve the resulting owner; Agent visual states use a controlled snapshot without changing native ownership.','Cross-axis centering is verified against actual native widget content; no native panel screenshot API exists in .7.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,deletes,commands,requests,updates,errors,previews,renderer:await js(`({fields:[...document.querySelectorAll('[aria-label=浏览器地址]')].map(field=>({value:field.value,visible:field.checkVisibility(),expanded:field.getAttribute('aria-expanded'),active:field===document.activeElement,title:field.title,classes:field.parentElement.className})),text:document.body.innerText.slice(-1800)})`).catch(()=>null),startState:await js(`window.navora.browser.workspace.startPage(${JSON.stringify(chat)})`).catch(()=>null)},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
