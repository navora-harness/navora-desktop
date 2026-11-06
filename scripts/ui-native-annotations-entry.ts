import {app,BrowserWindow,WebContentsView,NativePanel,Menu,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createDefaultConfig} from '../shared/config'
import {appearancePalette} from '../shared/appearance'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_native_annotations'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('An isolated profile is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true});fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'原生批注隔离验证',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const inactive=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-8000,-8000);inactive.call(this)};BrowserWindow.prototype.focus=function(){}
const requests:NativePanelShow[]=[],updates:NativePanelContent[]=[],panels:NativePanel[]=[],checks:string[]=[],errors:string[]=[]
const contentByRoot=new Map<string,NativePanelContent>()
let previews=0,started=false,agentSubmissions=0
const nativeCaptures:unknown[]=[],run=promisify(execFile)
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'){requests.push(structuredClone(args[0]));contentByRoot.set(args[0].content.id,structuredClone(args[0].content));args[0]={...args[0],focusMode:'none',dismissOnOutsideClick:false}}
  if(channel==='navora:native-ui.update'&&args[2]?.content){updates.push(structuredClone(args[2].content));contentByRoot.set(args[2].content.id,structuredClone(args[2].content))}
  if(channel==='navora:browser.workspace.preview')previews++
  if(/^navora:agent\.(submit|run|retry|queue\.resume)$/.test(channel))agentSubmissions++
  return listener(event,...args)
})
const show=NativePanel.prototype.show
NativePanel.prototype.show=function(options){panels.push(this);return show.call(this,options)}
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>批注样本</title><style>body{font:18px Segoe UI;padding:40px}#target{width:280px;height:80px;margin:40px;background:#e4effa}#other{margin-top:100px;width:220px;height:60px;background:#eee}</style><input id="draft" value="页面草稿保持"><button id="target" onclick="window.businessClicks++">批注目标</button><div id="other">第二个位置</div><script>window.identity=crypto.randomUUID();window.businessClicks=0;window.framesPainted=0;requestAnimationFrame(function tick(){window.framesPainted++;requestAnimationFrame(tick)})</script>')})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref()
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let n=0;n<180;n++){if(await check())return;await wait(50)}throw Error('Timed out: '+label)}
const nodes=(root:NativePanelContent):NativePanelContent[]=>[root,...(root.children||[]).flatMap(nodes)]
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const click=async(selector:string)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!e)throw Error('Missing: '+${JSON.stringify(selector)});e.click()})()`);await wait(70)}
    const latest=(id:string)=>contentByRoot.get(id)
    const editorShows=()=>requests.filter(request=>request.content.id==='annotation-editor-root').length
    const captureNative=async(name:string)=>{
      await wait(180)
      const state=(panels.at(-1)! as any)._getState()
      const {stdout}=await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:15000})
      const capture=JSON.parse(stdout);nativeCaptures.push(capture);assert.equal(capture.ok,true)
    }
    const card=(id:string)=>`.conversation-annotations-panel .annotation-chat-card[data-annotation-id="${id}"]`
    const cardButton=async(selector:string,text:string)=>{await js(`(()=>{const card=document.querySelector(${JSON.stringify(selector)}),button=card&&[...card.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!button||!button.checkVisibility())throw Error('Missing card button: '+${JSON.stringify(text)});button.click()})()`);await wait(70)}


    let guest:Electron.WebContents|undefined
    try{
      win.setContentSize(1380,900);await until(()=>js('!!document.querySelector(".composer")'),'application ready')
      const pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:native-annotations',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true);return id})()`)
      await until(()=>{guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url&&!wc.isLoading());return !!guest},'guest loaded');guest!.setBackgroundThrottling(false)
      const walk=(root:Electron.View):Electron.View[]=>[root,...root.children.flatMap(walk)],view=()=>walk(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents===guest) as WebContentsView|undefined
      await until(()=>!!view()?.getVisible(),'live view visible')
      const identity=await guest!.executeJavaScript('window.identity'),viewport=await guest!.executeJavaScript('[innerWidth,innerHeight]'),before=await guest!.executeJavaScript('window.framesPainted')
      const annotations=()=>js(`window.navora.browser.workspace.annotations(${JSON.stringify(chat)})`),targets=()=>js(`window.navora.browser.workspace.annotationTargets(${JSON.stringify(chat)},${JSON.stringify(pageId)})`)
      assert.equal(await js('document.querySelectorAll(".browser-notes-count,.browser-annotations,.annotation-chat-card").length'),0)
      checks.push('annotation-list-and-counter-removed-from-browser-toolbar')
      await click('.browser-annotation-toggle')
      await until(()=>guest!.executeJavaScriptInIsolatedWorld(1008,[{code:'globalThis.__navoraAnnotations?.phase==="armed"'}]),'annotation armed')
      const choose=async(selector:string)=>{const r=await guest!.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);guest!.sendInputEvent({type:'mouseMove',...r});guest!.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...r});guest!.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...r})}
      await choose('#target');await until(()=>requests.some(request=>request.content.id==='annotation-editor-root'),'native editor shown')
      assert.equal(await js('document.querySelectorAll(".browser-annotations,.annotation-floating-editor,.browser-frozen-frame").length'),0)
      assert.equal(view()?.getVisible(),true);assert.equal(previews,0);assert.equal(await guest!.executeJavaScript('window.businessClicks'),0)
      assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.deepEqual(await guest!.executeJavaScript('[innerWidth,innerHeight]'),viewport)
      assert.ok(await guest!.executeJavaScript('window.framesPainted')>before);checks.push('point-selection-opens-native-editor-with-live-unchanged-view-and-no-preview')
      assert.equal(nodes(latest('annotation-editor-root')!).find(node=>node.id==='annotation-comment')?.type,'textarea')
      assert.equal((panels.at(-1)! as any)._getState().visible,true)
      assert.equal(win.isVisible(),true)
      const compactHeight=nodes(latest('annotation-editor-root')!).find(node=>node.id==='annotation-comment')!.height!
      await captureNative('light-short-annotation-editor')
      const first=panels.at(-1)!,comment='第一行批注\n第二行 😀'
      first.emit('action',{id:'annotation-comment',type:'change',value:comment})
      await until(async()=>((await targets())[0]?.comment===comment),'multiline draft persisted')
      first.emit('action',{id:'annotation-comment',type:'submit',value:comment})
      await until(async()=>(await annotations()).length===1,'Enter saves annotation')
      const firstNote=(await annotations())[0]
      await until(()=>js('document.querySelector(".conversation-annotations-count")?.textContent==="1"'),'saved annotation available in list')
      assert.equal(await js('document.querySelectorAll(".messages .annotation-chat-card").length'),0)
      assert.equal(await js('!!document.querySelector(".msg-empty")'),true)
      assert.equal((await annotations())[0].comment,comment)
      assert.equal(await js('document.querySelectorAll(".composer-context-inline-node,.composer-context-block").length'),0)
      checks.push('textarea-submit-saves-annotation-without-chat-card-or-composer-reference')
      await until(()=>guest!.executeJavaScriptInIsolatedWorld(1008,[{code:'globalThis.__navoraAnnotations?.phase==="armed"'}]),'ready for continuous annotation')
      const beforeNext=editorShows();await choose('#other');await until(async()=>(await targets()).length>=1,'next target retained')
      await until(()=>editorShows()>beforeNext,'next target editor')
      const nextTarget=(await targets()).at(-1),oldTargetId=(await annotations())[0].selection.targetId
      await js(`window.navora.browser.workspace.annotationMode(${JSON.stringify(chat)},${JSON.stringify(pageId)},'armed',${JSON.stringify(oldTargetId)})`)
      assert.equal(await guest!.executeJavaScriptInIsolatedWorld(1008,[{code:'globalThis.__navoraAnnotations?.selection?.targetId'}]),nextTarget.id)
      const next=panels.at(-1)!;next.emit('action',{id:'annotation-comment',type:'change',value:'第二处批注'})
      await until(async()=>(await targets()).some((target:any)=>target.comment==='第二处批注'),'next target draft')
      next.emit('action',{id:'annotation-comment',type:'submit',value:'第二处批注'});await until(async()=>(await annotations()).length===2,'continuous second save')
      await until(()=>js('document.querySelector(".conversation-annotations-count")?.textContent==="2"'),'two saved annotations in list')
      assert.equal(await js('document.querySelectorAll(".messages .annotation-chat-card").length'),0)
      assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'页面草稿保持');assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.equal(view()?.getVisible(),true);assert.equal(previews,0)
      checks.push('continuous-annotation-retains-page-form-and-live-instance')
      const openAnnotationList=async()=>{await click('[data-chat-resource="annotations"]');await until(()=>js('!!document.querySelector(".conversation-annotations-panel")'),'HTML conversation annotation list opened')}
      const chooseListEntry=async(id:string)=>{await js(`(()=>{const row=[...document.querySelectorAll('.conversation-annotation-row')].find(row=>row.dataset.annotationKey===${JSON.stringify('annotation:')}+${JSON.stringify(id)});if(!row)throw Error('Missing annotation row');row.click()})()`);await until(()=>js('!!document.querySelector(".conversation-annotations-panel .annotation-chat-card")'),'HTML annotation detail')}
    const captureCards=async(name:string)=>{
      await openAnnotationList();await chooseListEntry(firstNote.id)
      await js('document.querySelector(".annotation-chat-card")?.scrollIntoView({block:"nearest"})');await wait(100)
      fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())
      const geometry=await js('(()=>{const messages=document.querySelector(".messages"),cards=[...document.querySelectorAll(".conversation-annotations-panel .annotation-chat-card")];return {width:innerWidth,messages:messages?{width:messages.clientWidth,scrollWidth:messages.scrollWidth}:null,cards:cards.map(card=>{const r=card.getBoundingClientRect(),s=getComputedStyle(card);return {width:r.width,height:r.height,scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,background:s.backgroundColor,color:s.color}})}})()')
      assert.ok(geometry.cards.length>0);assert.ok(geometry.messages?.width>0,'Conversation is visible for card screenshots');for(const item of geometry.cards){assert.ok(item.width>0&&item.height>0,'Card is visible for screenshot');assert.ok(item.scrollWidth<=item.clientWidth+1,'Card has no horizontal overflow')}
      fs.writeFileSync(path.join(output,name+'-layout.json'),JSON.stringify(geometry,null,2))
      await click('[aria-label=关闭批注列表]')
      return geometry
    }
      const listFilter=async(selector:string,value:string)=>js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      const order=await js('(()=>{const notes=document.querySelector("[data-chat-resource=annotations]").getBoundingClientRect(),summary=document.querySelector("[data-chat-resource=resources]").getBoundingClientRect();return {notes:notes.right,summary:summary.left}})()')
      assert.ok(order.notes<=order.summary,'Annotation list sits immediately left of summary')
      await openAnnotationList()
      await until(()=>js('document.querySelectorAll(".conversation-annotation-row").length===2'),'two list entries')
      const listGeometry=await js('(()=>{const panel=document.querySelector(".conversation-annotations-panel").getBoundingClientRect(),pane=document.querySelector(".composer").getBoundingClientRect(),view=document.querySelector(".browser-viewport-area").getBoundingClientRect();return {inside:panel.left>=pane.left+7&&panel.right<=pane.right-7,overlap:panel.left<view.right&&panel.right>view.left&&panel.top<view.bottom&&panel.bottom>view.top}})()')
      assert.equal(listGeometry.inside,true);assert.equal(listGeometry.overlap,false)
      fs.writeFileSync(path.join(output,'light-conversation-annotations-list.png'),(await win.webContents.capturePage()).toPNG())
      await listFilter('[aria-label=搜索当前对话批注]','第二处');await until(()=>js('document.querySelectorAll(".conversation-annotation-row").length===1'),'annotation search filters rows')
      await listFilter('[aria-label=筛选批注状态]','resolved');await until(()=>js('document.querySelectorAll(".conversation-annotation-row").length===0'),'annotation status empty state')
      await listFilter('[aria-label=筛选批注状态]','all');await listFilter('[aria-label=搜索当前对话批注]','');await until(()=>js('document.querySelectorAll(".conversation-annotation-row").length===2'),'annotation filters reset')
      await chooseListEntry(firstNote.id)
      fs.writeFileSync(path.join(output,'light-conversation-annotation-detail.png'),(await win.webContents.capturePage()).toPNG())
      assert.equal(await js(`document.querySelector(${JSON.stringify(card(firstNote.id)+' .annotation-chat-comment')})?.textContent`),comment)
      assert.equal(await js(`document.querySelector(${JSON.stringify(card(firstNote.id)+' details')})?.open`),false)
      assert.equal(await js('!!document.querySelector("[aria-label=在对话中查看此批注]")'),false)
      await click('[aria-label=关闭批注列表]');await until(()=>js('!document.querySelector(".conversation-annotations-panel")'),'HTML annotation list closes')
      assert.equal(view()?.getVisible(),true);assert.equal(previews,0)
      assert.equal(requests.some(request=>request.content.id==='conversation-annotations-root'),false)
      checks.push('HTML-header-list-left-of-summary-search-status-details-keeps-clear-of-live-View')

      await click('.browser-annotation-toggle');await until(()=>js('document.querySelector(".browser-annotation-toggle").getAttribute("aria-pressed")==="false"'),'exit annotation')
      await click('.file-workspace .workspace-launcher[aria-label="隐藏工作区"]')
      await until(()=>js('!document.querySelector(".file-workspace")'),'workspace and browser editor component unmounted')
      assert.equal(guest!.isDestroyed(),false);assert.equal(await guest!.executeJavaScript('window.identity'),identity)
      const beforeEdit=editorShows();await openAnnotationList();await chooseListEntry(firstNote.id);await cardButton('.conversation-annotations-panel','编辑');await until(()=>editorShows()>beforeEdit,'header list edits saved annotation in native panel')
      assert.equal(nodes(requests.filter(request=>request.content.id==='annotation-editor-root').at(-1)!.content).find(node=>node.id==='annotation-comment')?.value,comment)
      assert.equal(await js('!!document.querySelector(".file-workspace .browser-tab-panel")'),true)
      checks.push('card-edit-reopens-hidden-unmounted-workspace-and-retains-request-until-browser-editor-mounts')
      const current=panels.at(-1)!,long='字'.repeat(3999)+'😀\n保留超限草稿'
      current.emit('action',{id:'annotation-comment',type:'change',value:long});await until(()=>nodes(latest('annotation-editor-root')!).find(node=>node.id==='annotation-save')?.disabled,'overflow disables saving')
      assert.ok(nodes(latest('annotation-editor-root')!).find(node=>node.id==='annotation-comment')!.height!>compactHeight,'Editor grows for long content')
      current.emit('action',{id:'annotation-comment',type:'submit',value:long});await wait(100)
      assert.equal((await annotations()).find((note:any)=>note.id===firstNote.id).comment,comment)
      assert.equal((await js(`window.navora.browser.workspace.annotationDrafts(${JSON.stringify(chat)})`)).find((row:any)=>!row.deleted)?.text,long)
      current.emit('action',{id:'annotation-keep',type:'click'});await until(()=>!(current as any)._getState().visible,'long draft editor collapsed')
      await openAnnotationList();await chooseListEntry(firstNote.id)
      await until(()=>js(`!!document.querySelector(${JSON.stringify(card(firstNote.id)+' .annotation-chat-notice')})`),'list detail shows retained draft notice')
      const beforeReopen=editorShows();await cardButton(card(firstNote.id),'编辑');await until(()=>editorShows()>beforeReopen,'retained long draft reopened from card')
      assert.equal(nodes(requests.filter(request=>request.content.id==='annotation-editor-root').at(-1)!.content).find(node=>node.id==='annotation-comment')?.value,long)
      await captureNative('light-long-annotation-editor')
      const edited='修改后的批注\n仍保留 😀',editing=panels.at(-1)!
      editing.emit('action',{id:'annotation-comment',type:'change',value:edited});await until(()=>!nodes(latest('annotation-editor-root')!).find(node=>node.id==='annotation-save')?.disabled,'shorter saved draft valid')
      editing.emit('action',{id:'annotation-comment',type:'submit',value:edited});await until(async()=>(await annotations()).find((note:any)=>note.id===firstNote.id)?.comment===edited,'edited card saved')
      await openAnnotationList();await chooseListEntry(firstNote.id)
      await until(()=>js(`document.querySelector(${JSON.stringify(card(firstNote.id)+' .annotation-chat-comment')})?.textContent===${JSON.stringify(edited)}`),'list detail updates edited comment')
      await click('[aria-label=关闭批注列表]')
      checks.push('list-detail-edit-retains-overlength-emoji-draft-and-reopens-it-intact')
      await until(()=>js('document.querySelector(".browser-annotation-toggle").getAttribute("aria-pressed")==="false"'),'single card edit releases annotation session')
      await click('.browser-annotation-toggle');await until(()=>guest!.executeJavaScriptInIsolatedWorld(1008,[{code:'globalThis.__navoraAnnotations?.phase==="armed"'}]),'new draft selection armed')
      const beforeDraft=editorShows();await choose('#other');await until(()=>editorShows()>beforeDraft,'unsaved target editor')
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const draftEditor=panels.at(-1)!,draftComment='未完成的批注草稿 😀'
      draftEditor.emit('action',{id:'annotation-comment',type:'change',value:draftComment});await until(async()=>(await targets()).some((target:any)=>target.comment===draftComment),'unsaved target text persisted')
      const draftTarget=(await targets()).find((target:any)=>target.comment===draftComment),draftCard=`.conversation-annotations-panel .annotation-chat-card[data-target-id="${draftTarget.id}"]`
      draftEditor.emit('action',{id:'annotation-keep',type:'click'});await until(()=>!(draftEditor as any)._getState().visible,'target draft panel collapsed')
      await click('.browser-annotation-toggle');await until(()=>js('document.querySelector(".browser-annotation-toggle").getAttribute("aria-pressed")==="false"'),'unsaved draft session exited')
      await openAnnotationList();await click(`[data-annotation-key="annotation-target:${draftTarget.id}"]`)
      await until(()=>js(`document.querySelector(${JSON.stringify(draftCard+' .annotation-chat-comment')})?.textContent===${JSON.stringify(draftComment)}`),'target draft available in list')
      assert.equal(await js('document.querySelectorAll(".messages .annotation-chat-card").length'),0)
      const beforeContinue=editorShows();await cardButton(draftCard,'继续填写');await until(()=>editorShows()>beforeContinue,'draft card continues native editing')
      assert.equal(nodes(requests.filter(request=>request.content.id==='annotation-editor-root').at(-1)!.content).find(node=>node.id==='annotation-comment')?.value,draftComment)
      const resumed=panels.at(-1)!;resumed.emit('action',{id:'annotation-keep',type:'click'});await until(()=>!(resumed as any)._getState().visible,'resumed draft kept')
      checks.push('unsaved-target-remains-in-list-and-continues-intact')
      const secondNote=(await annotations()).find((note:any)=>note.id!==firstNote.id)
      await openAnnotationList();await chooseListEntry(secondNote.id)
      await click(card(secondNote.id)+' summary');await cardButton(card(secondNote.id),'移除批注…')
      assert.equal((await annotations()).length,2,'First delete click only asks for confirmation')
      await cardButton(card(secondNote.id),'保留');assert.equal((await annotations()).length,2)
      await cardButton(card(secondNote.id),'移除批注…');await cardButton(card(secondNote.id),'确认移除');await until(async()=>(await annotations()).length===1,'card delete confirmed')
      await openAnnotationList();await until(()=>js('document.querySelectorAll(".conversation-annotation-row").length===2'),'saved note removed while draft retained')
      assert.equal(await js(`!!document.querySelector('[data-annotation-key="annotation:${secondNote.id}"]')`),false)
      await click('[aria-label=关闭批注列表]')
      assert.equal(requests.some(request=>request.content.id==='annotation-list-root'),false)
      assert.equal(agentSubmissions,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'chats',chat+'.json'),'utf8')).messages,[])
      checks.push('list-details-support-cancel-and-confirm-delete-without-agent-messages')
      const lightGeometry=await captureCards('light-annotation-chat-cards')
      // Desktop sidebar presentation lives in the title bar. Establish a split
      // workspace and visible sidebar before changing its persisted preference.
      win.setContentSize(1680,900)
      await until(()=>js('!!document.querySelector(".file-workspace .workspace-expand")?.checkVisibility()'),'workspace expansion control')
      if(await js('document.querySelector(".file-workspace .workspace-expand").getAttribute("aria-label").includes("恢复分栏")'))await click('.file-workspace .workspace-expand')
      await until(()=>js('document.querySelector(".file-workspace .workspace-expand")?.getAttribute("aria-label")==="展开工作区"'),'workspace restored to split')
      if(await js('document.querySelector(".shell").classList.contains("sidebar-collapsed")'))await click('.window-sidebar-toggle[aria-label="显示侧栏"]')
      await until(()=>js('!document.querySelector(".shell").classList.contains("sidebar-collapsed")&&document.querySelector("aside.sidebar").checkVisibility()'),'sidebar visible in split workspace')
      await click('.window-sidebar-toggle[aria-label="切换为悬浮侧栏"]');await until(()=>js('document.querySelector(".shell").classList.contains("sidebar-floating")'),'floating preference')
      await click('.workspace-expand');await until(()=>js('!document.querySelector(".shell").classList.contains("sidebar-floating")'),'expanded disables floating')
      assert.equal(await js('document.querySelector(".window-sidebar-toggle").disabled'),true)
      assert.equal(await js('document.querySelector(".window-sidebar-toggle").title'),'展开工作区时仅使用固定侧栏')
      assert.equal(await js('JSON.parse(localStorage.getItem("navora.sidebar.presentation.v1")).mode'),'floating')
      await click('.workspace-expand');await until(()=>js('document.querySelector(".shell").classList.contains("sidebar-floating")'),'split restores preference')
      await click('.window-sidebar-toggle[aria-label="固定侧栏"]')
      await until(()=>js('!document.querySelector(".shell").classList.contains("sidebar-floating")'),'fixed sidebar restored')
      checks.push('expanded-workspace-blocks-floating-and-restores-saved-preference')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})')
      await until(()=>js('document.documentElement.dataset.navoraColorScheme==="dark"'),'dark appearance')
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await js('Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished))')
      const darkStyle=await js('Object.fromEntries([".chat-new-action",".chat-item.active",".workspace-tab-item.active",".browser-address-bar",".activity-rail button"].map(selector=>{const el=document.querySelector(selector),s=el&&getComputedStyle(el);return [selector,s?{background:s.backgroundColor,color:s.color,surface:s.getPropertyValue("--appearance-surface"),selection:s.getPropertyValue("--appearance-selection")}:null]}))')
      fs.writeFileSync(path.join(output,"dark-computed-styles.json"),JSON.stringify(darkStyle,null,2))
      const savedAppearance=await js('window.navora.config.get().then(config=>config.app)'),palette=appearancePalette(savedAppearance.appearance_theme,'dark',false)
      const rgb=(hex:string)=>`rgb(${[1,3,5].map(index=>Number.parseInt(hex.slice(index,index+2),16)).join(', ')})`
      const darkMain=await js('(()=>{const style=getComputedStyle(document.querySelector(".main"));return {background:style.backgroundColor,color:style.color,surface:style.getPropertyValue("--appearance-surface").trim(),ink:style.getPropertyValue("--appearance-ink").trim()}})()')
      assert.equal(darkMain.surface.toLowerCase(),palette.surface.toLowerCase(),'The saved dark theme supplies the main surface token')
      assert.equal(darkMain.ink.toLowerCase(),palette.ink.toLowerCase(),'The saved dark theme supplies the main text token')
      assert.equal(darkMain.background,rgb(palette.surface),'The main panel applies its dark surface token')
      assert.equal(darkMain.color,rgb(palette.ink),'The main panel applies its dark text token')
      fs.writeFileSync(path.join(output,'dark-conversation-and-browser-toolbar.png'),(await win.webContents.capturePage()).toPNG())
      fs.writeFileSync(path.join(output,'toolbar-without-bottom-bar.png'),(await win.webContents.capturePage()).toPNG())
      const darkGeometry=await captureCards('dark-annotation-chat-cards')
      assert.notEqual(darkGeometry.cards[0].background,lightGeometry.cards[0].background,'Chat annotation cards follow the current appearance')
      const beforeDark=editorShows();await openAnnotationList();await chooseListEntry(firstNote.id);await cardButton(card(firstNote.id),'编辑');await until(()=>editorShows()>beforeDark,'dark native card editor')
      await captureNative('dark-short-annotation-editor')
      const darkEditor=panels.at(-1)!;darkEditor.emit('action',{id:'annotation-keep',type:'click'});await until(()=>!(darkEditor as any)._getState().visible,'dark editor collapsed')
      win.setContentSize(980,820);await wait(200)
      if(!await js('document.querySelector(".messages")?.checkVisibility()'))await click('[data-conversation-tab]')
      await until(()=>js('document.querySelector(".messages")?.clientWidth>0'),'narrow conversation tab visible')
      await captureCards('narrow-dark-annotation-chat-cards')
      win.setContentSize(1380,900);await wait(200)
      assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'页面草稿保持')
      assert.ok(await guest!.executeJavaScript('window.framesPainted')>before);assert.equal(previews,0)
      checks.push('light-dark-and-narrow-list-details-and-real-native-editor-captured-with-live-view-retained')
      await js(`(async()=>{await window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'activate'});await window.navora.browser.setVisible(${JSON.stringify(pageId)},true)})()`)
      await until(()=>js('document.querySelector(".browser-annotation-toggle")?.checkVisibility()'),'browser restored for direct context annotation')
      await until(()=>!!view()?.getVisible(),'live view restored for right-click')
      if(process.env.NAVORA_ANNOTATION_LIST_ONLY!=='1'){
      const popupOriginal=Menu.prototype.popup,closeOriginal=Menu.prototype.closePopup
      let contextMenu:{menu:Menu;options:Electron.PopupOptions}|undefined
      Menu.prototype.popup=function(options){contextMenu={menu:this,options:options||{}}}
      Menu.prototype.closePopup=function(parent){if(contextMenu?.menu===this&&(!parent||contextMenu.options.window===parent)){const current=contextMenu;contextMenu=undefined;current.options.callback?.()}}
      try{
        const beforeContext=editorShows(),point=await guest!.executeJavaScript('(()=>{const r=document.querySelector("#target").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()'),paintedBeforeContext=await guest!.executeJavaScript('window.framesPainted')
        guest!.sendInputEvent({type:'mouseMove',...point});guest!.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});guest!.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point})
        await until(()=>!!contextMenu,'actual guest right-click opens application menu')
        const annotate=contextMenu!.menu.getMenuItemById('annotate');assert.equal(annotate?.label,'批注');assert.equal(annotate?.enabled,true)
        assert.equal(contextMenu!.menu.getMenuItemById('annotations'),null)
        annotate!.click(undefined,win,undefined as any)
        await until(()=>editorShows()>beforeContext,'right-click directly opens native annotation editor without another guest click')
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        const directTarget=(await targets()).find((target:any)=>!target.comment&&target.selection.selector==='#target')
        assert.ok(directTarget);assert.equal(directTarget.selection.kind,'element');assert.equal(await guest!.executeJavaScript('window.businessClicks'),0)
        const directEditor=panels.at(-1)!,directComment='右键目标直接批注 😀'
        directEditor.emit('action',{id:'annotation-comment',type:'change',value:directComment});await until(async()=>(await targets()).some((target:any)=>target.id===directTarget.id&&target.comment===directComment),'direct context draft persisted')
        directEditor.emit('action',{id:'annotation-comment',type:'submit',value:directComment});await until(async()=>(await annotations()).length===2,'direct context annotation saved')
        const directNote=(await annotations()).find((note:any)=>note.comment===directComment);assert.ok(directNote)
        await openAnnotationList();await chooseListEntry(directNote.id)
        assert.equal(await js(`document.querySelector(${JSON.stringify(card(directNote.id)+' .annotation-chat-comment')})?.textContent`),directComment)
        assert.equal(await js('document.querySelectorAll(".messages .annotation-chat-card").length'),0)
        await click('[aria-label=关闭批注列表]')
        await until(()=>js('document.querySelector(".browser-annotation-toggle").getAttribute("aria-pressed")==="false"'),'direct context single-shot annotation releases selection after save')
        assert.equal((directEditor as any)._getState().visible,false);assert.equal(await guest!.executeJavaScript('window.businessClicks'),0)
        assert.equal(await guest!.executeJavaScript('window.identity'),identity);assert.equal(await guest!.executeJavaScript('document.querySelector("#draft").value'),'页面草稿保持')
        assert.ok(await guest!.executeJavaScript('window.framesPainted')>paintedBeforeContext);assert.equal(view()?.getVisible(),true);assert.equal(previews,0);assert.equal(agentSubmissions,0)
        await js(`window.navora.browser.workspace.removeAnnotation(${JSON.stringify(chat)},${JSON.stringify(directNote.id)})`)
        await until(async()=>!(await annotations()).some((note:any)=>note.id===directNote.id),'direct context regression note cleaned up')
      }finally{Menu.prototype.popup=popupOriginal;Menu.prototype.closePopup=closeOriginal}
      checks.push('actual-right-click-opens-target-bound-native-editor-and-saves-annotation-with-single-shot-release-without-extra-click')
      }
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'close'})`)
      await until(()=>guest!.isDestroyed(),'original annotation page closed')
      await openAnnotationList();await click(`[data-annotation-key="annotation-target:${draftTarget.id}"]`)
      await until(()=>js(`!!document.querySelector(${JSON.stringify(draftCard)})`),'closed-page draft remains in list')
      await click(draftCard+' summary');await cardButton(draftCard,'放弃草稿…');await cardButton(draftCard,'确认移除')
      await until(async()=>!(await js(`window.navora.browser.workspace.annotationTargets(${JSON.stringify(chat)})`)).some((target:any)=>target.id===draftTarget.id),'closed-page draft discarded from list')
      await openAnnotationList();await chooseListEntry(firstNote.id);await cardButton('.conversation-annotations-panel','加入输入框')
      await until(()=>js('document.querySelectorAll(".composer-context-inline-node,.composer-context-block").length===1'),'closed-page annotation added to composer from header list')
      await until(async()=>JSON.stringify((await js(`window.navora.chats.get(${JSON.stringify(chat)})`))?.draftDocument).includes(firstNote.id),'annotation reference draft persisted')
      assert.equal(agentSubmissions,0);assert.deepEqual((await js(`window.navora.chats.get(${JSON.stringify(chat)})`)).messages,[])
      assert.equal((await annotations()).length,1);assert.equal(await js('document.querySelectorAll(".messages .annotation-chat-card").length'),0)
      checks.push('closed-page-draft-can-be-discarded-and-saved-annotation-added-to-composer-without-chat-card-or-agent-messages')
      await click('.composer .composer-attach-trigger');await click('#composer-attach-annotation')
      await until(()=>js('document.querySelector(".composer-attachment-heading strong")?.textContent==="已有批注"&&document.querySelectorAll(".source-options [role=option]").length===1'),'existing annotations available directly in attachments')
      fs.writeFileSync(path.join(output,'existing-annotation-attachment.png'),(await win.webContents.capturePage()).toPNG())
      await click('.source-options [role=option]');await until(()=>js('!document.querySelector(".composer-attachment-menu")'),'existing annotation inserted')
      await until(()=>js('document.querySelectorAll(".composer-context-inline-node,.composer-context-block").length===2'),'attachment inserts another explicit reference alongside existing content')
      assert.equal(agentSubmissions,0);assert.equal((await annotations()).length,1)
      checks.push('attachment-common-source-inserts-existing-saved-annotation-without-page-or-auto-send')

      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,previews,agentSubmissions,errors,nativeCaptures,nativeShows:requests.length,nativeInstances:new Set(panels).size,noteCount:(await annotations()).length,limitations:[...(process.env.NAVORA_ANNOTATION_LIST_ONLY==='1'?['Targeted list run excludes the separate direct right-click annotation regression.']:[]),'Native actions are injected through the real bridge; native keyboard/IME is covered separately.','Owned native popup HWNDs are captured separately with PrintWindow; renderer captures show annotation list details; chat remains free of annotation cards.']},null,2))
      app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({ok:false,error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,requests,updates},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron/main.js')).href)
