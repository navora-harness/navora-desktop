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
const documentationFixture=[
  '此插件在本地处理文本。支持**批量整理**、结果核对与可复用的工具调用，使用 `compute.local` 权限。',
  '[快速开始](#快速开始) · [参数说明](#参数说明)',
  '## 快速开始',
  '1. 安装并启用插件。\n2. 在对话中描述需要整理的资料。\n   - 保留原始文档。\n   - 指定输出内容。',
  '### 准备工作',
  '- 检查文件内容。\n  - 支持 Markdown 与纯文本。\n- 确认输出位置。',
  '> [!TIP]\n> 第一次使用时，建议先用少量资料检查结果。',
  '## 参数说明',
  '| 参数 | 类型 | 默认值 | 用途 | 示例 | 备注 |\n| --- | --- | --- | --- | --- | --- |\n| `text` | string | 必填 | 待处理内容 | `hello world` | 保留原始内容 |\n| `operation` | string | `normalize` | 整理方式 | `normalize` | 支持批量处理 |\n| `output` | string | 自动 | 输出位置 | `workspace/result.md` | 写入前确认 |',
  '## 示例代码',
  '```json\n{\n  "text": "hello <world>",\n  "operation": "normalize",\n  "comment": "copy preserves exact characters and a deliberately long line for narrow document containers"\n}\n```',
  '```bash\nnode example.cjs --operation normalize --output workspace/result.md\n```',
  '> [!WARNING]\n> 覆盖已有文件前，请确认输出路径。',
  '## 结果检查',
  '- [x] 输入内容已确认。\n- [ ] 输出结果待核对。',
  '<details><summary>展开查看说明</summary><p>工具按已配置权限执行，不自动扩大访问范围。</p></details>',
  '---',
  '### 常见问题',
  '如遇问题，请检查启用状态与工具参数。使用 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制选中文本。',
  '## 结果检查',
  '同名章节保持独立位置。',
].join('\n\n')
function files(id:string,name:string,version='1.0.0',bundled=false){return {...creatorTemplate('plugin'),'plugin.json':JSON.stringify({id,name,version,description:'整理资料与本地文本，提供可核对的结果。',defaultEnabled:true,bundled}),'main.cjs':creatorTemplate('plugin')['main.cjs']!.replaceAll('my_plugin_text',id.replaceAll('-','_')+'_text'),'README.md':'# '+name+'\n\n'+documentationFixture+'\n\n<script>window.__pluginUnsafe=true</script>'}}
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
    await click('[aria-label="页面更多操作"]')
    const menuLayout=await js('(()=>{const menu=document.querySelector(".conversation-actions-menu"),parent=menu.parentElement,r=menu.getBoundingClientRect();return {visible:menu.checkVisibility(),rect:{x:r.x,y:r.y,width:r.width,height:r.height},visibility:getComputedStyle(menu).visibility,parentHeight:parent.clientHeight,parentOverflow:getComputedStyle(parent).overflow}})()')
    assert.equal(menuLayout.visible&&menuLayout.rect.x>=0&&menuLayout.rect.x+menuLayout.rect.width<=1440,true,'The page menu stays inside the viewport in either motion mode')
    await capture('global-menu-initial')
    await click('[aria-label="页面更多操作"]')
    for(const [id,label] of [['chats','对话'],['workspace','文件'],['browser','浏览器'],['plugins','插件']]){
      if(await js(`document.querySelector('[data-panel="${id}"]').getAttribute('aria-pressed')!=='true'`))await click(`[data-panel="${id}"]`)
      await click(`[aria-label="${label}侧栏更多操作"]`)
      assert.equal(await js('!!document.querySelector(".v-overlay--active .sidebar-panel-menu")'),true,'Each sidebar opens an actions menu')
      assert.equal(await js(`document.querySelector('.v-overlay--active .sidebar-panel-menu').getBoundingClientRect().top>document.querySelector('[aria-label="${label}侧栏更多操作"]').getBoundingClientRect().bottom`),true,'Actions open below the trigger without covering it')
      assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width>52'),true,'Opening actions preserves the sidebar')
      if(id==='plugins'){
        await js('document.querySelector(".v-overlay--active .sidebar-panel-menu").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))')
        assert.equal(await js('document.activeElement.getAttribute("role")'),'menuitem','Actions support keyboard focus')
        await capture('sidebar-more-menu')
        await click('.plugin-workspace-head h1')
        assert.equal(await js('!!document.querySelector(".v-overlay--active .sidebar-panel-menu")'),false,'Clicking outside dismisses the actions menu')
        assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width>52'),true)
        await click(`[aria-label="${label}侧栏更多操作"]`)
      }
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(240)
      assert.equal(await js('!!document.querySelector(".v-overlay--active .sidebar-panel-menu")'),false,'Escape dismisses only the actions menu')
      assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width>52'),true)
      await click(`[aria-label="${label}侧栏更多操作"]`)
      await click('.v-overlay--active .sidebar-panel-menu [aria-label="隐藏侧栏"]')
      await wait(180)
      assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width'),52,'The menu can hide each sidebar')
    }
    await click('[data-panel="plugins"]');await wait(250)
    assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true)
    assert.equal(await js('document.querySelector(".conversation-content").checkVisibility()'),false)
    assert.equal(await js('document.querySelectorAll(".plugin-result").length'),3)
    assert.equal(await js('document.querySelectorAll(".rail-panel-button[aria-pressed=true]").length'),1)
    await click('[aria-label="页面更多操作"]')
    assert.equal(await js('document.querySelector(".conversation-actions-menu").textContent.includes("刷新插件")'),true,'The global menu remains available in the plugin workspace')
    assert.equal(await js('document.querySelector(".conversation-actions-menu").textContent.includes("删除当前对话")'),false,'Plugin actions do not expose unrelated conversation controls')
    await click('[aria-label="页面更多操作"]')
    await click('.sidebar-settings-btn')
    await click('[aria-label="页面更多操作"]')
    await js('[...document.querySelectorAll(".conversation-actions-menu button")].find(el=>el.textContent.includes("模型配置")).click()');await wait(200)
    assert.equal(await js('document.querySelector("#settings-page-title").textContent'),'模型','The global settings menu navigates to the actual model configuration')
    await click('[aria-label="页面更多操作"]')
    await js('[...document.querySelectorAll(".conversation-actions-menu button")].find(el=>el.textContent.includes("打开插件管理")).click()');await wait(250)
    assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true)
    await click('[data-plugin-key="local:local-tool"]')
    assert.equal(await js('document.querySelector(".plugin-hero h2").textContent'),'资料整理')
    assert.equal(await js('document.querySelector(".plugin-docs").textContent.includes("在本地处理文本")'),true)
    assert.equal(await js('!!window.__pluginUnsafe'),false)
    await capture('plugins-installed')
    assert.equal(await js('(()=>{const doc=document.querySelector(".plugin-docs");return parseFloat(getComputedStyle(doc.querySelector("h1")).fontSize)>parseFloat(getComputedStyle(doc.querySelector(".document-prose h2")).fontSize)&&getComputedStyle(doc.querySelector(".document-prose ul")).listStyleType==="disc"})()'),true,'Document headings and list markers have a distinct reading hierarchy')
    assert.equal(await js('document.querySelectorAll(".plugin-docs [data-callout]").length'),2,'Tip and warning blocks are styled as author callouts')
    assert.equal(await js('document.querySelectorAll(".plugin-docs .document-code-copy").length'),2)
    assert.equal(await js('(()=>{const ids=[...document.querySelectorAll(".plugin-docs .document-prose h2,.plugin-docs .document-prose h3")].map(el=>el.id);return ids.length===new Set(ids).size})()'),true,'Repeated section names receive unique anchors')
    await js('(()=>{const root=document.querySelector(".plugin-detail-scroll"),target=document.querySelector(".plugin-readme");root.scrollTop+=target.getBoundingClientRect().top-root.getBoundingClientRect().top-24})()');await capture('plugins-markdown-reading')
    await js('Object.defineProperty(navigator.clipboard,"writeText",{configurable:true,value:async text=>{window.__copiedDocumentCode=text}})')
    const exactCode=await js('document.querySelector(".plugin-docs pre code").textContent')
    await click('.plugin-docs .document-code-copy');assert.equal(await js('window.__copiedDocumentCode'),exactCode,'Copying code preserves original text and excludes the language header')
    assert.equal(await js('document.querySelector(".plugin-docs .document-code-copy").textContent'),'已复制')
    await js('delete navigator.clipboard.writeText')
    const windowsBeforeAnchor=BrowserWindow.getAllWindows().length
    const headingPosition=await js('document.querySelector(".plugin-workspace-head").getBoundingClientRect().top')
    await js(`document.querySelector('.plugin-docs a[href^="#"]').click()`);await wait(180)
    assert.equal(await js('document.activeElement.textContent'),'快速开始','README anchors navigate inside the existing document')
    assert.equal(await js('document.querySelector(".plugin-workspace-head").getBoundingClientRect().top'),headingPosition,'Section navigation scrolls only the document and preserves the title bar')
    assert.equal(BrowserWindow.getAllWindows().length,windowsBeforeAnchor,'Section links do not open an empty browser window')
    await js('document.querySelector(".plugin-detail-scroll").scrollTop=0');await wait(180)
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
    for(const width of [960,650,390]){win.setContentSize(width,844);await wait(150);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true);if(await js('!!document.querySelector(".mobile-topbar") && document.querySelector(".mobile-topbar").checkVisibility()')){await click('[aria-label="打开菜单"]');await click('[data-plugin-key="local:local-tool"]');assert.equal(await js('document.querySelector(".shell").classList.contains("sidebar-open")'),false)}await capture('plugins-width-'+width);if(await js('document.querySelector(".plugin-docs .outline-toggle").checkVisibility()')){if(await js('document.querySelector(".plugin-docs .outline-toggle").getAttribute("aria-expanded")==="false"'))await click('.plugin-docs .outline-toggle');assert.equal(await js('document.querySelector(".plugin-docs .outline-toggle").getAttribute("aria-expanded")'),'true')}await js('document.querySelector(".plugin-docs .md-table-scroll").scrollIntoView({block:"center"})');if(width===390)assert.equal(await js('(()=>{const table=document.querySelector(".plugin-docs .md-table-scroll");return table.scrollWidth>table.clientWidth&&document.documentElement.scrollWidth<=innerWidth+1})()'),true,'Wide tables scroll inside the document without widening the app');await capture('plugins-markdown-width-'+width)}
    win.setContentSize(1440,900);await wait(150);await click('.plugin-back');assert.equal(await js('document.querySelector(".composer-input textarea").value'),'保留的对话草稿')
    await click('[data-panel="plugins"]');win.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['control']});await wait(200);await click('.chat-search-close');await click('[data-panel="plugins"]');assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true,'Plugin navigation can be reopened after conversation search')
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
