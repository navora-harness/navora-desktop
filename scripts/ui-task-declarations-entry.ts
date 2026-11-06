import {app,BrowserWindow,Menu,ipcMain} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {createComposerDocument} from '../shared/composer-document'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_declarations_a',other='chat_declarations_b',unknown='chat_declarations_future'
if(!profile||!path.isAbsolute(profile)||!project||!output)throw Error('Explicit isolated fixture paths required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const requests:any[]=[],submissions:any[]=[],errors:string[]=[],layoutWarnings:string[]=[],checks:string[]=[]
const server=createServer(async(request,response)=>{let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw);requests.push(body);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{role:'assistant',content:'已完成本地只读规划。'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}}))})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref()
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.ai_generate_chat_title=false;config.app.running_message_mode='insert';config.remote.enabled=false;config.files.custom_root=path.join(profile,'workspaces')
config.ai.providers=[{id:'declaration-fixture',label:'本地声明验收',type:'openai_compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,api_key_ref:'',model:'fixture',models:['fixture'],timeout_ms:20000}];config.ai.default_provider='declaration-fixture'
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
for(const [index,id]of [chat,other,unknown].entries()){
 const document=createComposerDocument(id,id===unknown?'未来声明原文':'');if(id===unknown)document.declarations={version:98,ids:['future'],payload:{retain:'完整保留'}}
 fs.writeFileSync(path.join(profile,'chats',id+'.json'),JSON.stringify({id,title:['任务声明甲','任务声明乙','未来声明丙'][index],createdAt:Date.now()-index*1000,updatedAt:Date.now()-index*1000,providerId:'declaration-fixture',model:'fixture',executionMode:'chat',draftDocument:document,draftRevision:0,...(id===other?{queuePaused:true,queuedMessages:[{id:'queue-declarations',content:'队列规划正文',document:{...createComposerDocument(id,'队列规划正文'),declarations:{version:1,ids:['plan']}},revision:0,createdAt:Date.now()}]}:{}),messages:[]}))
}
const inactive=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>();BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)}inactive.call(this)};BrowserWindow.prototype.focus=function(){};Menu.prototype.popup=function(){}
let holdSubmission=false,submissionReady=false,releaseSubmission:(()=>void)|undefined
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{if(channel==='navora:agent.submit'){submissions.push(structuredClone(args));const result=structuredClone(await listener(event,...args));if(holdSubmission){submissionReady=true;await new Promise<void>(resolve=>{releaseSubmission=resolve})};return result}return listener(event,...args)})
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));async function until(check:()=>Promise<unknown>|unknown,label:string){for(let n=0;n<220;n++){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
 if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',event=>{if(event.level==='error'){if(event.message==='ResizeObserver loop completed with undelivered notifications.')layoutWarnings.push(event.message);else errors.push(event.message)}})
 win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code),draft=()=>js(`window.navora.chats.get(${JSON.stringify(chat)}).then(chat=>chat.draftDocument)`)
  const click=async(selector:string)=>{await js(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!node)throw Error('Missing visible control: '+${JSON.stringify(selector)});node.click()})()`);await wait(90)}
  const press=async(key:string,modifiers:string[]=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers:modifiers as any});win.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers:modifiers as any});await wait(100)}
  const editor='.composer .composer-richtext',chips=()=>js('([...document.querySelectorAll(".composer .composer-input .composer-task-declaration")].map(node=>node.textContent.trim()))')
  const menu=async()=>{await click('.composer [aria-label="附加"]');await until(()=>js('!!document.querySelector(".composer-attachment-menu")'),'attachment menu')}
  const select=async(id:string)=>{await menu();await click('#composer-attach-declaration-'+id);await until(()=>js(`!document.querySelector('.composer-attachment-menu')`),'menu dismissed')}
  const navigate=async(id:string)=>{const title=id===chat?'任务声明甲':id===other?'任务声明乙':'未来声明丙';await js(`[...document.querySelectorAll('.chat-item-title-text')].find(node=>node.textContent.trim()===${JSON.stringify(title)}).closest('.chat-item-main').click()`);await until(()=>js(`document.querySelector('.chat-item.active .chat-item-title-text')?.textContent.trim()===${JSON.stringify(title)}`),'conversation switch');await wait(150)}
  try{
   win.setContentSize(1550,980);await until(()=>js(`!!document.querySelector(${JSON.stringify(editor)})`),'composer mounted')
   await menu();assert.deepEqual(await js('([...document.querySelectorAll(".composer-attachment-label")].map(node=>node.textContent))'),['添加','声明','工具'])
   assert.equal(await js('document.querySelector("#composer-attach-declaration-plan").getAttribute("role")'),'menuitemcheckbox');assert.equal(await js('document.querySelector("#composer-attach-declaration-plan").getAttribute("aria-checked")'),'false')
   await js('(()=>{const input=document.querySelector(".composer-attachment-search input");input.value="planning";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
   await until(()=>js('document.querySelectorAll(".composer-attachment-options>button").length===1'),'English declaration alias')
   await press('Enter');await until(async()=>(await chips()).length===1,'plan selected')
   assert.equal(await js('document.querySelector(".composer .composer-richtext").contains(document.activeElement)'),true)
   assert.equal(await js('document.querySelector(".composer [aria-label=发送]").disabled'),true)
   await until(async()=>(await draft())?.declarations?.ids?.includes('plan'),'pure declaration saved')
   checks.push('HTML-attachment-menu-separates-groups-and-check-state-with-search-aliases-and-restores-editor-focus')
   await press('z',['control']);await until(async()=>(await chips()).length===0,'declaration undo');await press('y',['control']);await until(async()=>(await chips()).length===1,'declaration redo')
   await select('automation');await until(async()=>(await chips()).length===2,'combined declarations');await until(async()=>(await draft())?.declarations?.ids?.length===2,'combined declaration saved')
   fs.writeFileSync(path.join(output,'task-declarations-composer.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
   checks.push('declaration-only-draft-disables-send-but-persists-and-shares-editor-undo-redo-history')
   await navigate(other);assert.equal((await chips()).length,0)
   assert.equal(await js('document.querySelector(".queue-declarations")?.textContent'),'计划');assert.equal(await js('document.querySelector("[aria-label=直接插入队列消息]").disabled'),true)
   await click('[aria-label="编辑队列消息"]');await click('.queue-attach');await click('#composer-attach-declaration-automation')
   await until(()=>js('document.querySelectorAll(".queue-document-container .composer-task-declaration").length===2'),'queue-only declaration changed');assert.equal((await chips()).length,0)
   await js('[...document.querySelectorAll(".queue-edit-actions button")].find(button=>button.textContent.trim()==="保存").click()')
   await until(()=>js(`window.navora.chats.get(${JSON.stringify(other)}).then(chat=>chat.queuedMessages[0].revision===1)`),'real queue edit saved')
   const queued=await js(`window.navora.chats.get(${JSON.stringify(other)}).then(chat=>chat.queuedMessages[0])`);assert.deepEqual(queued.document.declarations,{version:1,ids:['automation','plan']});assert.equal(queued.taskConstraints.phase,'plan')
   checks.push('queue-declaration-edit-targets-only-its-document-and-persists-revision-and-frozen-plan-stage')
   await navigate(chat);assert.equal((await chips()).length,2)
   win.webContents.reload();await until(()=>js(`!!document.querySelector(${JSON.stringify(editor)})`),'reload composer');await until(async()=>(await chips()).length===2,'declarations survive renderer restart')
   checks.push('per-chat-declarations-survive-conversation-switch-and-renderer-restart-without-leaking')
   await js(`document.querySelector(${JSON.stringify(editor)}).focus()`);win.webContents.insertText('先规划整理页面的方案');await until(()=>js('document.querySelector(".composer [aria-label=发送]").disabled===false'),'body makes submission valid')
   holdSubmission=true;await click('.composer [aria-label="发送"]');await until(()=>js(`window.navora.chats.get(${JSON.stringify(chat)}).then(chat=>chat.messages.some(message=>message.role==='user'&&message.meta?.taskConstraints?.phase==='plan'))`),'real main accepts plan snapshot')
   const accepted=await js(`window.navora.chats.get(${JSON.stringify(chat)}).then(chat=>chat.messages.find(message=>message.role==='user'))`)
   assert.deepEqual(accepted.meta.document.declarations,{version:1,ids:['automation','plan']});assert.equal(accepted.content,'先规划整理页面的方案');assert.equal(accepted.meta.taskConstraints.phase,'plan');assert.equal(submissions.at(-1)?.[2],'queue')
   await until(async()=>(await chips()).length===0,'accepted submission clears next draft declarations');await until(()=>submissionReady,'submission result held before IPC delivery');await select('automation');await until(async()=>(await draft())?.declarations?.ids?.length===1&&(await draft())?.id!==accepted.meta.document.id,'new declaration saved while old receipt held');releaseSubmission!();await until(()=>js('document.querySelector(".composer .composer-send").getAttribute("aria-busy")==="false"'),'held submission receipt delivered');assert.equal((await chips()).length,1);checks.push('a-delayed-accepted-receipt-does-not-clear-the-next-drafts-new-declaration');await click('.composer [aria-label="移除自动化声明"]');await until(async()=>(await chips()).length===0,'remove new draft declaration after receipt');await until(()=>js('!!document.querySelector(".msg-task-declarations")'),'history declaration visible')
   await until(()=>requests.length>0,'local model request');assert.ok(requests[0].tools?.length>0);assert.equal(await js(`window.navora.chats.get(${JSON.stringify(chat)}).then(chat=>chat.executionMode)`),'chat')
   checks.push('structured-submission-keeps-body-and-phase-separate-forces-only-this-message-tool-path-and-clears-next-draft')
   await js(`document.querySelector(${JSON.stringify(editor)}).focus()`);await press('/');await until(()=>js('!!document.querySelector(".composer-attachment-menu")'),'slash menu');await click('#composer-attach-declaration-automation');await until(async()=>(await chips()).length===1,'slash declaration selected')
   assert.equal(await js(`document.querySelector(${JSON.stringify(editor)}).textContent`),'');await press('z',['control']);await until(async()=>(await chips()).length===0,'slash declaration undo');assert.equal(await js(`document.querySelector(${JSON.stringify(editor)}).textContent`),'/');await press('y',['control']);await until(async()=>(await chips()).length===1,'slash declaration redo');assert.equal(await js(`document.querySelector(${JSON.stringify(editor)}).textContent`),'')
   checks.push('slash-consumption-and-declaration-change-form-one-editor-history-transaction')
   await until(()=>js(`window.navora.agent.isRunning(${JSON.stringify(chat)}).then(running=>!running)`),'local run finishes')
   await navigate(unknown);assert.equal(await js('document.querySelector(".composer [aria-label=发送]").disabled'),true);assert.equal(await js('document.querySelector(".composer").textContent.includes("此任务声明暂不支持")'),true)
   await js(`document.querySelector(${JSON.stringify(editor)}).focus()`);win.webContents.insertText('继续保留');await wait(550)
   const retained=await js(`window.navora.chats.get(${JSON.stringify(unknown)}).then(chat=>chat.draftDocument)`);assert.deepEqual(retained.declarations,{version:98,ids:['future'],payload:{retain:'完整保留'}});assert.ok(JSON.stringify(retained.content).includes('继续保留'));assert.equal(submissions.length,1)
   checks.push('future-declaration-metadata-survives-edit-save-while-executable-send-stays-disabled')
   assert.deepEqual(errors,[])
   fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,submissions,layoutWarnings,modelRequests:requests.length,boundaries:['Actual built renderer/preload/main, TipTap history and isolated on-disk chat store are exercised.','The model endpoint is a local deterministic fixture; runtime phase tool denial and child/resume policy are verified separately.','Windows are kept inactive offscreen; this does not assert physical keyboard focus or IME behavior.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
  }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,errors,submissions,requests,renderer:await js('({hash:location.hash,text:document.body.innerText.slice(-6500),composer:document.querySelector(".composer")?.outerHTML.slice(0,14000)})').catch(()=>null)},null,2));console.error(error);app.exit(1)}
 })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
