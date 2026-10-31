import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../shared/config'
import { addProviderFromPresetId } from '../shared/model-providers'
import { SecretsStore } from '../electron/modules/secrets'
import { createServer } from 'node:http'

const root = process.env.NAVORA_DATA_ROOT!, output = process.env.NAVORA_UI_OUTPUT!
const reduced = process.env.NAVORA_UI_REDUCED_MOTION === '1'
if (reduced) app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
const config = createDefaultConfig()
config.app.onboarding_completed = true
config.app.ai_generate_chat_title = false
config.remote.enabled = false
const cloud = addProviderFromPresetId('cloudbypass', config.ai.providers)!
config.ai.providers.push(cloud)
config.ai.default_provider = cloud.id
fs.writeFileSync(path.join(root,'config.yml'), JSON.stringify(config))
fs.mkdirSync(path.join(root,'chats'),{recursive:true})
const workspaceFixture = path.join(root, 'workspace', 'chat_renovation119', 'folder')
fs.mkdirSync(workspaceFixture, {recursive:true})
fs.writeFileSync(path.join(workspaceFixture, 'note.txt'), 'Keyboard navigation fixture')
const otherWorkspace=path.join(root,'workspace','chat_renovation118')
fs.mkdirSync(otherWorkspace,{recursive:true});fs.writeFileSync(path.join(otherWorkspace,'other-only.txt'),'From another conversation')
fs.writeFileSync(path.join(path.dirname(workspaceFixture), 'preview.md'), '# 文件预览\n\n**Markdown** 内容\n\n<script>window.__previewExecuted=true</script>')
fs.writeFileSync(path.join(path.dirname(workspaceFixture), 'binary.bin'), Buffer.from([1,0,2]))
fs.writeFileSync(path.join(path.dirname(workspaceFixture), 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64'))
for(let i=0;i<120;i++) {
  const messages = i === 119 ? Array.from({length:100},(_,n) => [
    {id:'u'+n,role:'user',content:'长对话滚动与目录测试 '+n,createdAt:n*3},
    {id:'t'+n,role:'tool',content:'{"ok":true}',createdAt:n*3+1,meta:{toolName:n%2?'file_list':'fixture_plugin',status:'done'}},
    {id:'a'+n,role:'assistant',content:'这是一条用于检查排版、滚动和侧栏响应的本地测试回复。',createdAt:n*3+2},
  ]).flat() : []
  if(i===119)messages.push(...([
    {id:'ui-style-user-error',role:'user',content:'工具失败样式（本地测试夹具）',createdAt:400},
    {id:'ui-style-tool-error',role:'tool',content:'{"ok":false,"error":"load_failed"}',createdAt:401,meta:{toolName:'browser_open',status:'error'}},
    {id:'ui-style-answer-error',role:'assistant',content:'这里仅检查失败工具的折叠样式。',createdAt:402},
    {id:'ui-style-user-plugin',role:'user',content:'插件样式（本地测试夹具）',createdAt:403},
    {id:'ui-style-plugin',role:'tool',content:'{"ok":true}',createdAt:404,meta:{toolName:'fixture_plugin',status:'done',fromPlugin:true,pluginId:'fixture'}},
    {id:'ui-style-answer-plugin',role:'assistant',content:'插件摘要。',createdAt:405},
    {id:'ui-style-user-log',role:'user',content:'日志样式（本地测试夹具）',createdAt:406},
    {id:'ui-style-log',role:'log',content:'本地日志样式记录',createdAt:407,meta:{kind:'agent_status'}},
    {id:'ui-style-answer-log',role:'assistant',content:'日志摘要。',createdAt:408},
  ]) as typeof messages)
  const chat={id:'chat_renovation'+i,title:'本地回归对话 '+i,createdAt:i+1,updatedAt:i+1,messages}
  fs.writeFileSync(path.join(root,'chats',chat.id+'.json'),JSON.stringify(chat))
}
app.setPath('userData',root)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const openedPaths:string[]=[]
shell.openPath=async target=>{openedPaths.push(target);return ''}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
let started = false
app.on('browser-window-created', (_,win) => {
  if (started) return
  started = true
  win.webContents.setBackgroundThrottling(false)
  if (win.webContents.isOffscreen()) { win.webContents.setFrameRate(60); win.webContents.on('paint',() => {}) }
  const errors: string[] = []
  win.webContents.on('console-message',event => { if (event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load', () => void (async () => {
    const js = async (code: string) => { try { return await win.webContents.executeJavaScript(code) } catch(error) { throw new Error('Renderer operation failed: '+code.slice(0,220)+' / '+String(error)) } }
    const click = async (selector: string) => {
      const point = await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      win.webContents.sendInputEvent({type:'mouseMove',...point})
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
      await wait(260)
    }
    const tab = async (label: string) => { await js(`[...document.querySelectorAll('.settings-navigation .nav-label')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).closest('button').click()`); await wait(100) }
    const input = async (selector: string, value: string, event = 'input') => { await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`); await wait(40) }
    const capture = async (name: string) => { await wait(100); fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG()) }
    const viewport = async () => assert.equal(await js('document.documentElement.scrollWidth <= innerWidth+1'),true,'Viewport has no horizontal overflow')
    const selectCloud = () => click('.provider-list-item:last-child')
    const secrets = new SecretsStore(root)
    let modelRequests = 0
    const queuePrompts:string[]=[]
    let releaseQueueFirst:(()=>void)|undefined
    const server = createServer(async (req,res) => {
      res.setHeader('Content-Type','application/json')
      if (req.url === '/v1/models') { res.end(JSON.stringify({data:[{id:'qwen38-turbo-q6'}]})); return }
      let body = ''; for await (const part of req) body += part
      const request = JSON.parse(body)
      const lastUser=request.messages?.filter((message:{role:string})=>message.role==='user').at(-1)?.content
      if(typeof lastUser==='string' && lastUser.startsWith('UI_QUEUE_')){
        queuePrompts.push(lastUser)
        if(lastUser==='UI_QUEUE_FIRST')await new Promise<void>(resolve=>{releaseQueueFirst=resolve})
        res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'完成：'+lastUser,reasoning_content:'这是隔离测试中的思考内容。'},finish_reason:'stop'}]}));return
      }
      modelRequests++
      assert.equal(request.model,'qwen38-turbo-q6')
      assert.equal(request.reasoning_effort,'low')
      assert.equal(request.tools,undefined)
      res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'2'},finish_reason:'stop'}]}))
    })
    try {
      for(let n=0;n<60;n++) { if(await js('!!document.querySelector(".composer")')) break; await wait(100) }
      win.setMinimumSize(0,0); win.setContentSize(1440,900); await wait(150)
      await click('.sidebar-settings-btn'); await tab('模型')
      assert.equal(await js('document.querySelectorAll(".model-entry").length'),1,'Only the selected model is mounted')
      assert.equal(await js('document.querySelectorAll(".reasoning-row").length'),0,'Reasoning mappings start folded')
      assert.equal(await js(`(()=>{const key=document.querySelector('input[type="password"]'),p=document.querySelector('.settings-page .content');return key.getBoundingClientRect().bottom<p.getBoundingClientRect().bottom})()`),true,'Key is visible before capabilities')
      await input('input[type="password"]','fixture-cloud-key')
      await click('.provider-list-item:first-child')
      await input('input[type="password"]','fixture-openai-key')
      await selectCloud()
      assert.equal(await js('document.querySelector("input[type=password]").value'), 'fixture-cloud-key','Switching providers keeps separate drafts')
      await click('.settings-close'); await click('.sidebar-settings-btn'); await tab('模型')
      assert.equal(await js('document.querySelector("input[type=password]").value'),'fixture-cloud-key','Closing settings retains memory-only key drafts')
      await click('.provider-list-item:first-child')
      const oldDefault = await js('document.querySelector(".catalog-picker select").value')
      await input('.catalog-picker select','gpt-4.1-mini','change')
      assert.equal(await js('document.querySelector(".catalog-picker option:checked").textContent.includes("默认")'),false,'Editing a catalog entry does not switch defaults')
      await input('.catalog-picker select',oldDefault,'change')
      await selectCloud(); await click('.tier-mapping-toggle')
      await input('.reasoning-row:nth-child(3) input','quick','change')
      assert.equal(await js('document.querySelector(".default-tier select").value'),'quick','Renaming the default tier follows its new name')
      await click('.save-btn'); await wait(400)
      assert.equal(secrets.get(cloud.api_key_ref),'fixture-cloud-key')
      assert.equal(secrets.get(config.ai.providers[0]!.api_key_ref),'fixture-openai-key','Apply stores every provider draft in its own secret')
      const saved = await js('window.navora.config.get()')
      assert.equal(saved.ai.providers.find((p: {id:string})=>p.id===cloud.id).model_settings['qwen38-turbo-q6'].reasoning.default,'quick')
      assert.equal(JSON.stringify(saved).includes('fixture-cloud-key'),false,'Plaintext keys never enter config')
      // A slower response from a different provider must not replace the active preview.
      ipcMain.removeHandler('navora:secrets.getApiKey')
      ipcMain.handle('navora:secrets.getApiKey',async (_event,ref: string) => {
        await wait(ref === cloud.api_key_ref ? 10 : 220)
        return { configured:true, preview:ref === cloud.api_key_ref ? 'CLOUD-MASK' : 'OTHER-MASK' }
      })
      await click('.provider-list-item:first-child'); await selectCloud(); await wait(300)
      assert.equal(await js(`document.querySelector('input[type=password]').closest('.v-field').textContent.includes('CLOUD-MASK')`),true,'Late preview cannot cross provider boundaries')
      await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
      const address = server.address() as {port:number}
      await input('.connection-form .v-input:nth-child(2) input',`http://127.0.0.1:${address.port}/v1`)
      await click('.save-btn'); await wait(400)
      await click('.probe-actions button:first-child'); await wait(120)
      assert.equal(await js('document.querySelector(".probe-result").textContent.includes("连接成功")'),true,'Connection probe uses the saved endpoint')
      assert.equal(modelRequests,0,'Connection check does not make a chat request')
      await click('.probe-actions button:nth-child(2)'); await wait(180)
      assert.equal(await js('document.querySelector(".probe-result").textContent.trim().startsWith("2")'),true,'Question probe validates an actual model reply')
      assert.equal(modelRequests,1)
      await capture('model-compact')
      for (const zoom of [1.25,1.5,2]) { win.webContents.setZoomFactor(zoom); await wait(180); await viewport(); await capture('settings-zoom-'+zoom) }
      win.webContents.setZoomFactor(1); await wait(150)
      await tab('权限')
      await input('.permission-filters input[type=text]','读取文件')
      assert.equal(await js('document.querySelectorAll(".perm-row").length'),1,'Permission search uses readable names')
      for (const label of ['技能','插件']) {
        await tab(label)
        assert.equal(await js('document.querySelector(".settings-empty").checkVisibility()'),true,'Empty '+label+' has visible guidance')
      }
      await click('.settings-close')
      await wait(450)
      await click('[data-panel="workspace"]')
      await js("document.querySelector('.workspace-panel [role=treeitem]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))")
      await wait(150)
      assert.equal(await js("document.querySelector('.workspace-panel [role=treeitem]').getAttribute('aria-expanded')"),'true','Right arrow expands a real workspace folder')
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))")
      assert.equal(await js("document.activeElement.textContent.includes('note.txt')"),true,'Down arrow reaches the loaded file')
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))")
      assert.equal(await js("document.activeElement.dataset.depth"),'0','Left arrow returns to the containing folder')
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))")
      assert.equal(await js("document.activeElement.getAttribute('aria-expanded')"),'false','Left arrow collapses the folder')
      // Workspace selection opens the real bounded IPC preview without launching another window.
      await click('.tree-row[title="folder"] .ws-twist')
      await click('.tree-row[title="folder/note.txt"]')
      await wait(180)
      assert.equal(await js('document.querySelector(".preview-code")?.textContent'), 'Keyboard navigation fixture')
      await capture('file-preview-text')
      const oldWidth = await js('document.querySelector(".file-preview").getBoundingClientRect().width')
      await js("document.querySelector('.resource-card-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))")
      await wait(80)
      assert.equal(await js('document.querySelector(".file-preview").getBoundingClientRect().width'),oldWidth+20)
      await click('.tree-row[title="preview.md"]')
      assert.equal(await js('document.querySelector(".preview-markdown h1")?.textContent'),'文件预览')
      assert.equal(await js('window.__previewExecuted'),undefined,'Preview never executes file scripts')
      await capture('file-preview-markdown')
      await js("document.querySelector('.preview-tools button').click()")
      assert.equal(await js('document.querySelector(".preview-code")?.textContent.includes("<script>")'),true,'Source is escaped text')
      await click('.tree-row[title="image.png"]')
      assert.equal(await js('document.querySelector(".preview-image img")?.complete'),true)
      await capture('file-preview-image')
      await click('.tree-row[title="binary.bin"]')
      assert.equal(await js('document.querySelector(".preview-empty")?.textContent.includes("暂不支持预览")'),true)
      await click('[aria-label="关闭文件预览"]')
      assert.equal(await js('!!document.querySelector(".file-preview")'),false)
      await click('[data-panel="chats"]')
      assert.equal(await js('document.querySelector(".chat-item").getBoundingClientRect().height'),34,'Chats use single-line compact rows')
      await capture('sidebar-detail')
      await js('document.querySelector(".run-card.error").scrollIntoView({block:"center"})')
      const compactError = await js('document.querySelector(".run-card.error .run-card-head").getBoundingClientRect().width')
      assert.ok(compactError<400,'Failed tools use the same compact trigger as plugins')
      await js('document.querySelector(".composer-input textarea").focus()')
      win.webContents.sendInputEvent({type:'mouseMove',x:500,y:25});await wait(180)
      assert.equal(await js('getComputedStyle(document.querySelector(".run-card.error .run-card-head")).borderTopColor'),'rgba(0, 0, 0, 0)','Collapsed activity has no resting border')
      await click('.run-card.error .run-card-head')
      assert.equal(await js('document.querySelector(".run-card.error .run-card-head").getBoundingClientRect().width'),compactError,'Opening details never resizes the trigger')
      await capture('tool-error-disclosure')
      await click('.run-card.error .run-card-head')
      await js('(async()=>{const cfg=await window.navora.config.get();await window.navora.config.save({app:{...cfg.app,collapse_tool_runs:false,collapse_run_logs:true}})})()')
      await wait(200)
      assert.equal(await js('[...document.querySelectorAll(".run-card-text")].some(el=>el.textContent.includes("1 条日志"))'),true,'Even a single folded log uses the shared disclosure')
      await js('[...document.querySelectorAll(".run-card-text")].find(el=>el.textContent.includes("1 条日志")).scrollIntoView({block:"center"})')
      await capture('log-disclosure')
      await js('(async()=>{const cfg=await window.navora.config.get();await window.navora.config.save({app:{...cfg.app,collapse_tool_runs:true}})})()')
      await wait(150)
      // Native folder opening, current-chat resources and global management retain distinct owners.
      await click('[data-chat-resource="files"]')
      assert.equal(openedPaths.at(-1),path.dirname(workspaceFixture),'Explorer opens the actual current chat folder, not its parent')
      assert.equal(await js('!!document.querySelector(".chat-resource-popup")'),false,'Explorer never opens a file menu')
      if(await js('!!document.querySelector(".conversation-resource-card")'))await click('[aria-label="关闭资源面板"]')
      await click('[data-chat-resource="resources"]')
      await click('[data-resource-tab="files"]')
      assert.equal(await js('document.querySelector(".conversation-resource-card").textContent.includes("other-only.txt")'),false,'Current files exclude other conversations')
      assert.equal(await js('document.querySelector(".conversation-resource-card .res-head").checkVisibility()'),true,'Local file controls are visible')
      await capture('current-chat-files')
      await click('.conversation-resource-card .tree-row[title="preview.md"]')
      assert.equal(await js('document.querySelector(".preview-markdown h1")?.textContent'),'文件预览')
      await click('[aria-label="关闭文件预览"]')
      await click('[data-resource-tab="outputs"]')
      assert.ok(await js('document.querySelectorAll(".resource-output-row").length')>0,'Conversation outputs are available in the resource card')
      await click('.resource-output-row:first-child')
      assert.equal(await js('!!document.querySelector(".resource-outputs .msg-md-content")'),true,'Output details reuse the safe message renderer')
      await capture('current-chat-outputs')
      await click('[data-panel="workspace"]')
      assert.equal(await js('document.querySelectorAll("[data-resource-kind=files] .resource-owner").length'),2,'Global files hide every empty chat')
      await click('[data-owner-id="chat_renovation118"] .resource-owner-toggle')
      await click('.global-resources .tree-row[title="other-only.txt"]')
      assert.equal(await js('document.querySelector(".preview-code")?.textContent'),'From another conversation','Global preview carries the resource owner, not the active chat')
      await click('[aria-label="关闭文件预览"]')
      await capture('all-chat-files')
      await click('[aria-label="关闭资源面板"]')
      fs.mkdirSync(path.join(workspaceFixture,'deep'),{recursive:true});fs.writeFileSync(path.join(workspaceFixture,'deep','new.txt'),'New nested output')
      await js('window.navora.workspace.setChatRoot("chat_renovation119",null)');await wait(300)
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'Deep file changes automatically reveal resources')
      await click('[aria-label="关闭资源面板"]')
      await js('window.navora.workspace.delete("chat_renovation118","other-only.txt")');await wait(300)
      assert.equal(await js('document.querySelectorAll("[data-resource-kind=files] .resource-owner").length'),1,'Deleting the last file removes its conversation from global files')
      await js('(async()=>{window.__localSession=await window.navora.browser.createSession("chat_renovation119",{persist:false});window.__otherSession=await window.navora.browser.createSession("chat_renovation118",{persist:false});await window.navora.browser.createWindow(window.__otherSession.sessionId,{url:"about:blank",show:false})})()')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),false,'Another conversation cannot auto-open current resources')
      await js('(async()=>{await window.navora.browser.createWindow(window.__localSession.sessionId,{url:"about:blank",show:false})})()');await wait(220)
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'A new current-chat browser window automatically opens resources')
      assert.equal(await js('document.querySelector("[data-resource-tab=browser]").getAttribute("aria-pressed")'),'true','New browser discovery selects its resource type')
      await click('[data-resource-tab="browser"]')
      assert.equal(await js('document.querySelectorAll(".conversation-resource-card .tree-sess").length'),1,'Current browser card excludes unrelated sessions')
      await capture('current-chat-browser')
      await click('[aria-label="关闭资源面板"]')
      await js('(async()=>{const tree=await window.navora.browser.tree("chat_renovation119");await window.navora.browser.setVisible(tree[0].windows[0].windowId,true)})()');await wait(160)
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),false,'Visibility changes respect manual dismissal')
      await click('[data-panel="browser"]')
      assert.equal(await js('document.querySelectorAll("[data-resource-kind=browser] .resource-owner").length'),2,'Global browser shows owners from every chat')
      assert.equal(await js('(async()=>{const sessions=await window.navora.browser.treeAll();return new Set(sessions.map(s=>s.sessionId)).size===sessions.length})()'),true,'All-tree snapshot never duplicates sessions')
      await capture('all-chat-browser')
      assert.equal(await js('document.querySelectorAll(".rail-panel-button[aria-pressed=true]").length'),1,'Only one global sidebar is open')
      assert.equal(await js('document.querySelectorAll(".rail-panel-groups [draggable=true],.dock-header [draggable=true],.dock-collapse,.dock-divider,.rail-composite-icon").length'),0,'Grouping, dragging and collapse controls are removed')
      await click('[data-panel="browser"]')
      assert.equal(await js('document.querySelector(".sidebar").getBoundingClientRect().width'),52,'Closing the selected sidebar leaves only the icon rail')
      await js('localStorage.setItem("navora.sidebar.rail",JSON.stringify({version:1,active:"old-combination",groups:[{id:"old-combination",panels:["chats","workspace","browser"]}]}))')
      await win.webContents.reload();await wait(400)
      assert.equal(await js('document.querySelectorAll(".rail-panel-button").length'),3,'Legacy combinations become independent entries')
      assert.equal(await js('document.querySelectorAll(".rail-panel-button[aria-pressed=true]").length'),1)
      await click('.chat-batch-trigger')
      assert.equal(await js('document.querySelector(".batch-delete-btn").disabled'),true,'Batch actions start disabled')
      await click('.chat-item-main')
      assert.equal(await js('document.querySelector(".chat-batch-count").textContent.trim()'),'已选 1')
      assert.equal(await js('document.querySelector(".batch-delete-btn").disabled'),false)
      await capture('chat-batch-actions')
      await click('.chat-batch-trigger')
      assert.equal(await js('document.querySelector(".rail-search").closest(".activity-rail")!==null'),true,'Search stays in the rail')
      assert.equal(await js('document.querySelectorAll(".run-card.open").length'),0,'Tool and plugin groups start collapsed')
      await js('document.querySelectorAll(".outline-step")[70].click()')
      await wait(350)
      const jumpError = await js(`(()=>{const box=document.querySelector('.messages'),row=box.querySelector('[data-msg-id="u70"]');return Math.abs(row.getBoundingClientRect().top-box.getBoundingClientRect().top)})()`)
      assert.ok(jumpError < 5,'Long conversation jumps stay aligned after deferred painting: '+jumpError)
      const outlinePoint=await js('(()=>{const r=document.querySelector(".outline-step.current").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
      win.webContents.sendInputEvent({type:'mouseMove',...outlinePoint});await wait(220)
      assert.equal(await js('!!document.querySelector(".outline-preview")'),true,'Jump rail exposes an animated preview')
      await capture('conversation-jump-preview')
      win.webContents.sendInputEvent({type:'mouseMove',x:500,y:450});for(let n=0;n<12;n++){await wait(80);if(!await js('!!document.querySelector(".outline-preview")'))break}
      assert.equal(await js('!!document.querySelector(".outline-preview")'),false,'Jump previews leave without blocking conversation controls')
      // Stress interrupted transitions, then verify both visibility and pointer exclusion.
      await click('[data-panel="workspace"]')
      const samples: Array<{p95:number;inputP95:number;samples:number}> = []
      for (let round = 0; round < 3; round++) {
        samples.push(await js(`(async()=>{
          const frames=[],responses=[]; let last=performance.now(),running=true;
          const frame=now=>{frames.push(now-last);last=now;if(running)requestAnimationFrame(frame)};requestAnimationFrame(frame);
          const b=document.querySelector('[data-panel="workspace"]');
          for(let i=0;i<20;i++){const start=performance.now();b.click();await Promise.resolve();responses.push(performance.now()-start);await new Promise(r=>setTimeout(r,35))}
          await new Promise(r=>setTimeout(r,400));running=false;
          const values=frames.slice(3).sort((a,b)=>a-b);responses.sort((a,b)=>a-b);
          return {p95:values[Math.floor(values.length*.95)],inputP95:responses[Math.floor(responses.length*.95)],samples:values.length}
        })()`))
      }
      // Replicate the fixed scene three times so one scheduler pause cannot dominate a short sample.
      const frameMetrics = { medianP95:samples.map(s=>s.p95).sort((a,b)=>a-b)[1]!, medianInputP95:samples.map(s=>s.inputP95).sort((a,b)=>a-b)[1]!, samples }
      assert.equal(await js(`(()=>{const b=document.querySelector('[data-panel="workspace"]'),pane=document.querySelector('#dock-pane-workspace');return b.getAttribute('aria-pressed')==='true' && pane.checkVisibility() && !pane.inert})()`),true,'Interrupted toggles settle on the intended visible state')
      if (!reduced) assert.ok(frameMetrics.medianP95 <= 32,'Animated long-list median frame p95 stays within 32 ms: '+JSON.stringify(frameMetrics))
      else {
        assert.ok(frameMetrics.medianInputP95 <= 32,'Reduced-motion input updates stay within 32 ms: '+JSON.stringify(frameMetrics))
        assert.equal(await js("document.getAnimations().filter(a=>a.playState==='running').length"),0,'Reduced motion has no running effects')
      }
      await click('[data-panel="workspace"]'); await wait(350)
      assert.equal(await js('document.querySelector("#dock-pane-workspace").checkVisibility()'),false,'Hidden pane leaves no intermediate layer')
      await capture('sidebar-interrupted')
      // Narrow settings use their own header; chat header returns on exit.
      for (const width of [1280,960,720,390]) {
        win.setContentSize(width,844); await wait(160)
        await click(width>1100?'.sidebar-settings-btn':'.mobile-topbar-btn[aria-label="设置"]')
        await tab('模型'); await viewport()
        assert.equal(await js('!!document.querySelector(".mobile-topbar")'),false,'Settings owns its header')
        await capture('model-width-'+width)
        await click('.settings-close')
      }
      await click('.mobile-topbar-btn[aria-label="打开菜单"]')
      await click('[data-panel="workspace"]')
      await click('.tree-row[title="preview.md"]')
      assert.equal(await js(`(()=>{const preview=document.querySelector('.file-preview').getBoundingClientRect(),caption=document.querySelector('.mobile-topbar').getBoundingClientRect();return preview.top>=caption.bottom-1})()`),true,'Narrow preview stays below the caption and chat header')
      await capture('file-preview-narrow')
      await click('[aria-label="关闭文件预览"]')
      win.setContentSize(1440,900);await wait(200)
      await js('window.navora.agent.submit("chat_renovation119",{content:"UI_QUEUE_FIRST"},"queue")')
      for(let n=0;n<50&&!releaseQueueFirst;n++)await wait(30)
      assert.ok(releaseQueueFirst,'Agent request is in flight')
      await input('.composer-input textarea','UI_QUEUE_SECOND')
      await click('[aria-label="加入队列"]')
      await js('window.navora.agent.submit("chat_renovation119",{content:"UI_QUEUE_DELETE"},"queue")');await wait(100)
      await click('.message-queue li:last-child [aria-label="删除队列消息"]')
      await click('.message-queue li:first-child [aria-label="编辑队列消息"]')
      await js('document.querySelector(".message-queue textarea").focus()')
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(100)
      assert.equal(await js('window.navora.agent.isRunning("chat_renovation119")'),true,'Escape in the queue editor never stops the active task')
      await click('.message-queue li:first-child [aria-label="编辑队列消息"]')
      await input('.message-queue textarea','UI_QUEUE_SECOND_EDITED')
      await js('[...document.querySelectorAll(".queue-edit-actions button")].find(button=>button.textContent==="保存").click()');await wait(120)
      await js('window.navora.agent.submit("chat_renovation119",{content:"UI_QUEUE_STEER"},"queue")');await wait(100)
      await click('.message-queue li:last-child [aria-label="直接插入队列消息"]')
      const persistedQueue=JSON.parse(fs.readFileSync(path.join(root,'chats','chat_renovation119.json'),'utf8')).queuedMessages
      assert.deepEqual(persistedQueue.map((entry:{content:string})=>entry.content),['UI_QUEUE_SECOND_EDITED'],'The main process persists only unsent work')
      assert.equal(await js('Math.abs(document.querySelector(".message-queue").getBoundingClientRect().width-document.querySelector(".composer-box").getBoundingClientRect().width)<1'),true,'Queue aligns with the composer width')
      await capture('conversation-message-queue')
      releaseQueueFirst!()
      for(let n=0;n<150;n++){if(await js('(async()=>{const c=await window.navora.chats.get("chat_renovation119");return !await window.navora.agent.isRunning(c.id)&&!c.queuedMessages?.length})()'))break;await wait(40)}
      assert.deepEqual(queuePrompts,['UI_QUEUE_FIRST','UI_QUEUE_STEER','UI_QUEUE_SECOND_EDITED'],'Insertion reaches the active model context before the queued task starts')
      const sentUsers=await js('(async()=>{const c=await window.navora.chats.get("chat_renovation119");return c.messages.filter(m=>m.role==="user"&&m.content.startsWith("UI_QUEUE_")).map(m=>m.content)})()')
      assert.deepEqual(sentUsers,['UI_QUEUE_FIRST','UI_QUEUE_STEER','UI_QUEUE_SECOND_EDITED'],'Each user message is recorded once and deleted work is never executed')
      assert.equal(await js('!!document.querySelector(".message-queue")'),false,'The empty queue disappears')
      await capture('conversation-unified-activity')
      assert.deepEqual(errors,[],'No renderer errors')
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reduced,frameMetrics,modelRequests,checks:['provider-drafts','reopen-draft','tier-rename','preview-race','separate-probes','permission-search','visible-empty-states','workspace-keyboard','file-preview','file-preview-source-safety','file-preview-width','compact-chat-rows','native-explorer-current-path','floating-resource-files-browser-outputs','resource-auto-open-dismissal','all-chat-files','all-browser-owners','single-sidebar','old-group-migration','message-queue-edit-delete-insert','main-process-queue-persistence','active-context-insertion','long-conversation-jump','zoom-layout','interrupted-motion','single-mobile-header']},null,2))
      console.log(JSON.stringify({ok:true,reduced,frameMetrics,modelRequests}))
      server.close(); app.exit(0)
    } catch(error) { console.error(error); await capture('failure'); server.close(); app.exit(1) }
  })())
})
void import('../electron/main')
