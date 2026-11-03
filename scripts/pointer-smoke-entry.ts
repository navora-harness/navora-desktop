import {app, BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import {executeAgentTool, type ToolExecContext} from '../electron/modules/browser-tools'
import {createDefaultConfig} from '../shared/config'
import {requiresBrowserObservation} from '../shared/browser-tool-policy'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'

const root = process.env.NAVORA_POINTER_SMOKE_ROOT!
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    if (await check()) return
    await pause(10)
  }
  assert.fail(message)
}
const fixture = (framed: boolean) => `<!doctype html><meta charset="utf-8"><title>Pointer fixture</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}button{position:absolute;left:280px;top:80px;width:120px;height:60px}#drag{position:absolute;left:50px;top:210px;width:80px;height:60px;background:teal;touch-action:none;user-select:none}iframe{position:absolute;left:430px;top:80px;width:420px;height:400px;border:3px solid black}</style>
<button id="${framed ? 'frame-button' : 'main-button'}">Click fixture</button><div id="drag">Drag fixture</div>
${framed ? '' : '<iframe id="child-frame" src="/frame"></iframe>'}
<script>
window.pointerFixture={events:[],clicks:0,dragEnds:0,dragMoves:[],dragDelta:null,errors:[],captureRequests:[]};
const state=window.pointerFixture;
addEventListener('error',e=>state.errors.push(e.message));
for(const type of ['pointermove','pointerdown','pointerup','pointercancel','dragstart','gotpointercapture','lostpointercapture','mousemove','mousedown','mouseup','click']){
 document.addEventListener(type,e=>state.events.push({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons,trusted:e.isTrusted,time:e.timeStamp,id:e.target.id,pointerId:e.pointerId,captured:document.querySelector('#drag').hasPointerCapture(e.pointerId)}),true);
}
document.querySelector('button').addEventListener('click',()=>state.clicks++);
let dragging=null;
const drag=document.querySelector('#drag');
drag.addEventListener('pointerdown',e=>{e.preventDefault();dragging={x:e.clientX,y:e.clientY};state.dragMoves=[];drag.setPointerCapture(e.pointerId);state.captureRequests.push({pointerId:e.pointerId,captured:drag.hasPointerCapture(e.pointerId)})});
document.addEventListener('pointermove',e=>{if(!dragging)return;state.dragMoves.push(e.buttons);state.dragDelta={x:e.clientX-dragging.x,y:e.clientY-dragging.y};drag.style.transform='translate('+state.dragDelta.x+'px,'+state.dragDelta.y+'px)'});
document.addEventListener('pointerup',()=>{if(dragging)state.dragEnds++;dragging=null});
</script>`

