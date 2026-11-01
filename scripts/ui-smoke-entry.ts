import { app, BrowserWindow, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../shared/config'
import { addProviderFromPresetId } from '../shared/model-providers'
import { OpenAICompatibleClient } from '../electron/modules/llm/openai-compatible'
import { createServer } from 'node:http'

const root = process.env.NAVORA_DATA_ROOT!
const output = process.env.NAVORA_UI_OUTPUT!
const config = createDefaultConfig()
const reducedMotion = process.env.NAVORA_UI_REDUCED_MOTION === '1'
if(reducedMotion) app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
config.app.onboarding_completed = true
config.app.show_main_on_start = true
const cloud = addProviderFromPresetId('cloudbypass', config.ai.providers)!
config.ai.providers.push(cloud)
config.ai.default_provider = cloud.id
config.remote.enabled = true // Regression fixture: legacy default password.
// Use the product's own configuration loader, IPC, preload and renderer in an isolated profile.
// JSON is also valid YAML, and contains only default test configuration.
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
app.setPath('userData',root)
if(process.env.NAVORA_LIVE_WEATHER === '1') {
  const plugin = path.join(root,'plugins','fixture-status')
  fs.mkdirSync(plugin,{recursive:true})
  fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify({id:'fixture-status',name:'Status fixture',version:'1.0.0',description:'Unrelated enabled plugin regression',main:'main.cjs',defaultEnabled:true}))
  fs.writeFileSync(path.join(plugin,'main.cjs'),`module.exports={tools:[{type:'function',function:{name:'fixture_status',description:'Read a fixture status',parameters:{type:'object',properties:{}}}}],execute(){return {ok:true}}}`)
}
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve,ms))
let tested = false

