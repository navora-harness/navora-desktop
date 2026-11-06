import {app,BrowserWindow,webContents} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import {createDefaultConfig} from '../shared/config'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_toolbar_layout'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('An isolated profile is required')
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
const config=createDefaultConfig()
config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config))
fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'浏览器工具栏布局',createdAt:1,updatedAt:1,messages:[]}))
const show=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-8000,-8000);show.call(this)}
BrowserWindow.prototype.focus=function(){}
const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end(`<title>测试页面 ${request.url}</title><p>导航测试</p>`)})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref()
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`,checks:string[]=[],samples:unknown[]=[]
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>unknown|Promise<unknown>,label:string){for(let n=0;n<200;n++){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=async(code:string):Promise<any>=>{try{return await win.webContents.executeJavaScript(code)}catch(error){console.error('Renderer check failed:',code);throw error}}
    const click=async(selector:string)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!e)throw Error('Missing visible control: '+${JSON.stringify(selector)});e.click()})()`);await wait(80)}
    const geometry=async(label:string)=>{const sample=await js(`(()=>{const host=[...document.querySelectorAll('.file-workspace-head')].find(e=>e.checkVisibility()),strip=host.querySelector('.browser-tab-strip');return {label:${JSON.stringify(label)},host:host.getBoundingClientRect().width,strip:strip.getBoundingClientRect().width,slot:strip.style.getPropertyValue('--workspace-tab-slot-width'),tabs:[...strip.querySelectorAll('.workspace-tab-item')].map(e=>({title:e.textContent,width:e.getBoundingClientRect().width})),tools:host.querySelector('.workspace-context-tools')?.getBoundingClientRect().width}})()`);samples.push(sample);return sample}
    try{
      win.setContentSize(1700,950);await until(()=>js('!!document.querySelector(".composer")'),'app ready')
      const pageId=await js(`(async()=>{const id=await window.navora.browser.workspace.ensure(${JSON.stringify(chat)},'browser:toolbar',${JSON.stringify(url+'a')});await window.navora.browser.setVisible(id,true);return id})()`)
      await until(()=>webContents.getAllWebContents().some(wc=>wc.getURL()===url+'a'&&!wc.isLoading()),'page loaded')
      await until(()=>js('document.querySelector(".browser-annotation-toggle")?.checkVisibility()'),'toolbar visible')
      assert.equal(await js('[...document.querySelectorAll(".browser-forward")].some(e=>e.checkVisibility())'),false)
      const guest=webContents.getAllWebContents().find(wc=>wc.getURL()===url+'a')!
      await guest.loadURL(url+'b')
      await until(()=>js('[...document.querySelectorAll(".browser-back")].some(e=>e.checkVisibility()&&!e.disabled)'),'back available')
      await click('.browser-back')
      await until(()=>guest.getURL()===url+'a','back navigates')
      await until(()=>js('[...document.querySelectorAll(".browser-forward")].some(e=>e.checkVisibility())'),'forward shown')
      await click('.browser-forward')
      await until(()=>guest.getURL()===url+'b','forward navigates')
      await until(()=>js('![...document.querySelectorAll(".browser-forward")].some(e=>e.checkVisibility())'),'forward hidden at end')
      checks.push('Real back and forward history works; forward is hidden without a next entry')
      assert.equal(await js('(()=>{const button=[...document.querySelectorAll(".browser-annotation-toggle")].find(e=>e.checkVisibility()),address=button.parentElement.querySelector(".browser-address-bar");return button.getBoundingClientRect().left>=address.getBoundingClientRect().right})()'),true)
      await click('.browser-annotation-toggle')
      await until(()=>js('document.querySelector(".browser-annotation-toggle[aria-pressed=true]")'),'annotation mode active')
      assert.equal(await js('!!document.querySelector("[aria-label=临时操作网页],[aria-label=返回批注]")'),false)
      await click('.browser-annotation-toggle')
      checks.push('Annotation button sits after address; temporary browsing button removed')
      if(await js('document.querySelector(".file-workspace .workspace-expand")?.getAttribute("aria-label")==="展开工作区"'))await click('.file-workspace .workspace-expand')
      await wait(400);await geometry('before-new-tab')
      const before=await js('document.querySelectorAll(".file-workspace .workspace-tab-item").length')
      await click('.file-workspace-new-tab')
      await until(()=>js(`document.querySelectorAll('.file-workspace .workspace-tab-item').length===${before+1}`),'new tab created')
      await wait(500)
      const created=await geometry('after-new-tab')
      assert.ok(created.host>1000,'The test provides enough room for full width tabs')
      for(const tab of created.tabs)assert.equal(tab.width,220,'New tabs use ideal width when room is available')
      checks.push('New browser tab keeps 220px slots in a spacious workspace')
      await js(`window.navora.browser.workspace.tabAction({chatId:${JSON.stringify(chat)},pageId:${JSON.stringify(pageId)},action:'activate'})`)
      await until(()=>js('document.querySelector(".browser-annotation-toggle")?.checkVisibility()'),'original toolbar restored')
      fs.writeFileSync(path.join(output,'toolbar.png'),(await win.webContents.capturePage()).toPNG())
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,samples},null,2))
      console.log(JSON.stringify({ok:true,checks:checks.length,samples}));app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,samples},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron/main.js')).href)
