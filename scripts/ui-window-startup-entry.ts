import {app,BrowserWindow,ipcMain} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createDefaultConfig} from '../shared/config'

const profile=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,scenario=process.env.NAVORA_STARTUP_SCENARIO!
console.log('[startup-fixture]',scenario,'boot')
process.on('uncaughtException',error=>{console.error(error);app.exit(1)})
if(!profile||!path.isAbsolute(profile)||!output)throw Error('Isolated startup profile required')
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig()
config.app.onboarding_completed=true;config.app.close_to_tray=false;config.remote.enabled=false
config.app.appearance_mode=scenario==='dark'?'dark':'light'
config.app.window_acrylic=scenario!=='solid'
if(scenario==='tray')config.app.show_main_on_start=false
config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspace')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config))
const chat='chat_startup_fixture'
fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'启动恢复检查',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
const local=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Startup restored page</title><p>Isolated restoration fixture</p>')})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const url=`http://127.0.0.1:${(local.address() as {port:number}).port}/startup`
fs.writeFileSync(path.join(profile,'browser-workspace.json'),JSON.stringify([{sessionId:'sess_0123456789',chatId:chat,sessionIndex:1,pages:[
  {id:'win_0123456789',url,detached:true,host:'fixture-detached',order:0},
  {id:'win_abcdef0123',url,detached:false,host:'fixture-main',order:0},
]}]))

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const timeline:{event:string;time:number;window?:number}[]=[],errors:string[]=[]
let main:BrowserWindow|undefined,shownAt=0,paintedAt=0,completeAt=0,readyCalled=false
let inspectSplash!:()=>void
const splashInspected=new Promise<void>(resolve=>{inspectSplash=resolve})
const originalHandle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,...args)=>{
  if(channel==='navora:app.startup.shown'){paintedAt=Date.now();timeline.push({event:'splash-painted',time:paintedAt})}
  if(channel==='navora:app.startup.ready'){
    readyCalled=true
    await splashInspected
    if(scenario==='slow')await wait(1700)
  }
  if(channel==='navora:app.startup.complete'){
    completeAt=Date.now();timeline.push({event:'main-frame-painted',time:completeAt})
  }
  return listener(event,...args)
})
const until=async(check:()=>unknown|Promise<unknown>,label:string)=>{
  const deadline=Date.now()+15000
  while(Date.now()<deadline){if(await check())return;await wait(25)}
  throw Error('Timed out: '+label)
}
app.on('browser-window-created',(_event,win)=>{
  console.log('[startup-fixture] window created',win.id)
  const isMain=!main
  if(isMain)main=win
  win.on('show',()=>{
    timeline.push({event:isMain?'main-shown':'restored-shown',time:Date.now(),window:win.id})
    if(isMain&&!shownAt)shownAt=Date.now()
    if(!isMain&&!completeAt)errors.push('A restored window appeared before the main frame completed')
  })
  if(!isMain)return
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=async(code:string)=>{try{return await win.webContents.executeJavaScript(code)}catch(error){console.error('[startup-fixture] renderer check failed:',code);throw error}}
    try{
      await until(()=>paintedAt>0&&shownAt>0,'visible splash')
      console.log('[startup-fixture] inspecting splash')
      const loading=await js(`(()=>{const icon=document.querySelector('#navora-startup img'),r=icon.getBoundingClientRect();return {state:document.documentElement.dataset.navoraStartup,loaded:icon.complete&&icon.naturalWidth>0,x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight,appOpacity:getComputedStyle(document.querySelector('#app')).opacity,inert:document.body.inert,background:getComputedStyle(document.body).backgroundColor,blur:getComputedStyle(document.querySelector('#navora-startup')).backdropFilter}})()`)
      assert.equal(loading.state,'loading');assert.equal(loading.loaded,true)
      assert.ok(Math.abs(loading.x-loading.width/2)<1&&Math.abs(loading.y-loading.height/2)<1,'Icon is centered in the entire window')
      assert.equal(loading.appOpacity,'0');assert.equal(loading.inert,true)
      assert.equal(win.getOpacity(),1,'Whole-window alpha must not expose unblurred desktop during startup')
      assert.equal(loading.background,'rgba(0, 0, 0, 0)')
      assert.equal(loading.blur,'blur(24px)')
      assert.ok(BrowserWindow.getAllWindows().filter(w=>w!==win).every(w=>!w.isVisible()),'All restored windows stay hidden')
      assert.ok(win.contentView.children.every(view=>!view.getVisible()),'Native page surfaces cannot cover the splash')
      fs.writeFileSync(path.join(output,'01-loading.png'),(await win.webContents.capturePage()).toPNG())
      inspectSplash()
      await until(()=>completeAt>0,'startup completion')
      console.log('[startup-fixture] completed')
      assert.ok(readyCalled)
      const durationMs=completeAt-Math.max(shownAt,paintedAt)
      assert.ok(durationMs>=1000,'At least 1000ms of visible painted splash: '+durationMs)
      if(scenario==='slow')assert.ok(durationMs>=1700,'Slow initialization extends loading')
      await until(()=>BrowserWindow.getAllWindows().some(w=>w!==win&&w.isVisible()),'detached restored window')
      assert.equal(await js('document.documentElement.dataset.navoraStartup'),'complete')
      assert.equal(await js('document.body.inert'),false)
      assert.equal(win.getOpacity(),1)
      assert.ok(win.contentView.children.every(view=>view.getVisible()))
      const tree=await js(`window.navora.browser.tree(${JSON.stringify(chat)})`)
      assert.equal(tree.flatMap((s:any)=>s.windows).length,2,'Both embedded and detached pages restore')
      fs.writeFileSync(path.join(output,'02-ready.png'),(await win.webContents.capturePage()).toPNG())
      win.hide();win.show();await wait(60)
      assert.equal(await js('!!document.querySelector("#navora-startup")'),false,'Tray-style re-show does not repeat startup')
      const reloaded=new Promise<void>(resolve=>win.webContents.once('did-finish-load',()=>resolve()))
      win.webContents.reload()
      await reloaded
      await until(()=>js('!!document.querySelector(".main-shell")'),'reload main shell')
      assert.notEqual(await js('document.documentElement.dataset.navoraStartup'),'loading','Reload does not repeat startup')
      assert.equal(errors.length,0,errors.join('\n'))
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,scenario,durationMs,loading,timeline,errors},null,2))
      local.close();app.exit(0)
    }catch(error){
      console.error(error)
      fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,timeline,errors,windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),bounds:w.getBounds()}))},null,2))
      local.close();app.exit(1)
    }
  })())
})
console.log('[startup-fixture] importing application')
await import('../electron/main')
console.log('[startup-fixture] application imported')
if(scenario==='tray'){
  void app.whenReady().then(async()=>{
    await until(()=>app.listenerCount('activate')>0,'tray activation handler')
    await wait(100)
    assert.equal(BrowserWindow.getAllWindows().length,0,'Start-in-tray remains hidden')
    app.emit('activate',{},false)
  }).catch(error=>{console.error(error);app.exit(1)})
}
