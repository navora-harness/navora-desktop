import {app,BrowserWindow,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createDefaultConfig} from '../shared/config'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,reduced=process.env.NAVORA_UI_REDUCED_MOTION==='1'
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if(reduced)app.commandLine.appendSwitch('force-prefers-reduced-motion')
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
app.setPath('userData',root)
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(root,'chats'),{recursive:true})
for(const [id,title,time] of [['chat_tree_main','项目资料',3],['chat_tree_other','保留的浏览器数据',2],['chat_tree_empty','尚无浏览器的对话',1]] as const)fs.writeFileSync(path.join(root,'chats',id+'.json'),JSON.stringify({id,title,createdAt:time,updatedAt:time,messages:[]}))
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<title>${req.url==='/second'?'后续资料':'项目首页'}</title><input id="draft" value="网页草稿">`)})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>,label:string){for(let n=0;n<120;n++){if(await check())return;await wait(60)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const errors:string[]=[],checks:string[]=[]
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const click=async(selector:string)=>{await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click()})()`);await wait(140)}
    const exists=(selector:string)=>js(`!!document.querySelector(${JSON.stringify(selector)})`)
    const panel='[data-resource-kind=browser]',main=`${panel} [data-owner-id=chat_tree_main]`,other=`${panel} [data-owner-id=chat_tree_other]`
    const tree=()=>js('window.navora.browser.tree("chat_tree_main")')
    const choose=async(trigger:string,label:string)=>{await until(()=>js('!document.querySelector(".sidebar-ctx-panel")'),'previous menu dismissed');await click(trigger);await until(()=>exists('.sidebar-ctx-panel'),'context menu');await js(`(()=>{const button=[...document.querySelectorAll('.sidebar-ctx-panel button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing menu action '+${JSON.stringify(label)});button.click()})()`);await wait(150)}
    const dialogAction=async(label:string)=>{await js(`(()=>{const dialog=[...document.querySelectorAll('.v-overlay--active')].find(node=>node.querySelector('.v-card'));const button=[...dialog.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing dialog action '+${JSON.stringify(label)});button.click()})()`);await wait(160)}
    const setFilter=async(value:string)=>{await js(`(()=>{const select=document.querySelector('${panel} select[aria-label="浏览器资源显示范围"]');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(140)}
    const search=async(value:string)=>{await js(`(()=>{const input=document.querySelector('${panel} .global-resource-filter input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(180)}
    async function capture(name:string){await wait(150);const rect=await js(`document.querySelector('${panel}').getBoundingClientRect().toJSON()`);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage({x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)})).toPNG())}
    try{
      await until(()=>exists('.composer'),'main app');win.setContentSize(1440,1000)
      const fixtures=await js(`(async()=>{const empty=await window.navora.browser.createSession('chat_tree_main',{persist:true}),filled=await window.navora.browser.createSession('chat_tree_main',{persist:false}),saved=await window.navora.browser.createSession('chat_tree_other',{persist:true});await window.navora.browser.updateSession(saved.sessionId,{name:'账户资料'});await window.navora.browser.updateSession(empty.sessionId,{isDefault:true});const first=await window.navora.browser.createWindow(filled.sessionId,{url:${JSON.stringify(base+'/first')},show:false}),second=await window.navora.browser.createWindow(filled.sessionId,{url:${JSON.stringify(base+'/second')},show:false});return {empty,filled,saved,first,second}})()`)
      await click('[data-panel=browser]')
      const filled=`${main} [data-session-id="${fixtures.filled.sessionId}"]`,empty=`${main} [data-session-id="${fixtures.empty.sessionId}"]`
      await until(()=>exists(filled),'populated session')
      assert.equal(await exists(`${panel} [data-owner-id=chat_tree_empty]`),false)
      assert.equal(await exists(other),false)
      assert.equal(await exists(empty),false)
      checks.push('default-hides-zero-resource-chats','default-hides-other-empty-session-owners','current-empty-sessions-grouped')
      await capture('01-browser-resources-default')
      await click(`${main} .empty-sessions-toggle`)
      assert.equal(await exists(empty),true)
      assert.equal(await js(`document.querySelector('${empty} .session-persistent').getAttribute('aria-label')`),'保留会话数据')
      const beforePages=(await tree()).flatMap((session:any)=>session.windows).length
      await click(`${empty} .tree-name`)
      assert.equal((await tree()).flatMap((session:any)=>session.windows).length,beforePages)
      assert.equal(await exists(`${empty} .session-empty-detail`),true)
      checks.push('empty-session-discovery','storage-label-does-not-claim-login','session-selection-never-creates-a-page')
      await search('账户资料')
      await until(()=>exists(other),'search finds empty named session through default page filter')
      assert.equal(await exists(`${other} [data-session-id="${fixtures.saved.sessionId}"]`),true)
      assert.equal(await exists(main),false)
      checks.push('name-search-finds-collapsed-empty-session','search-keeps-only-matching-owners')
      await search('');await setFilter('all');assert.equal(await exists(other),true)
      await click(`${panel} .browser-scope-buttons button:first-child`)
      assert.equal(await exists(other),false)
      await click(`${panel} .browser-scope-buttons button:last-child`)
      assert.equal(await exists(other),true)
      checks.push('all-session-filter-preserves-empty-sessions','current-and-all-scope-change-only-presentation')
      await choose(`${filled} .session-actions .browser-row-more`,'重命名')
      await until(()=>exists('.v-overlay--active input'),'rename dialog')
      await js(`(()=>{const input=document.querySelector('.v-overlay--active input');input.value='研究资料';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await dialogAction('保存')
      await until(()=>tree().then(items=>items.some((session:any)=>session.sessionId===fixtures.filled.sessionId&&session.name==='研究资料')),'rename persisted')
      assert.equal(await js(`document.querySelector('${filled} .session-title').textContent`),'研究资料')
      await choose(`${filled} .session-actions .browser-row-more`,'设为默认会话')
      await until(()=>tree().then(items=>items.find((session:any)=>session.sessionId===fixtures.filled.sessionId)?.isDefault),'default saved')
      assert.equal((await tree()).filter((session:any)=>session.isDefault).length,1)
      checks.push('rename-updates-session-metadata','default-is-unique-in-owner')
      const guest=webContents.getAllWebContents().find(contents=>contents.getURL()===base+'/first')!
      await until(()=>Promise.resolve(!!guest&&!guest.isLoading()),'fixture webpage')
      const nativeSession=guest.session
      await nativeSession.cookies.set({url:base,name:'keep-me',value:'yes'})
      await choose(`${filled} .session-actions .browser-row-more`,'关闭全部页面')
      await dialogAction('关闭全部页面')
      await until(()=>tree().then(items=>items.find((session:any)=>session.sessionId===fixtures.filled.sessionId)?.windows.length===0),'all pages closed')
      assert.equal((await nativeSession.cookies.get({url:base}))[0]!.value,'yes')
      checks.push('close-all-pages-preserves-session-and-cookie')
      await choose(`${filled} .session-actions .browser-row-more`,'清除网站数据…')
      await dialogAction('取消')
      assert.equal((await nativeSession.cookies.get({url:base}))[0]!.value,'yes')
      checks.push('cancel-data-clear-does-nothing')
      await choose(`${filled} .session-actions .browser-row-more`,'清除网站数据…')
      await dialogAction('清除网站数据')
      await until(()=>nativeSession.cookies.get({url:base}).then(items=>items.length===0),'site cookie cleared')
      assert.equal((await tree()).find((session:any)=>session.sessionId===fixtures.filled.sessionId).name,'研究资料')
      checks.push('clear-site-data-retains-named-session')
      await capture('02-browser-resources-empty-sessions')
      await choose(`${empty} .session-actions .browser-row-more`,'删除会话及数据…')
      await dialogAction('删除会话及数据')
      await until(()=>tree().then(items=>!items.some((session:any)=>session.sessionId===fixtures.empty.sessionId)),'session deleted')
      assert.equal((await tree()).length,1)
      checks.push('confirmed-delete-removes-only-selected-session')
      await click(`${panel} button[aria-label="新建浏览器页面"]`)
      await js(`(()=>{const select=document.querySelector('select[aria-label="新建页面所属对话"]');select.value='chat_tree_empty';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await dialogAction('新建页面')
      await until(()=>js('window.navora.browser.tree("chat_tree_empty").then(sessions=>sessions.length===1&&sessions[0].windows.length===1)'),'explicit new page in another empty chat')
      checks.push('create-page-explicitly-selects-owner-without-empty-chat-clutter')
      win.setContentSize(900,760);await wait(220)
      for(let n=0;n<2&&!await js(`(()=>{const panel=document.querySelector('${panel}');return panel?.checkVisibility()&&panel.clientWidth>100})()`);n++){await click('[data-panel=browser]');await wait(260)}
      const sizes=await js(`(()=>{const panel=document.querySelector('${panel}');return {width:panel.clientWidth,scroll:panel.scrollWidth,visible:panel.checkVisibility()}})()`)
      assert.equal(sizes.visible,true,'Browser resource sidebar is visible before measuring narrow layout')
      assert.ok(sizes.scroll<=sizes.width+1,'Narrow browser resource controls fit')
      await capture('03-browser-resources-narrow')
      checks.push('narrow-resource-panel-no-horizontal-overflow')
      assert.deepEqual(errors.filter(error=>!error.includes('ERR_CONNECTION_REFUSED')&&!error.includes('ERR_FILE_NOT_FOUND')),[])
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reduced,checks},null,2));console.log(JSON.stringify({ok:true,reduced,checks:checks.length}));app.exit(0)
    }catch(error){console.error(error);try{console.error(await js(`({owners:[...document.querySelectorAll('${panel} .resource-owner')].map(el=>el.dataset.ownerId),dialogs:[...document.querySelectorAll('.v-overlay--active')].map(el=>el.textContent),menus:[...document.querySelectorAll('.sidebar-ctx-panel')].map(el=>el.textContent)})`));await capture('failure')}catch{}app.exit(1)}
    finally{server.close()}
  })())
})
await import('../electron/main')
