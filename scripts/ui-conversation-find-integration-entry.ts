import {app,BrowserWindow,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import {createDefaultConfig} from '../shared/config'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,project=process.env.NAVORA_FIND_PROJECT!
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));app.setPath('userData',root)
fs.mkdirSync(path.join(root,'chats'),{recursive:true});fs.mkdirSync(path.join(root,'workspace','chat_find_integration'),{recursive:true})
fs.writeFileSync(path.join(root,'workspace','chat_find_integration','fixture.md'),'# 工作区查找布局资料\n\n此文件用于验证菜单中返回当前聊天查找。')
const now=Date.now()
fs.writeFileSync(path.join(root,'chats','chat_find_integration.json'),JSON.stringify({id:'chat_find_integration',title:'当前聊天查找集成检查',createdAt:now-1000,updatedAt:now,messages:[{id:'user_find',role:'user',content:'请检查聊天查找入口 keyword。',createdAt:now-1000},{id:'answer_find',role:'assistant',content:'## 资料核对\n\n这里包含 **keyword** 标记。\n\n[工作区文件](fixture.md)'+Array.from({length:30},(_,n)=>'\n\n资料段落 '+n+'：切换工作区保留阅读位置。').join(''),createdAt:now}]}))
const originalShow=BrowserWindow.prototype.showInactive
const placedWindows=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placedWindows.has(this)){placedWindows.add(this);this.setPosition(-8000,-8000)};originalShow.call(this)};BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:Array<{name:string;ok:boolean;metrics?:unknown}>=[],errors:string[]=[]
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Find webpage fixture</title><p>native keyword keyword fixture</p>')})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const pageUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}/`
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string)=>win.webContents.executeJavaScript(code)
    const until=async(code:string)=>{for(let n=0;n<100;n++){if(await js(code))return;await wait(50)}throw Error('Timed out: '+code)}
    const click=async(selector:string)=>{await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.focus();element.click()})()`);await wait(180)}
    const key=async(keyCode:string,modifiers:Array<'control'|'shift'|'alt'|'meta'>=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(160)}
    const record=async(name:string,code:string)=>{const result=await js(code);checks.push({name,ok:!!result.ok,metrics:result});console.log(name,JSON.stringify(result))}
    const measure=`(()=>{const panel=document.querySelector('.conversation-find'),input=panel?.querySelector('input'),chat=document.querySelector('#conversation-panel'),main=document.querySelector('.main'),messages=document.querySelector('.messages-wrap'),composer=document.querySelector('.composer'),r=panel?.getBoundingClientRect(),b=main.getBoundingClientRect(),m=messages?.getBoundingClientRect(),c=composer?.getBoundingClientRect(),i=input?.getBoundingClientRect(),hit=i&&document.elementFromPoint(i.x+i.width/2,i.y+i.height/2);return {ok:!!panel&&panel.checkVisibility()&&!panel.closest('[inert]')&&r.height>25&&r.height<100&&r.top>=b.top&&r.bottom<=b.bottom&&r.bottom<=m.top+1&&m.height>100&&c.bottom<=b.bottom+1&&hit===input,opened:!!panel,visible:panel?.checkVisibility(),inert:!!panel?.closest('[inert]'),focused:document.activeElement===input,inputReceivesPointer:hit===input,panel:r?.toJSON(),messages:m?.toJSON(),composer:c?.toJSON(),main:b.toJSON(),rows:getComputedStyle(main).gridTemplateRows,chatDisplay:chat&&getComputedStyle(chat).display,focus:document.activeElement?.outerHTML.slice(0,200)}})()`
    const capture=async(name:string)=>{fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())}
    const close=async()=>{if(await js('!!document.querySelector(".conversation-find")'))await click('[aria-label="关闭当前聊天查找"]')}
    const search=async()=>{await js('(()=>{const input=document.querySelector(".conversation-find input");input.value="keyword";input.dispatchEvent(new Event("input",{bubbles:true}))})()');await until('document.querySelector(".conversation-find-count")?.textContent.includes("/")')}
    try{
      win.setContentSize(1500,900);await until('!!document.querySelector(".composer")')
      await click('button[aria-label="在当前聊天中查找"]');await record('standalone icon opens a compact visible find bar',measure)
      if(!await js('(()=>{const input=document.querySelector(".conversation-find input"),r=input.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input})()'))throw Error('Native pointer cannot reach the actual find input')
      {
        const point=await js('(()=>{const r=document.querySelector(".conversation-find input").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
        win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});for(const character of 'keyword')win.webContents.sendInputEvent({type:'char',keyCode:character})
        await until('document.querySelector(".conversation-find-count")?.textContent.trim()==="1 / 2"');await record('native pointer and typing search actual transcript','({ok:document.querySelector(".conversation-find-count").textContent.trim()==="1 / 2"&&[...CSS.highlights].some(([name,highlight])=>name.startsWith("navora-chat-find-"+document.querySelector(".conversation-find").dataset.findOwner+"-")&&name.endsWith("-active")&&highlight.size>0&&[...highlight].every(range=>document.querySelector("#conversation-panel").contains(range.startContainer)))})')
        await key('F3');await record('F3 navigates the next actual result','({ok:document.querySelector(".conversation-find-count").textContent.trim()==="2 / 2"})');await key('Enter',['shift']);await record('Shift Enter returns to the previous result','({ok:document.querySelector(".conversation-find-count").textContent.trim()==="1 / 2"})')
        await click('.conversation-find-options summary');await record('find options stay above transcript and receive pointer','(()=>{const options=document.querySelector(".conversation-find-options>div"),r=options.getBoundingClientRect(),hit=document.elementFromPoint(r.x+20,r.y+20);return {ok:options.contains(hit),hit:hit?.outerHTML.slice(0,180)}})()');await key('Escape')
      }
      await search();await capture('01-icon-find');await close();await record('closing find restores the three-row transcript layout','(()=>{const messages=document.querySelector(".messages-wrap").getBoundingClientRect(),header=document.querySelector(".conversation-title-header").getBoundingClientRect();return {ok:!document.querySelector(".conversation-find")&&Math.abs(messages.top-header.bottom)<1}})()')
      await click('.chat-more-trigger');await until('!!document.querySelector(".conversation-actions-menu")');await js('[...document.querySelectorAll(".conversation-actions-menu button")].find(el=>el.textContent.includes("在当前聊天中查找")).click()');await wait(450);await record('chat more menu opens the find input after menu dismissal',measure);await record('chat menu leaves focus in the find input','({ok:document.activeElement===document.querySelector(".conversation-find input"),overlays:document.querySelectorAll(".v-overlay--active").length})');await capture('02-more-find');await close()
      await js('[...document.querySelectorAll(".application-menu-trigger")].find(el=>el.textContent==="编辑").click()');await until('!!document.querySelector("[data-command=\\"conversation.find\\"]")');await click('[data-command="conversation.find"]');await record('application edit menu opens current-chat find',measure);await close()
      await js('document.querySelector(".composer-richtext").focus()');await key('F',['control']);await record('Ctrl F from composer opens current-chat find',measure);await close()
      await click('[data-chat-resource=workspace]');await until('!!document.querySelector(".file-workspace [role=tab]")')
      await click('button[aria-label="在当前聊天中查找"]');await record('split workspace keeps chat find outside the native browser column',measure);await close()
      await click('[aria-label="展开工作区"]');await click('[data-conversation-tab]');await until('document.querySelector(".composer").checkVisibility()')
      await click('.workspace-chat-tools button[aria-label="在当前聊天中查找"]');await record('expanded conversation toolbar opens interactive find',measure);await search();await capture('03-expanded-find');await close()
      await click('.workspace-chat-tools .chat-more-trigger');await until('!!document.querySelector(".conversation-actions-menu")');await js('[...document.querySelectorAll(".conversation-actions-menu button")].find(el=>el.textContent.includes("在当前聊天中查找")).click()');await wait(450);await record('expanded chat menu opens find without inert ancestor',measure);await close()
      await js('document.querySelector(".composer-richtext").focus()');await key('F',['control']);await record('expanded conversation Ctrl F opens find',measure);await close()
      await click('[aria-label="收起工作区（恢复分栏）"]')
      win.setContentSize(900,800);await until('document.querySelector(".main").classList.contains("workspace-single")');await click('.file-workspace [role=tab][data-page-id]');await until('!document.querySelector(".composer").checkVisibility()');await js('window.narrowFindBefore={expanded:document.querySelector(".main").classList.contains("workspace-single"),hidden:!document.querySelector(".composer").checkVisibility()}');await wait(200)
      await js('[...document.querySelectorAll(".application-menu-trigger")].find(el=>el.textContent==="编辑").click()');await until('!!document.querySelector("[data-command=\\"conversation.find\\"]")');await click('[data-command="conversation.find"]');await record('find invoked over automatically expanded workspace reveals the current conversation',`(()=>{const result=${measure};return {...result,ok:result.ok&&window.narrowFindBefore.expanded&&window.narrowFindBefore.hidden&&document.querySelector('[data-conversation-tab]')?.getAttribute('aria-selected')==='true',before:window.narrowFindBefore}})()`);await capture('04-narrow-expanded-find');await close()
      if(await js('!!document.querySelector(".file-workspace")'))await click('.file-workspace .workspace-launcher')
      win.setContentSize(1500,900);await wait(350);await click('[data-chat-resource=workspace]');await until('!!document.querySelector(".file-workspace [role=tab]")')
      await js(`(async()=>{const tab=(await window.navora.browser.workspace.state()).pages.flatMap(s=>s.windows)[0];window.findPage=tab.windowId;await window.navora.browser.workspace.command(tab.windowId,'navigate',${JSON.stringify(pageUrl)})})()`)
      for(let n=0;n<100&&!webContents.getAllWebContents().some(w=>w.getURL()===pageUrl&&!w.isLoading());n++)await wait(50)
      const guest=webContents.getAllWebContents().find(w=>w.getURL()===pageUrl);if(!guest)throw Error('No native webpage fixture')
      await wait(400)
      const nativeEvents:Array<{type:string;key:string;control:boolean}>=[];guest.on('before-input-event',(_event,input)=>nativeEvents.push({type:input.type,key:input.key,control:input.control}))
      guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']});guest.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});await wait(400)
      checks.push({name:'native guest receives the actual Ctrl F key event',ok:nativeEvents.some(input=>input.type==='keyDown'&&input.key.toLowerCase()==='f'&&input.control),metrics:{nativeEvents,state:await js('window.navora.browser.workspace.state()')}})
      await record('native webpage Ctrl F retains webpage find','({ok:!!document.querySelector(".browser-find-bar")&&!document.querySelector(".conversation-find"),webFind:!!document.querySelector(".browser-find-bar")})');await capture('05-native-web-find')
      const ok=checks.length===17&&checks.every(check=>check.ok)&&errors.length===0;fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok,renderer:process.env.VITE_DEV_SERVER_URL?'source':'built',rendererBundle:process.env.VITE_DEV_SERVER_URL?undefined:fs.readFileSync(path.join(project,'dist','index.html'),'utf8').match(/assets\/index-[^"\s]+\.js/)?.[0],checks,errors},null,2));console.log(JSON.stringify({ok,checks:checks.length,failed:checks.filter(check=>!check.ok).map(check=>check.name),output}));app.exit(process.env.NAVORA_FIND_EXPECT_FIXED==='1'&&!ok?1:0)
    }catch(error){try{await capture('failure');fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2))}catch{}console.error(error);app.exit(1)}finally{server.close()}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
