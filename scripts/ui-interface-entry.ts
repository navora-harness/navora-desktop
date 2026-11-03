import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../shared/config'
import { addProviderFromPresetId } from '../shared/model-providers'
import { version as productVersion } from '../package.json'

const root = process.env.NAVORA_DATA_ROOT!, output = process.env.NAVORA_UI_OUTPUT!
const reduced = process.env.NAVORA_UI_REDUCED_MOTION === '1'
if (reduced) app.commandLine.appendSwitch('force-prefers-reduced-motion', '1')
const config = createDefaultConfig()
config.app.onboarding_completed = true
config.remote.enabled = false
const provider = addProviderFromPresetId('cloudbypass', config.ai.providers)!
config.ai.providers.push(provider)
config.ai.default_provider = provider.id
fs.writeFileSync(path.join(root, 'config.yml'), JSON.stringify(config))
app.setPath('userData', root)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let started = false
app.on('browser-window-created', (_, win) => {
  if (started) return
  started = true
  win.webContents.setBackgroundThrottling(false)
  if (win.webContents.isOffscreen()) { win.webContents.setFrameRate(60); win.webContents.on('paint', () => {}) }
  const errors: string[] = [], checks: string[] = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load', () => void (async () => {
    const js = async (code: string): Promise<any> => {
      const result = await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).catch(e=>({__failure:String(e)}))`)
      if (result?.__failure) throw new Error(result.__failure)
      return result
    }
    const until = async (code: string) => {
      for (let i = 0; i < 60; i++) { if (await js(code)) return; await wait(60) }
      throw new Error('Timed out: ' + code)
    }
    const click = async (selector: string) => {
      await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click()})()`)
      await wait(100)
    }
    const tab = async (label: string) => {
      await js(`[...document.querySelectorAll('.settings-navigation .nav-label')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).closest('button').click()`)
      await wait(80)
    }
    const capture = async (name: string) => { await wait(350); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG()) }
    const fits = async (selector: string) => {
      const size = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {width:e.clientWidth,scroll:e.scrollWidth,left:r.left,right:r.right,viewport:innerWidth}})()`)
      assert.ok(size.scroll <= size.width + 2, selector + ' overflows: ' + JSON.stringify(size))
      assert.ok(size.left >= -1 && size.right <= size.viewport + 1, selector + ' outside viewport: ' + JSON.stringify(size))
    }
    const dialogFits = async (card: string, body: string, footer: string) => {
      const boxes = await js(`(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {card:box(${JSON.stringify(card)}),body:box(${JSON.stringify(body)}),footer:box(${JSON.stringify(footer)}),height:innerHeight}})()`)
      assert.ok(boxes.card.top >= -1 && boxes.card.bottom <= boxes.height + 1, 'Dialog fits short viewport: ' + JSON.stringify(boxes))
      assert.ok(boxes.body.height > 40 && boxes.footer.top >= boxes.body.bottom - 2 && boxes.footer.bottom <= boxes.height + 1, 'Actions remain accessible: ' + JSON.stringify(boxes))
      await fits(card)
    }
    try {
      await until('!!document.querySelector(".composer")')
      assert.equal(await js('window.navora.app.info().then(info=>info.version)'), productVersion, 'Application version uses Navora package metadata')
      checks.push('product-version')
      win.setMinimumSize(0, 0); win.setContentSize(1440, 900); await wait(180)
      await js(`(()=>{const f=document.querySelector('.composer-input textarea');f.focus();f.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true,clientX:innerWidth-12,clientY:innerHeight-12}))})()`)
      await until('!!document.querySelector(".sidebar-ctx-panel")')
      win.setContentSize(390, 350); await wait(180)
      await until(`(()=>{const r=document.querySelector('.sidebar-ctx-panel').getBoundingClientRect();return r.left>=8&&r.top>=8&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7})()`)
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))`)
      assert.equal(await js(`document.activeElement.textContent.trim()`), '全选', 'Context menu supports keyboard navigation after resize')
      await capture('context-menu-resized')
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
      await until('!document.querySelector(".sidebar-ctx-panel")')
      assert.equal(await js(`document.activeElement.matches('.composer-input textarea')`),true,'Context menu restores input focus')
      checks.push('context-menu-resize-and-focus')
      win.setContentSize(1440, 900); await wait(150)
      await click('.sidebar-settings-btn'); await until('!!document.querySelector(".settings-workspace .content")')
      for (const width of [320, 420, 640]) {
        await js(`void Object.assign(document.querySelector('.settings-workspace').style,{width:'${width}px',maxWidth:'${width}px',flex:'0 0 ${width}px'})`)
        for (const label of ['基本', '模型', '浏览器', '工作区', '技能', '插件', '远程访问', '权限', '询问/决策', '子对话', '关于']) {
          await tab(label); await fits('.settings-workspace .content')
          const header = await js(`(()=>{const b=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {page:b('.settings-workspace'),title:b('.settings-workspace .top-left'),actions:b('.settings-workspace .top-actions')}})()`)
          assert.ok(header.actions.right <= header.page.right + 1 && header.actions.left >= header.page.left - 1, 'Settings actions fit pane: ' + JSON.stringify(header))
          assert.ok(header.actions.top >= header.title.bottom - 1 || header.actions.left >= header.title.right - 1, 'Header groups never overlap: ' + JSON.stringify(header))
          checks.push(`settings-${width}-${label}`)
          if (label === '模型') await capture(`settings-pane-${width}`)
        }
      }
      await js(`document.querySelector('.settings-workspace').removeAttribute('style')`)
      win.setContentSize(1280, 480); await wait(120); await tab('技能')
      await js(`[...document.querySelectorAll('.settings-workspace button')].find(b=>b.textContent.trim()==='新建技能').click()`)
      await until('!!document.querySelector(".skill-dlg-card")')
      await dialogFits('.skill-dlg-card', '.skill-dlg-body', '.skill-dlg-actions'); await capture('skill-short-desktop'); checks.push('skill-short-desktop')
      win.setContentSize(390, 480); await wait(150)
      await dialogFits('.skill-dlg-card', '.skill-dlg-body', '.skill-dlg-actions'); await capture('skill-short-mobile'); checks.push('skill-short-mobile')
      await click('.skill-dlg-close'); await until('!document.querySelector(".skill-dlg-card")')
      await click('.nav-guide'); await until('!!document.querySelector(".ob-card")')
      for (let step = 0; step < 4; step++) {
        await dialogFits('.ob-card', '.ob-body', '.ob-foot')
        await capture('onboarding-short-' + step); checks.push('onboarding-short-' + step)
        if (step < 3) await js(`[...document.querySelectorAll('.ob-foot button')].find(b=>b.textContent.trim()==='下一步').click()`)
        await wait(100)
      }
      await click('.ob-skip'); await wait(150); await click('.settings-close')
      win.setContentSize(1440, 900); await wait(130)
      await click('.sidebar-foot button[title="更多"]')
      await js(`[...document.querySelectorAll('.sidebar-more-item')].find(b=>b.textContent.trim()==='使用文档').click()`)
      await until('!!document.querySelector(".docs-page")')
      win.setContentSize(390, 480); await wait(150)
      const count = await js(`document.querySelectorAll('.docs-page .nav-item').length`)
      for (let i = 0; i < count; i++) {
        await js(`document.querySelectorAll('.docs-page .nav-item')[${i}].click()`)
        await wait(20)
        await fits('.docs-page'); await fits('.docs-page .content')
        const active = await js(`(()=>{const a=document.querySelector('.docs-page [aria-current="page"]').getBoundingClientRect(),n=document.querySelector('.docs-page .nav-list').getBoundingClientRect();return {left:a.left,right:a.right,navLeft:n.left,navRight:n.right,scroll:document.querySelector('.docs-page .content').scrollTop}})()`)
        assert.ok(active.left >= active.navLeft - 1 && active.right <= active.navRight + 1, 'Active documentation item remains visible: ' + JSON.stringify(active))
        assert.equal(active.scroll, 0, 'Documentation sections begin at the top')
        const nav = await js(`(()=>{const r=document.querySelector('.docs-page .nav').getBoundingClientRect();return {height:r.height,width:r.width}})()`)
        assert.ok(nav.height <= 65, 'Documentation navigation stays one row: ' + JSON.stringify(nav))
      }
      await capture('docs-short-mobile'); checks.push('docs-navigation-and-sections')
      await click('.docs-page .close-btn'); await wait(100)
      win.setContentSize(1440, 900); await wait(120)
      await click('[data-panel="plugins"]'); await until('!!document.querySelector(".plugin-workspace")')
      for (const width of [320, 420, 640]) {
        await js(`void Object.assign(document.querySelector('.plugin-workspace').style,{width:'${width}px',maxWidth:'${width}px',flex:'0 0 ${width}px'})`)
        await wait(80); await fits('.plugin-workspace'); await fits('.plugin-workspace-head')
        const geometry = await js(`(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {title:box('.plugin-page-identity'),header:box('.plugin-workspace-head')}})()`)
        assert.ok(geometry.title.left >= geometry.header.left - 1 && geometry.title.right <= geometry.header.right + 1, 'Plugin identity fits its header: ' + JSON.stringify(geometry))
        await capture('plugin-pane-' + width); checks.push('plugin-pane-' + width)
      }
      await js(`document.querySelector('.plugin-workspace').removeAttribute('style')`)
      await click('[aria-label="创建插件"]'); await until('!!document.querySelector(".creator-workspace")')
      await js(`[...document.querySelectorAll('.creator-workspace button')].find(b=>b.textContent.trim()==='从模板开始').click()`)
      await until('!!document.querySelector(".creator-code")')
      for (const width of [320, 420, 640]) {
        await js(`void Object.assign(document.querySelector('.creator-workspace').style,{width:'${width}px',maxWidth:'${width}px',flex:'0 0 ${width}px'})`)
        await wait(80); await fits('.creator-workspace'); await fits('.creator-header'); await fits('.creator-generation'); await fits('.creator-footer')
        await capture('creator-pane-' + width); checks.push('creator-pane-' + width)
      }
      await js(`document.querySelector('.creator-workspace').removeAttribute('style')`)
      win.setContentSize(390, 480); await wait(140)
      assert.ok(await js(`(()=>{const p=document.querySelector('.creator-editor-area');p.scrollTop=p.scrollHeight;const r=p.querySelector('.creator-footer-actions').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0})()`), 'Creator actions reachable in short viewport')
      await capture('creator-short-mobile'); checks.push('creator-short-mobile')
      await click('[aria-label="退出创建器"]')
      // Only remote HTTP/WS transports are fixtures; these are the actual routed product pages.
      await js(`(()=>{
        window.__remoteRows=Array.from({length:40},(_,i)=>({windowId:'fixture-'+i,title:'窗口 '+i+' '+('Long browser title '.repeat(8)),url:'https://example.test/'+('long-path/'.repeat(12))+i,visible:false,loading:i===0}));
        const original=window.fetch.bind(window);window.__loginCalls=0;
        window.fetch=(url,opts)=>{
          if(url==='/api/windows')return Promise.resolve(new Response(JSON.stringify({windows:window.__remoteRows}),{status:200}));
          if(url==='/api/auth/me')return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200}));
          if(url==='/api/login'){window.__loginCalls++;return Promise.resolve(new Response(JSON.stringify({ok:false}),{status:401}))}
          return original(url,opts)
        };
        localStorage.removeItem('navora_remote_token');location.hash='#/login';
      })()`)
      await until('!!document.querySelector(".login-page")')
      win.setContentSize(320, 320); await wait(120); await fits('.login-page')
      assert.ok(await js(`(()=>{const p=document.querySelector('.login-page');p.scrollTop=p.scrollHeight;const r=p.querySelector('.login-btn').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0})()`), 'Login submit reachable in short viewport')
      await js(`document.querySelector('.login-page form').requestSubmit()`); await until('window.__loginCalls===1')
      assert.equal(await js(`document.querySelector('.login-page .v-alert').textContent.includes('用户名或密码错误')`), true)
      await capture('remote-login-short'); checks.push('remote-login-short-scroll-and-submit')
      await js(`localStorage.setItem('navora_remote_token','interface-fixture');location.hash='#/remote'`)
      await until('document.querySelectorAll(".remote-home .win").length===40')
      win.setContentSize(320, 480); await wait(120); await fits('.remote-home')
      assert.ok(await js(`(()=>{const p=document.querySelector('.remote-home');p.scrollTop=p.scrollHeight;const r=p.querySelector('.win:last-child').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0})()`), 'Long remote list reaches last item')
      assert.equal(await js(`document.querySelector('.remote-home').textContent.includes('已隐藏')`), false)
      await capture('remote-list-bottom'); checks.push('remote-list-long-titles-and-scroll')
      await js(`window.__remoteRows=[];document.querySelector('[aria-label="刷新远程页面"]').click()`)
      await until('!!document.querySelector(".remote-home .empty")'); await capture('remote-list-empty')
      await js(`(()=>{
        window.WebSocket=class {
          static OPEN=1;readyState=0;
          constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.({})},10)}
          send(text){const m=JSON.parse(text);if(m.type==='bridge.status')setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'bridge.status',hasWindow:false,detail:'窗口已关闭',title:'远程窗口',url:'https://example.test/'})}),5)}
          close(){this.readyState=3;this.onclose?.({})}
        };location.hash='#/remote/fixture-0'
      })()`)
      await until('document.querySelector(".bridge-page .status")?.textContent.includes("窗口已关闭")')
      await fits('.bridge-page'); await fits('.bridge-page .toolbar')
      assert.equal(await js(`document.querySelectorAll('.bridge-page .tool-btn[aria-label]').length`), 2)
      await capture('remote-bridge-320'); checks.push('remote-bridge-status-and-controls')
      assert.deepEqual(errors, [], 'No renderer errors')
      fs.writeFileSync(path.join(output, 'completed.json'), JSON.stringify({ok:true,reduced,checks}, null, 2))
      console.log(JSON.stringify({ok:true,reduced,checks:checks.length})); app.exit(0)
    } catch (error) { console.error(error); await capture('failure'); app.exit(1) }
  })())
})
void import('../electron/main')
