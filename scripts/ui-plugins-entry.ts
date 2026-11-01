import {app,BrowserWindow,dialog} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import {createDefaultConfig} from '../shared/config'
import {creatorTemplate} from '../shared/creators'
import {PluginStore} from '../electron/modules/plugin-store'
import {MarketplaceClient} from '../electron/modules/marketplace-client'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!,reduced=process.env.NAVORA_UI_REDUCED_MOTION==='1'
if(reduced)app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
const catalogRoot=path.join(root,'catalog')
fs.mkdirSync(catalogRoot,{recursive:true})
function files(id:string,name:string,version='1.0.0',bundled=false){return {...creatorTemplate('plugin'),'plugin.json':JSON.stringify({id,name,version,description:'整理资料与本地文本，提供可核对的结果。',defaultEnabled:true,bundled}),'main.cjs':creatorTemplate('plugin')['main.cjs']!.replaceAll('my_plugin_text',id.replaceAll('-','_')+'_text'),'README.md':'# '+name+'\n\n此插件在本地处理文本。\n\n<script>window.__pluginUnsafe=true</script>'}}
for(const item of [{id:'local-tool',name:'资料整理'},{id:'bundled-tool',name:'随附助手',bundled:true},{id:'broken-tool',name:'需要修复的插件',broken:true}]){const directory=path.join(root,'plugins',item.id);fs.mkdirSync(directory,{recursive:true});for(const [name,content] of Object.entries(files(item.id,item.name,'1.0.0',item.bundled)))fs.writeFileSync(path.join(directory,name),item.broken&&name==='main.cjs'?'module.exports={':content)}
function catalogProduct(id:string,name:string,version:string){const directory=path.join(catalogRoot,'plugins',id,version);fs.mkdirSync(directory,{recursive:true});const zip=new AdmZip();for(const [file,content] of Object.entries(files(id,name,version)))zip.addFile(file,Buffer.from(content));const archive=zip.toBuffer();fs.writeFileSync(path.join(directory,'package.zip'),archive);fs.writeFileSync(path.join(directory,'README.md'),'# '+name+'\n\n来自测试商店的插件说明。');return {kind:'plugin',productId:id,name,description:'本地文本处理插件',displayMode:'single',packages:[{id,name,description:'本地处理',versions:[{version,sha256:crypto.createHash('sha256').update(archive).digest('hex'),size:archive.length,downloadPath:`plugins/${id}/${version}/package.zip`,publishedAt:'2026-11-01',hasReadme:true,readmePath:`plugins/${id}/${version}/README.md`}]}]}}
fs.writeFileSync(path.join(catalogRoot,'index.json'),JSON.stringify({schemaVersion:1,generatedAt:'2026-11-01',products:[catalogProduct('local-tool','资料整理','1.2.0'),catalogProduct('store-helper','商店文本助手','1.0.0')]}))
const importArchive=path.join(root,'imported-helper.zip'),importZip=new AdmZip();for(const [file,content] of Object.entries(files('imported-helper','导入助手')))importZip.addFile(file,Buffer.from(content));importZip.writeZip(importArchive)
const config=createDefaultConfig();config.app.onboarding_completed=true;config.app.ai_generate_chat_title=false;config.remote.enabled=false;config.store.base_url=catalogRoot
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config));app.setPath('userData',root)
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){}
dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[importArchive]})) as typeof dialog.showOpenDialog
dialog.showSaveDialog=(async()=>({canceled:false,filePath:path.join(root,'exported-plugin.zip')})) as typeof dialog.showSaveDialog
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let started=false
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.setBackgroundThrottling(false);if(win.webContents.isOffscreen()){win.webContents.setFrameRate(60);win.webContents.on('paint',()=>{})}const errors:string[]=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=async(code:string):Promise<any>=>{const result=await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).catch(error=>({__testFailure:String(error)}))`);if(result?.__testFailure)throw Error(code.slice(0,180)+' / '+result.__testFailure);return result}
  const click=async(selector:string)=>{const point=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const event of [{type:'mouseMove',...point},{type:'mouseDown',button:'left',clickCount:1,...point},{type:'mouseUp',button:'left',clickCount:1,...point}])win.webContents.sendInputEvent(event as Electron.MouseInputEvent);await wait(180)}
  const input=async(selector:string,value:string)=>{await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(70)}
  const nav=async(label:string)=>{await js(`[...document.querySelectorAll('.plugin-sections button')].find(el=>el.textContent.includes(${JSON.stringify(label)})).click()`);await wait(240)}
  const action=async(label:string)=>{await js(`[...document.querySelectorAll('.plugin-detail-actions button')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`);await wait(250)}
  const dialogButton=async(label:string)=>{await js(`[...document.querySelectorAll('.v-dialog.v-overlay--active button')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`);await wait(300)}
  const capture=async(name:string)=>{await wait(80);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())}
  try{
    for(let n=0;n<60;n++){if(await js('!!document.querySelector(".composer")'))break;await wait(100)}win.setMinimumSize(0,0);win.setContentSize(1440,900);await wait(150)
    await input('.composer-input textarea','保留的对话草稿')
    await click('[data-panel="plugins"]');await wait(250)
    assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true)
    assert.equal(await js('document.querySelector(".conversation-content").checkVisibility()'),false)
    assert.equal(await js('document.querySelectorAll(".plugin-result").length'),3)
    assert.equal(await js('document.querySelectorAll(".rail-panel-button[aria-pressed=true]").length'),1)
    await click('[data-plugin-key="local:local-tool"]')
    assert.equal(await js('document.querySelector(".plugin-hero h2").textContent'),'资料整理')
    assert.equal(await js('document.querySelector(".plugin-docs").textContent.includes("在本地处理文本")'),true)
    assert.equal(await js('!!window.__pluginUnsafe'),false)
    await capture('plugins-installed')
    await click('.plugin-enable-action input');assert.equal(await js('document.querySelector(".plugin-enable-action input").checked'),false)
    await action('导出');assert.equal(fs.existsSync(path.join(root,'exported-plugin.zip')),true)
    await js("[...document.querySelectorAll('.plugin-detail-tabs button')].find(el=>el.textContent==='工具').click()")
    assert.equal(await js('document.querySelectorAll(".plugin-tool-grid code").length'),1,'Known tools remain inspectable while the plugin is disabled')
    await click('.plugin-enable-action input');assert.equal(await js('document.querySelectorAll(".plugin-tool-grid code").length'),1)
    await click('[data-plugin-key="local:broken-tool"]');assert.equal(await js('!!document.querySelector(".plugin-detail-error")'),true)
    await click('[data-plugin-key="local:bundled-tool"]');assert.equal(await js('!!document.querySelector(".plugin-danger")'),false)
    await nav('插件商店');assert.equal(await js('document.querySelectorAll(".plugin-result").length'),2)
    await click('[data-plugin-key="store:local-tool"]');assert.equal(await js('document.querySelector(".plugin-detail-actions").textContent.includes("更新插件")'),true)
    await action('更新插件');assert.equal(await js('!!document.querySelector(".v-dialog.v-overlay--active .installer")'),true)
    if(await js('!![...document.querySelectorAll(".v-dialog.v-overlay--active button")].find(el=>el.textContent.trim()==="继续")'))await dialogButton('继续')
    await dialogButton('更新到 1.2.0');await wait(250)
    assert.equal(await js('(async()=>{return (await window.navora.plugins.list()).find(p=>p.id==="local-tool").version})()'),'1.2.0')
    await click('[data-plugin-key="store:store-helper"]');await capture('plugins-store-detail')
    await action('安装插件');if(await js('!![...document.querySelectorAll(".v-dialog.v-overlay--active button")].find(el=>el.textContent.trim()==="继续")'))await dialogButton('继续')
    await dialogButton('确认安装');await wait(250)
    assert.equal(await js('document.querySelector(".plugin-detail-actions").textContent.includes("安装插件")'),false,'Installed state refreshes in place')
    await action('卸载');await dialogButton('确认卸载')
    assert.equal(await js('document.querySelector(".plugin-detail-actions").textContent.includes("安装插件")'),true,'Uninstall updates catalog state without stale installed flags')
    await nav('搜索插件');await input('.plugin-search input','LOCAL TEXT')
    assert.equal(await js('document.querySelectorAll(".plugin-result").length'),1,'Search matches local tool names without duplicating catalog results')
    await input('.plugin-search input','不存在的插件');assert.equal(await js('document.querySelector(".plugin-list-empty").textContent.includes("没有匹配")'),true)
    await input('.plugin-search input','');await nav('已安装插件')
    await click('.plugin-import-action');await js("[...document.querySelectorAll('.plugin-import-menu button')].find(el=>el.textContent==='安装 ZIP').click()");await wait(180)
    assert.equal(await js('!!document.querySelector(".v-dialog.v-overlay--active .import-body")'),true)
    await dialogButton('确认安装');await wait(200)
    assert.equal(await js('document.querySelector(".plugin-hero h2").textContent'),'导入助手')
    await capture('plugins-imported')
    const originalList=PluginStore.prototype.list;try{PluginStore.prototype.list=function(){throw Error('fixture-list-unavailable')};await click('[aria-label="刷新插件"]');assert.equal(await js('!!document.querySelector(".plugin-sidebar-error")'),true);assert.equal(await js('document.querySelectorAll(".plugin-result").length'),4)}finally{PluginStore.prototype.list=originalList}await click('.plugin-sidebar-error button')
    const originalStore=MarketplaceClient.prototype.list;try{MarketplaceClient.prototype.list=async()=>({ok:false,error:'store_unreachable'});await nav('插件商店');await click('[aria-label="刷新插件"]');assert.equal(await js('document.querySelector(".plugin-sidebar-error").textContent.includes("无法连接")'),true);await nav('已安装插件');assert.equal(await js('document.querySelectorAll(".plugin-result").length'),4)}finally{MarketplaceClient.prototype.list=originalStore}
    await click('[data-panel="plugins"]');await wait(180);assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width'),52);assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true,'Closing plugin navigation preserves the detail view');await click('[data-panel="plugins"]')
    for(const width of [960,650,390]){win.setContentSize(width,844);await wait(150);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true);if(await js('!!document.querySelector(".mobile-topbar") && document.querySelector(".mobile-topbar").checkVisibility()')){await click('[aria-label="打开菜单"]');await click('[data-plugin-key="local:local-tool"]');assert.equal(await js('document.querySelector(".shell").classList.contains("sidebar-open")'),false)}await capture('plugins-width-'+width)}
    win.setContentSize(1440,900);await wait(150);await click('.plugin-back');assert.equal(await js('document.querySelector(".composer-input textarea").value'),'保留的对话草稿')
    await click('[data-panel="plugins"]');await click('[aria-label="搜索对话"]');await click('.chat-search-close');await click('[data-panel="plugins"]');assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true,'Plugin navigation can be reopened after conversation search')
    await click('[aria-label="创建插件"]');await wait(250);assert.equal(await js('!!document.querySelector(".creator-workspace")'),true,'Plugin navigation opens the existing creator')
    await click('[aria-label="退出创建器"]');assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true,'Closing the creator returns to plugin management')
    await win.webContents.reload();await wait(500);assert.equal(await js('document.querySelector(".plugin-workspace")?.checkVisibility()'),true,'The selected plugin module is restored after reload')
    await click('[aria-label="管理已安装插件"]');await input('.plugin-library [aria-label="搜索插件"]','导入助手');await click('.library-title-row [aria-label="批量操作"]');await click('.plugin-batch-toolbar > button:first-child');await click('.plugin-batch-toolbar .plugin-danger');await dialogButton('确认卸载（1）')
    assert.equal(await js('(async()=>{const records=await window.navora.plugins.list();return !records.some(record=>record.id==="imported-helper")&&records.some(record=>record.id==="bundled-tool")})()'),true,'Bulk uninstall removes the filtered selection and preserves bundled plugins')
    assert.deepEqual(errors,[],'No missing icons or renderer errors');if(reduced){await wait(300);assert.equal(await js('document.getAnimations().filter(a=>a.playState==="running").length'),0)}
    fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reduced,checks:['rail-single-selection','installed-details','safe-readme','toggle','tools','export','bundled-guard','broken-plugin','store-update','store-install','store-uninstall','search-deduplication','local-import','list-recovery','store-offline','responsive','draft-preservation','navigation-recovery']},null,2));console.log(JSON.stringify({ok:true,reduced}));app.exit(0)
  }catch(error){console.error(error);await capture('failure');app.exit(1)}
})())})
await import('../electron/main')
