// Launch only the new win-unpacked application, with its own temporary profile.
// Neither installer nor the installed user's application/profile is invoked.
// Inspector bootstrap changes window placement only, before application code runs.
// node scripts/packaged-startup-smoke.mjs --version 0.3.36
// Add --questionnaire-preview to capture a synthetic questionnaire in the real packaged app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const questionnairePreview = args.includes('--questionnaire-preview')
assert.ok(args.length === 2 || (args.length === 3 && args[2] === '--questionnaire-preview'), 'Usage: --version <release-version> [--questionnaire-preview]')
assert.equal(args[0], '--version'); assert.match(args[1], /^\d+\.\d+\.\d+$/)
const version = args[1], output = path.join(project, 'release', `v${version}`)
assert.equal(fs.realpathSync(output).toLowerCase(), output.toLowerCase(), 'Release directory must not be redirected')
const releaseManifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'))
assert.equal(releaseManifest.version, version)
assert.match(releaseManifest.runtimeVersion, /^45\.0\.0-cloudbypass\.\d+$/)
const executable = path.join(output, 'win-unpacked/Navora.exe')
assert.ok(fs.lstatSync(executable).isFile() && !fs.lstatSync(executable).isSymbolicLink())
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-release-startup-'))
fs.writeFileSync(path.join(profile, 'config.yml'), JSON.stringify({ app: { onboarding_completed: true, close_to_tray: false, show_main_on_start: true, ...(questionnairePreview ? { appearance_theme: 'mist', appearance_mode: 'light' } : {}) }, remote: { enabled: false }, ai: { providers: [] } }))
// These records follow shared/questionnaire.ts's versioned disk protocol. They
// are intentionally synthetic, pending, and never submitted: no model is called.
const fixtureChatId = 'release_questionnaire_preview_chat'
const fixtureQuestionnaireId = 'release_questionnaire_preview_form'
let fixtureQuestionnaire
if (questionnairePreview) {
  const now = Date.now(), title = '新项目需求确认'
  fixtureQuestionnaire = {
    id: fixtureQuestionnaireId, chatId: fixtureChatId, chatTitle: title,
    runId: 'release_questionnaire_preview_run', toolCallId: 'release_questionnaire_preview_call',
    schemaRevision: 1, status: 'pending', createdAt: now, updatedAt: now,
    title, description: '开始前，先一起确认项目的方向。你可以集中填写，也可以随时切回聊天讨论。',
    questions: [
      { id: 'name', type: 'text', title: '项目叫什么名字？', required: true, placeholder: '给项目起一个好记的名字' },
      { id: 'platform', type: 'single', title: '优先开发哪个版本？', required: true, allowOther: true, allowUnknown: true, options: [
        { id: 'desktop', label: '桌面应用', description: '适合本地工作与文件协作', recommended: true },
        { id: 'web', label: '网页应用', description: '通过浏览器随时访问' },
      ] },
      { id: 'features', type: 'multi', title: '首版需要哪些能力？', required: true, allowOther: true, allowNote: true, options: [
        { id: 'questionnaire', label: '问卷与批量需求确认' },
        { id: 'draft', label: '填写草稿自动保存' },
        { id: 'export', label: '回答导出与分享' },
      ] },
      { id: 'notifications', type: 'toggle', title: '任务完成后开启提醒？', allowUnknown: true },
      { id: 'days', type: 'number', title: '期望多少天完成首版？', unit: '天', min: 1, max: 365, allowDelegate: true },
      { id: 'notes', type: 'textarea', title: '还有哪些体验要求？', placeholder: '描述你最在意的体验、限制或参考…', allowSkip: true },
    ],
    draft: { revision: 1, updatedAt: now, supplement: '', answers: {
      name: { state: 'answered', value: '灵感工作台' },
      platform: { state: 'answered', value: 'desktop' },
      features: { state: 'answered', value: ['questionnaire', 'draft'] },
      notifications: { state: 'answered', value: true },
      days: { state: 'answered', value: 14 },
    } },
  }
  for (const directory of ['chats', 'questionnaires']) fs.mkdirSync(path.join(profile, directory))
  fs.writeFileSync(path.join(profile, 'questionnaires', fixtureQuestionnaireId + '.json'), JSON.stringify(fixtureQuestionnaire))
  fs.writeFileSync(path.join(profile, 'chats', fixtureChatId + '.json'), JSON.stringify({
    id: fixtureChatId, title, titleLocked: true, createdAt: now, updatedAt: now,
    messages: [
      { id: 'preview_user', role: 'user', content: '我想做一个简便美观的项目工作台，先帮我集中确认需求。', createdAt: now },
      { id: 'preview_assistant', role: 'assistant', content: '我整理了 6 个问题。你可以在右侧问卷中集中回答，填写内容会自动保存。', createdAt: now + 1 },
      { id: 'preview_tool', role: 'tool', content: '等待填写问卷', createdAt: now + 2, meta: { toolName: 'agent_ask_form', toolCallId: fixtureQuestionnaire.toolCallId, questionnaireId: fixtureQuestionnaireId, status: 'running', args: { title } } },
    ],
  }))
}
const env = { ...process.env, NAVORA_DATA_ROOT: profile }
for (const name of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_FILE', 'NODE_OPTIONS']) delete env[name]
const child = spawn(executable, ['--inspect-brk=127.0.0.1:0', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu'], {
  cwd: path.dirname(executable), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let stderr = '', stdout = '', processError, nodeConnection, browserConnection, rendererSession
let forcedTermination = false
const errors = [], connections = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms))
child.stdout.on('data', chunk => { stdout += chunk })
child.stderr.on('data', chunk => { stderr += chunk })
child.once('error', error => { processError = error })
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
const deadline = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill() }, 90000)
async function until(check, label, timeout = 25000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (processError) throw processError
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`Packaged application exited before ${label}: ${stderr}`)
    const result = await check()
    if (result) return result
    await wait(100)
  }
  throw Error(`Timed out: ${label}\n${stderr}`)
}
async function connect(endpoint, label) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname), 'Debugger must bind to loopback')
  const socket = new WebSocket(endpoint), pending = new Map(), events = []
  let sequence = 0
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)), request = pending.get(message.id)
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer)
      message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result)
    } else {
      events.push(message)
      if(message.method === 'Runtime.exceptionThrown') errors.push({ source: label, exception: message.params.exceptionDetails })
    }
  })
  const connection = { socket, pending, events, send(method, params = {}, sessionId) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`${label} ${method} timed out`)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  } }
  connections.push(connection)
  return connection
}
async function evaluate(connection, expression, sessionId) {
  const result = await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
let report = { ok: false, version, isolatedDataRoot: profile, limitation: 'Isolated win-unpacked startup, with inspector-only window placement. Does not test NSIS installation, portable launcher, existing-user migration, physical OS input filtering or cursor compositor visibility.' }
try {
  const nodeEndpoint = await until(() => stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1], 'paused main-process inspector')
  nodeConnection = await connect(nodeEndpoint, 'main')
  await nodeConnection.send('Runtime.enable')
  await nodeConnection.send('Debugger.enable')
  const mainUrlPattern='app\\.asar[\\\\/]dist-electron[\\\\/]main\\.js$'
  const breakpoint=await nodeConnection.send('Debugger.setBreakpointByUrl',{urlRegex:mainUrlPattern,lineNumber:0,columnNumber:0})
  // inspect-brk accepts Runtime.evaluate before Node's own bootstrap is ready.
  // First advance to the packaged entry breakpoint, after initialization but
  // before any application statement can create or show a window.
  await nodeConnection.send('Runtime.runIfWaitingForDebugger')
  let entryFrame
  for(let attempt=0;attempt<8;attempt++){
    const paused=await until(()=>{
      const index=nodeConnection.events.findIndex(event=>event.method==='Debugger.paused')
      return index<0?null:nodeConnection.events.splice(index,1)[0].params
    },'packaged application entry breakpoint')
    const frame=paused.callFrames[0]
    if(paused.hitBreakpoints?.includes(breakpoint.breakpointId)||new RegExp(mainUrlPattern).test(frame.url)){
      entryFrame=frame
      report.bootstrapMainUrl=frame.url||nodeConnection.events.find(event=>event.method==='Debugger.scriptParsed'&&event.params.scriptId===frame.location.scriptId)?.params.url
      report.mainBreakpoint=breakpoint.breakpointId;break
    }
    assert.ok(attempt<7,'Could not stop before the packaged application entry')
    await nodeConnection.send('Debugger.resume')
  }
  await nodeConnection.send('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId})
  const bootstrapResult = await nodeConnection.send('Debugger.evaluateOnCallFrame',{callFrameId:entryFrame.callFrameId,returnByValue:true,expression:`(()=>{
    const electron=process.getBuiltinModule('module').createRequire(${JSON.stringify(executable)})('electron');
    electron.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    electron.app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
    const placedWindows=new WeakSet();
    electron.BrowserWindow.prototype.show=function(){if(!placedWindows.has(this)){placedWindows.add(this);this.setPosition(-8000,-8000)}this.setSkipTaskbar(true);this.showInactive()};
    electron.BrowserWindow.prototype.focus=function(){};
    electron.app.on('browser-window-created',(_event,window)=>{window.setSkipTaskbar(true);window.webContents.setBackgroundThrottling(false)});
    return {dataRoot:process.env.NAVORA_DATA_ROOT,customCursor:typeof electron.webContents.fromId==='function'};
  })()`})
  if(bootstrapResult.exceptionDetails)throw Error(JSON.stringify(bootstrapResult.exceptionDetails))
  const bootstrap=bootstrapResult.result.value
  assert.equal(path.resolve(bootstrap.dataRoot), path.resolve(profile))
  await nodeConnection.send('Debugger.resume')
  const browserEndpoint = await until(() => stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'renderer debugging endpoint')
  browserConnection = await connect(browserEndpoint, 'renderer')
  const target = await until(async () => (await browserConnection.send('Target.getTargets')).targetInfos.find(item => item.type === 'page' && item.url.includes('app.asar/dist/index.html')), 'packaged renderer loaded from app.asar')
  rendererSession = (await browserConnection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
  await browserConnection.send('Runtime.enable', {}, rendererSession)
  await until(() => evaluate(browserConnection, '!!window.navora&&!!document.querySelector(".composer")', rendererSession), 'packaged main interface ready')
  const result = await evaluate(browserConnection, '(async()=>({info:await window.navora.app.info(),nativeUi:await window.navora.nativeUi.capabilities(),config:await window.navora.config.get(),chats:await window.navora.chats.list(),workspace:await window.navora.browser.workspace.state(),bodyLength:document.body.innerText.length}))()', rendererSession)
  assert.equal(result.info.version, version)
  assert.equal(result.nativeUi.distributionVersion, releaseManifest.runtimeVersion, 'Packaged app must retain its custom runtime capability identity after devDependencies are stripped')
  for (const capability of ['menus', 'panels', 'pageInfo']) assert.equal(result.nativeUi[capability], true, `Missing packaged native UI capability: ${capability}`)
  if (['45.0.0-cloudbypass.7', '45.0.0-cloudbypass.8', '45.0.0-cloudbypass.9', '45.0.0-cloudbypass.10', '45.0.0-cloudbypass.11'].includes(releaseManifest.runtimeVersion)) {
    for (const capability of ['menuControls', 'menuAppearance', 'panelItems', 'panelTextarea', 'panelScrollbars']) assert.equal(result.nativeUi[capability], true, `Missing packaged ${releaseManifest.runtimeVersion} capability: ${capability}`)
  }
  assert.equal(path.resolve(result.info.dataRoot), path.resolve(profile), 'Startup must use only its temporary profile')
  assert.equal(result.info.portable, true, 'Explicit isolated data root is active')
  assert.equal(result.config.remote.enabled, false, 'Remote listener remains disabled in the fixture')
  assert.equal(result.config.browser.automation.protect_input, true)
  assert.equal(result.config.browser.automation.show_virtual_cursor, true)
  assert.equal(result.config.browser.automation.cursor_style, 'windows-glow')
  assert.equal(result.config.browser.automation.cursor_scale, 1)
  if (questionnairePreview) {
    assert.deepEqual(result.chats.map(chat => chat.id), [fixtureChatId], 'Preview must load only its exact synthetic chat')
    assert.deepEqual(result.chats[0].messages.map(message => message.id), ['preview_user', 'preview_assistant', 'preview_tool'], 'Preview must load only its exact synthetic messages')
    const questionnaires = await evaluate(browserConnection, 'window.navora.questionnaires.list()', rendererSession)
    assert.equal(questionnaires.length, 1, 'Preview must load only one synthetic questionnaire')
    assert.deepEqual(questionnaires[0], fixtureQuestionnaire, 'Packaged store must accept the exact versioned questionnaire fixture')
  } else {
    assert.ok(result.chats.length <= 1 && result.chats.every(chat => !chat.messages?.length), 'No personal chats loaded')
  }
  assert.ok(result.bodyLength > 20 && result.workspace, 'Main interface and native workspace initialized')
  assert.deepEqual(errors, [], 'No uncaught application exceptions')
  const screenshot = await browserConnection.send('Page.captureScreenshot', { format: 'png' }, rendererSession)
  fs.writeFileSync(path.join(output, 'packaged-startup.png'), Buffer.from(screenshot.data, 'base64'))
  report = { ...report, ok: true, info: result.info, nativeUi: result.nativeUi, bodyLength: result.bodyLength, rendererUrl: target.url, workspaceLoaded: true, automation: result.config.browser.automation, errors }
  if (questionnairePreview) {
    // Resize only the real renderer viewport. Keep application DOM, styles, IPC,
    // and its packaged QuestionnairePanel untouched; screenshots are CDP PNGs.
    await browserConnection.send('Emulation.setDeviceMetricsOverride', { width: 1520, height: 1120, deviceScaleFactor: 1, mobile: false }, rendererSession)
    const render = expression => evaluate(browserConnection, expression, rendererSession)
    await until(() => render(`document.querySelector('.shell')?.dataset.chatId===${JSON.stringify(fixtureChatId)}||!!document.querySelector('.chat-item-title-text')`), 'synthetic chat available')
    await render(`(()=>{if(document.querySelector('.shell')?.dataset.chatId!==${JSON.stringify(fixtureChatId)}){const item=[...document.querySelectorAll('.chat-item-title-text')].find(item=>item.textContent.trim()===${JSON.stringify(fixtureQuestionnaire.title)});if(!item)throw Error('Synthetic preview chat missing');item.closest('.chat-item-main').click()}})()`)
    await until(() => render(`document.querySelector('.shell')?.dataset.chatId===${JSON.stringify(fixtureChatId)}`), 'synthetic chat selected')
    await until(() => render('!!document.querySelector(".questionnaire-pending-dock button")||!!document.querySelector(".questionnaire-panel h1")'), 'pending questionnaire entry')
    await render('document.querySelector(".questionnaire-pending-dock button")?.click()')
    await until(() => render(`document.querySelector('.questionnaire-panel h1')?.textContent===${JSON.stringify(fixtureQuestionnaire.title)}&&document.querySelectorAll('.questionnaire-question').length===6`), 'real packaged questionnaire ready')
    await until(() => render('document.querySelector(".questionnaire-save-status")?.textContent.includes("草稿已保存")'), 'saved preview draft loaded')
    async function capture(name) {
      await render('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
      const image = await browserConnection.send('Page.captureScreenshot', { format: 'png' }, rendererSession)
      fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
    }
    const initialState = await render(`(()=>({name:document.querySelector('[aria-label="项目叫什么名字？"]').value,fieldCount:document.querySelectorAll('.questionnaire-question').length,tabCount:document.querySelectorAll('[data-file-key="questionnaire"]').length,tabLabel:document.querySelector('[data-file-key="questionnaire"] .workspace-tab-label')?.textContent,expanded:document.querySelector('.main').classList.contains('workspace-single')}))()`)
    assert.equal(initialState.name, fixtureQuestionnaire.draft.answers.name.value)
    assert.equal(initialState.fieldCount, 6)
    assert.equal(initialState.tabCount, 1)
    assert.equal(initialState.tabLabel, `问卷: ${fixtureQuestionnaire.title}`, 'Packaged questionnaire tab includes its generated title')
    assert.equal(initialState.expanded, false, 'Preview starts with chat and questionnaire side by side')
    await capture('questionnaire-preview-split.png')
    await render(`document.querySelector('.workspace-expand[aria-label="展开工作区"]').click()`)
    await until(() => render('document.querySelector(".main").classList.contains("workspace-single")'), 'questionnaire workspace expanded')
    await capture('questionnaire-preview.png')
    await render('document.querySelector(".questionnaire-scroll").scrollTop=document.querySelector(".questionnaire-scroll").scrollHeight')
    await capture('questionnaire-preview-details.png')
    const preserved = await render(`window.navora.questionnaires.get(${JSON.stringify(fixtureQuestionnaireId)})`)
    assert.deepEqual(preserved, fixtureQuestionnaire, 'Preview is read-only and leaves the synthetic draft pending')
    assert.deepEqual(errors, [], 'No uncaught application exceptions while rendering the questionnaire')
    report.questionnairePreview = { synthetic: true, modelInvoked: false, personalDataLoaded: false, questionnaireId: fixtureQuestionnaireId, chatId: fixtureChatId, schemaRevision: fixtureQuestionnaire.schemaRevision, questionTypes: fixtureQuestionnaire.questions.map(question => question.type), viewport: { width: 1520, height: 1120 }, screenshots: ['questionnaire-preview-split.png', 'questionnaire-preview.png', 'questionnaire-preview-details.png'], singletonTab: initialState.tabCount === 1, tabLabel: initialState.tabLabel, savedDraftLoaded: true, originalRecordPreserved: true }
  }
  // Detach the Node inspector before quitting so it cannot keep shutdown waiting.
  nodeConnection.socket.close()
  await evaluate(browserConnection, 'window.navora.app.quit()', rendererSession).catch(() => {})
  await Promise.race([exited, wait(5000)])
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  for (const connection of connections) {
    connection.socket.close()
    for (const request of connection.pending.values()) { clearTimeout(request.timer); request.reject(Error('Startup check closed')) }
  }
  if (!processError && child.exitCode === null && child.signalCode === null) { forcedTermination = true; child.kill(); await Promise.race([exited, wait(5000)]) }
  fs.writeFileSync(path.join(output, 'startup-stdout.log'), stdout)
  fs.writeFileSync(path.join(output, 'startup-stderr.log'), stderr)
  report.processExited = !!processError || child.exitCode !== null || child.signalCode !== null
  report.shutdown = { forcedTermination, exitCode: child.exitCode, signal: child.signalCode }
  if (!report.processExited || forcedTermination || (!processError && child.exitCode !== 0)) {
    report.ok = false
    report.shutdownError = !report.processExited ? 'Isolated application did not exit after its own termination request' : forcedTermination ? 'Isolated application required forced termination' : 'Isolated application exited with a nonzero code or signal'
    process.exitCode = 1
  }
  if (report.processExited) {
    try {
      const tempRoot = fs.realpathSync(os.tmpdir()), resolved = fs.realpathSync(profile)
      assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase(), 'Cleanup target must be directly under system temp')
      assert.ok(path.basename(resolved).startsWith('navora-release-startup-'), 'Cleanup target must be this fixture profile')
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      report.profileRemoved = true
    } catch (error) {
      report.profileCleanupError = error instanceof Error ? error.message : String(error)
      report.ok = false; process.exitCode = 1
    }
  }
  fs.writeFileSync(path.join(output, 'startup-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
