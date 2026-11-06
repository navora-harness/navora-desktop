import {app,BrowserWindow,Menu,ipcMain,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chatA='chat_resource_a',chatB='chat_resource_b'
if(!profile||!path.isAbsolute(profile)||!project)throw Error('Explicit isolated data root required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
for(const [index,id]of [chatA,chatB].entries())fs.writeFileSync(path.join(profile,'chats',id+'.json'),JSON.stringify({id,title:index?'参考任务乙':'当前任务甲',createdAt:Date.now()-index*1000,updatedAt:Date.now()-index*1000,messages:[]}))
const inactive=BrowserWindow.prototype.showInactive,placed=new WeakSet<BrowserWindow>()
BrowserWindow.prototype.show=function(){if(!placed.has(this)){placed.add(this);this.setPosition(-8000,-8000)}inactive.call(this)};BrowserWindow.prototype.focus=function(){}
const menus:Menu[]=[],popupOptions=new WeakMap<Menu,Electron.PopupOptions>(),checks:string[]=[],management:unknown[][]=[],creates:unknown[][]=[],errors:string[]=[]
let previews=0
Menu.prototype.popup=function(options={}){menus.push(this);popupOptions.set(this,options)}
Menu.prototype.closePopup=function(){const options=popupOptions.get(this);popupOptions.delete(this);options?.callback?.()}
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{if(channel==='navora:browser.session.manage')management.push(structuredClone(args));if(channel==='navora:browser.window.create')creates.push(structuredClone(args));if(channel==='navora:browser.workspace.preview')previews++;return listener(event,...args)})
const local=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end(`<!doctype html><title>${request.url?.includes('b')?'设计参考乙':'规范页面甲'}</title><p>本地浏览器资源验收</p>`)})
await new Promise<void>(resolve=>local.listen(0,'127.0.0.1',resolve));local.unref()
const origin=`http://127.0.0.1:${(local.address() as {port:number}).port}`,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let index=0;index<160;index++){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false);if(started)return;started=true;win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code),root='.global-resources[data-resource-kind=browser]',state=()=>js('window.navora.browser.treeAll()')
    const click=(selector:string)=>js(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!node)throw Error('Missing visible fixture control');node.click()})()`)
    const query=async(value:string)=>{await js(`(()=>{const input=document.querySelector(${JSON.stringify(root+' [aria-label=搜索浏览器资源]')});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(90)}
    const rows=()=>js(`([...document.querySelectorAll(${JSON.stringify(root+' .tree-row.win')})].filter(row=>row.checkVisibility()).map(row=>({id:row.dataset.pageId,owner:row.dataset.ownerId,text:row.innerText})))`)
    const invoke=(menu:Menu,label:string)=>{const item=menu.items.find(item=>item.label===label);assert.ok(item,`Missing native menu item ${label}`);assert.equal(item.enabled,true);item.click(item,win,{} as any)}
    const openDefaultMenu=async()=>{const before=menus.length;await click(root+' [data-session-scope=default] .browser-row-more');await until(()=>menus.length>before,'default session native menu');return menus.at(-1)!}
    try{
      win.setContentSize(1500,940);await until(()=>js('!!document.querySelector(".composer")'),'renderer ready')
      await click('[data-panel=browser]');await until(()=>js(`!!document.querySelector(${JSON.stringify(root+' [data-session-id=sess_default]')})`),'lazy default entry visible')
      assert.equal((await state()).length,1);assert.equal((await state())[0].initialized,false);assert.equal(webContents.getAllWebContents().filter(wc=>wc.getURL().startsWith(origin)).length,0)
      assert.equal(await js(`document.querySelector(${JSON.stringify(root)}).textContent.includes('所属对话')`),false)
      checks.push('zero-page-public-default-entry-does-not-create-a-webpage-or-extra-chat')
      await click(root+' [aria-label=新建浏览器页面]')
      await until(async()=>creates.length===1&&(await state())[0].windows.some((page:any)=>page.chatId===chatA),'default new page belongs to actual current chat')
      const pageA=(await state())[0].windows.find((page:any)=>page.chatId===chatA).windowId
      await js(`window.navora.browser.workspace.command(${JSON.stringify(pageA)},'navigate',${JSON.stringify(origin+'/a')})`)
      const shared=await js(`window.navora.browser.createSession(${JSON.stringify(chatB)})`)
      const pageB=await js(`window.navora.browser.createWindow(${JSON.stringify(shared.sessionId)},{chatId:${JSON.stringify(chatB)},url:${JSON.stringify(origin+'/b')},show:false})`)
      const privateSession=await js(`window.navora.browser.createSession(${JSON.stringify(chatB)},{scope:'temporary'})`)
      await js(`window.navora.browser.updateSession(${JSON.stringify(privateSession.sessionId)},{name:'独立账户'})`)
      await until(async()=> (await rows()).length===2,'all-scope public pages from two chats')
      assert.equal(await js(`document.querySelectorAll(${JSON.stringify(root+' [data-session-id=sess_default]')}).length`),1)
      assert.equal(await js(`document.querySelectorAll(${JSON.stringify(root+' .resource-owner')}).length`),0)
      assert.deepEqual((await rows()).map((row:any)=>row.owner).sort(),[chatA,chatB].sort())
      assert.ok((await rows()).some((row:any)=>row.text.includes('参考任务乙')))
      assert.equal(await js(`document.querySelector(${JSON.stringify(root+' [data-session-id="'+privateSession.sessionId+'"]')})`),null)
      assert.ok(await js(`document.querySelector(${JSON.stringify(root+' .empty-session-discovery')}).textContent.includes('1')`))
      const sidebarBounds=await js(`(()=>{const rect=document.querySelector(${JSON.stringify(root)}).getBoundingClientRect();return {x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}})()`)
      fs.writeFileSync(path.join(output,'browser-resources-all.png'),(await win.webContents.capturePage(sidebarBounds)).toPNG())
      checks.push('two-chat-public-pages-use-one-session-node-with-owner-labels-and-no-outer-chat-tree')
      await query('独立账户');await until(()=>js(`!!document.querySelector(${JSON.stringify(root+' [data-session-id="'+privateSession.sessionId+'"]')})`),'named empty private session found by search');assert.equal((await rows()).length,0)
      await query('参考任务乙');await until(async()=> (await rows()).length===1,'owner name search scoped to matching pages');assert.equal((await rows())[0].id,pageB.windowId)
      await js(`([...document.querySelectorAll(${JSON.stringify(root+' .browser-scope-buttons button')})].find(button=>button.textContent==='当前对话')).click()`)
      await until(async()=> (await rows()).length===0,'current scope excludes other chat search results')
      assert.equal(await js(`document.querySelectorAll(${JSON.stringify(root+' [data-session-id=sess_default]')}).length`),1)
      assert.equal(await js(`document.querySelectorAll(${JSON.stringify(root+' .global-resource-empty')}).length`),1)
      await query('');assert.equal((await rows()).length,1);assert.equal((await rows())[0].owner,chatA)
      assert.equal(await js(`document.querySelector(${JSON.stringify(root+' .page-owner')})`),null)
      checks.push('search-discovers-empty-private-sessions-and-respects-current-owner-with-one-no-result-message')
      await js(`([...document.querySelectorAll(${JSON.stringify(root+' .browser-scope-buttons button')})].find(button=>button.textContent==='全部对话')).click()`)
      const beforeOptions=menus.length;await click(root+' [aria-label=浏览器资源选项]');await until(()=>menus.length>beforeOptions,'resource options native menu')
      const options=menus.at(-1)!,showEmpty=options.items.find(item=>item.label==='显示空会话')!;assert.equal(showEmpty.type,'checkbox');assert.equal(showEmpty.checked,false);invoke(options,'显示空会话')
      await until(()=>js(`!!document.querySelector(${JSON.stringify(root+' [data-session-id="'+privateSession.sessionId+'"]')})`),'empty private sessions shown explicitly')
      const styles=await js(`(()=>{const list=document.querySelector(${JSON.stringify(root+' .global-resource-list')}),tree=document.querySelector(${JSON.stringify(root+' .res-tree')});return {outer:getComputedStyle(list).overflowY,inner:getComputedStyle(tree).overflowY}})()`)
      assert.deepEqual(styles,{outer:'auto',inner:'visible'});checks.push('native-list-options-toggle-empty-sessions-with-one-scroll-container')
      const menu=await openDefaultMenu();assert.equal(menu.items.some(item=>/重命名|删除会话|设为默认|取消默认/.test(item.label)),false)
      assert.ok(menu.items.some(item=>item.label==='关闭当前对话的页面'))
      const beforeManagement=management.length;invoke(menu,'清除网站数据…')
      await until(()=>js('!![...document.querySelectorAll(".v-overlay--active")].find(node=>node.textContent.includes("清除共享网站数据"))'),'explicit shared-data impact dialog')
      assert.equal(await js('[...document.querySelectorAll(".v-overlay--active")].some(node=>node.textContent.includes("所有对话使用的登录状态都会受到影响"))'),true)
      await js('[...document.querySelectorAll(".v-overlay--active button")].find(button=>button.textContent.trim()==="取消").click()');await wait(100);assert.equal(management.length,beforeManagement)
      checks.push('default-session-hides-destructive-identity-actions-and-shared-data-confirmation-cancel-has-no-effect')
      const closeMenu=await openDefaultMenu();invoke(closeMenu,'关闭当前对话的页面')
      await until(()=>js('[...document.querySelectorAll(".v-overlay--active")].some(node=>node.textContent.includes("只关闭当前对话"))'),'chat-scoped public close dialog')
      await js('[...document.querySelectorAll(".v-overlay--active button")].find(button=>button.textContent.trim()==="关闭当前对话的页面").click()')
      await until(async()=>{const tree=await state();return !tree[0].windows.some((page:any)=>page.windowId===pageA)&&tree[0].windows.some((page:any)=>page.windowId===pageB.windowId)},'public close preserves other chat page')
      assert.deepEqual(management.at(-1),['sess_default','close-pages',{chatId:chatA}]);checks.push('public-session-close-uses-captured-chat-and-preserves-other-chat-pages')
      assert.equal((await js('window.navora.chats.list()')).length,2)
      assert.equal((await state()).filter((session:any)=>session.sessionId==='sess_default').length,1)
      assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,creates,management,previews,boundaries:['Actual built renderer/preload/main with two temporary chats and real session APIs. No external website or installed profile is used.','Native Menu objects and real application callbacks are exercised while OS popup display is suppressed; physical focus/IME/DPI are separate.','Existing session-management confirmation dialogs remain HTML; this resource-list change does not claim completion of the deferred native-overlay migration.','Shared-data clear is cancelled; actual shared-data management concurrency is covered separately by the backend suite.']},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));app.exit(0)
    }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,creates,management,errors,previews,tree:await state().catch(()=>null),renderer:await js(`({text:document.body.innerText.slice(-2200),resources:document.querySelector(${JSON.stringify(root)})?.innerHTML.slice(0,12000)})`).catch(()=>null)},null,2));console.error(error);app.exit(1)}
  })())
})
await import(pathToFileURL(path.join(project,'dist-electron','main.js')).href)