app.on('browser-window-created',(_event,win) => {
  if (tested) return
  tested = true
  win.webContents.setBackgroundThrottling(false)
  if(win.webContents.isOffscreen()) {
    win.webContents.setFrameRate(60)
    win.webContents.on('paint',() => {})
  }
  const errors: string[] = []
  win.webContents.on('console-message',(event) => { if(event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load',() => {
    void (async () => {
      try {
        for(let i=0;i<50;i++) {
          if(await win.webContents.executeJavaScript('!!window.navora && !!document.querySelector(".composer")')) break
          await wait(100)
        }
        assert.equal(await win.webContents.executeJavaScript('!!window.navora'),true,'Product preload must expose the API')
        assert.equal(await win.webContents.executeJavaScript('!!document.querySelector(".composer")'),true)
        if(reducedMotion) assert.equal(await win.webContents.executeJavaScript(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true)
        win.setMinimumSize(0,0)
        win.setContentSize(1440,900)
        await wait(300)
        const capture = async (name: string) => {
          await win.webContents.capturePage(undefined,{stayHidden:true})
          await wait(150)
          fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
        }
        const click = async (selector: string) => {
          const point = await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
          win.webContents.sendInputEvent({type:'mouseMove',...point})
          win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
          win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
          await wait(280)
        }
        const assertViewport = async () => {
          const dimensions = await win.webContents.executeJavaScript(`({width:innerWidth,root:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,right:document.querySelector('.shell').getBoundingClientRect().right,boxes:['body','#app','.v-application','.v-application__wrap','.shell'].map(s=>{const el=document.querySelector(s),r=el.getBoundingClientRect(),css=getComputedStyle(el);return {s,x:r.x,w:r.width,padding:css.padding,margin:css.margin,width:css.width,transform:css.transform}})})`)
          assert.equal(dimensions.root,dimensions.width,'Root must not reserve a scrollbar strip')
          assert.ok(dimensions.scroll <= dimensions.width + 1,'No horizontal overflow')
          assert.ok(Math.abs(dimensions.right - dimensions.width) <= 1,'Shell covers right edge: '+JSON.stringify(dimensions))
        }
        const assertIconContrast = async () => {
          const failures = await win.webContents.executeJavaScript(`(()=>{
            const rgb=value=>{const m=value.match(/rgba?\\(([^)]+)\\)/);return m?m[1].split(',').map(Number):null};
            const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
            return [...document.querySelectorAll('button svg')].filter(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!el.closest('[disabled],[aria-disabled="true"]')).flatMap(el=>{
              const r=el.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth||!r.width)return [];
              const fg=rgb(getComputedStyle(el).color);if(!fg)return [];
              let node=el.parentElement,bg=[255,255,255];while(node){const c=rgb(getComputedStyle(node).backgroundColor);if(c&&(c.length===3||c[3]>=.95)){bg=c;break}node=node.parentElement}
              const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
              return ratio<2.8?[{button:el.closest('button').getAttribute('title')||el.closest('button').getAttribute('aria-label')||el.closest('button').textContent.trim(),ratio,fg,bg}]:[];
            });})()`)
          assert.deepEqual(failures,[],'Visible button icons need contrast')
        }
        // Exercise actual pointer capture, pane toggles and keyboard resize persistence.
        const drag = async (selector: string, dx: number, dy: number) => {
          const point = await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
          win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
          win.webContents.sendInputEvent({type:'mouseMove',x:point.x+dx,y:point.y+dy,modifiers:['leftbuttondown']})
          win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x+dx,y:point.y+dy})
          await wait(80)
        }
        await click('.rail-new-chat')
        const blankCount = await win.webContents.executeJavaScript(`(async()=>(await window.navora.chats.list()).length)()`)
        await click('.composer-input textarea')
        await win.webContents.insertText('保留未发送的草稿')
        await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('.rail-new-chat');for(let i=0;i<5;i++)b.click()})()`)
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'N',modifiers:['control']})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'N',modifiers:['control']})
        await wait(120)
        assert.equal(await win.webContents.executeJavaScript(`(async()=>(await window.navora.chats.list()).length)()`),blankCount,'An empty chat is reused by repeated clicks and Ctrl N')
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.composer-input textarea').value`),'保留未发送的草稿','New chat keeps the unsent draft')
        await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.composer-input textarea');el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
        const sidebarWidth = await win.webContents.executeJavaScript(`document.querySelector('aside.sidebar').getBoundingClientRect().width`)
        await drag('.sidebar-divider.vertical',60,0)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('aside.sidebar').getBoundingClientRect().width`),sidebarWidth+60)
        for(const id of ['workspace','browser','chats']) {
          await click(`[data-panel="${id}"]`)
          assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".rail-panel-button[aria-pressed=true]").length'),1,'Only one rail entry opens at a time')
        }
        assert.equal(await win.webContents.executeJavaScript('!!document.querySelector(".rail-search")?.closest(".activity-rail") && !!document.querySelector(".chat-batch-trigger")?.closest(".dock-header")'),true,'Search and batch controls have dedicated stable positions')
        await capture('navora-desktop.png')
        await assertViewport();await assertIconContrast()
        const menuButton = `document.querySelector('.sidebar-foot button[title="更多"]')`
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(500)
        await capture('navora-menu.png')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.v-menu.v-overlay--active')`),true)
        assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.sidebar-more-item')).color`),'rgb(26, 35, 50)')
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(500)
        await win.webContents.executeJavaScript(`(async()=>{const button=${menuButton};for(let i=0;i<4;i++){button.click();await new Promise(resolve=>setTimeout(resolve,25))}})()`)
        await wait(500)
        await capture('navora-menu-closed.png')
        await wait(450)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[data-pp-menu-pending]').length`),0)
        assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(${menuButton}).opacity`),'1')
        const compositing = await win.webContents.executeJavaScript(`({gutter:getComputedStyle(document.documentElement).scrollbarGutter,clones:document.querySelectorAll('.pp-button-face,[data-pp-dialog-motion]').length,newChatColor:getComputedStyle(document.querySelector('.rail-new-chat')).color})`)
        assert.equal(compositing.gutter,'auto')
        assert.equal(compositing.clones,0)
        assert.notEqual(compositing.newChatColor,'rgb(255, 255, 255)')
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[data-pp-button-visual],.pp-button-face,[data-pp-dialog-motion]').length`),0,'No source clones or dimension morphs')
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(40)
        const animationProperties = await win.webContents.executeJavaScript(`document.getAnimations().filter(a=>a.effect?.target?.classList?.contains('v-overlay__content')).flatMap(a=>a.effect.getKeyframes().flatMap(f=>Object.keys(f)))`)
        assert.ok(!animationProperties.some((key:string)=>['width','height','filter','backdropFilter','left','top'].includes(key)),'Popup animations only composite')
        if(!reducedMotion) assert.ok(animationProperties.includes('opacity') && animationProperties.includes('transform'),'Normal mode retains visible popup motion')
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(180)
        await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create('检索回归');await window.navora.chats.append(c.id,{role:'user',content:'唯一消息关键词 松树和海风'});})()`)
        await wait(150)
        await click('.brand-search-btn')
        assert.equal(await win.webContents.executeJavaScript(`document.activeElement.classList.contains('chat-search-input')`),true,'Search must receive focus after a real click')
        await win.webContents.insertText('松树和海风')
        await wait(200)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.chat-search-hit').length`),1,'Search matches message contents')
        await capture('navora-search.png')
        await click('.chat-search-hit')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.chat-search-input')`),false)
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control']})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['control']})
        await wait(250)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.chat-search-input')`),true,'Ctrl K opens search')
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await wait(220)
        await win.webContents.executeJavaScript(`(async()=>{const c=(await window.navora.chats.list()).find(c=>c.title==='检索回归');await window.navora.chats.append(c.id,{role:'tool',content:'{"ok":true}',meta:{toolName:'weather_get',status:'done',args:{},result:{ok:true},durationMs:1000}});await window.navora.chats.append(c.id,{role:'assistant',content:'**天气排版测试**\\n\\n当前 **18°C**，多云。\\n\\n| 日期 | 天气 | 温度 | 降雨概率 |\\n| --- | --- | --- | --- |\\n| 10/31 | 多云 | 12°C～20°C | 6% |\\n| 11/01 | 阵雨 | 11°C～18°C | 80% |\\n| 11/02 | 阴 | 12°C～19°C | 20% |\\n| 11/03 | 小雨 | 10°C～18°C | 60% |\\n| 11/04 | 多云 | 12°C～20°C | 10% |\\n| 11/05 | 晴 | 13°C～21°C | 5% |\\n| 11/06 | 晴 | 12°C～20°C | 8% |\\n\\n> 以上数值是界面回归夹具，并非实时预报。\\n\\n- 列表与表格使用统一的间距。\\n- 数据来源、复制和耗时位于回答底部。\\n\\n此内容为界面测试夹具。',meta:{durationMs:1400,sources:[{url:'https://open-meteo.com/en/docs',title:'Open-Meteo',siteName:'Open-Meteo'}]}})})()`)
        await wait(180)
        await win.webContents.executeJavaScript(`(async()=>{const c=(await window.navora.chats.list()).find(c=>c.title==='检索回归');await window.navora.chats.append(c.id,{role:'user',content:'第二轮：验证右侧对话导航'});await window.navora.chats.append(c.id,{role:'assistant',content:'右侧标记可以预览每次提问，点击后跳到该轮对话。',meta:{durationMs:800}})})()`)
        await wait(200)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.outline-step').length`),2,'Outline has one stop per user turn')
        const point = await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.outline-step').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
        const shortOutlineWidth=await win.webContents.executeJavaScript(`document.querySelector('.outline-list').getBoundingClientRect().width`)
        win.webContents.sendInputEvent({type:'mouseMove',...point})
        await wait(80)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.outline-preview')`),true,'Outline hover shows the user question')
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.outline-list').getBoundingClientRect().width`),shortOutlineWidth,'Short outlines have stable width without an expanding frame')
        await capture('navora-short-outline.png')
        await click('.outline-step')
        await wait(600)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.outline-step').getAttribute('aria-current')`),'location','Outline click selects the first turn')
        const aligned = await win.webContents.executeJavaScript(`(()=>{const box=document.querySelector('.messages'),message=box.querySelector('.msg.user');return Math.abs(message.getBoundingClientRect().top-box.getBoundingClientRect().top)})()`)
        assert.ok(aligned<4,'Outline scrolls to the actual question: '+aligned)
        await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('.md-table-scroll'),table=c.querySelector('table');return !!table&&c.getBoundingClientRect().width<=document.querySelector('.msg.assistant').getBoundingClientRect().width})()`)
        const replyLayout = await win.webContents.executeJavaScript(`(()=>{const reply=document.querySelector('.msg.assistant'),body=reply.querySelector('.msg-md-content').getBoundingClientRect(),footer=reply.querySelector('.reply-footer').getBoundingClientRect(),run=document.querySelector('.run-card-head').getBoundingClientRect();return {bodyBottom:body.bottom,footerTop:footer.top,runWidth:run.width,replyWidth:reply.getBoundingClientRect().width}})()`)
        assert.ok(replyLayout.footerTop>=replyLayout.bodyBottom,'Sources, copy and elapsed follow the answer')
        assert.ok(replyLayout.runWidth<replyLayout.replyWidth*.7,'Completed tool disclosure is compact')
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.run-card-head').getAttribute('aria-expanded')`),'false')
        await capture('navora-conversation.png')
        await win.webContents.executeJavaScript(`document.querySelector('.run-card-head').click()`)
        await wait(40)
        assert.equal(await win.webContents.executeJavaScript(`document.getAnimations().some(a=>a.effect?.target?.classList?.contains('run-card-body'))`),!reducedMotion,'Tool disclosure has independent motion and respects reduced motion')
        await wait(240)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.run-card.open')`),true,'Tool details remain accessible')
        await win.webContents.executeJavaScript(`(async()=>{const b=document.querySelector('.run-card-head');for(let i=0;i<5;i++){b.click();await new Promise(r=>setTimeout(r,25))}})()`)
        await wait(250)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.run-card-body')`),false,'Interrupted disclosures release their body')
        assert.equal(await win.webContents.executeJavaScript(`document.getAnimations().some(a=>a.effect?.target?.classList?.contains('run-card-body'))`),false,'Interrupted disclosure leaves no animation')
        await click('.reply-footer .read-pages-bar')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.read-pages-dialog')`),true,'Footer source button opens its details')
        await click('.read-pages-dialog-close')
        await win.webContents.executeJavaScript(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedReply=text}}})`)
        await click('.reply-copy-btn')
        assert.equal(await win.webContents.executeJavaScript(`window.__copiedReply.includes('天气排版测试')`),true,'Copy uses the actual answer')
        const beforeCreate = await win.webContents.executeJavaScript(`(async()=>(await window.navora.chats.list()).length)()`)
        await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('.rail-new-chat');for(let i=0;i<5;i++)b.click()})()`)
        await wait(300)
        assert.equal(await win.webContents.executeJavaScript(`(async()=>(await window.navora.chats.list()).length)()`),beforeCreate+1,'Concurrent clicks from a populated chat create only one new conversation')
        await win.webContents.executeJavaScript(`[...document.querySelectorAll('.chat-item-title-text')].find(el=>el.textContent.trim()==='检索回归').closest('.chat-item-main').click()`)
        await wait(250)
        await assertIconContrast()
        await click('.model-panel-trigger')
        await win.webContents.executeJavaScript(`[...document.querySelectorAll('.model-panel-reasoning button')].find(el=>el.textContent.trim()==='深入').click()`)
        await wait(220)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.model-trigger-tier').textContent.trim()`),'深入')
        assert.equal(await win.webContents.executeJavaScript(`(async()=>{const chats=await window.navora.chats.list();return chats.find(c=>c.title==='检索回归').reasoningLevel})()`),'high')
        await click('[aria-label="关闭模型面板"]')
        await click('.rail-panel-button[aria-pressed=true]')
        assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`),52,'All-hidden mode leaves a rail, not an empty sidebar')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.rail-search') && !!document.querySelector('.rail-new-chat')`),true,'Search and new chat stay available in rail mode')
        assert.equal(await win.webContents.executeJavaScript(`(()=>{const rail=document.querySelector('.activity-rail'),side=document.querySelector('aside.sidebar'),r=rail.getBoundingClientRect(),s=side.getBoundingClientRect();return getComputedStyle(rail).borderRightWidth==='0px'&&Math.abs((r.left+r.width/2)-(s.left+s.width/2))<1})()`),true,'Collapsed rail has one edge and centered controls, without an inner strip')
        await capture('navora-rail-only.png')
        await click('.rail-search')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.chat-search-input')`),true)
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await wait(250)
        await click('.sidebar-settings-btn')
        assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)>52`),true,'Settings opens from rail-only mode')
        await click('.settings-close')
        assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`),52,'Closing settings restores rail mode')
        await click('.sidebar-settings-btn')
        await click('[data-panel="workspace"]')
        assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('.settings-workspace') && document.querySelector('[data-panel="workspace"]').getAttribute('aria-pressed')==='true' && document.querySelector('[data-resource-kind=files]').checkVisibility()`),true,'Selecting a hidden panel from settings opens that panel on the first click')
        await click('[data-panel="workspace"]')
        await win.webContents.executeJavaScript(`(async()=>{const b=document.querySelector('[data-panel="workspace"]');for(let i=0;i<4;i++){b.click();await new Promise(r=>setTimeout(r,25))}})()`)
        let sidebarSettled = false
        for(let i=0;i<20;i++) {
          sidebarSettled = await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)===52 && !document.querySelector('#dock-pane-workspace').checkVisibility()`)
          if(sidebarSettled) break
          await wait(40)
        }
        const sidebarEnd = await win.webContents.executeJavaScript(`(()=>{const pane=document.querySelector('#dock-pane-workspace'),side=document.querySelector('aside.sidebar'),button=document.querySelector('[data-panel="workspace"]');return {width:side.getBoundingClientRect().width,pane:pane.getAttribute('style'),visible:pane.checkVisibility(),pressed:button.getAttribute('aria-pressed'),shell:side.parentElement.className,classes:pane.className,animations:document.getAnimations().map(a=>({target:a.effect?.target?.className,state:a.playState}))}})()`)
        assert.equal(sidebarSettled,true,'Interrupted sidebar toggles settle at the intended collapsed state: '+JSON.stringify(sidebarEnd))
        await click('[data-panel="chats"]')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.sidebar-settings-btn')`),true)
        await win.webContents.executeJavaScript(`document.querySelector('.sidebar-settings-btn').click()`)
        await wait(40)
        if(!reducedMotion) assert.ok(await win.webContents.executeJavaScript(`document.getAnimations().some(a=>a.effect?.target?.classList?.contains('sidebar-settings-face'))`),'Settings sidebar flips independently')
        await wait(700)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-workspace') && !document.querySelector('.settings-dialog-content')`),true)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('aside.sidebar .settings-navigation') && !document.querySelector('.settings-workspace .settings-navigation')`),true,'Settings categories replace sidebar content')
        const settingsHeader = await win.webContents.executeJavaScript(`(()=>{const top=document.querySelector('.settings-workspace>.top'),back=top.querySelector('.settings-close'),save=top.querySelector('.save-btn'),title=top.querySelector('h1');return {height:top.getBoundingClientRect().height,backWidth:back.getBoundingClientRect().width,backLeft:back.getBoundingClientRect().left,titleLeft:title.getBoundingClientRect().left,backIcon:back.querySelector('svg').getAttribute('data-icon'),saveHeight:save.getBoundingClientRect().height,saveRight:save.getBoundingClientRect().right,viewport:innerWidth,hasCloseInActions:!!top.querySelector('.top-actions .settings-close')}})()`)
        assert.equal(settingsHeader.height,44,'Settings and chat share the compact native caption row')
        assert.equal(settingsHeader.backIcon,'arrow-left','Settings uses a back action, distinct from native window close')
        assert.ok(settingsHeader.backWidth<=32 && settingsHeader.backLeft<settingsHeader.titleLeft && !settingsHeader.hasCloseInActions,'Back is compact and sits beside the title')
        assert.equal(settingsHeader.saveHeight,28,'Apply has a compact fixed height')
        assert.ok(settingsHeader.saveRight<=settingsHeader.viewport-145,'Apply leaves a gap before native window controls')
        const settingsBody = await win.webContents.executeJavaScript(`(()=>{const page=document.querySelector('.settings-workspace'),shell=page.querySelector(':scope>.shell'),panel=page.querySelector('.panel'),section=page.querySelector('.section');return {viewportHeight:innerHeight,page:page.getBoundingClientRect().toJSON(),shell:shell.getBoundingClientRect().toJSON(),panel:panel.getBoundingClientRect().toJSON(),section:section.getBoundingClientRect().toJSON(),rows:getComputedStyle(shell).gridTemplateRows}})()`)
        assert.ok(Math.abs(settingsBody.panel.bottom-settingsBody.page.bottom)<2,'Settings content fills the workspace: '+JSON.stringify(settingsBody))
        assert.ok(Math.abs(settingsBody.page.bottom-settingsBody.viewportHeight)<2,'Settings replaces the full chat grid rather than its first auto row: '+JSON.stringify(settingsBody))
        assert.ok(settingsBody.section.width<=760,'Basic preferences use a readable column')
        await capture('navora-settings.png')
        const switchSelector='.message-display-card .v-switch input'
        const checkedBefore=await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(switchSelector)}).checked`)
        const switchBounds=await win.webContents.executeJavaScript(`(()=>{const s=document.querySelector(${JSON.stringify(switchSelector)}).closest('.v-switch'),track=s.querySelector('.v-switch__track').getBoundingClientRect(),thumb=s.querySelector('.v-switch__thumb').getBoundingClientRect();return {inside:thumb.left>=track.left&&thumb.right<=track.right&&thumb.top>=track.top&&thumb.bottom<=track.bottom,label:s.querySelector('input').getAttribute('aria-label'),background:getComputedStyle(s.querySelector('.v-switch__track')).backgroundColor}})()`)
        assert.equal(switchBounds.inside,true,'Switch thumb stays inside its track')
        assert.ok(switchBounds.label,'Switch input has its visible setting label')
        await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(switchSelector)}).focus()`)
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(220)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(switchSelector)}).checked`),!checkedBefore,'Space toggles the native switch without changing focus')
        const offBounds=await win.webContents.executeJavaScript(`(()=>{const s=document.querySelector(${JSON.stringify(switchSelector)}).closest('.v-switch'),t=s.querySelector('.v-switch__track').getBoundingClientRect(),k=s.querySelector('.v-switch__thumb').getBoundingClientRect();return {inside:k.left>=t.left&&k.right<=t.right&&k.top>=t.top&&k.bottom<=t.bottom,background:getComputedStyle(s.querySelector('.v-switch__track')).backgroundColor}})()`)
        assert.equal(offBounds.inside,true,'Both switch states use the same contained geometry')
        assert.notEqual(offBounds.background,switchBounds.background,'On and off remain visually distinct')
        await capture('navora-switch-keyboard.png')
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(220)
        for(const label of ['模型','浏览器','工作区','技能','插件','远程访问','权限','询问/决策','子对话','关于','基本']) {
          await win.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation .nav-label')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).closest('button').click()`)
          await wait(140)
          const layout = await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.settings-page .panel'),r=p.getBoundingClientRect();return {sections:document.querySelectorAll('.settings-page .section').length,scroll:p.scrollWidth,width:p.clientWidth,right:r.right,viewport:innerWidth}})()`)
          assert.equal(layout.sections,1,'Only the active settings page is mounted: '+label)
          assert.ok(layout.scroll <= layout.width + 2,'Settings panel does not overflow: '+label)
          assert.ok(layout.right <= layout.viewport,'Settings panel stays in viewport: '+label)
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.settings-workspace .top h1').textContent.trim()`),label,'Caption reflects the selected settings category')
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.settings-navigation [aria-current="page"] .nav-label').textContent.trim()`),label,'Settings navigation exposes the current category')
          await assertIconContrast()
          if(label==='模型') {
            await click('.tier-mapping-toggle')
            assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.reasoning-row').length`),5)
            await capture('navora-model-settings.png')
          }
        }
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.log-fold-setting .setting-status')?.textContent`),'已并入工具摘要','Grouped tools show log policy instead of a disabled switch')
        await click('input[aria-label="折叠工具调用"]')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.log-fold-setting input[aria-label="日志折叠"]:not(:disabled)')`),true,'Separate logs have an editable folding switch')
        await click('input[aria-label="日志折叠"]')
        const foldPreference = await win.webContents.executeJavaScript(`document.querySelector('input[aria-label="日志折叠"]').checked`)
        await click('input[aria-label="显示运行日志"]')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.log-fold-setting')`),false,'Hidden logs do not leave an unrelated child option')
        await click('input[aria-label="显示运行日志"]')
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('input[aria-label="日志折叠"]').checked`),foldPreference,'Folding preference survives hiding and showing logs')
        await capture('navora-log-settings.png')
        await click('input[aria-label="折叠工具调用"]')
        console.log('[ui] settings tabs checked; saving')
        await win.webContents.executeJavaScript(`document.querySelector('.settings-page .save-btn').click()`)
        await wait(350)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.v-snackbar__content')?.textContent.includes('已应用') || document.querySelector('.v-snackbar__content')?.textContent.includes('已保存')`),true,'Unrelated settings save succeeds with legacy remote configuration')
        console.log('[ui] reopening onboarding')
        await win.webContents.executeJavaScript(`document.querySelector('.nav-guide').click()`)
        await wait(350)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.ob-skip')`),true)
        await capture('navora-onboarding.png')
        await click('.ob-skip')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.ob-skip')`),false,'Skipping onboarding closes without error')
        assert.equal(await win.webContents.executeJavaScript(`(async()=>{const cfg=await window.navora.config.get();return cfg.app.onboarding_completed})()`),true)
        await win.webContents.executeJavaScript(`document.querySelector('.sidebar-settings-btn').click()`)
        await wait(300)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-close')`),true)
        await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`)
        await wait(500)
        const browserFixture = await win.webContents.executeJavaScript(`(async()=>{const c=(await window.navora.chats.list()).find(c=>c.title==='检索回归');const s=await window.navora.browser.createSession(c.id,{persist:false});await window.navora.browser.createWindow(s.sessionId,{url:'about:blank',show:false});return {chatId:c.id,sessionId:s.sessionId}})()`)
        await wait(200)
        await click('[data-panel="browser"]')
        await click('.quick-browser-btn')
        await click('.quick-browser-btn')
        assert.equal(await win.webContents.executeJavaScript(`(async()=>{const tree=await window.navora.browser.tree(${JSON.stringify(browserFixture.chatId)});return tree.flatMap(s=>s.windows).length})()`),1,'Quick browser open reuses the existing window')
        await click('.tree-row.win .icon-btn.danger')
        assert.equal(await win.webContents.executeJavaScript(`(async()=>{const tree=await window.navora.browser.tree(${JSON.stringify(browserFixture.chatId)});return tree.flatMap(s=>s.windows).length})()`),0,'Window close is directly available')
        await win.webContents.executeJavaScript(`window.navora.browser.closeSession(${JSON.stringify(browserFixture.sessionId)})`)
        await click('[data-panel="chats"]')
        const runComposer = async (chatId: string, title: string, question: string) => {
          await win.webContents.executeJavaScript(`[...document.querySelectorAll('.chat-item-title-text')].find(el=>el.textContent.trim()===${JSON.stringify(title)}).closest('.chat-item-main').click()`)
          await wait(150)
          await click('.composer-input textarea')
          await win.webContents.insertText(question)
          const start = Date.now()
          await click('.composer-send')
          return start
        }
        // Withhold completion until the actual renderer displays both stream fields.
        let finishStream: (() => void) | undefined
        const streaming = createServer(async (req,res) => {
          const chunks: Buffer[] = []
          for await(const part of req) chunks.push(Buffer.from(part))
          const body = JSON.parse(Buffer.concat(chunks).toString())
          assert.equal(body.stream,true)
          res.setHeader('Content-Type','text/event-stream')
          const event = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`
          res.write(event({reasoning_content:'这是实时思考内容。'}))
          // Separate writes exercise throttled updates as well as the final flush.
          const timer = setTimeout(()=>res.write(event({content:'这是逐步显示的正文。'})),10)
          res.on('close',()=>clearTimeout(timer))
          finishStream = ()=>res.end(event({content:'回答已完成。'},'stop')+'data: [DONE]\n\n')
        })
        await new Promise<void>(resolve=>streaming.listen(0,'127.0.0.1',resolve))
        const streamPort = (streaming.address() as {port:number}).port
        try {
          await win.webContents.executeJavaScript(`(async()=>{const cfg=await window.navora.config.get();cfg.ai.providers.push({id:'stream_fixture',label:'Stream fixture',type:'openai_compatible',base_url:'http://127.0.0.1:${streamPort}/v1',api_key_ref:'secrets/stream-fixture',model:'fixture',models:['fixture']});await window.navora.config.save({ai:cfg.ai,app:{...cfg.app,ai_generate_chat_title:false}})})()`)
          const id = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create('流式回归');await window.navora.chats.setProvider(c.id,'stream_fixture','fixture');await window.navora.chats.setExecutionMode(c.id,'chat');return c.id})()`)
          await wait(150)
          await runComposer(id,'流式回归','你好')
          for(let i=0;i<30;i++) {
            if(await win.webContents.executeJavaScript(`document.querySelector('.thinking-bubble')?.textContent.includes('这是逐步显示的正文。')`)) break
            await wait(50)
          }
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.thinking-reason-body')?.textContent.trim()`),'这是实时思考内容。')
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.thinking-bubble')?.textContent.includes('这是逐步显示的正文。')`),true,'Answer appears before completion')
          assert.equal(await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(id)})`),true)
          await capture('navora-streaming.png')
          finishStream!()
          for(let i=0;i<30;i++) {
            if(!await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(id)})`)) break
            await wait(50)
          }
          const saved = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.get(${JSON.stringify(id)});return c.messages.filter(m=>m.role==='assistant')})()`)
          assert.equal(saved.length,1,'Streaming previews do not create duplicate persisted replies')
          assert.equal(saved[0].content,'这是逐步显示的正文。回答已完成。')
          assert.equal(saved[0].meta.reasoning,'这是实时思考内容。')
          await wait(100)
          assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.thinking-bubble')`),false)
          assert.equal(saved[0].meta.phase,'final','Streaming completion retains its final phase')
          assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.msg.assistant .msg-reasoning')`),false,'Reasoning stays outside the final answer body')
          await click('.run-card-head')
          await click('.msg-reasoning-toggle')
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.msg-reasoning-body')?.textContent.trim()`),'这是实时思考内容。')
          await capture('navora-streaming-complete.png')
        } finally { streaming.closeAllConnections(); await new Promise<void>(resolve=>streaming.close(()=>resolve())) }

        if(process.env.NAVORA_UI_STREAM_ONLY === '1') {
          fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reducedMotion,checks:['stream-before-completion','stream-single-final-message','stream-persisted-reasoning','stream-preview-cleanup']}))
          app.exit(0)
          return
        }

        // Cancellation is deterministic against a delayed local fixture, with the
        // real UI, preload, Agent and fetch. No slow billable request is needed.
        const delayed = createServer(async (req,res) => { for await(const _chunk of req) { /* drain */ } res.on('close',()=>{}) })
        await new Promise<void>(resolve=>delayed.listen(0,'127.0.0.1',resolve))
        const delayedPort = (delayed.address() as {port:number}).port
        try {
          await win.webContents.executeJavaScript(`(async()=>{const cfg=await window.navora.config.get();cfg.ai.providers.push({id:'stop_fixture',label:'Stop fixture',type:'openai_compatible',base_url:'http://127.0.0.1:${delayedPort}/v1',api_key_ref:'secrets/stop-fixture',model:'fixture',models:['fixture'],timeout_ms:10000});await window.navora.config.save({ai:cfg.ai});})()`)
          const stoppedId = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create('停止回归');await window.navora.chats.setProvider(c.id,'stop_fixture','fixture');await window.navora.chats.setExecutionMode(c.id,'chat');return c.id})()`)
          await wait(150)
          await runComposer(stoppedId,'停止回归','你好')
          assert.equal(await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(stoppedId)})`),true)
          await capture('navora-running.png')
          assert.equal(await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('.quick-stop-btn'),r=b.getBoundingClientRect();return getComputedStyle(b).whiteSpace==='nowrap'&&r.height<=30&&r.width>=55})()`),true,'Stop stays on one line')
          assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.thinking-avatar')`),false,'Activity uses the unified SVG')
          const stoppedAt = Date.now()
          await click('.quick-stop-btn')
          for(let i=0;i<15;i++) { if(!await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(stoppedId)})`)) break; await wait(100) }
          assert.equal(await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(stoppedId)})`),false)
          assert.ok(Date.now()-stoppedAt < 1500,'Stop releases the run promptly')
          await capture('navora-stopped.png')
        } finally { delayed.closeAllConnections(); await new Promise<void>(resolve=>delayed.close(()=>resolve())) }

        // Background title work must yield to the next user request and must
        // never keep the real composer locked after an answer is visible.
        let titleStarted = false
        let titleCancelled = false
        const titles = createServer(async (req,res) => {
          const chunks: Buffer[] = []
          for await(const chunk of req) chunks.push(Buffer.from(chunk))
          const body = JSON.parse(Buffer.concat(chunks).toString())
          if(String(body.messages?.[0]?.content).includes('会话侧栏标题生成器')) {
            titleStarted = true
            res.on('close',()=> { titleCancelled = true })
            return
          }
          res.setHeader('Content-Type','application/json')
          res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'这是一条正常的测试回答。'},finish_reason:'stop'}]}))
        })
        await new Promise<void>(resolve=>titles.listen(0,'127.0.0.1',resolve))
        const titlePort = (titles.address() as {port:number}).port
        try {
          await win.webContents.executeJavaScript(`(async()=>{const cfg=await window.navora.config.get();cfg.ai.providers.push({id:'title_fixture',label:'Title fixture',type:'openai_compatible',base_url:'http://127.0.0.1:${titlePort}/v1',api_key_ref:'secrets/title-fixture',model:'fixture',models:['fixture']});await window.navora.config.save({ai:cfg.ai,app:{...cfg.app,ai_generate_chat_title:true}})})()`)
          const first = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create('后台标题回归');await window.navora.chats.setProvider(c.id,'title_fixture','fixture');await window.navora.chats.setExecutionMode(c.id,'agent');return c.id})()`)
          await wait(160)
          await runComposer(first,'后台标题回归','你好')
          for(let i=0;i<30&&!titleStarted;i++) await wait(100)
          assert.ok(titleStarted,'Idle title generation starts')
          await click('.composer-input textarea')
          await win.webContents.insertText('未发送的草稿')
          await wait(80)
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.composer-send').disabled`),false,'An unfinished title does not lock the composer')
          const second = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create('下一条问答');await window.navora.chats.setProvider(c.id,'title_fixture','fixture');await window.navora.chats.setExecutionMode(c.id,'chat');return c.id})()`)
          await wait(160)
          await runComposer(second,'下一条问答','你好')
          for(let i=0;i<20&&!titleCancelled;i++) await wait(50)
          assert.ok(titleCancelled,'The next user run cancels background title work')
          assert.equal(await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.get(${JSON.stringify(second)});return c.messages.some(m=>m.role==='assistant')})()`),true,'The next answer is not queued behind the title')
        } finally { titles.closeAllConnections(); await new Promise<void>(resolve=>titles.close(()=>resolve())) }

        if(process.env.NAVORA_LIVE_WEATHER === '1') {
          assert.equal(await win.webContents.executeJavaScript(`(async()=>{const list=await window.navora.plugins.list();return list.some(p=>p.id==='fixture-status')})()`),true,'Unrelated plugin is loaded during weather regression')
          const results: unknown[] = []
          for(const [index,question] of ['看看今天的天气','查一下北京今天的天气'].entries()) {
            const title = `天气实测 ${index+1}`
            const id = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create(${JSON.stringify(title)});const cfg=await window.navora.config.get();await window.navora.chats.setProvider(c.id,${JSON.stringify(cloud.id)},'qwen38-turbo-q6','low');await window.navora.chats.setExecutionMode(c.id,'auto');await window.navora.chats.setPermissions(c.id,{preset:'open',modes:cfg.permissions.modes});return c.id})()`)
            await wait(180)
            const started = await runComposer(id,title,question)
            let chat: any
            for(let i=0;i<450;i++) {
              chat = await win.webContents.executeJavaScript(`window.navora.chats.get(${JSON.stringify(id)})`)
              if(!await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(id)})`)) break
              await wait(100)
            }
            const tools = chat.messages.filter((m:any)=>m.role==='tool')
            const weather = tools.find((m:any)=>m.meta?.toolName==='weather_get')
            assert.ok(weather,'The real Agent must use the structured weather tool')
            assert.equal(weather.meta?.result?.ok,true,'Weather query returns data: '+JSON.stringify(weather.meta?.result))
            assert.deepEqual(tools.map((m:any)=>m.meta.toolName),['weather_get'],'One tool, no browser/date round trips')
            const answer = chat.messages.findLast((m:any)=>m.role==='assistant')
            assert.ok(answer?.content?.length > 15,'Weather answer is present')
            assert.ok(answer?.meta?.sources?.length,'Weather source is retained by host')
            assert.ok(Date.now()-started<30000,'Simple weather query finishes within 30s in this live run')
            results.push({question,ms:Date.now()-started,toolMs:weather.meta.durationMs,toolNames:tools.map((m:any)=>m.meta.toolName),answer:answer.content})
            fs.writeFileSync(path.join(output,'live-weather-results.json'),JSON.stringify(results,null,2))
            console.log(JSON.stringify({liveWeatherCase:index+1,ms:Date.now()-started,toolMs:weather.meta.durationMs}))
          }
          fs.writeFileSync(path.join(output,'live-weather-results.json'),JSON.stringify(results,null,2))
          console.log(JSON.stringify({liveWeather:true,results:results.map((r:any)=>({ms:r.ms,toolMs:r.toolMs,tools:r.toolNames}))}))
          await capture('navora-weather.png')
        }

        if(process.env.NAVORA_LIVE_MODEL === '1') {
          const cases = [
            { tier:'off', question:'1+1等于几？只输出数字。', expected:/2/ },
            { tier:'low', question:'请把 hello 翻译成中文，只输出译文。', expected:/你好|您好/ },
            { tier:'medium', question:'计算 7 乘以 8，只输出数字。', expected:/56/ },
            { tier:'high', question:'请解释什么是哈希表，用一句话回答。', expected:/哈希|散列|键|映射/ },
            { tier:'xhigh', question:'2+3等于几？只输出数字。', expected:/5/ },
          ]
          const results: {tier:string;ms:number;answer:string}[] = []
          for(const [index,item] of cases.entries()) {
            const title = `模型实测 ${index+1}`
            const chatId = await win.webContents.executeJavaScript(`(async()=>{const c=await window.navora.chats.create(${JSON.stringify(title)});await window.navora.chats.setProvider(c.id,${JSON.stringify(cloud.id)},'qwen38-turbo-q6',${JSON.stringify(item.tier)});await window.navora.chats.setExecutionMode(c.id,'chat');return c.id})()`)
            await wait(180)
            const start = await runComposer(chatId,title,item.question)
            let chat: any
            for(let i=0;i<450;i++) {
              chat = await win.webContents.executeJavaScript(`window.navora.chats.get(${JSON.stringify(chatId)})`)
              if(chat.messages.some((m:any)=>m.role==='assistant') && !await win.webContents.executeJavaScript(`window.navora.agent.isRunning(${JSON.stringify(chatId)})`)) break
              if(chat.messages.some((m:any)=>m.meta?.kind==='agent_error')) throw new Error('Live Agent failed: '+chat.messages.at(-1).content)
              await wait(100)
            }
            const answer = chat.messages.filter((m:any)=>m.role==='assistant').at(-1)?.content || ''
            assert.match(answer,item.expected,`Live ${item.tier} answer`)
            assert.equal(chat.messages.filter((m:any)=>m.role==='tool').length,0,'Simple questions need no tools')
            results.push({tier:item.tier,ms:Date.now()-start,answer})
          }
          const bitmap = Buffer.alloc(64*64*4)
          for(let i=0;i<bitmap.length;i+=4) {bitmap[i+2]=255;bitmap[i+3]=255}
          const red = nativeImage.createFromBitmap(bitmap,{width:64,height:64}).toDataURL()
          const client = new OpenAICompatibleClient({baseUrl:cloud.base_url,apiKey:fs.readFileSync(path.join(root,'secrets','secrets','cloudbypass.key'),'utf8').trim(),model:cloud.model,timeoutMs:45000,maxOutputTokens:2048,reasoningEffort:'low',supportsImages:true})
          const vision = await client.chat([{role:'user',content:[{type:'text',text:'这张图片主要是什么颜色？只用一个中文词回答。'},{type:'image_url',image_url:{url:red}}]}],[])
          assert.match(vision.content || '',/红/,'Configured vision model reads a generated red image')
          fs.writeFileSync(path.join(output,'live-model-results.json'),JSON.stringify({results,vision:vision.content},null,2))
          console.log(JSON.stringify({liveModel:true,model:cloud.model,results,vision:vision.content}))
          await capture('navora-live-model.png')
        }
        if(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-workspace')`)) await click('.settings-close')
        for(const width of [960,720]) {
          win.setContentSize(width,900)
          await wait(220)
          await assertViewport()
          assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('main.main').getBoundingClientRect().width)`),await win.webContents.executeJavaScript(`innerWidth`),'Tablet main uses the full viewport')
          await click('.mobile-topbar-btn[aria-label="设置"]')
          await win.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation .nav-label')].find(el=>el.textContent.trim()==='模型').closest('button').click()`)
          await wait(180)
          const tablet = await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.settings-page .content');return {scroll:p.scrollWidth,width:p.clientWidth}})()`)
          assert.ok(tablet.scroll<=tablet.width+2,'Tablet model settings do not overflow: '+width)
          if(width===960) await capture('navora-tablet-model-settings.png')
          await click('.settings-close')
        }
        win.setContentSize(390,844)
        await wait(300)
        await capture('navora-mobile.png')
        const layout = await win.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth,mobile:!!document.querySelector('.mobile-layout'),sidebarTransform:getComputedStyle(document.querySelector('.sidebar')).transform,sidebarOpen:document.querySelector('.shell').classList.contains('sidebar-open')})`)
        assert.equal(layout.mobile,true)
        assert.equal(layout.sidebarOpen,false)
        assert.notEqual(layout.sidebarTransform,'none')
        assert.ok(layout.scroll <= layout.width + 1,'No horizontal page overflow')
        await assertViewport()
        await click('.mobile-topbar-btn[aria-label="设置"]')
        for(let i=0;i<20;i++) { if(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-page')`)) break; await wait(100) }
        assert.ok(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-page') && document.querySelector('.settings-page').getBoundingClientRect().width <= innerWidth`),'Mobile settings opens from real pointer input')
        await capture('navora-mobile-settings.png')
        for(const label of ['模型','浏览器','工作区','技能','插件','远程访问','权限','询问/决策','子对话','关于']) {
          await win.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation .nav-label')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).closest('button').click()`)
          await wait(120)
          const size = await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.settings-page .content');return {scroll:p.scrollWidth,width:p.clientWidth}})()`)
          assert.ok(size.scroll<=size.width+2,'Mobile settings do not overflow: '+label+' '+JSON.stringify(size))
          await assertIconContrast()
          if(label==='模型') {
            await win.webContents.executeJavaScript(`document.querySelector('.model-entry').scrollIntoView({block:'start'})`)
            await capture('navora-mobile-model-settings.png')
          }
        }
        await click('.settings-close')
        await click('.mobile-topbar-btn[aria-label="打开菜单"]')
        const mobileRail = await win.webContents.executeJavaScript(`(()=>{const rail=document.querySelector('.activity-rail').getBoundingClientRect(),toolbar=document.querySelector('[data-group="group-chats"] .dock-header').getBoundingClientRect();return {right:rail.right,left:toolbar.left}})()`)
        assert.ok(mobileRail.left>=mobileRail.right,'Mobile actions do not overlap the icon rail')
        await capture('navora-mobile-sidebar.png')
        await click('[data-panel="chats"]')
        assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`),52,'Mobile all-hidden mode also avoids an empty drawer')
        await capture('navora-mobile-rail-only.png')
        await click('[data-panel="chats"]')
        assert.equal(await win.webContents.executeJavaScript(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`),288,'Mobile panel navigation restores its drawer width')
        await win.webContents.executeJavaScript(`[...document.querySelectorAll('.chat-item-title-text')].find(el=>el.textContent.trim()==='检索回归').closest('.chat-item-main').click()`)
        await wait(300)
        const tableBounds = await win.webContents.executeJavaScript(`(()=>{const table=document.querySelector('.md-table-scroll'),r=table.getBoundingClientRect();return {right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()`)
        assert.ok(tableBounds.right<=tableBounds.width && tableBounds.scroll<=tableBounds.width,'A wide Markdown table stays inside the mobile answer')
        await capture('navora-mobile-conversation.png')
        assert.deepEqual(errors,[])
        console.log(JSON.stringify({ok:true,reducedMotion,checks:['empty-chat-reuse','draft-preservation','rail-single-selection','rail-action-placement','rail-single-edge','disclosure-motion-cancellation','log-setting-dependencies','sidebar-pointer-resize','pane-toggle-persistence','rail-icon-consistency','rail-only-recovery','conversation-outline','answer-footer','markdown-table','settings-sidebar-flip','real-app-preload','desktop-shell','right-edge','menu-open-close','menu-interruption-cleanup','search-native-click','search-message-match','search-shortcut','reasoning-tier-persistence','all-settings-tabs','settings-save-legacy-remote','onboarding-skip-legacy-remote','close-button','stop-from-real-ui','mobile-layout','mobile-settings'],output}))
        fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reducedMotion}))
        app.exit(0)
      } catch(error) {
        console.error(error)
        fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
        if(errors.length) console.error(JSON.stringify({rendererErrors:errors}))
        app.exit(1)
      }
    })()
  })
})

void import('../electron/main')
