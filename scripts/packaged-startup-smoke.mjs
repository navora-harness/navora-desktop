// Launch only the new win-unpacked application, with its own temporary profile.
// Neither installer nor the installed user's application/profile is invoked.
// Inspector bootstrap changes window placement only, before application code runs.
// node scripts/packaged-startup-smoke.mjs --version 0.3.36
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
assert.equal(args.length, 2, 'Usage: --version 0.3.36')
assert.equal(args[0], '--version'); assert.match(args[1], /^\d+\.\d+\.\d+$/)
const version = args[1], output = path.join(project, 'release', `v${version}`)
assert.equal(fs.realpathSync(output).toLowerCase(), output.toLowerCase(), 'Release directory must not be redirected')
const executable = path.join(output, 'win-unpacked/Navora.exe')
assert.ok(fs.lstatSync(executable).isFile() && !fs.lstatSync(executable).isSymbolicLink())
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-release-startup-'))
fs.writeFileSync(path.join(profile, 'config.yml'), JSON.stringify({ app: { onboarding_completed: true, close_to_tray: false, show_main_on_start: true }, remote: { enabled: false }, ai: { providers: [] } }))
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
  const result = await evaluate(browserConnection, '(async()=>({info:await window.navora.app.info(),config:await window.navora.config.get(),chats:await window.navora.chats.list(),workspace:await window.navora.browser.workspace.state(),bodyLength:document.body.innerText.length}))()', rendererSession)
  assert.equal(result.info.version, version)
  assert.equal(path.resolve(result.info.dataRoot), path.resolve(profile), 'Startup must use only its temporary profile')
  assert.equal(result.info.portable, true, 'Explicit isolated data root is active')
  assert.equal(result.config.remote.enabled, false, 'Remote listener remains disabled in the fixture')
  assert.equal(result.config.browser.automation.protect_input, true)
  assert.equal(result.config.browser.automation.show_virtual_cursor, true)
  assert.equal(result.config.browser.automation.cursor_style, 'navora-arrow')
  assert.ok(result.chats.length <= 1 && result.chats.every(chat => !chat.messages?.length), 'No personal chats loaded')
  assert.ok(result.bodyLength > 20 && result.workspace, 'Main interface and native workspace initialized')
  assert.deepEqual(errors, [], 'No uncaught application exceptions')
  const screenshot = await browserConnection.send('Page.captureScreenshot', { format: 'png' }, rendererSession)
  fs.writeFileSync(path.join(output, 'packaged-startup.png'), Buffer.from(screenshot.data, 'base64'))
  report = { ...report, ok: true, info: result.info, bodyLength: result.bodyLength, rendererUrl: target.url, workspaceLoaded: true, automation: result.config.browser.automation, errors }
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
