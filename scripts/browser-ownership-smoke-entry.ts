import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getBrowserAutomationController } from '../electron/modules/browser-automation-controller'
import { createBrowserCursorImage, browserCursorSvg } from '../electron/modules/browser-native-cursor'
import { createDefaultBrowserAutomation } from '../shared/browser-automation'
import { browserCapabilities } from '../electron/modules/browser-capabilities'

app.setPath('userData', path.join(process.env.NAVORA_OWNERSHIP_PROFILE!, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const output = process.env.NAVORA_OWNERSHIP_OUTPUT!
const checks: string[] = []
const report: Record<string, unknown> = { checks, limitation: 'Hidden isolated native API fixture. Does not certify physical OS input blocking or native cursor compositor visibility.' }
let win: BrowserWindow | undefined
void app.whenReady().then(async () => {
try {
  win = new BrowserWindow({ show: false, width: 800, height: 500, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><style>body{margin:0}button{position:absolute;left:40px;top:40px;width:160px;height:60px}iframe{position:absolute;left:300px;top:20px;width:260px;height:180px;border:0}</style><button id="target">Native fixture</button><iframe srcdoc="<button style=\'position:absolute;left:10px;top:10px;width:150px;height:70px\' onclick=\'window.clicks=(window.clicks||0)+1\'>Frame fixture</button>"></iframe><script>window.clicks=0;window.trusted=true;document.querySelector("button").onclick=e=>{window.clicks++;window.trusted=window.trusted&&e.isTrusted}</script>'))
  const wc = win.webContents
  await new Promise(resolve => setTimeout(resolve, 150))
  await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
  report.capabilities = browserCapabilities(wc)
  assert.equal(typeof wc.setVirtualCursorImage, 'function')
  assert.equal(typeof wc.setAutomationOptions, 'function')
  assert.equal(typeof wc.getAutomationState, 'function')
  assert.equal(typeof wc.resetAutomationOptions, 'function')
  checks.push('custom-native-cursor-and-guard-api-present')
  const nativeCalls: { options?: Electron.AutomationOptions; reset?: true }[] = []
  const nativeConfigure = wc.setAutomationOptions.bind(wc), nativeReset = wc.resetAutomationOptions.bind(wc)
  wc.setAutomationOptions = async options => {
    nativeCalls.push({ options })
    await nativeConfigure(options)
  }
  wc.resetAutomationOptions = async () => {
    nativeCalls.push({ reset: true })
    await nativeReset()
  }
  const controller = getBrowserAutomationController(wc)
  await controller.claimRun('native-fixture')
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().isolateInput, true)
  assert.equal(controller.snapshot().keepRendering, true)
  assert.equal(controller.snapshot().rendering?.keepAlive, true)
  checks.push('native-acquisition-confirmed-before-task-work')
  await controller.run({ runId: 'native-fixture' }, operation => operation.commit(() => wc.dispatchInputSequence([
    { kind: 'mouse', type: 'mouseMoved', position: {x: 100, y: 65}, atMs: 0 },
    { kind: 'mouse', type: 'mousePressed', position: {x: 100, y: 65}, button: 'left', clickCount: 1, atMs: 20 },
    { kind: 'mouse', type: 'mouseReleased', position: {x: 100, y: 65}, button: 'left', clickCount: 1, atMs: 45 },
  ])))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(await wc.executeJavaScript('window.clicks'), 1)
  assert.equal(await wc.executeJavaScript('window.trusted'), true)
  assert.equal(controller.snapshot().inputProtected, true)
  checks.push('trusted-native-click-operates-while-page-protected', 'protection-retained-after-complete-tool')
  const before = controller.captureEpoch()
  wc.emit('before-mouse-event' as never, {} as never, { type: 'mouseMoved' } as never)
  wc.emit('before-mouse-event' as never, {} as never, { type: 'mouseEnter' } as never)
  assert.equal(controller.captureEpoch(), before)
  assert.equal(controller.snapshot().owner, 'ai')
  checks.push('hover-event-does-not-handoff-between-tools')
  await controller.run({ runId: 'native-fixture' }, operation => operation.commit(() => wc.dispatchInputSequence([
    { kind: 'mouse', type: 'mouseMoved', position: {x: 340, y: 60}, atMs: 0 },
    { kind: 'mouse', type: 'mousePressed', position: {x: 340, y: 60}, button: 'left', clickCount: 1, atMs: 20 },
    { kind: 'mouse', type: 'mouseReleased', position: {x: 340, y: 60}, button: 'left', clickCount: 1, atMs: 45 },
  ])))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(await wc.executeJavaScript('document.querySelector("iframe").contentWindow.clicks'), 1)
  checks.push('protected-task-native-click-routes-into-frame')
  let revision = controller.snapshot().revision ?? 0
  for (const cursor_style of ['navora-arrow', 'focus-ring', 'precision-cross'] as const) {
    const cursor = await createBrowserCursorImage(cursor_style, true)
    assert.equal(cursor.image.isEmpty(), false)
    assert.deepEqual(cursor.image.getScaleFactors(), [1, 1.25, 1.5, 2, 3])
    for (const scaleFactor of cursor.image.getScaleFactors()) assert.ok(cursor.image.toPNG({ scaleFactor }).length > 50)
    fs.writeFileSync(path.join(output, cursor_style + '.png'), cursor.image.toPNG({ scaleFactor: 3 }))
    fs.writeFileSync(path.join(output, cursor_style + '.svg'), browserCursorSvg(cursor_style))
    await controller.applySettings({ ...createDefaultBrowserAutomation(), cursor_style }, ++revision)
    assert.equal(controller.snapshot().cursorStyle, cursor_style)
    assert.equal(controller.snapshot().inputProtected, true)
    checks.push('native-image-five-dpi-representations-and-hotspot-' + cursor_style)
  }
  await controller.applySettings({ ...createDefaultBrowserAutomation(), show_virtual_cursor: false }, ++revision)
  const hidden = await createBrowserCursorImage('navora-arrow', false)
  assert.equal(hidden.image.isEmpty(), false, 'Transparent native bitmap remains a valid image')
  assert.equal(hidden.image.toBitmap().some(Boolean), false)
  assert.equal(controller.snapshot().cursorVisible, false)
  assert.equal(controller.snapshot().cursorEnabled, false)
  assert.equal(controller.snapshot().inputProtected, true)
  assert.equal(controller.snapshot().isolateInput, true)
  assert.equal(controller.snapshot().keepRendering, true)
  assert.ok(nativeCalls.filter(call => call.options).every(({options}) => options!.isolateInput && options!.keepRendering && options!.blockRealPointer && options!.blockRealKeyboard))
  assert.equal(nativeCalls.at(-1)?.options?.virtualCursor?.enabled, false)
  checks.push('cursor-drawing-disabled-with-isolation-rendering-and-input-guards-retained')
  await controller.finishRun('wrong-task')
  assert.equal(controller.snapshot().inputProtected, true)
  checks.push('stale-task-cannot-release-current-native-lease')
  await controller.finishRun('native-fixture')
  assert.equal(controller.snapshot().cursorEnabled, false)
  assert.equal(controller.snapshot().inputProtected, false)
  assert.equal(controller.snapshot().isolateInput, false)
  assert.equal(controller.snapshot().keepRendering, false)
  assert.equal(wc.getAutomationState().inputActive, false)
  assert.equal(nativeCalls.at(-1)?.reset, true)
  checks.push('matching-task-completion-confirmed-native-release')
  await controller.claimRun('next-task')
  const handoff = await controller.takeControl()
  assert.equal(handoff.owner, 'user')
  assert.equal(handoff.nativeConfirmed, true)
  assert.equal(handoff.inputProtected, false)
  checks.push('explicit-host-handoff-confirms-release')
  report.nativeCalls = nativeCalls
  report.ok = true
} catch (error) {
  report.ok = false; report.error = error instanceof Error ? error.stack : String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(output, 'browser-ownership-native.json'), JSON.stringify(report, null, 2))
  win?.destroy()
  console.log(`[browser-ownership] ${checks.length} native checks; ok=${report.ok}`)
  app.exit(report.ok ? 0 : 1)
}
})
