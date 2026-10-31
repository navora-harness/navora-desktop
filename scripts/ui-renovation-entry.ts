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
    {id:'ui-style-progress-old',role:'assistant',content:'连接超时了，我再试一次。',createdAt:401,meta:{partial:false,reasoning:'第一轮观察'}},
    {id:'ui-style-tool-error',role:'tool',content:'{"ok":false,"error":"load_failed"}',createdAt:401,meta:{toolName:'browser_open',status:'error'}},
    {id:'ui-style-progress-new',role:'assistant',content:'窗口已存在，正在读取页面内容。',createdAt:402,meta:{phase:'progress',partial:false,reasoning:'第二轮观察'}},
    {id:'ui-style-tool-recovered',role:'tool',content:'{"ok":true}',createdAt:403,meta:{toolName:'browser_get',status:'done'}},
    {id:'ui-style-answer-error',role:'assistant',content:'这里仅检查失败工具的折叠样式。',createdAt:404,meta:{phase:'final',reasoning:'第一轮观察\n第二轮观察\n完成回答'}},
    {id:'ui-style-user-plugin',role:'user',content:'插件样式（本地测试夹具）',createdAt:403},
    {id:'ui-style-plugin',role:'tool',content:'{"ok":true}',createdAt:404,meta:{toolName:'fixture_plugin',status:'done',fromPlugin:true,pluginId:'fixture'}},
    {id:'ui-style-answer-plugin',role:'assistant',content:'插件摘要。',createdAt:405},
    {id:'ui-style-user-log',role:'user',content:'日志样式（本地测试夹具）',createdAt:406},
    {id:'ui-style-log',role:'log',content:'本地日志样式记录',createdAt:407,meta:{kind:'agent_status'}},
    {id:'ui-style-answer-log',role:'assistant',content:'日志摘要。\n\n[打开文档](preview.md)\n\n![图片](image.png)',createdAt:408,meta:{sources:[{url:'https://example.com/fixture',title:'本地来源测试'}]}},
  ]) as typeof messages)
  const chat={id:'chat_renovation'+i,title:'本地回归对话 '+i,createdAt:i+1,updatedAt:i+1,messages}
  fs.writeFileSync(path.join(root,'chats',chat.id+'.json'),JSON.stringify(chat))
}
app.setPath('userData',root)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const openedPaths:string[]=[],openedUrls:string[]=[]
shell.openExternal=async url=>{openedUrls.push(url)}
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
      if(typeof lastUser==='string' && lastUser.startsWith('UI_PROCESS')){
        const read=request.messages.some((message:{role:string;tool_call_id?:string})=>message.role==='tool'&&message.tool_call_id==='ui-process-time')
        const reply=read?{role:'assistant',content:'已读取设备时间，过程已完成。',reasoning_content:'已取得真实工具结果。'}:{role:'assistant',content:'正在读取当前时间。',reasoning_content:'先查看设备时间。',tool_calls:[{id:'ui-process-time',type:'function',function:{name:'datetime_now',arguments:'{}'}}]}
        res.end(JSON.stringify({choices:[{message:reply,finish_reason:read?'stop':'tool_calls'}]}));return
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
      await js("document.querySelector('.file-workspace-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))")
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
      assert.equal(await js('document.querySelectorAll(".file-workspace [role=tab]").length'),4,'Files open in independent tabs')
      await js('[...document.querySelectorAll(".file-workspace [role=tab]")].find(tab=>tab.textContent.includes("preview.md")).click()');await wait(120)
      assert.equal(await js('document.querySelector(".preview-code")?.textContent.includes("<script>")'),true,'Switching tabs preserves Markdown source mode')
      await js('[...document.querySelectorAll(".file-workspace [role=tab]")].find(tab=>tab.textContent.includes("image.png")).click()');await wait(120)
      await input('[aria-label="图片缩放"]','100','change')
      await js('[...document.querySelectorAll(".file-workspace [role=tab]")].find(tab=>tab.textContent.includes("preview.md")).click()');await wait(100)
      await js('[...document.querySelectorAll(".file-workspace [role=tab]")].find(tab=>tab.textContent.includes("image.png")).click()');await wait(100)
      assert.equal(await js('document.querySelector(".preview-zoom").value'),'100','Image zoom survives tab switches')
      await capture('file-workspace-tabs')
      await js(`document.querySelector('.messages .msg-md-content a[href="preview.md"]').click()`);await wait(150)
      assert.equal(await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").textContent.includes("preview.md")'),true,'Workspace links in replies open file tabs')
      await js(`document.querySelector('.messages .msg-md-content img[data-src="image.png"]').click()`);await wait(150)
      assert.equal(await js('!!document.querySelector(".media-lightbox")'),false,'Workspace images open in tabs rather than a separate dialog')

      await click('[aria-label="新增文件标签页"]')
      await click('.file-workspace-picker .tree-row[title="preview.md"]')
      assert.equal(await js('document.querySelectorAll(".file-workspace [role=tab]").length'),4,'The file picker reuses an existing tab')
      assert.equal(await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").textContent.includes("preview.md")'),true,'The plus button can select workspace files')
      await js('[...document.querySelectorAll(".file-workspace [role=tab]")].find(tab=>tab.textContent.includes("image.png")).click()');await wait(100)

      await click('[aria-label="关闭标签页：binary.bin"]')
      assert.equal(await js('document.querySelectorAll(".file-workspace [role=tab]").length'),3,'Closing an inactive tab preserves the selected file')
      await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');await wait(100)
      assert.equal(await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").textContent.includes("preview.md")'),true,'Keyboard navigation selects the neighbouring file tab')
      await click('.sidebar-settings-btn')
      assert.equal(await js('!!document.querySelector(".file-workspace")'),false,'Settings owns its space while file tabs stay saved')
      await click('.settings-close')
      assert.equal(await js('document.querySelectorAll(".file-workspace [role=tab]").length'),3,'Returning from settings restores the file workspace')

      await click('[aria-label="关闭文件预览"]')
      assert.equal(await js('!!document.querySelector(".file-preview")'),false)
      await click('[data-chat-resource="workspace"]')
      assert.equal(await js('document.querySelectorAll(".file-workspace [role=tab]").length'),3,'Hiding and reopening preserves file tabs')
      await click('[aria-label="关闭文件预览"]')
      await click('[data-panel="chats"]')
      assert.equal(await js('document.querySelector(".chat-item").getBoundingClientRect().height'),34,'Chats use single-line compact rows')
      await capture('sidebar-detail')
      await js('document.querySelector(".run-card.error").scrollIntoView({block:"center"})')
      const compactError = await js('document.querySelector(".run-card.error .run-card-head").getBoundingClientRect().width')
      assert.ok(compactError<400,'Failed tools use the same compact trigger as plugins')
      await js('document.querySelector(".composer-input textarea").focus()')
      win.webContents.sendInputEvent({type:'mouseMove',x:500,y:25});await wait(180)
      assert.equal(await js('getComputedStyle(document.querySelector(".run-card.error .run-card-head")).borderTopColor'),'rgba(0, 0, 0, 0)','Collapsed activity has no resting border')
      assert.equal(await js('document.querySelectorAll(".msg.assistant[data-msg-id^=ui-style-progress]").length'),0,'Progress never renders as independent final replies')
      await click('.run-card.error .run-card-head')
      assert.equal(await js('document.querySelectorAll(".run-card.error .process-note").length'),2,'Legacy and explicitly tagged progress join one process')
      assert.equal(await js('document.querySelectorAll(".process-note .reply-footer").length'),0,'Intermediate notes have no final-answer actions or duration')
      await click('.run-card.error .msg-reasoning-toggle')
      assert.equal(await js('document.querySelector(".run-card.error .msg-reasoning-body").textContent.includes("完成回答")'),true,'Aggregate reasoning is available once inside the process')
      assert.equal(await js('document.querySelectorAll(".msg.assistant>.msg-row>.msg-main>.msg-reasoning").length'),0,'Final answers do not duplicate the process disclosure')
      assert.equal(await js('document.querySelector(".run-card.error .run-card-head").getBoundingClientRect().width'),compactError,'Opening details never resizes the trigger')
      await capture('process-and-final-output')
      await click('.run-card.error .run-card-head')
      await js('document.querySelector("[data-msg-id=ui-style-answer-error]").scrollIntoView({block:"center"})')
      await capture('final-answer-separation')
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
      assert.equal(await js('document.querySelector(".conversation-resource-card").classList.contains("is-overview")'),true,'Resources open as a compact overview')
      assert.ok(await js('document.querySelector(".conversation-resource-card").getBoundingClientRect().height')<500,'The overview follows its content height')
      await click('.resource-overview-section:nth-child(2) .resource-overview-row')
      assert.equal(openedUrls.at(-1),'https://example.com/fixture','Source links open through the native external-link API')
      assert.equal(await js('[...document.querySelectorAll(".resource-overview-row")].every(row=>!!row.querySelector("svg"))'),true,'Every overview resource has a visible SVG icon')
      await capture('resource-compact-overview')
      await click('[data-resource-view="files"]')
      assert.equal(await js('document.querySelector(".conversation-resource-card").textContent.includes("other-only.txt")'),false,'Current files exclude other conversations')
      assert.equal(await js('document.querySelector(".conversation-resource-card .res-head").checkVisibility()'),true,'Local file controls are visible')
      await capture('current-chat-files')
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'docked','Enough conversation width keeps resources beside the answer')
      const transcriptAtRight=()=>js('(()=>{const box=document.querySelector(".messages"),main=document.querySelector("main.main"),r=box.getBoundingClientRect();return Math.abs(r.right-main.getBoundingClientRect().right)<1 && r.right===innerWidth})()')
      assert.equal(await transcriptAtRight(),true,'Docked resources keep the conversation scrollbar at the window edge')
      assert.equal(await js('(()=>{const row=document.querySelector(".messages .msg"),card=document.querySelector(".conversation-resource-card"),outline=document.querySelector(".conversation-outline");return row.getBoundingClientRect().right<card.getBoundingClientRect().left && outline.getBoundingClientRect().right<card.getBoundingClientRect().left})()'),true,'Transcript and jump rail still leave room for docked resources')
      const transcriptScroll=await js('document.querySelector(".messages").scrollTop')
      const transcriptEdge=await js('(()=>{const r=document.querySelector(".messages").getBoundingClientRect();return {x:Math.floor(r.right)-3,y:Math.floor(r.top+r.height/2)}})()')
      win.webContents.sendInputEvent({type:'mouseMove',...transcriptEdge});await wait(100);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...transcriptEdge});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...transcriptEdge});await wait(180)
      assert.ok(await js('document.querySelector(".messages").scrollTop')<transcriptScroll,'The native scrollbar track scrolls the conversation beside the resource card')
      await capture('conversation-scrollbar-right-edge')

      await click('.composer-input textarea')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'Outside clicks preserve a docked card')
      // A wide sidebar makes the card float even in a wide application window.
      await js('for(let n=0;n<21;n++)document.querySelector(".sidebar-divider.vertical").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');await wait(180)
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'overlay','Sidebar width contributes to available conversation space')
      assert.equal(await js('getComputedStyle(document.querySelector(".messages-wrap")).marginRight'),'0px','Floating resources leave the conversation at its full width')
      assert.equal(await transcriptAtRight(),true,'Floating resources never move the conversation scrollbar')
      await click('[data-resource-tab="files"]')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'Inside clicks keep the floating card open')
      await js(`(()=>{const el=document.querySelector('.conversation-resource-card .tree-row[title="preview.md"]'),r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+20,clientY:r.y+10}))})()`);await wait(120)
      await js('(()=>{window.__clipboardWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async text=>{window.__copiedResource=text};return true})()')
      await click('.sidebar-ctx-panel button:nth-child(3)')
      assert.equal(await js('window.__copiedResource'),'preview.md','Teleported resource actions execute without dismissing the card')
      await js('(()=>{navigator.clipboard.writeText=window.__clipboardWrite;return true})()')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'The card owns its teleported context menu')
      await capture('resource-overlay-wide-sidebar')
      await click('.composer-input textarea')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),false,'Outside clicks dismiss floating resources')
      assert.equal(await transcriptAtRight(),true,'Dismissing resources leaves the scrollbar fixed')
      assert.equal(await js('document.activeElement.matches(".composer-input textarea")'),true,'Dismissal preserves the underlying composer click and focus')
      await click('[data-chat-resource="resources"]')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'The resource button opens an overlay once')
      await click('[data-chat-resource="resources"]')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),false,'The resource button closes without reopening the overlay')
      await js('document.querySelector(".sidebar-divider.vertical").dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}))');await wait(160)
      win.setContentSize(1240,900);await wait(160)
      await click('[data-chat-resource="resources"]')
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'overlay','Narrow conversation space overlays resources')
      await click('[data-panel="chats"]')
      await click('[data-chat-resource="resources"]')
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'docked','Closing the sidebar can restore enough space below the old viewport breakpoint')
      await click('[data-panel="chats"]')
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'overlay','Opening the sidebar switches an existing card to overlay mode')
      win.setContentSize(1440,900);await wait(160)
      assert.equal(await js('document.querySelector(".conversation-resource-card").dataset.layout'),'docked','Widening restores the dock without closing resources')
      await click('[data-resource-view="files"]')
      await click('.conversation-resource-card .tree-row[title="preview.md"]')
      assert.equal(await js('document.querySelector(".preview-markdown h1")?.textContent'),'文件预览')
      await click('[aria-label="关闭文件预览"]')
      if(!await js('!!document.querySelector(".conversation-resource-card")'))await click('[data-chat-resource="resources"]')
      if(await js('!!document.querySelector("[data-resource-view=outputs]")'))await click('[data-resource-view="outputs"]');else await click('[data-resource-tab="outputs"]')
      assert.ok(await js('document.querySelectorAll(".resource-output-row").length')>0,'Conversation outputs are available in the resource card')
      assert.equal(await js('[...document.querySelectorAll(".resource-output-row")].some(el=>el.textContent.includes("重试一次")||el.textContent.includes("窗口已存在"))'),false,'Resource outputs exclude process narration')
      await click('.resource-output-row:first-child')
      assert.equal(await js('!!document.querySelector(".resource-outputs .msg-md-content")'),true,'Output details reuse the safe message renderer')
      await capture('current-chat-outputs')
      await click('[data-panel="workspace"]')
      assert.equal(await js('document.querySelectorAll("[data-resource-kind=files] .resource-owner").length'),2,'Global files hide every empty chat')
      await click('[data-owner-id="chat_renovation118"] .resource-owner-toggle')
      await click('.global-resources .tree-row[title="other-only.txt"]')
      assert.equal(await js('document.querySelector(".preview-code")?.textContent'),'From another conversation','Global preview carries the resource owner, not the active chat')
      assert.equal(await js('document.querySelector(".file-workspace-owner").textContent.includes("118")'),true,'Cross-conversation file tabs display their owner')
      await click('[aria-label="关闭文件预览"]')
      await capture('all-chat-files')
      if(await js('!!document.querySelector(".conversation-resource-card")'))await click('[aria-label="关闭资源面板"]')
      fs.mkdirSync(path.join(workspaceFixture,'deep'),{recursive:true});fs.writeFileSync(path.join(workspaceFixture,'deep','new.txt'),'New nested output')
      await js('window.navora.workspace.setChatRoot("chat_renovation119",null)');await wait(300)
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'Deep file changes automatically reveal resources')
      if(await js('!!document.querySelector(".conversation-resource-card")'))await click('[aria-label="关闭资源面板"]')
      await js('window.navora.workspace.delete("chat_renovation118","other-only.txt")');await wait(300)
      assert.equal(await js('document.querySelectorAll("[data-resource-kind=files] .resource-owner").length'),1,'Deleting the last file removes its conversation from global files')
      await js('(async()=>{window.__localSession=await window.navora.browser.createSession("chat_renovation119",{persist:false});window.__otherSession=await window.navora.browser.createSession("chat_renovation118",{persist:false});await window.navora.browser.createWindow(window.__otherSession.sessionId,{url:"about:blank",show:false})})()')
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),false,'Another conversation cannot auto-open current resources')
      await js('(async()=>{await window.navora.browser.createWindow(window.__localSession.sessionId,{url:"about:blank",show:false})})()');await wait(220)
      assert.equal(await js('!!document.querySelector(".conversation-resource-card")'),true,'A new current-chat browser window automatically opens resources')
      assert.equal(await js('document.querySelector(".conversation-resource-card").classList.contains("is-overview")'),true,'New browser discovery shows the compact overview')
      await click('[data-resource-view="browser"]')
      assert.equal(await js('document.querySelectorAll(".conversation-resource-card .tree-sess").length'),1,'Current browser card excludes unrelated sessions')
      await capture('current-chat-browser')
      if(await js('!!document.querySelector(".conversation-resource-card")'))await click('[aria-label="关闭资源面板"]')
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
      await click('[data-chat-resource="workspace"]')
      assert.ok(await js('document.querySelectorAll(".file-workspace [role=tab]").length')>=3,'File tab metadata survives reloading the application')
      await click('[aria-label="关闭文件预览"]')

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
      await click('[data-chat-resource="workspace"]')
      await js('document.querySelector(".file-workspace [role=tab][aria-selected=true]").focus()')
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(220)
      assert.equal(await js('!!document.querySelector(".file-workspace")'),false,'Escape in the file tab strip hides the workspace')
      assert.equal(await js('window.navora.agent.isRunning("chat_renovation119")'),true,'Escape in file tabs never stops the Agent')

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
      await js('window.navora.agent.submit("chat_renovation119",{content:"UI_PROCESS 请读取当前设备时间并回答"},"queue")')
      for(let n=0;n<150;n++){if(await js('(async()=>{const c=await window.navora.chats.get("chat_renovation119");return !await window.navora.agent.isRunning(c.id)&&c.messages.at(-1)?.meta?.phase==="final"})()'))break;await wait(40)}
      const processTurn=await js('(async()=>{const c=await window.navora.chats.get("chat_renovation119"),i=c.messages.findIndex(m=>m.role==="user"&&m.content.startsWith("UI_PROCESS"));return c.messages.slice(i+1)})()')
      assert.equal(processTurn.find((m:{role:string})=>m.role==='assistant').meta.phase,'progress','Runtime preserves narration phase after shimmer clears')
      assert.equal(processTurn.find((m:{role:string})=>m.role==='assistant').meta.partial,false)
      assert.equal(processTurn.at(-1).meta.phase,'final','The completed answer is explicitly tagged final')
      assert.equal(await js('[...document.querySelectorAll(".msg.assistant")].filter(el=>el.textContent.includes("正在读取当前时间")).length'),0,'Tool narration does not become an independent reply')
      await capture('conversation-unified-activity')
      assert.deepEqual(errors,[],'No renderer errors')
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reduced,frameMetrics,modelRequests,checks:['process-vs-final-legacy','process-vs-final-runtime','process-reasoning-group','final-resource-filter','provider-drafts','reopen-draft','tier-rename','preview-race','separate-probes','permission-search','visible-empty-states','workspace-keyboard','file-preview','file-preview-source-safety','file-preview-width','file-tab-reuse-and-close','file-tab-state-cache','image-zoom-tabs','file-picker-tabs','file-workspace-hide-restore','compact-chat-rows','native-explorer-current-path','floating-resource-files-browser-outputs','resource-auto-open-dismissal','resource-space-aware-overlay','resource-outside-dismissal','resource-owned-menu','compact-resource-overview','resource-source-links','conversation-scrollbar-window-edge','all-chat-files','all-browser-owners','single-sidebar','old-group-migration','message-queue-edit-delete-insert','main-process-queue-persistence','active-context-insertion','long-conversation-jump','zoom-layout','interrupted-motion','single-mobile-header']},null,2))
      console.log(JSON.stringify({ok:true,reduced,frameMetrics,modelRequests}))
      server.close(); app.exit(0)
    } catch(error) { console.error(error); await capture('failure'); server.close(); app.exit(1) }
  })())
})
void import('../electron/main')
