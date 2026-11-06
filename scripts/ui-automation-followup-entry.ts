import {app,BrowserWindow,NativePanel,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import type {AgentAskRequest,PermissionRequest} from '../shared/types'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_followup_ui'
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.ai_generate_chat_title=false;config.app.appearance_mode='light';config.remote.enabled=false;config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'))
const now=Date.now()
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'网页操作与决策',createdAt:now,updatedAt:now,messages:[
  {id:'fixture-user',role:'user',content:'检查表单的填写结果，提交前让我确认。',createdAt:now-4000},
  {id:'fixture-tool-before',role:'tool',content:JSON.stringify({ok:true,complete:true}),createdAt:now-3000,meta:{toolName:'browser_get',status:'done'}},
  {id:'fixture-reasoning',role:'assistant',content:'表单字段已回读确认，尚未提交。接下来由你决定是否提交。',createdAt:now-2000,meta:{phase:'progress',reasoning:'核对当前页面与字段值，并把已确认的填写结果与尚未执行的提交分开。需要用户确认的动作先等待答复。'}},
  {id:'fixture-tool-after',role:'tool',content:JSON.stringify({ok:true,status:'dispatched'}),createdAt:now-1000,meta:{toolName:'browser_click',status:'done'}},
]}))
fs.writeFileSync(path.join(profile,'chats','chat_followup_other.json'),JSON.stringify({id:'chat_followup_other',title:'切换检查',createdAt:now-10000,updatedAt:now-10000,messages:[]}))
fs.writeFileSync(path.join(profile,'browser-start.json'),JSON.stringify({links:[],history:[
  {chatId:chat,url:'https://httpbin.org/forms/post',title:'表单测试',visitedAt:now},
  {chatId:chat,url:'https://developer.mozilla.org/zh-CN/docs/Web/API/PointerEvent',title:'PointerEvent 文档',visitedAt:now-60000},
  {chatId:chat,url:'https://example.com/notes',title:'操作记录',visitedAt:now-120000},
  {chatId:'other-conversation',url:'https://other.example.invalid/private',title:'其他聊天的网址',visitedAt:now+1000}
]}))
const show=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);show.call(this)}
BrowserWindow.prototype.focus=function(){}
let nativePanel:Electron.NativePanel|undefined
const nativeShow=NativePanel.prototype.show
NativePanel.prototype.show=function(options){nativeShow.call(this,options);nativePanel=this}
let mode:'fail'|'hold'|'ok'|'expired'='fail',reply:((value:boolean)=>void)|undefined,replyFailure:((error:Error)=>void)|undefined,askCalls=0
const permissionDecisions:string[]=[],handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:agent.ask.respond'&&String(args[0]).startsWith('fixture-question')){
    askCalls++;if(mode==='fail')throw Error('fixture_delivery_failure')
    if(mode==='hold')return new Promise<boolean>((resolve,reject)=>{reply=resolve;replyFailure=reject})
    return mode==='ok'
  }
  if(channel==='navora:permission.respond'&&String(args[0]).startsWith('fixture-permission')){permissionDecisions.push(String(args[1]));return true}
  return listener(event,...args)
})
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>表单测试</title><style>body{font:15px system-ui;padding:30px;color:#243c37}input{display:block;margin:14px 0;padding:8px}</style><h2>表单测试</h2><label>备注<input value="等待确认后提交"></label>')})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref()
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const run=promisify(execFile),checks:string[]=[],errors:string[]=[]
async function until(check:()=>Promise<unknown>|unknown,label:string){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const click=async(selector:string)=>{await js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click()})()`);await wait(80)}
    const input=async(selector:string,value:string)=>{await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50)}
    const switchChat=async(title:string)=>{await js(`(()=>{const el=[...document.querySelectorAll('.chat-item-main')].find(el=>el.textContent.includes(${JSON.stringify(title)}));if(!el)throw Error('Missing chat');el.click()})()`);await wait(150)}
    const capture=async(name:string)=>{await wait(130);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())}
    const captureDetail=async(name:string,selector:string)=>{
      const bounds=await js(`(()=>{const boxes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>el.checkVisibility()).map(el=>el.getBoundingClientRect());if(!boxes.length)throw Error('Missing screenshot region');const x=Math.max(0,Math.min(...boxes.map(r=>r.left))-10),y=Math.max(0,Math.min(...boxes.map(r=>r.top))-10),right=Math.min(innerWidth,Math.max(...boxes.map(r=>r.right))+10),bottom=Math.min(innerHeight,Math.max(...boxes.map(r=>r.bottom))+10);return {x,y,width:right-x,height:bottom-y}})()`)
      const factor=win.webContents.getZoomFactor(),rect={x:Math.floor(bounds.x*factor),y:Math.floor(bounds.y*factor),width:Math.ceil(bounds.width*factor),height:Math.ceil(bounds.height*factor)}
      fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(rect)).toPNG())
    }
    const sendAsk=(id='fixture-question-1')=>{const request:AgentAskRequest={id,chatId:chat,kind:'user_choice',question:'是否提交当前表单？\n已核对填写内容，提交后会发送到测试服务器。',options:['提交表单','保留当前页面'],optionItems:[{label:'提交表单',hint:'发送已填写的内容'},{label:'保留当前页面',hint:'暂不提交，保留填写结果',recommended:true}],allowCustom:true,timeoutMs:0};win.webContents.send('navora:agent.ask',request)}
    try{
      win.setContentSize(1380,980)
      await until(()=>js('!!document.querySelector(".composer-box")&&!!document.querySelector(".transcript-reasoning")'),'main transcript')
      const aligned=await js(`(()=>{const reasoning=document.querySelector('.transcript-reasoning>.transcript-activity-trigger'),tool=document.querySelector('.transcript-tool .transcript-activity-trigger');return ['fontSize','gap','minHeight'].every(key=>getComputedStyle(reasoning)[key]===getComputedStyle(tool)[key])&&reasoning.querySelector('[data-icon=lightbulb]')&&reasoning.querySelector('[data-icon=chevron-right]')?true:false})()`)
      assert.equal(aligned,true);await capture('01-thinking-and-page-actions-light');await captureDetail('01-thinking-detail','.transcript-tool,.messages>.msg.assistant')
      await click('.transcript-reasoning>.transcript-activity-trigger');await capture('02-thinking-expanded-light')
      checks.push('historical-reasoning-matches-page-action-disclosure-and-official-icons')
      await click('.composer .composer-attach-trigger');await until(()=>js('!!document.querySelector("#composer-attach-skill")'),'attachments')
      assert.equal(await js('document.querySelector("#composer-attach-skill b").textContent'),'技能')
      assert.equal(await js('document.querySelector("#composer-attach-plugin b").textContent'),'插件')
      await js('document.querySelector("#composer-attach-skill").scrollIntoView({block:"center"})');await capture('03-attachment-sources-light')
      await click('#composer-attach-url');await until(()=>js('document.querySelectorAll(".source-url-options>button").length===3'),'URL history')
      assert.equal(await js('document.querySelector(".source-url-history").textContent.includes("其他聊天")'),false)
      await capture('04-url-history-light');await captureDetail('04-url-history-detail','.composer-attachment-menu');await input('[aria-label="搜索网址历史"]','PointerEvent');assert.equal(await js('document.querySelectorAll(".source-url-options>button").length'),1)
      await click('.source-url-options>button');assert.equal(await js('document.querySelector("input[inputmode=url]").value'),'https://developer.mozilla.org/zh-CN/docs/Web/API/PointerEvent')
      assert.equal(await js('document.querySelector(".composer-attachment-menu")?.checkVisibility()'),true,'History selection fills the form without inserting or navigating')
      await click('.source-insert');await until(()=>js('!document.querySelector(".composer-attachment-menu")'),'URL inserted')
      assert.equal(await js('document.querySelector(".composer .composer-richtext").textContent.includes("PointerEvent 文档")'),true)
      checks.push('URL-history-is-chat-scoped-searchable-and-selection-needs-explicit-insert','skill-and-plugin-labels-drop-description-suffix')
      sendAsk();await until(()=>js('!!document.querySelector("[data-decision-card=question]")'),'question')
      await capture('05-decision-question-light');await captureDetail('05-decision-question-detail','[data-decision-card=question]');await input('[aria-label="自行填写决定"]','先检查收件地址，再提交')
      await click('.ask-opt-custom-submit');await until(()=>js('document.querySelector("[data-decision-card=question]")?.dataset.decisionState==="error"'),'delivery error retained')
      assert.equal(await js('document.querySelector("[aria-label=自行填写决定]").value'),'先检查收件地址，再提交');await capture('06-decision-error-retains-answer')
      mode='hold';await click('.ask-opt-custom-submit');await until(()=>!!replyFailure,'held failure')
      await switchChat('切换检查');replyFailure!(Error('fixture_delivery_failure_after_switch'));await wait(100)
      await switchChat('网页操作与决策');await until(()=>js('document.querySelector("[data-decision-card=question]")?.dataset.decisionState==="error"'),'return to failed request')
      assert.equal(await js('document.querySelector("[aria-label=自行填写决定]").value'),'先检查收件地址，再提交')
      checks.push('failed-decision-retains-custom-draft-across-chat-remount')
      reply=undefined;await click('.ask-opt-custom-submit');await until(()=>!!reply,'held acknowledgement')
      assert.equal(await js('document.querySelector("[data-decision-card=question]")?.dataset.decisionState'),'submitting')
      await js('document.querySelector(".ask-opt-custom-submit").click()');assert.equal(askCalls,3)
      win.webContents.send('navora:agent.ask.cancel',{id:'fixture-question-1',reason:'resolved'});await wait(100)
      assert.equal(await js('!!document.querySelector("[data-decision-card=question]")'),true,'Cancel notification cannot erase an in-flight answer before IPC acknowledgement')
      reply!(true);await until(()=>js('!document.querySelector("[data-decision-card=question]")'),'acknowledged decision cleared')
      checks.push('failed-decision-retains-draft','in-flight-decision-suppresses-duplicates-and-waits-for-acknowledgement')
      mode='expired';sendAsk('fixture-question-expired');await until(()=>js('!!document.querySelector("[data-decision-card=question]")'),'expired request created');await click('.ask-options>button')
      await until(()=>js('document.querySelector("[data-decision-card=question]")?.dataset.decisionState==="expired"'),'expired result');assert.equal(await js('[...document.querySelectorAll(".ask-options button")].every(button=>button.disabled)'),true);await click('[data-decision-dismiss]')
      const permission:PermissionRequest={id:'fixture-permission-1',chatId:chat,capability:'click',detail:'点击当前页面的提交按钮。',timeoutMs:0}
      win.webContents.send('navora:permission.request',permission);await until(()=>js('!!document.querySelector("[data-decision-card=permission]")'),'permission')
      assert.equal(await js('document.querySelector("[data-permission-remember]").checked'),false);await capture('07-permission-once-light');await captureDetail('07-permission-detail','[data-decision-card=permission]')
      await click('[data-permission-remember]');await capture('08-permission-remember-light');await click('.perm-btn.primary');await until(()=>js('!document.querySelector("[data-decision-card=permission]")'),'permission ack');assert.deepEqual(permissionDecisions,['allow_chat'])
      checks.push('expired-decisions-disable-submit-and-can-be-dismissed','permission-defaults-to-once-and-preserves-remember-protocol')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})');await wait(180);sendAsk('fixture-question-dark');await until(()=>js('!!document.querySelector("[data-decision-card=question]")'),'dark question');await capture('09-decision-dark')
      win.setContentSize(660,850);await wait(150)
      await js(`(()=>{const sidebar=document.querySelector('.rail-panel-button[data-panel=chats]');if(sidebar?.getAttribute('aria-pressed')==='true')sidebar.click()})()`);await wait(100);await capture('10-decision-narrow-dark')
      assert.equal(await js('(()=>{const r=document.querySelector("[data-decision-card=question]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()'),true)
      win.webContents.send('navora:agent.ask.cancel',{id:'fixture-question-dark',reason:'resolved'})
      win.setContentSize(1380,980);await js('window.navora.config.save({app:{appearance_mode:"light"}})');await wait(160)
      await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:followup',${JSON.stringify(url)});await window.navora.browser.setVisible(id,true)})()`)
      await until(()=>webContents.getAllWebContents().some(wc=>wc.getURL()===url&&!wc.isLoading()),'local browser page')
      const guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!,controller=getBrowserAutomationController(guest)
      await controller.resume()
      async function openAgent(name:string){
        nativePanel=undefined
        await js(`(()=>{const el=[...document.querySelectorAll('[data-browser-agent-control]')].find(el=>el.checkVisibility());el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})()`)
        await until(()=>!!nativePanel,'real NativePanel')
        await wait(120)
        const state=(nativePanel as unknown as {_getState():{windowHandle:string;parentWindowHandle:string;controls:unknown[]}})._getState()
        fs.writeFileSync(path.join(output,name+'-state.json'),JSON.stringify(state,null,2))
        const driver=path.join(project,'scripts','capture-native-panel.py')
        await run('python',[driver,'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:15000})
        nativePanel!.hide();await wait(100)
      }
      await openAgent('11-agent-idle-native-light')
      await controller.claimRun('fixture-background-run');await until(()=>js(`window.navora.browser.workspace.state().then(s=>s.pages.flatMap(row=>row.windows).some(page=>page.automation?.leaseRunId==='fixture-background-run'))`),'actual main-process lease reaches renderer');await wait(160);await openAgent('12-agent-active-native-light')
      await controller.finishRun('fixture-background-run')
      await js('window.navora.config.save({app:{appearance_mode:"dark"}})');await wait(180);await openAgent('13-agent-idle-native-dark')
      checks.push('real-native-agent-panel-idle-active-and-dark-captured','dark-and-narrow-decision-layout-stays-within-viewport')
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,errors,askCalls,permissionDecisions,scope:'Actual Vue/main/preload and real NativePanel in an isolated profile; seeded synthetic messages and controlled delivery failures. Native screenshots use PID-checked PrintWindow; no personal chats, model requests or system input.'},null,2))
      server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.exit(0)
    }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({ok:false,error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors},null,2));await capture('failure');app.exit(1)}
  })())
})
// Bundle the actual main entry with the fixture so both use the same controller
// registry; importing the prebuilt bundle would silently create a second one.
await import('../electron/main')
