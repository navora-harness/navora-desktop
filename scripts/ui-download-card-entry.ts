import {app,BrowserWindow,Menu,NativePanel,WebContentsView,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {browserNativeId} from '../shared/browser-native-panels'
import type {NativePanelContent,NativePanelShow} from '../shared/native-ui'
import type {BrowserDownloadEntry} from '../shared/types'
import {systemDownloadIcon} from '../electron/modules/download-file-icons'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_download_card_fixture'
if(!profile||!path.isAbsolute(profile))throw Error('An isolated profile is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.appearance_mode='light';config.remote.enabled=false;config.ai.providers=[];config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'))
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'下载列表界面',createdAt:Date.now(),updatedAt:Date.now(),messages:[
  {id:'fixture-download-start',role:'log',content:'浏览器下载开始：QQ_9.9.37_261103_x64_01.exe',createdAt:Date.now(),meta:{kind:'browser_download',download:{state:'started',path:'downloads/setup.exe'}}},
  {id:'fixture-download-complete',role:'log',content:'浏览器下载完成：QQ_9.9.37_261103_x64_01.exe',createdAt:Date.now(),meta:{kind:'user_op'}}
]}))
const showInactive=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);showInactive.call(this)};BrowserWindow.prototype.focus=function(){}
let panel:NativePanel|undefined,request:NativePanelShow|undefined,downloads:BrowserDownloadEntry[]=[],revision=0,guestId=0,hiddenCalls=0,previewRequests=0,boundsRequests=0
const actions:unknown[]=[],checks:string[]=[],errors:string[]=[],metrics:unknown[]=[]
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:native-ui.show'&&args[0].content.id==='downloads-root')args[0]={...args[0],focusMode:'none'}
  if(channel==='navora:browser.workspace.preview')previewRequests++
  if(channel==='navora:native-ui.command'&&args[2]?.type==='bounds')boundsRequests++
  if(channel==='navora:downloads.list')return structuredClone(downloads.filter(item=>!args[0]||item.chatId===args[0]))
  if(channel==='navora:downloads.icon'){
    const item=downloads.find(item=>item.id===args[0]&&item.chatId===args[1])
    return item?systemDownloadIcon(item):undefined
  }
  if(/^navora:downloads\.(pause|resume|cancel|open|reveal|remove|clear)$/.test(channel)){
    const action=channel.split('.').at(-1)!;actions.push({action,args})
    if(action==='pause')downloads=downloads.map(item=>item.id===args[0]?{...item,state:'paused',canResume:true,canPause:false}:item)
    if(action==='resume')downloads=downloads.map(item=>item.id===args[0]?{...item,state:'started',canResume:false,canPause:true}:item)
    if(action==='cancel')downloads=downloads.map(item=>item.id===args[0]?{...item,state:'cancelled'}:item)
    if(action==='remove')downloads=downloads.filter(item=>item.id!==args[0])
    if(action==='clear')downloads=downloads.filter(item=>!['completed','failed','cancelled'].includes(item.state))
    pushDownloads();return {ok:true}
  }
  const result=await listener(event,...args)
  // Observe committed native content, after asynchronous icon decoding and bridge validation.
  if(channel==='navora:native-ui.show'&&args[0].content.id==='downloads-root')request=structuredClone(args[0])
  if(channel==='navora:native-ui.update'&&args[2]?.content?.id==='downloads-root'&&request&&result)request.content=structuredClone(args[2].content)
  return result
})
const nativeShow=NativePanel.prototype.show
NativePanel.prototype.show=function(options){nativeShow.call(this,options);panel=this}
const nativePopupMenu=NativePanel.prototype.popupMenu,nativeMenus:Electron.NativePanelMenuOptions[]=[]
NativePanel.prototype.popupMenu=function(menu,options){nativeMenus.push({...options});nativePopupMenu.call(this,menu,options)}
// Select the actual browser menu command without moving the system pointer.
const menuPopup=Menu.prototype.popup
let selectDownloadCommand='clear'
const downloadMenus:string[][]=[]
Menu.prototype.popup=function(options){const item=this.getMenuItemById('downloads')||this.getMenuItemById(selectDownloadCommand);if(item){if(item.id!=='downloads'){downloadMenus.push(this.items.map(value=>value.id));assert.equal((panel as unknown as {_getState():{visible:boolean}})._getState().visible,true,'Download panel stays visible behind its menu')}setTimeout(()=>{item.click(item,options!.window!,{} as Electron.KeyboardEvent);options?.callback?.()},80);return}menuPopup.call(this,options)}
const setVisible=WebContentsView.prototype.setVisible
WebContentsView.prototype.setVisible=function(visible){if(this.webContents.id===guestId&&!visible)hiddenCalls++;setVisible.call(this,visible)}
function pushDownloads(){revision++;for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('navora:downloads.changed',{downloads,revision})}
const local=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>下载测试页面</title><h1>网页保持实时显示</h1><input value="未保存的网页草稿"><script>window.framesPainted=0;window.identity=crypto.randomUUID();function tick(){window.framesPainted++;requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile)
async function until(check:()=>Promise<unknown>|unknown,label:string){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
const nodes=(root:NativePanelContent):NativePanelContent[]=>[root,...(root.children||[]).flatMap(nodes)]
const entry=(id:string,filename:string,state:BrowserDownloadEntry['state'],patch:Partial<BrowserDownloadEntry>={}):BrowserDownloadEntry=>({id,filename,state,chatId:chat,source:'browser',sessionId:'fixture',url,createdAt:Date.now(),updatedAt:Date.now(),...patch})
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    try{
      win.setContentSize(1380,960);await until(()=>js('!!document.querySelector(".composer-box")'),'main application')
      await until(()=>js('!!document.querySelector(".msg-empty")'),'quiet download-only conversation empty state')
      assert.equal(await js('document.querySelectorAll("[data-msg-id=fixture-download-start],[data-msg-id=fixture-download-complete]").length'),0)
      assert.equal((await js(`window.navora.chats.get(${JSON.stringify(chat)})`)).messages.length,2)
      checks.push('new-and-legacy-download-logs-stay-in-context-without-chat-rows')
      await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:download-card',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true)})()`)
      await until(()=>webContents.getAllWebContents().some(wc=>wc.getURL()===url&&!wc.isLoading()),'live local webpage')
      const guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;guestId=guest.id;guest.setBackgroundThrottling(false)
      const descendants=(view:Electron.View):Electron.View[]=>[view,...view.children.flatMap(descendants)]
      const view=descendants(win.contentView).find(view=>view instanceof WebContentsView&&view.webContents.id===guest.id) as WebContentsView
      await until(()=>view.getVisible(),'visible webpage view');await wait(300)
      const identity=await guest.executeJavaScript('window.identity'),count=webContents.getAllWebContents().length
      async function openDownloads(){
        panel=undefined;request=undefined
        await js(`(()=>{const el=[...document.querySelectorAll('[aria-label="浏览器更多操作"]')].find(el=>el.checkVisibility());if(!el)throw Error('Missing browser menu');el.click()})()`)
        await until(()=>!!panel&&request?.content.id==='downloads-root','actual native downloads popup');await wait(100)
      }
      async function capture(name:string){
        await wait(120)
        const state=(panel as unknown as {_getState():{windowHandle:string;parentWindowHandle:string}})._getState()
        fs.writeFileSync(path.join(output,name+'-state.json'),JSON.stringify(state,null,2))
        await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:15000})
      }
      async function captureTrigger(name:string){
        const geometry=await js(`(()=>{const button=[...document.querySelectorAll('.browser-downloads-trigger')].find(el=>el.checkVisibility());if(!button)throw Error('Missing download button');const bounds=button.getBoundingClientRect(),ring=button.querySelector('.dl-progress-ring').getBoundingClientRect(),icon=button.querySelector('.app-icon').getBoundingClientRect();return {x:Math.floor(bounds.x-8),y:Math.floor(bounds.y-8),width:Math.ceil(bounds.width+16),height:Math.ceil(bounds.height+16),ring:ring.width,icon:icon.width,expanded:button.getAttribute('aria-expanded')}})()`)
        assert.ok(geometry.ring>geometry.icon+8,'Download ring must leave space around its arrow')
        const {x,y,width,height}=geometry
        fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage({x,y,width,height})).toPNG())
        metrics.push({label:name,...geometry})
      }
      async function continuous(label:string){
        const frames=await guest.executeJavaScript('window.framesPainted'),bounds=view.getBounds(),previews=previewRequests,hides=hiddenCalls
        await wait(160)
        assert.equal(view.getVisible(),true);assert.deepEqual(view.getBounds(),bounds);assert.equal(await guest.executeJavaScript('window.identity'),identity)
        assert.ok(await guest.executeJavaScript('window.framesPainted')>frames);assert.equal(previewRequests,previews);assert.equal(hiddenCalls,hides);assert.equal(webContents.getAllWebContents().length,count)
        assert.equal(await js('document.querySelectorAll(".browser-frozen-frame,.browser-preview-unavailable,.browser-downloads-menu .dl-panel").length'),0)
        metrics.push({label,webContents:count,guestId,bounds,previewRequests,hiddenCalls});checks.push(label)
      }
      async function clickAction(id:string){
        assert.ok(request&&nodes(request.content).some(node=>node.id===id&&!node.disabled))
        const previous=actions.length
        panel!.emit('action',{id,type:'click'})
        await until(()=>actions.length>previous,`download action ${id}`)
        await wait(130)
      }
      previewRequests=0;hiddenCalls=0
      await openDownloads();assert.equal(nodes(request!.content).some(node=>node.id==='downloads-clear'),false);await capture('01-downloads-empty-light');await continuous('empty-native-popup-keeps-original-webpage-live')
      panel!.hide();panel!.emit('dismissed',{reason:'escape'});await wait(100)
      downloads=[entry('sample','QQ_9.9.37_261103_x64_01.exe','started',{receivedBytes:150*1024**2,totalBytes:318.9*1024**2,canPause:true,canCancel:true})];pushDownloads();await wait(120)
      await openDownloads();await capture('05-single-active-light');await captureTrigger('07-download-trigger-active')
      const sample=browserNativeId('download','sample')
      await clickAction(sample+'-pause');await captureTrigger('08-download-trigger-paused');await clickAction(sample+'-resume')
      downloads=[{...downloads[0]!,state:'completed',receivedBytes:318.9*1024**2}];pushDownloads();await wait(120);await capture('06-single-completed-light')
      await clickAction('downloads-clear');assert.equal(downloads.length,0);checks.push('single-download-and-header-options-clear-control-work')
      await wait(120)
      downloads=[entry('active','项目资料与图片资源.zip','started',{receivedBytes:18.4*1024**2,totalBytes:42.8*1024**2,canPause:true,canCancel:true}),entry('done','操作记录_2026-11-05.json','completed',{totalBytes:19.7*1024,relPath:'下载/操作记录_2026-11-05.json'}),entry('paused','页面截图与附件.zip','paused',{receivedBytes:3.2*1024**2,totalBytes:8.6*1024**2,canResume:true}),entry('failed','浏览器自动化使用指南.pdf','failed',{error:'连接已中断，请重新下载'})];pushDownloads();await wait(100)
      await openDownloads();await capture('02-downloads-list-light');await continuous('mixed-native-popup-keeps-view-visible-without-preview-or-extra-renderer')
      panel!.emit('action',{id:'downloads-search',type:'click'})
      await until(()=>request&&nodes(request.content).some(node=>node.id==='downloads-query'),'download search field')
      panel!.emit('action',{id:'downloads-query',type:'change',value:'操作记录'})
      await until(()=>request&&nodes(request.content).filter(node=>node.id.endsWith('-row')).length===1,'filtered download rows')
      assert.ok(nodes(request!.content).some(node=>node.text==='操作记录_2026-11-05.json'))
      panel!.emit('action',{id:'downloads-search',type:'click'})
      await until(()=>request&&nodes(request.content).filter(node=>node.id.endsWith('-row')).length===4,'restore downloads after search')
      await wait(160)
      checks.push('download-search-filters-and-restores-existing-records')
      const active=browserNativeId('download','active'),done=browserNativeId('download','done')
      const measuredBounds=boundsRequests;assert.ok(measuredBounds>=2,'Native row geometry is measured for compact list fitting')
      downloads[0]={...downloads[0]!,receivedBytes:30*1024**2};pushDownloads();await until(()=>request&&Number(nodes(request.content).find(node=>node.id===active+'-progress')?.value)>0.6,'live progress update');await wait(160);assert.equal(boundsRequests,measuredBounds,'Progress-only updates reuse measured native list geometry');checks.push('progress-updates-in-existing-native-panel-without-remeasuring-layout')
      await clickAction(active+'-pause');await until(()=>request&&nodes(request.content).some(node=>node.id===active+'-resume'),'pause result');await clickAction(active+'-resume')
      await clickAction(done+'-row');await clickAction(done+'-reveal');assert.deepEqual(actions.slice(-2).map((value:any)=>value.action),['open','reveal']);checks.push('pause-resume-open-and-reveal-use-current-scoped-command-ids')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})');await wait(220);await capture('03-downloads-list-dark');await continuous('dark-native-popup-retains-live-webpage')
      panel!.hide();panel!.emit('dismissed',{reason:'escape'});win.setContentSize(660,850);await wait(700);await openDownloads();await capture('04-downloads-list-narrow-dark');await continuous('narrow-native-popup-retains-live-webpage')
      await clickAction(active+'-cancel')
      selectDownloadCommand='remove'
      const before=actions.length,state=(panel as unknown as {_getState():{controls:Array<{id:string;bounds:{x:number;y:number}}>}})._getState(),row=state.controls.find(value=>value.id===done+'-row')!
      panel!.emit('action',{id:done+'-row',type:'context-menu',revision:panel!.getDiagnostics().revision,sourceType:'mouse',anchor:{x:row.bounds.x+10,y:row.bounds.y+10,width:1,height:1}})
      await until(()=>actions.length>before,'scoped right-click menu removal')
      assert.ok(downloadMenus.at(-1)?.includes('open'));assert.ok(downloadMenus.at(-1)?.includes('copy'))
      assert.equal(nativeMenus.at(-1)?.id,done+'-row');assert.equal(nativeMenus.at(-1)?.sourceType,'mouse')
      assert.equal(panel!.getDiagnostics().menuOpen,false,'An associated menu releases its native lifecycle after selection')
      selectDownloadCommand='clear';await openDownloads();await clickAction('downloads-clear');assert.equal(downloads.length,1);assert.equal(downloads[0]!.state,'paused');checks.push('context-menu-cancel-remove-and-clear-preserve-active-downloads')
      panel!.hide();panel!.emit('dismissed',{reason:'escape'});await wait(100)
      const unknownPath=path.join(profile,'system-icon.navoraunknown');fs.writeFileSync(unknownPath,'Isolated icon fixture')
      downloads=[entry('system-icon','其他类型.navoraunknown','completed',{savePath:unknownPath}),entry('sheet','下载统计.xlsx','completed'),entry('document','使用说明.docx','completed'),entry('image','产品截图.png','completed')];pushDownloads();await wait(200)
      const systemId=browserNativeId('download','system-icon')+'-icon'
      await openDownloads();await until(()=>request&&nodes(request.content).some(node=>node.id===systemId&&node.icon?.startsWith('download-file-')),'system file icon fallback')
      await capture('09-file-type-icons-dark');checks.push('preset-artwork-and-real-system-icon-fallback-reach-native-panel')
      panel!.hide();panel!.emit('dismissed',{reason:'escape'});await js('window.navora.config.save({app:{appearance_mode:"light"}})');win.setContentSize(1000,850);await wait(400)
      downloads=[entry('reference-active','QQ_9.9.37_261103_x64_01.exe','started',{receivedBytes:30*1024**2,totalBytes:319*1024**2,canPause:true,canCancel:true}),entry('reference-video','67cf70c2101d7a7dc2afddc3.mp4','cancelled'),entry('reference-zip','lineage-14.1-20180613-UNOFFICIAL-c7proltedd (1).zip','cancelled')];pushDownloads();await wait(120)
      await openDownloads();await capture('10-reference-layout-light');checks.push('reference-layout-top-aligned-icons-and-compact-status')
      assert.ok(nodes(request!.content).filter(node=>node.id.endsWith('-name')).every(node=>node.maxLines===2&&node.height===undefined),'Native filename shaping is capped at two lines')
      assert.deepEqual(errors,[]);assert.equal(previewRequests,0);assert.equal(hiddenCalls,0)
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,metrics,actions,errors,previewRequests,hiddenCalls,boundsRequests,nativeMenus,scope:'Actual application Vue/preload/main and real NativePanel; synthetic download IPC data, injected native actions, isolated local live webpage. Native screenshots use PID-checked PrintWindow. No personal data, shell file launch, model calls or physical input.'},null,2))
      local.closeAllConnections();app.exit(0)
    }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,request,actions,previewRequests,hiddenCalls},null,2));app.exit(1)}
  })())
})
await import('../electron/main')
