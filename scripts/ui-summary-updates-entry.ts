import { app, BrowserWindow, webContents } from 'electron'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../shared/config'

const root = process.env.NAVORA_DATA_ROOT!, output = process.env.NAVORA_UI_OUTPUT!
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.setPath('userData', root)
const config = createDefaultConfig(); config.app.onboarding_completed = true; config.remote.enabled = false
config.ai.providers = []
fs.writeFileSync(path.join(root, 'config.yml'), JSON.stringify(config))
const chatA = 'chat_summary_a', chatB = 'chat_summary_b', titleA = '摘要提醒 A', titleB = '摘要提醒 B'
fs.mkdirSync(path.join(root, 'chats'), { recursive: true })
for (const [id, title, updatedAt] of [[chatA, titleA, 3], [chatB, titleB, 2]] as const) {
  fs.mkdirSync(path.join(root, 'workspace', id), { recursive: true })
  fs.writeFileSync(path.join(root, 'workspace', id, 'historical.md'), '# 已有资料\n这是第一次打开时已经存在的文件。')
  fs.writeFileSync(path.join(root, 'chats', `${id}.json`), JSON.stringify({ id, title, createdAt: updatedAt, updatedAt, messages: [{ id: `answer-${id}`, role: 'assistant', content: '已有的聊天记录与文件应作为基线，不显示新资源提示。', createdAt: updatedAt }] }))
}
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8')
  response.end('<title>摘要检查页面</title><h1>本地网页</h1><p>标题与加载状态不应重复提醒。</p>')
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
fs.writeFileSync(path.join(root, 'browser-workspace.json'), JSON.stringify([{ sessionId: 'sess_aaaaaaaaaa', chatId: chatA, sessionIndex: 1, isDefault: true, pages: [{ id: 'win_aaaaaaaaaa', url: `${url}/historical`, muted: true, order: 0 }] }]))
const showInactive = BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show = function () { this.setPosition(-30000, -30000); this.setSkipTaskbar(true); showInactive.call(this) }
BrowserWindow.prototype.focus = function () {}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => Promise<unknown>, label: string) { for (let attempt = 0; attempt < 120; attempt++) { if (await check()) return; await wait(60) } throw Error(`Timed out: ${label}`) }
let started = false
app.on('browser-window-created', (_event, win) => {
  if (started) return
  started = true; win.webContents.setBackgroundThrottling(false)
  const errors: string[] = [], checks: string[] = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load', () => void (async () => {
    const js = (code: string): Promise<any> => win.webContents.executeJavaScript(code)
    const click = async (selector: string) => { await js(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());if(!node)throw Error('Missing visible '+${JSON.stringify(selector)});node.click()})()`); await wait(220) }
    const badge = () => js(`(()=>{const node=[...document.querySelectorAll('[data-chat-resource=resources]')].find(node=>node.checkVisibility());return node?{updated:node.classList.contains('has-updates'),title:node.title,open:node.getAttribute('aria-expanded')==='true',description:node.getAttribute('aria-description')}:null})()`)
    const noBadge = async () => { const state = await badge(); assert.ok(state, 'Summary action is visible'); assert.equal(state.updated, false, JSON.stringify(state)); return state }
    const oneBadge = async () => { const state = await badge(); assert.ok(state?.updated, JSON.stringify(state)); assert.match(state.title, /1 项新资源或更新/); assert.equal(state.open, false); return state }
    const refreshFiles = async (chatId: string) => { const snapshot = await js(`window.navora.workspace.resources(${JSON.stringify(chatId)},true)`); assert.equal(snapshot.ok, true); win.webContents.send('navora:workspace.changed', { chatId }); await wait(360); return snapshot }
    const file = (chatId: string, name: string, content: string) => fs.writeFileSync(path.join(root, 'workspace', chatId, name), content)
    const select = async (title: string) => { await js(`(()=>{const row=[...document.querySelectorAll('.chat-item-main')].find(node=>node.querySelector('.chat-item-title-text')?.textContent===${JSON.stringify(title)});if(!row?.checkVisibility())throw Error('Missing visible chat '+${JSON.stringify(title)});row.click()})()`); await until(() => js(`document.querySelector('.chat-item.active .chat-item-title-text')?.textContent===${JSON.stringify(title)}`), `selected ${title}`); await wait(350) }
    const capture = async (name: string) => { fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()) }
    const acknowledge = async () => { await click('[data-chat-resource=resources]'); await until(() => js('!!document.querySelector("#conversation-summary")?.checkVisibility()'), 'visible summary'); await click('[aria-label="关闭资源面板"]'); await noBadge() }
    try {
      await until(() => js('!!document.querySelector(".composer")'), 'main interface')
      win.setContentSize(1680, 1000); await wait(450)
      await select(titleA)
      assert.equal((await js(`window.navora.browser.tree(${JSON.stringify(chatA)})`))[0].windows[0].url, `${url}/historical`)
      await noBadge(); assert.equal(await js('!!document.querySelector("#conversation-summary")'), false)
      checks.push('historical-files-and-pages-establish-silent-baseline')

      file(chatA, 'new-report.md', '# 新生成文件\n第一次更新。')
      await refreshFiles(chatA); await oneBadge()
      assert.equal(await js('!!document.querySelector("#conversation-summary")'), false, 'New resources must not open the summary')
      checks.push('new-file-adds-one-unread-resource-without-opening-summary')
      await capture('01-file-update-badge')
      for (let index = 0; index < 3; index++) win.webContents.send('navora:workspace.changed', { chatId: chatA })
      await wait(420); await oneBadge()
      checks.push('duplicate-workspace-events-do-not-multiply-unread-count')
      await acknowledge(); checks.push('visible-summary-acknowledges-resources')

      const existing = webContents.getAllWebContents().find(contents => contents.id !== win.webContents.id && (contents.getURL().startsWith(`${url}/historical`) || !contents.getURL() || contents.getURL() === 'about:blank'))!
      assert.ok(existing, 'Restored native page exists: ' + JSON.stringify(webContents.getAllWebContents().map(contents=>({id:contents.id,url:contents.getURL()}))))
      await existing.loadURL(`${url}/historical`)
      await existing.executeJavaScript('document.title="更新的历史标题"')
      await existing.loadURL(`${url}/historical?reload=1`); await wait(420); await noBadge()
      checks.push('existing-page-title-navigation-and-loading-do-not-renotify')
      const before = new Set(webContents.getAllWebContents().map(contents => contents.id))
      await js(`window.navora.browser.createWindow('sess_aaaaaaaaaa',{url:'about:blank',show:false})`)
      const page = webContents.getAllWebContents().find(contents => !before.has(contents.id))!
      assert.ok(page, 'New native page exists'); await wait(300); await noBadge()
      checks.push('empty-start-page-is-not-an-unread-resource')
      await page.loadURL(`${url}/new-page`); await wait(420); await oneBadge()
      assert.equal(await js('!!document.querySelector("#conversation-summary")'), false)
      checks.push('first-real-page-adds-one-unread-resource-without-opening-summary')
      await acknowledge()
      await page.executeJavaScript('document.title="加载完成的新标题"')
      await page.loadURL(`${url}/new-page?reload=1`); await wait(420); await noBadge()
      checks.push('acknowledged-page-metadata-does-not-renotify')

      const oldRevision = (await js(`window.navora.workspace.resources(${JSON.stringify(chatA)})`)).entries.find((entry: any) => entry.path === 'new-report.md').revision
      file(chatA, 'new-report.md', '# 新生成文件\n第二次内容变化，这次长度也发生变化。')
      const changed = await refreshFiles(chatA)
      assert.notEqual(changed.entries.find((entry: any) => entry.path === 'new-report.md').revision, oldRevision)
      await oneBadge(); checks.push('same-file-new-revision-becomes-unread')
      fs.unlinkSync(path.join(root, 'workspace', chatA, 'new-report.md'))
      await refreshFiles(chatA); await noBadge(); checks.push('deleting-an-unread-resource-removes-its-reminder')

      file(chatA, 'later-a.md', '# A 新资源'); await refreshFiles(chatA); await oneBadge()
      await select(titleB); await noBadge()
      file(chatB, 'later-b.md', '# B 新资源'); await refreshFiles(chatB); await oneBadge()
      await select(titleA); await oneBadge()
      await select(titleB); await oneBadge()
      checks.push('each-chat-keeps-its-own-unread-count-across-switches')
      await acknowledge()

      await click('[data-chat-resource=resources]')
      const hiddenPage = await js(`(async()=>{const session=await window.navora.browser.createSession(${JSON.stringify(chatB)},{persist:false});return window.navora.browser.createWindow(session.sessionId,{url:'about:blank',show:true})})()`)
      assert.ok(hiddenPage.windowId)
      await until(() => js('!!document.querySelector(".file-workspace .workspace-expand")?.checkVisibility()'), 'split workspace')
      await click('.file-workspace .workspace-expand')
      await until(() => js('document.querySelector(".main")?.classList.contains("workspace-single")'), 'expanded browser')
      assert.equal(await js('!!document.querySelector("#conversation-summary")'), true, 'Summary remains mounted while hidden by the browser')
      assert.equal(await js('document.querySelector("#conversation-summary").checkVisibility()'), false)
      file(chatB, 'hidden-b.md', '# 摘要不可见期间生成的新资料'); await refreshFiles(chatB)
      await select(titleA); await oneBadge()
      await select(titleB)
      await click('.unified-conversation-tab [role=tab]')
      await until(() => js('document.querySelector(".main")?.classList.contains("workspace-chat-active")'), 'return to chat tab')
      await oneBadge()
      assert.equal(await js('!!document.querySelector("#conversation-summary")'), false)
      checks.push('hidden-mounted-summary-does-not-acknowledge-new-resources')
      await capture('02-hidden-summary-reminder-retained')
      await acknowledge()
      checks.push('returning-and-viewing-summary-clears-only-the-current-chat')
      await select(titleA); await oneBadge()
      assert.deepEqual(errors, [], 'No renderer errors during unread-resource checks')
      fs.writeFileSync(path.join(output, 'completed.json'), JSON.stringify({ ok: true, checks, errors, nativeCompositor: true, scope: 'Isolated real Electron with local files/native pages; workspace change events refresh the real index; no model calls or personal profile.' }, null, 2))
      console.log(JSON.stringify({ ok: true, checks: checks.length, output }))
      app.exit(0)
    } catch (error) {
      await capture('failure').catch(() => {})
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error), checks, errors, badge: await badge().catch(() => null) }, null, 2))
      console.error(error); app.exit(1)
    } finally { server.close() }
  })())
})
await import('../electron/main')
