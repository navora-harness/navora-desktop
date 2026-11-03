import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import AdmZip from 'adm-zip'
import { createDefaultConfig } from '../shared/config'
import { creatorTemplate } from '../shared/creators'
import { addProviderFromPresetId } from '../shared/model-providers'
import { SecretsStore } from '../electron/modules/secrets'
import { PluginStore } from '../electron/modules/plugin-store'
import { OpenAICompatibleClient } from '../electron/modules/llm/openai-compatible'

const root = process.env.NAVORA_DATA_ROOT!, output = process.env.NAVORA_UI_OUTPUT!
if (process.env.NAVORA_LIVE_CREATOR === '1') {
  const originalChat = OpenAICompatibleClient.prototype.chat
  OpenAICompatibleClient.prototype.chat = async function(...args) {
    const reply = await originalChat.apply(this,args)
    if (String(args[0][0]?.content).includes('创建助手')) fs.writeFileSync(path.join(output,'generation-response.json'),JSON.stringify({content:reply.content,finish_reason:reply.finish_reason},null,2))
    return reply
  }
}
const reduced = process.env.NAVORA_UI_REDUCED_MOTION === '1'
if (reduced) app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
let generationCount = 0
const server = createServer(async (req,res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const request = JSON.parse(body)
  res.setHeader('Content-Type','application/json')
  if (request.messages[0].content.includes('创建助手')) {
    generationCount++
    if (request.messages.at(-1).content.includes('cancel-fixture')) return
    const kind = request.messages[0].content.includes('插件创建助手') ? 'plugin' : 'skill'
    const files = creatorTemplate(kind)
    if (kind === 'skill') files['SKILL.md'] = files['SKILL.md']!.replace('my-skill','generated-skill')
    else files['README.md'] = '# 生成的插件\n\n本地文本处理工具。'
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({files})},finish_reason:'stop'}]}))
  } else {
    const tool = request.tools?.find((item:any) => /my_plugin_.*text/.test(item.function.name))
    if (tool && !request.messages.some((message:any) => message.role === 'tool')) {
      res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'creator-call',type:'function',function:{name:tool.function.name,arguments:'{"text":"hello"}'}}]},finish_reason:'tool_calls'}]}))
    } else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'测试成功：hello'},finish_reason:'stop'}]}))
  }
})
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
const port = (server.address() as {port:number}).port
const config = createDefaultConfig()
config.app.onboarding_completed = true; config.app.ai_generate_chat_title = false; config.remote.enabled = false
config.ai.providers = [{ id:'creator-fixture', label:'本地生成测试', type:'openai_compatible', base_url:`http://127.0.0.1:${port}/v1`, api_key_ref:'', model:'fixture', models:['fixture'], timeout_ms:30000 }]
config.ai.default_provider = 'creator-fixture'
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
app.setPath('userData',root)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const exportPath = path.join(root,'creator-export.zip')
dialog.showSaveDialog = (async () => ({canceled:false,filePath:exportPath})) as typeof dialog.showSaveDialog
const wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms))
let started = false
app.on('browser-window-created',(_,win) => {
  if(started) return
  started = true
  win.webContents.setBackgroundThrottling(false)
  if(win.webContents.isOffscreen()) { win.webContents.setFrameRate(60); win.webContents.on('paint',()=>{}) }
  const errors:string[] = []
  win.webContents.on('console-message',event => { if(event.level==='error') errors.push(event.message) })
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js = async (code:string):Promise<any> => {
      const result = await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).catch(error=>({__testFailure:String(error)}))`)
      if (result?.__testFailure) throw new Error(result.__testFailure)
      return result
    }
    const click = async (selector:string) => {
      const point = await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      win.webContents.sendInputEvent({type:'mouseMove',...point}); win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point}); win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point}); await wait(200)
    }
    const text = async (selector:string,value:string) => { await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(30) }
    const button = async (label:string) => { await js(`[...document.querySelectorAll('.creator-workspace button,.creator-library button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`); await wait(240) }
    const capture = async (name:string) => { await wait(120); fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG()) }
    const open = async (kind:'plugin'|'skill') => { await click('.sidebar-settings-btn'); await click('[aria-label="页面更多操作"]'); await js(`[...document.querySelectorAll('.conversation-actions-menu button')].find(b=>b.textContent.trim()==='${kind==='plugin'?'打开插件管理':'技能创建器'}').click()`); await wait(250); if(kind==='plugin')await click('[aria-label="创建插件"]'); await wait(250) }
    try {
      for(let n=0;n<60;n++) { if(await js('!!document.querySelector(".composer")')) break; await wait(100) }
      win.setMinimumSize(0,0); win.setContentSize(1440,900); await wait(200)
      await open('plugin'); await button('从模板开始')
      assert.equal(await js('document.querySelectorAll(".creator-file-tabs button").length'),3)
      await text('.creator-name','文本助手')
      await button('校验')
      assert.equal(await js('document.querySelector(".creator-validation-title").textContent.includes("校验通过")'),true)
      const projectId = await js('(async()=>{const r=await window.navora.creators.list("plugin");return r.projects[0].id})()')
      await capture('plugin-template')
      await button('main.cjs'); await text('.creator-code','module.exports = { tools: [;'); await button('校验')
      assert.equal(await js('document.querySelector(".creator-validation.failed").textContent.includes("语法错误")'),true)
      await text('.creator-code',creatorTemplate('plugin')['main.cjs']!)
      await text('[aria-label="创建需求"]','生成一个本地文本处理插件')
      await button('生成草稿'); await wait(150)
      assert.equal(generationCount,1)
      assert.equal(await js('document.querySelector(".creator-validation-title").textContent.includes("校验通过")'),true)
      await capture('plugin-generated')
      await button('撤销生成'); await button('校验')
      const beforeCancel = await js(`(async()=>{const r=await window.navora.creators.get(${JSON.stringify(projectId)});return r.project.files})()`)
      await text('[aria-label="创建需求"]','cancel-fixture'); await button('生成草稿'); await button('停止生成')
      await button('校验')
      assert.deepEqual(await js(`(async()=>{const r=await window.navora.creators.get(${JSON.stringify(projectId)});return r.project.files})()`),beforeCancel,'Cancel preserves draft files')
      await text('[aria-label="试用任务"]','请调用本对话插件工具，输入 text 为 hello，检查返回结果。')
      await button('打开试用对话')
      assert.equal(await js('!!document.querySelector(".composer")'),true)
      const trialChat = await js('(async()=>{const list=await window.navora.chats.list();return list.find(c=>c.title==="试用：文本助手")})()')
      assert.equal(trialChat.devPluginLinks.length,1)
      assert.equal(await js('(async()=>{return (await window.navora.plugins.list()).length})()'),0,'Trial plugin stays out of global installation')
      await click('.composer-send')
      for(let n=0;n<80;n++) {
        if(await js('document.querySelector(".in-chat-perm")?.checkVisibility()')) await js("[...document.querySelectorAll('.in-chat-perm button')].find(b=>b.textContent.includes('允许'))?.click()")
        if(!await js(`window.navora.agent.isRunning(${JSON.stringify(trialChat.id)})`)) break
        await wait(80)
      }
      const finished = await js(`window.navora.chats.get(${JSON.stringify(trialChat.id)})`)
      assert.ok(finished.messages.some((message:any)=>message.role==='tool'&&message.content.includes('hello')),'Trial executes the generated plugin through Agent tools')
      await capture('plugin-trial')
      await open('plugin')
      assert.equal(await js('document.querySelector(".creator-name").value'),'文本助手','Reopening restores saved draft')
      await button('安装到本机')
      const installed = await js('(async()=>{return (await window.navora.plugins.list())[0]})()')
      assert.ok(installed?.tools.length && !installed.error)
      await button('README.md'); await text('.creator-code','# 已更新\n\n更新说明。'); await button('更新')
      const saved = await js(`(async()=>{const r=await window.navora.creators.get(${JSON.stringify(projectId)});return r.project})()`)
      assert.equal(saved.installedRevision,saved.revision)
      await click('[aria-label="创建器更多操作"]'); await js(`[...document.querySelectorAll('.ui-action-menu button')].find(b=>b.textContent.includes('导出 ZIP')).click()`); await wait(240)
      assert.ok(new AdmZip(exportPath).getEntry('main.cjs'))
      await click('[aria-label="退出创建器"]')
      await open('skill'); await button('从模板开始')
      await text('[aria-label="创建需求"]','创建一个按步骤核对资料来源的技能'); await button('生成草稿')
      await button('预览'); assert.ok(await js('document.querySelector(".creator-rendered").textContent.includes("工作流程")'))
      await capture('skill-preview')
      await button('安装到本机')
      const skills = await js('window.navora.skills.list()')
      assert.equal(skills[0].name,'generated-skill')
      await button('源码'); await text('.creator-code',creatorTemplate('skill','research')['SKILL.md']!); await button('更新')
      assert.equal((await js('window.navora.skills.list()')).length,1,'Updating a skill retains its installed identity')
      for(const width of [960,650,390]) {
        win.setContentSize(width,844); await wait(180)
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true,'Creator fits narrow viewport')
        assert.equal(await js(`(()=>{const el=document.querySelector('.creator-back'),r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el})()`),true,'Native caption never blocks creator navigation')
        await capture('creator-width-'+width)
      }
      win.setContentSize(1440,900); await wait(150)
      await click('[aria-label="退出创建器"]')
      await click('.sidebar-settings-btn')
      await js("[...document.querySelectorAll('.settings-navigation .nav-label')].find(el=>el.textContent.trim()==='插件').closest('button').click()")
      assert.equal(await js('document.querySelectorAll(".settings-workspace .plugin-library,.settings-workspace .plugin-import-trigger,.settings-workspace .launch-plugin-creator").length'),0,'Settings contains only plugin behavior switches')
      assert.equal(await js('document.querySelector("[aria-label=插件开发模式]").checkVisibility()'),true)
      await click('[data-panel="plugins"]');await wait(250)
      await click('[aria-label="创建插件"]');await wait(250)
      assert.equal(await js('!!document.querySelector(".creator-workspace")'),true,'Plugin management opens the existing workbench')
      await click('[aria-label="退出创建器"]')
      assert.equal(await js('document.querySelector(".plugin-workspace").checkVisibility()'),true,'Closing returns to plugin management')
      await click('[aria-label="管理已安装插件"]')
      // Populate a mixed library through the real plugin loader.
      for (const item of [
        {id:'library-active',name:'资料整理',enabled:true},
        {id:'library-disabled',name:'文本归档',enabled:false},
        {id:'library-broken',name:'需要修复的插件',enabled:true,broken:true},
        {id:'library-bundled',name:'随附助手',enabled:true,bundled:true},
        {id:'library-long',name:'用于检查长名称和多工具排版的插件示例',enabled:true},
      ]) {
        const directory=path.join(root,'plugins',item.id)
        fs.mkdirSync(directory,{recursive:true})
        fs.writeFileSync(path.join(directory,'plugin.json'),JSON.stringify({id:item.id,name:item.name,description:'整理页面与本地文本，提供清晰可核对的结果。',version:'1.2.3',defaultEnabled:item.enabled,bundled:item.bundled}))
        fs.writeFileSync(path.join(directory,'main.cjs'),item.broken?'module.exports = {':creatorTemplate('plugin')['main.cjs']!.replaceAll('my_plugin_text',item.id.replaceAll('-','_')+'_text'))
        fs.writeFileSync(path.join(directory,'README.md'),'# '+item.name+'\n\n插件说明内容。')
      }
      await js('window.navora.plugins.reload()'); await wait(250)
      assert.equal(await js('document.querySelectorAll(".plugin-library-row").length'),6)
      assert.equal(await js('document.querySelectorAll(".plugin-library-details").length'),0,'Library details start folded')
      await capture('plugin-library')
      await text('.plugin-library [aria-label="搜索插件"]','LIBRARY ACTIVE')
      assert.equal(await js('document.querySelectorAll(".plugin-library-row").length'),1,'Search combines ID and tool tokens')
      await click('.plugin-library [aria-label="清空插件搜索"]')
      await js("document.querySelector('[aria-label=\"插件来源\"]').value='creator';document.querySelector('[aria-label=\"插件来源\"]').dispatchEvent(new Event('change',{bubbles:true}))")
      assert.equal(await js('document.querySelectorAll(".plugin-library-row").length'),1,'Creator installs have a distinct source filter')
      await js("document.querySelector('[aria-label=\"插件来源\"]').value='all';document.querySelector('[aria-label=\"插件来源\"]').dispatchEvent(new Event('change',{bubbles:true}))")
      await click('[data-plugin-id="library-broken"] .plugin-disclosure')
      assert.ok(await js('document.querySelector(".plugin-error-detail pre").textContent.length>0'),'Load errors remain inspectable')
      await click('[data-plugin-id="library-broken"] .plugin-enable')
      assert.equal(await js('document.querySelector("[data-plugin-id=library-broken] .plugin-enable").checked'),false,'An enabled broken plugin can be disabled')
      await click('.library-title-row [aria-label="批量操作"]')
      await text('.plugin-library [aria-label="搜索插件"]','library active')
      await js("[...document.querySelectorAll('.plugin-batch-toolbar button')].find(button=>button.textContent.includes('全选当前结果')).click()")
      assert.equal(await js('document.querySelectorAll(".plugin-batch-checkbox:checked").length'),1,'Batch selection only selects current results')
      await text('.plugin-library [aria-label="搜索插件"]','library')
      await js("[...document.querySelectorAll('.plugin-batch-toolbar button')].find(button=>button.textContent.includes('全选当前结果')).click()")
      assert.equal(await js('document.querySelector("[data-plugin-id=library-bundled] .plugin-batch-checkbox").checked'),false,'Bundled plugins cannot be selected for uninstall')
      await text('.plugin-library [aria-label="搜索插件"]','library disabled')
      assert.ok(await js('document.querySelector(".plugin-batch-toolbar > span").textContent.includes("筛选外")'),'Hidden selections are disclosed')
      await click('.library-title-row .library-text-button')
      await text('.plugin-library [aria-label="搜索插件"]','不存在的插件')
      assert.ok(await js('document.querySelector(".library-empty").textContent.includes("没有匹配")'))
      await click('.library-empty .library-text-button')
      for(const width of [960,650,390]) {
        win.setContentSize(width,844);await wait(150)
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true,'Plugin library fits the viewport')
        await capture('plugin-library-width-'+width)
      }
      win.setContentSize(1440,900);await wait(150)
      const originalList = PluginStore.prototype.list
      try {
        PluginStore.prototype.list = function () { throw new Error('fixture-list-unavailable') }
        await click('[aria-label="刷新插件"]')
        assert.ok(await js('document.querySelector(".library-load-error")?.textContent.includes("已保留现有内容")'),'Load failure is visible')
        assert.equal(await js('document.querySelectorAll(".plugin-library-row").length'),6,'Cached plugins survive a load failure')
      } finally { PluginStore.prototype.list = originalList }
      await click('.library-load-error button')
      assert.equal(await js('!!document.querySelector(".library-load-error")'),false,'Retry recovers the plugin list')
      let liveCreator = false
      if (process.env.NAVORA_LIVE_CREATOR === '1') {
        const keyPath = process.env.NAVORA_LIVE_KEY_FILE
        if (!keyPath) throw new Error('Live creator requires a local key file')
        const cloud = addProviderFromPresetId('cloudbypass',[])!
        new SecretsStore(root).set(cloud.api_key_ref, fs.readFileSync(keyPath,'utf8').trim())
        await js(`(async()=>{const cfg=await window.navora.config.get();cfg.ai.providers.push(${JSON.stringify(cloud)});cfg.ai.default_provider=${JSON.stringify(cloud.id)};await window.navora.config.save({ai:cfg.ai})})()`)
        await click('.plugin-back')
        await open('plugin'); await button('新建')
        await text('[aria-label="创建需求"]','创建一个纯本地文本插件，id 为 live-text-helper，工具返回输入字符串的倒序和字符数量，使用 compute.local 权限，不使用网络或文件。请编写完整实现和中文说明。')
        await button('生成草稿')
        for(let n=0;n<400;n++) { if(await js('!document.querySelector(".creator-stop")')) break; await wait(150) }
        assert.equal(await js('!!document.querySelector(".creator-error")'),false,'Live model generation succeeds')
        assert.equal(await js('document.querySelector(".creator-validation-title")?.textContent.includes("校验通过")'),true,'Real model produces a valid plugin draft')
        await button('安装到本机')
        const actual = await js('(async()=>{return (await window.navora.plugins.list()).find(p=>p.id==="live-text-helper")})()')
        assert.ok(actual?.tools.length && !actual.error,'Real generated plugin loads with its runtime contract')
        liveCreator = true; await capture('live-generated-plugin')
      }
      assert.deepEqual(errors,[],'No renderer errors or missing icons')
      if(reduced) { await wait(300); assert.equal(await js('document.getAnimations().filter(a=>a.playState==="running").length'),0) }
      fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,reduced,generationCount,liveCreator,checks:['composer-entry','settings-entry','templates','draft-persistence','invalid-source','generation','generation-cancel','isolated-trial','trial-tool-execution','plugin-install-update','skill-install-update','export','narrow-layout','plugin-library-search','plugin-library-source','plugin-library-errors','plugin-library-filtered-batch','plugin-library-narrow-layout']},null,2))
      console.log(JSON.stringify({ok:true,reduced,generationCount,liveCreator}))
      server.closeAllConnections(); server.close(); app.exit(0)
    } catch(error) { console.error(error); await capture('failure'); server.closeAllConnections(); server.close(); app.exit(1) }
  })())
})
void import('../electron/main')