void app.whenReady().then(async () => {
  let win: BrowserWindow | undefined
  let captureWin: BrowserWindow | undefined
  let server: http.Server | undefined
  try {
    // This custom package currently retains the upstream beta version in process.versions.
    assert.equal(process.env.NAVORA_POINTER_SMOKE_RELEASE, '45.0.0-cloudbypass.5', 'Use the new customized Electron package')
    assert.ok(process.versions.electron.startsWith('45.'), 'Use an Electron 45 runtime')
    server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(fixture(request.url === '/frame'))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    win = new BrowserWindow({show: false, width: 1000, height: 760, webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    }})
    const wc = win.webContents
    const api = wc as unknown as {dispatchInputSequence: (...args: any[]) => Promise<any>}
    assert.equal(typeof api.dispatchInputSequence, 'function', 'Native input sequence is available')
    const nativeDispatch = api.dispatchInputSequence.bind(wc)
    const batches: any[][] = []
    api.dispatchInputSequence = (...args) => {
      batches.push(args)
      return nativeDispatch(...args)
    }
    const config = createDefaultConfig()
    Object.assign(win, {activeOperations: 0, manager: {flushLayout() {}}})
    const record = {windowId: 'window', win}
    config.browser.wait.load = false
    config.browser.wait.network_idle = false
    config.browser.wait.delay_ms = 0
    config.browser.action_timeout_ms = 3000
    const normal = new AbortController()
    const context = (signal = normal.signal) => ({
      chatId: 'pointer-fixture', signal, getConfig: () => config,
      registry: {
        assertWindowOwned(chatId: string, windowId: string) {
          assert.equal(chatId, 'pointer-fixture'); assert.equal(windowId, 'window'); return record
        }, getTree() { return [] }, getWindowRecord() { return record },
      }, gate: {async check() { return {ok: true} }},
    }) as unknown as ToolExecContext
    const call = async (name: string, args: Record<string, unknown>, signal = normal.signal) => {
      if (requiresBrowserObservation(name) && !signal.aborted) {
        const observed = await executeAgentTool('browser_get', {windowId: 'window', what: 'text', waitUntil: 'none'}, context(signal)) as {ok?: boolean}
        assert.equal(observed.ok, true, 'A normal new input observes the current document first')
      }
      const result = await executeAgentTool(name, {windowId: 'window', waitUntil: 'none', ...args}, context(signal)) as Record<string, any>
      console.log(`[pointer-smoke] ${name} ${String(args.action || '')} ${JSON.stringify(result)}`)
      return result
    }
    const mouse = (args: Record<string, unknown>, signal = normal.signal) => call('browser_mouse', args, signal)
    const state = () => wc.executeJavaScript('structuredClone(window.pointerFixture)') as Promise<any>
    const reset = () => wc.executeJavaScript('window.pointerFixture.events=[]')
    const assertSequence = (result: Record<string, any>) => {
      assert.equal(result.ok, true)
      assert.ok(['dispatchInputSequence', 'dispatchInputSequence+target_clickSelector'].includes(result.method))
      assert.equal((result.dispatch ?? result).status, 'completed')
      assert.ok(result.plannedSteps >= 1, 'Tool returns the planned step count')
    }
    await win.loadURL(`http://127.0.0.1:${(server.address() as {port: number}).port}/`)
    await wc.capturePage(undefined, {stayHidden: true, stayAwake: true})
    await pause(50)
    assert.equal(win.isVisible(), false, 'All fixtures remain hidden')

    await reset()
    const beforeMove = performance.now()
    const moved = await mouse({action: 'move', from: {x: 20, y: 30}, x: 216.25, y: 132.75,
      motion: {durationMs: 240, speedMultiplier: 1.2, intervalMs: 8, seed: 42}})
    const elapsed = performance.now() - beforeMove
    assertSequence(moved)
    assert.equal(moved.durationMs, 200)
    assert.ok(elapsed >= 150 && elapsed < 2000, `Native timing follows the configured duration (${elapsed} ms)`)
    await until(async () => {
      const last = (await state()).events.filter((event: any) => event.type === 'pointermove').at(-1)
      return last && Math.abs(last.x - 216.25) <= 1 && Math.abs(last.y - 132.75) <= 1
    }, 'The renderer receives the final movement')
    const moveEvents = (await state()).events.filter((event: any) => event.type === 'pointermove')
    assert.ok(moveEvents.length >= 3, 'The page receives intermediate pointer movements')
    assert.ok(moveEvents.every((event: any) => event.trusted && event.buttons === 0))
    assert.ok(Math.abs(moveEvents.at(-1).x - 216.25) <= 1 && Math.abs(moveEvents.at(-1).y - 132.75) <= 1,
      'The final viewport coordinates reach the page')

    const beforeClick = (await state()).clicks
    const countBeforeClick = batches.length
    const clicked = await mouse({action: 'click', from: {x: 216.25, y: 132.75}, x: 340, y: 110,
      motion: {durationMs: 100, intervalMs: 10, seed: 4}})
    assertSequence(clicked)
    assert.equal(batches.length, countBeforeClick + 1, 'Click movement and buttons use one native batch')
    await until(async () => (await state()).clicks === beforeClick + 1, 'Native click changes the actual document')
    assert.equal((await state()).clicks, beforeClick + 1, 'Native click changes the actual document')
    assert.ok((await state()).events.filter((event: any) => event.type === 'click').every((event: any) => event.trusted))

    await reset()
    const dragged = await mouse({action: 'drag', from: {x: 90, y: 240}, x: 260, y: 290,
      motion: {durationMs: 180, intervalMs: 9, seed: 19}})
    assertSequence(dragged)
    try {
      await until(async () => (await state()).dragEnds === 1, 'Native pointerup completes the document drag')
    } catch (error) {
      console.log('[pointer-smoke] failed drag document state', JSON.stringify(await state()))
      throw error
    }
    const dragState = await state()
    console.log('[pointer-smoke] drag document state', JSON.stringify({dragEnds: dragState.dragEnds,
      dragDelta: dragState.dragDelta, dragMoves: dragState.dragMoves, errors: dragState.errors,
      buttons: dragState.events.filter((event: any) => ['pointerdown', 'pointerup', 'pointercancel', 'dragstart', 'gotpointercapture', 'lostpointercapture'].includes(event.type))}))
    assert.equal(dragState.dragEnds, 1, 'Drag completes with a native pointerup')
    assert.deepEqual(dragState.errors, [], 'Drag fixture reports no page errors')
    assert.ok(dragState.dragMoves.length > 2 && dragState.dragMoves.every((buttons: number) => buttons === 1),
      'Every drag movement preserves the held left button')
    assert.ok(Math.abs(dragState.dragDelta.x - 170) < 0.01 && Math.abs(dragState.dragDelta.y - 50) < 0.01,
      'Native dragging updates the actual dragged element')

    // Hidden-window capture is measured separately from document-level dragging.
    // The production path never changes virtual cursor policy to improve a test.
    // Use an independent page: native diagnostic input outside an Agent lease is
    // deliberately treated as user intervention by the production coordinator.
    captureWin = new BrowserWindow({show: false, width: 1000, height: 760, webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    }})
    const captureContents = captureWin.webContents
    await captureWin.loadURL(`http://127.0.0.1:${(server.address() as {port: number}).port}/`)
    await captureContents.capturePage(undefined, {stayHidden: true, stayAwake: true})
    const captureState = () => captureContents.executeJavaScript('structuredClone(window.pointerFixture)') as Promise<any>
    const probeCapture = async (kind: 'legacy' | 'sequence') => {
      await captureContents.executeJavaScript('document.querySelector("#drag").style.transform="";window.pointerFixture.events=[];window.pointerFixture.captureRequests=[]')
      const events = [
        {type: 'mouseMoved', x: 90, y: 240, button: 'none', buttons: 0},
        {type: 'mousePressed', x: 90, y: 240, button: 'left', buttons: 1, clickCount: 1},
        {type: 'mouseMoved', x: 130, y: 250, button: 'none', buttons: 1},
        {type: 'mouseMoved', x: 170, y: 260, button: 'none', buttons: 1},
        {type: 'mouseReleased', x: 170, y: 260, button: 'left', buttons: 0, clickCount: 1},
      ]
      if (kind === 'legacy') {
        const legacy = captureContents as unknown as {dispatchMouseEvent(event: Record<string, unknown>): Promise<unknown>}
        for (const event of events) { await legacy.dispatchMouseEvent(event); await pause(40) }
      } else {
        const result = await (captureContents as unknown as typeof api).dispatchInputSequence(events.map((event, index) => ({...event, kind: 'mouse', atMs: index * 40})))
        assert.equal(result.status, 'completed')
      }
      await pause(40)
      const captured = await captureState()
      return {requested: captured.captureRequests, granted: captured.events.filter((event: any) => event.type === 'gotpointercapture').length,
        cancelled: captured.events.some((event: any) => event.type === 'pointercancel'), errors: captured.errors}
    }
    const captureDiagnostics: Record<string, unknown> = {legacy: await probeCapture('legacy'), sequence: await probeCapture('sequence')}
    const virtual = captureContents as unknown as {setVirtualCursorEnabled?: (enabled: boolean, options?: {blockRealPointer: boolean; blockRealKeyboard: boolean}) => Promise<void>}
    if (virtual.setVirtualCursorEnabled) {
      try {
        await virtual.setVirtualCursorEnabled(true, {blockRealPointer: false, blockRealKeyboard: false})
        captureDiagnostics.virtualSequence = await probeCapture('sequence')
      } finally { await virtual.setVirtualCursorEnabled(false, {blockRealPointer: false, blockRealKeyboard: false}) }
    }
    console.log('[pointer-smoke] hidden pointer capture diagnostics', JSON.stringify(captureDiagnostics))

    // Native target coordinates are relative to the same element, including inside a frame.
    const snapshot = await wc.getAgentSnapshot({maxFrames: 8, maxNodes: 200})
    const mainTarget = snapshot.elements.find(element => element.tagName.toLowerCase() === 'button' && element.target.routingId === wc.mainFrame.routingId)
    const frameTarget = snapshot.elements.find(element => element.tagName.toLowerCase() === 'button' && element.target.routingId !== wc.mainFrame.routingId)
    assert.ok(mainTarget && frameTarget, 'Native snapshot exposes both main and iframe targets')
    for (const [element, framed] of [[mainTarget, false], [frameTarget, true]] as const) {
      const targetStateCode = framed ? 'document.querySelector("iframe").contentWindow.pointerFixture' : 'window.pointerFixture'
      await wc.executeJavaScript(`${targetStateCode}.events=[]`)
      const result = await mouse({action: 'click', target: element.target, from: {x: 2, y: 4}, x: 12.25, y: 14.5,
        motion: {durationMs: 75, intervalMs: 7.5, seed: 9}})
      assertSequence(result)
      await until(() => wc.executeJavaScript(`${targetStateCode}.events.some(event=>event.type==='click')`), 'The target document receives click')
      const targetState = await wc.executeJavaScript(`structuredClone(${targetStateCode})`)
      const lastClick = targetState.events.filter((event: any) => event.type === 'click').at(-1)
      assert.ok(lastClick?.trusted)
      assert.ok(Math.abs(lastClick.x - 292.25) <= 1 && Math.abs(lastClick.y - 94.5) <= 1,
        `Target coordinates remain element local in the ${framed ? 'iframe' : 'main document'}`)
    }

    const nativeRefs = await call('browser_get', {what: 'agent_snapshot', maxFrames: 8, maxNodes: 200})
    const nativeButton = nativeRefs.value.elements.find((element: any) =>
      element.tagName.toLowerCase() === 'button' && element.target.routingId === wc.mainFrame.routingId)
    assert.match(nativeButton.ref, /^n\d+e\d+$/)
    const expectedNativeCenter = await wc.executeJavaScript('(()=>{const r=document.querySelector("#main-button").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()')
    const geometryApi = wc as unknown as {getNodeBoxModel(id: number, options: {scrollIntoView: boolean}): Promise<any>}
    const mainNodeBox = await geometryApi.getNodeBoxModel(nativeButton.target.backendNodeId, {scrollIntoView: true})
    const frameNodeBox = await geometryApi.getNodeBoxModel(frameTarget.target.backendNodeId, {scrollIntoView: true}).catch(error => ({error: String(error)}))
    console.log('[pointer-smoke] native geometry diagnostics', JSON.stringify({
      mainSnapshot: nativeButton.bounds, mainNodeBox, mainDomCenter: expectedNativeCenter,
      frameSnapshot: frameTarget.bounds, frameNodeBox,
    }))
    const beforeNativeHover = batches.length
    const hoveredRef = await call('browser_hover', {ref: nativeButton.ref, motion: {durationMs: 60, intervalMs: 10}})
    assert.equal(hoveredRef.ok, true, 'A host-owned native ref can be hovered')
    assert.equal(batches.length, beforeNativeHover + 1, 'Native ref hover uses the configured timed approach')
    const refApproachEnd = batches.at(-1)![0].at(-1)
    assert.ok(Math.abs(refApproachEnd.x - expectedNativeCenter.x) <= 1 && Math.abs(refApproachEnd.y - expectedNativeCenter.y) <= 1,
      `Native ref approach uses top-level CSS pixels (${JSON.stringify(refApproachEnd)} versus ${JSON.stringify(expectedNativeCenter)})`)
    const beforeNativeClick = batches.length
    const nativeClicked = await call('browser_click', {target: nativeButton.target, motion: {durationMs: 60, intervalMs: 10}})
    assert.equal(nativeClicked.ok, true, 'A default native target click retains native center validation')
    assert.equal(batches.length, beforeNativeClick + 1, 'A default target click includes its timed approach')
    const beforeFrameCenter = batches.length
    const frameClicksBeforeCenter = await wc.executeJavaScript('document.querySelector("iframe").contentWindow.pointerFixture.clicks')
    const frameCentered = await call('browser_click', {target: frameTarget.target, motion: {durationMs: 60, intervalMs: 10}})
    assert.equal(frameCentered.ok, true, 'A frame target keeps its native center click')
    assert.equal(frameCentered.motionApplied, false, 'Unverified frame geometry does not produce a guessed curve')
    assert.equal(batches.length, beforeFrameCenter, 'Frame center click does not reuse scaled snapshot bounds')
    await until(() => wc.executeJavaScript(`document.querySelector("iframe").contentWindow.pointerFixture.clicks===${frameClicksBeforeCenter + 1}`),
      'The iframe center click reaches exactly the intended document')

    wc.setZoomFactor(1.25)
    await wc.capturePage(undefined, {stayHidden: true, stayAwake: true})
    await reset()
    assertSequence(await mouse({action: 'move', from: {x: 30, y: 40}, x: 200.25, y: 160.75,
      motion: {durationMs: 80, intervalMs: 8, seed: 3}}))
    await until(async () => {
      const last = (await state()).events.filter((event: any) => event.type === 'pointermove').at(-1)
      return last && Math.abs(last.x - 200.25) <= 1 && Math.abs(last.y - 160.75) <= 1
    }, 'The zoomed renderer receives the final CSS coordinates')
    const zoomEndpoint = (await state()).events.filter((event: any) => event.type === 'pointermove').at(-1)
    assert.ok(zoomEndpoint && Math.abs(zoomEndpoint.x - 200.25) <= 1 && Math.abs(zoomEndpoint.y - 160.75) <= 1,
      'Viewport coordinates remain CSS pixels at 125% zoom')
    wc.setZoomFactor(1)
    await wc.capturePage(undefined, {stayHidden: true, stayAwake: true})

    const beforeDefault = batches.length
    assertSequence(await call('browser_hover', {selector: '#main-button'}))
    assertSequence(await call('browser_click', {selector: '#main-button'}))
    assert.equal(batches.length, beforeDefault + 2, 'Ordinary Agent hover and click use native trajectories by default')

    const clicksBeforeOverlay = (await state()).clicks
    await wc.executeJavaScript(`window.overlayClicks=0;const overlay=document.createElement('div');overlay.id='pointer-overlay';overlay.style.cssText='position:fixed;left:280px;top:80px;width:120px;height:60px;z-index:9999;background:red';overlay.addEventListener('click',()=>window.overlayClicks++);document.body.append(overlay)`)
    const batchesBeforeOverlay = batches.length
    const obscured = await call('browser_click', {selector: '#main-button', motion: {durationMs: 100, intervalMs: 10}})
    assert.equal(obscured.ok, false, 'An obscured selector is not reported clicked')
    assert.ok(batches.length <= batchesBeforeOverlay + 1, 'Obscured click is never replayed')
    await pause(80)
    assert.equal((await state()).clicks, clicksBeforeOverlay, 'An overlay prevents the original button from being clicked')
    assert.equal(await wc.executeJavaScript('window.overlayClicks'), 0, 'Selector protection never clicks the covering element')
    const beforeFlow = batches.length
    const failedFlow = await call('browser_flow', {
      steps: [{do: 'click', selector: '#main-button', from: {x: 20, y: 30}, motion: {durationMs: 80, intervalMs: 10}}],
      retries: 3, retryDelayMs: 1, maxTotalMs: 3000,
    })
    assert.equal(failedFlow.ok, false)
    assert.equal(batches.length, beforeFlow + 1, 'browser_flow never retries a failed timed input')
    assert.equal(failedFlow.failedResult.status, 'failed', 'Flow preserves the timed failure summary')
    assert.ok(failedFlow.failedResult.movementDispatchedCount > 0, 'Flow preserves partial dispatch evidence')
    assert.equal(await wc.executeJavaScript('window.overlayClicks'), 0, 'Flow never falls back to an unsafe coordinate click')
    await wc.executeJavaScript('document.querySelector("#pointer-overlay").remove()')

    const clicksBeforeRemoval = (await state()).clicks
    await wc.executeJavaScript(`window.replacementClicks=0;document.addEventListener('pointermove',()=>{const original=document.querySelector('#main-button');const replacement=original.cloneNode(true);replacement.addEventListener('click',()=>window.replacementClicks++);original.replaceWith(replacement)},{once:true})`)
    const batchesBeforeRemoval = batches.length
    const removed = await call('browser_click', {selector: '#main-button', from: {x: 20, y: 30}, motion: {durationMs: 160, intervalMs: 10}})
    assert.equal(removed.ok, false, 'A selector target removed during approach is not reported clicked')
    assert.equal(batches.length, batchesBeforeRemoval + 1, 'A stale target never retries against its replacement')
    await pause(80)
    assert.equal((await state()).clicks, clicksBeforeRemoval, 'The removed original button never receives click')
    assert.equal(await wc.executeJavaScript('window.replacementClicks'), 0, 'A replacement at the same coordinates never receives click')

    const cancelling = new AbortController()
    const clicksBeforeCancel = (await state()).clicks
    const replacementClicksBeforeCancel = await wc.executeJavaScript('window.replacementClicks')
    const batchesBeforeCancel = batches.length
    const pending = mouse({action: 'click', from: {x: 20, y: 30}, x: 340, y: 110,
      motion: {durationMs: 400, intervalMs: 10, seed: 100}}, cancelling.signal)
    const cancelTimer = setTimeout(() => cancelling.abort(), 50)
    let cancelled: Record<string, any>
    try { cancelled = await pending } finally { clearTimeout(cancelTimer) }
    assert.equal(cancelled.ok, false, 'Cancellation does not report success')
    assert.equal((cancelled.dispatch ?? cancelled).status, 'cancelled')
    await pause(450)
    assert.equal((await state()).clicks, clicksBeforeCancel, 'Cancellation prevents the future button press')
    assert.equal(await wc.executeJavaScript('window.replacementClicks'), replacementClicksBeforeCancel,
      'A cancelled viewport click never reaches the replacement button')
    assert.equal(batches.length, batchesBeforeCancel + 1, 'A cancelled batch is never replayed through another backend')

    await wc.executeJavaScript('document.querySelector("#drag").style.transform="";window.pointerFixture.events=[]')
    const cancellingDrag = new AbortController()
    const dragPending = mouse({action: 'drag', from: {x: 90, y: 240}, x: 260, y: 290,
      motion: {durationMs: 400, intervalMs: 10, seed: 10}}, cancellingDrag.signal)
    const dragCancelTimer = setTimeout(() => cancellingDrag.abort(), 50)
    let cancelledDrag: Record<string, any>
    try { cancelledDrag = await dragPending } finally { clearTimeout(dragCancelTimer) }
    assert.equal(cancelledDrag.status, 'cancelled')
    const cancelledDragDispatch = cancelledDrag.partialResult ?? cancelledDrag.dispatch ?? cancelledDrag
    assert.equal(cancelledDragDispatch.status, 'cancelled', 'The control error retains the native cancellation result')
    assert.equal(cancelledDragDispatch.cleanup.failed, 0, 'A cancelled drag has no failed native button cleanup')
    assert.equal(cancelledDragDispatch.cleanup.dispatched, 1, 'Cancellation releases exactly its held native button')
    await until(async () => (await state()).events.some((event: any) => event.type === 'pointerup' && event.buttons === 0),
      'The document observes native cancellation releasing the button')
    await reset()
    assertSequence(await mouse({action: 'move', x: 30, y: 40, motion: {durationMs: 50, intervalMs: 10, seed: 2}}))
    await until(async () => (await state()).events.some((event: any) => event.type === 'pointermove'),
      'A fresh movement follows cancellation')
    assert.ok((await state()).events.filter((event: any) => event.type === 'pointermove').every((event: any) => event.buttons === 0),
      'No held button leaks into the next operation')

    // Exercise ownership gates without the normal helper's automatic observation.
    const controller = getBrowserAutomationController(wc)
    const oldIntent = new Map([['window', {webContentsId: wc.id,
      epoch: controller.captureEpoch(), documentEpoch: controller.captureDocumentEpoch()}]])
    const rawMouse = (extraContext: Partial<ToolExecContext> = {}) => executeAgentTool('browser_mouse', {
      windowId: 'window', waitUntil: 'none', action: 'move', x: 60, y: 50,
      motion: {durationMs: 30, intervalMs: 10},
    }, {...context(), ...extraContext}) as Promise<Record<string, any>>
    const beforeGates = batches.length
    assert.equal(controller.needsObservation(), true, 'A completed action closes the next input observation gate')
    assert.equal((await rawMouse()).error, 'browser_observation_required')
    assert.equal(batches.length, beforeGates, 'Missing observation dispatches no input')
    const paused = await controller.pause()
    assert.equal(paused.owner, 'paused')
    assert.equal(paused.inputProtected, false, 'Pause confirms real input is no longer blocked')
    assert.equal(paused.nativeConfirmed, true)
    const pausedRead = await executeAgentTool('browser_get', {windowId: 'window', what: 'text', waitUntil: 'none'}, context()) as Record<string, any>
    assert.equal(pausedRead.ok, true, 'Pause keeps observation available')
    assert.equal(controller.needsObservation(), true, 'A paused read does not authorize future input')
    assert.equal((await rawMouse()).error, 'browser_manual_control')
    await controller.resume()
    assert.equal((await rawMouse()).error, 'browser_observation_required', 'Resume requires a fresh current-owner observation')
    const resumedRead = await executeAgentTool('browser_get', {windowId: 'window', what: 'text', waitUntil: 'none'}, context()) as Record<string, any>
    assert.equal(resumedRead.ok, true)
    assert.equal((await rawMouse({browserIntentEpochs: oldIntent})).error, 'browser_operation_invalidated',
      'Fresh observation never revives an intent captured before pause')
    assert.equal(batches.length, beforeGates, 'Paused, unobserved, and old intents dispatch no input')
    assertSequence(await rawMouse())
    assert.equal(win.isVisible(), false, 'Smoke never presents or focuses a window')
    assert.equal(wc.debugger.isAttached(), false, 'Native pointer movement never attaches the debugger')
    console.log('[pointer-smoke] PASS', JSON.stringify({release: process.env.NAVORA_POINTER_SMOKE_RELEASE, electron: process.versions.electron,
      checks: ['native-capability', 'trusted-intermediate-moves', 'fractional-css-endpoint', 'speed-and-interval',
        'single-batch-click', 'drag-button-state-and-document-update', 'main-and-iframe-local-targets',
        'native-ref-hover-and-css-approach', 'default-native-target-click', 'frame-center-without-guessed-curve', 'zoom', 'agent-default-hover-click', 'obscured-target-protection', 'flow-no-replay', 'stale-target-protection',
        'cancel-without-click-or-replay', 'cancelled-drag-releases-buttons', 'pause-resume-observation-and-stale-intent-gates', 'hidden-window', 'no-debugger'], captureDiagnostics, batches: batches.length}))
  } finally {
    captureWin?.destroy()
    win?.destroy()
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  }
}).then(() => app.exit(0), error => { console.error('[pointer-smoke] FAIL', error); app.exit(1) })
