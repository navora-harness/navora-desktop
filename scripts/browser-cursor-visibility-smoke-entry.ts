import {app,BrowserWindow,nativeImage,screen} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import {dispatchPointerMotion} from '../electron/modules/pointer-motion'
import {nativePointerWithReceipt} from '../electron/modules/trusted-pointer-receipt'
import {withBrowserInputOperation} from '../electron/modules/browser-input-context'
import {dispatchTrustedPointer,dispatchTrustedWheelOnce} from '../electron/modules/trusted-input'
import {createDefaultBrowserAutomation} from '../shared/browser-automation'

app.setPath('userData',path.join(process.env.NAVORA_CURSOR_PROFILE!,'profile'))
if(process.env.NAVORA_CURSOR_GPU!=='1')app.commandLine.appendSwitch('disable-gpu')
const scale=process.env.NAVORA_CURSOR_SCALE||'1'
app.commandLine.appendSwitch('force-device-scale-factor',scale)
const output=process.env.NAVORA_CURSOR_OUTPUT!
const checks:string[]=[]
const report:Record<string,unknown>={checks,scale,gpuMode:process.env.NAVORA_CURSOR_GPU==='1'?'default':'disabled',limitation:'Isolated current Windows runtime and forced device scales only. Does not certify other monitors/OS versions or reproduce the original user handoff incident. First closed pointer batch is revealed after acknowledgement.'}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let win:BrowserWindow|undefined
const html='<!doctype html><style>html,body{margin:0;background:white;width:100%;height:100%;overflow:hidden}button{position:absolute;left:240px;top:140px;width:100px;height:70px;background:white;color:white;border:0;outline:none}iframe{position:absolute;left:400px;top:200px;width:120px;height:90px;border:0}</style><button>test</button><iframe srcdoc="<style>body{margin:0;background:white}button{width:100px;height:70px;background:white;color:white;border:0;outline:none}</style><button onclick=\'window.clicked=true\'>test</button>"></iframe><script>window.clicks=0;document.querySelector("button").onclick=e=>{if(e.isTrusted)window.clicks++}</script>'

async function capture(name:string):Promise<Buffer>{
  await sleep(120)
  const rect=screen.dipToScreenRect(win!,win!.getContentBounds())
  const file=path.join(output,`${name}.png`)
  const hwnd=win!.getNativeWindowHandle().readBigUInt64LE().toString()
  const text=await new Promise<string>((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-File',path.join(process.cwd(),'scripts/cursor-window-screen-capture.ps1'),'-ImagePath',file,'-ExpectedHandle',hwnd,'-ExpectedPid',String(process.pid)],{windowsHide:true})
    let stdout='',stderr=''
    child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk})
    const timer=setTimeout(()=>{child.kill();reject(Error('System capture timeout'))},5000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve(stdout.trim()):reject(Error(stderr))})
  })
  assert.equal(text,'captured','Only the verified, unobscured fixture rectangle may be captured')
  report.captureRect=rect
  return nativeImage.createFromPath(file).toBitmap()
}
function changed(a:Buffer,b:Buffer):number{
  assert.equal(a.length,b.length)
  let count=0
  for(let offset=0;offset<a.length;offset+=4)if(Math.abs(a[offset]-b[offset])+Math.abs(a[offset+1]-b[offset+1])+Math.abs(a[offset+2]-b[offset+2])>30)count++
  return count
}

void app.whenReady().then(async()=>{
  try{
    win=new BrowserWindow({show:false,x:100,y:100,width:640,height:420,frame:false,roundedCorners:false,thickFrame:false,resizable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
    const wc=win.webContents
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
    win.setAlwaysOnTop(true);win.showInactive()
    for(let attempt=0;attempt<10;attempt++){
      try{await wc.capturePage();break}catch(error){if(attempt===9)throw error;await sleep(100)}
    }
    await sleep(400)
    const baseline=await capture('00-baseline')
    let white=0
    for(let offset=0;offset<baseline.length;offset+=4)if(baseline[offset]>250&&baseline[offset+1]>250&&baseline[offset+2]>250)white++
    assert.ok(white/(baseline.length/4)>0.99,'The fixture page must actually be rendered, not an empty native window')
    const controller=getBrowserAutomationController(wc,{controlWaitWarningMs:80})
    await controller.applySettings({...createDefaultBrowserAutomation(),cursor_style:'focus-ring'},1)
    await controller.claimRun('visible-fixture')
    assert.equal(controller.snapshot().inputProtected,true)
    assert.equal(controller.snapshot().cursorEnabled,false)
    const claimed=await capture('01-before-first-input')
    report.initialChangedPixels=changed(baseline,claimed)
    assert.equal(changed(baseline,claimed),0,'Claiming a navigation/read task must not add a zero-position cursor')
    checks.push('system-capture-no-cursor-before-first-input')

    await controller.run({runId:'visible-fixture'},operation=>operation.commit(()=>dispatchPointerMotion(wc,{action:'click',to:{x:290,y:175}})))
    assert.equal(await wc.executeJavaScript('window.clicks'),1)
    assert.equal(controller.snapshot().cursorEnabled,true)
    assert.equal(controller.snapshot().cursorVisible,undefined)
    const positioned=await capture('02-after-first-pointer-receipt')
    report.nativeAfterPointer=wc.getAutomationState()
    fs.writeFileSync(path.join(output,'guest-page.png'),(await wc.capturePage()).toPNG())
    report.pointerChangedPixels=changed(baseline,positioned)
    assert.ok(changed(baseline,positioned)>30,'OS capture must contain visible native cursor pixels')
    checks.push('trusted-first-click-and-system-visible-native-cursor')
    const guest=await wc.capturePage()
    fs.writeFileSync(path.join(output,'guest-page.png'),guest.toPNG())

    const snapshot=await wc.getAgentSnapshot({maxFrames:8,maxNodes:100})
    const target=snapshot.elements.find(element=>element.tagName.toLowerCase()==='button'&&element.target?.routingId===wc.mainFrame.routingId)
    assert.ok(target?.target)
    await controller.run({runId:'visible-fixture'},operation=>withBrowserInputOperation(wc,operation,()=>nativePointerWithReceipt(wc,target!.target!,'click','left',()=>operation.commit(()=>wc.clickElement({target:target!.target!})))) )
    assert.equal(await wc.executeJavaScript('window.clicks'),2)
    checks.push('public-target-click-retains-valid-cursor-and-trusted-input')

    controller.geometryChanged();await sleep(150)
    assert.equal(controller.snapshot().cursorEnabled,false)
    assert.equal(controller.snapshot().inputProtected,true)
    const invalid=await capture('03-after-geometry-invalidation')
    assert.equal(changed(baseline,invalid),0)
    checks.push('system-capture-no-leftover-after-geometry-invalidation')
    await controller.run({runId:'visible-fixture'},operation=>operation.commit(()=>dispatchPointerMotion(wc,{action:'click',to:{x:440,y:235}})))
    assert.equal(await wc.executeJavaScript('document.querySelector("iframe").contentWindow.clicked'),true)
    assert.equal(controller.snapshot().cursorPositionValid,true)
    checks.push('frame-routed-native-click-reestablishes-display-position')
    await controller.finishRun('visible-fixture')
    const finished=await capture('04-after-task-release')
    assert.equal(changed(baseline,finished),0)
    checks.push('system-capture-no-cursor-after-task-release')

    await controller.claimRun('target-first')
    await controller.run({runId:'target-first'},operation=>withBrowserInputOperation(wc,operation,()=>nativePointerWithReceipt(wc,target!.target!,'click','left',()=>operation.commit(()=>wc.clickElement({target:target!.target!})))) )
    assert.equal(controller.snapshot().cursorPositionValid,true)
    assert.equal(controller.snapshot().cursorEnabled,true)
    await controller.finishRun('target-first')
    const childTarget=snapshot.elements.find(element=>element.tagName.toLowerCase()==='button'&&element.target?.routingId!==wc.mainFrame.routingId)
    assert.ok(childTarget?.target)
    await controller.claimRun('frame-target-first')
    await controller.run({runId:'frame-target-first'},operation=>withBrowserInputOperation(wc,operation,()=>nativePointerWithReceipt(wc,childTarget!.target!,'click','left',()=>operation.commit(()=>wc.clickElement({target:childTarget!.target!})))) )
    assert.equal(controller.snapshot().cursorPositionValid,true)
    assert.equal(controller.snapshot().cursorEnabled,true)
    await controller.finishRun('frame-target-first')
    checks.push('main-and-child-frame-first-target-clicks-reveal-native-converted-position')

    for(const kind of ['move','wheel'] as const){
      await controller.claimRun(`primitive-${kind}`)
      await controller.run({runId:`primitive-${kind}`},operation=>withBrowserInputOperation(wc,operation,()=>kind==='move'?dispatchTrustedPointer(wc,{action:'move',x:100,y:100}):dispatchTrustedWheelOnce(wc,100,100,50)))
      assert.equal(controller.snapshot().cursorEnabled,true,kind)
      await controller.finishRun(`primitive-${kind}`)
    }
    checks.push('first-low-level-pointer-and-wheel-receipts-reveal-drawing')

    await controller.applySettings({...createDefaultBrowserAutomation(),show_virtual_cursor:false},2)
    await controller.claimRun('hidden-preference')
    await controller.run({runId:'hidden-preference'},operation=>operation.commit(()=>dispatchPointerMotion(wc,{action:'move',to:{x:100,y:100}})))
    assert.equal(controller.snapshot().cursorPositionValid,true)
    assert.equal(controller.snapshot().cursorEnabled,false)
    assert.equal(controller.snapshot().inputProtected,true)
    const hidden=await capture('05-hidden-preference-after-input')
    assert.equal(changed(baseline,hidden),0)
    await controller.finishRun('hidden-preference')
    await controller.applySettings({...createDefaultBrowserAutomation(),cursor_style:'focus-ring'},3)
    checks.push('hidden-preference-retains-protection-after-actual-input-with-no-cursor-pixels')

    await controller.claimRun('cancel-with-navigation')
    await controller.run({runId:'cancel-with-navigation'},operation=>operation.commit(()=>dispatchPointerMotion(wc,{action:'move',to:{x:100,y:100}})))
    let navigationDone!:()=>void
    controller.trackPending(new Promise<void>(resolve=>{navigationDone=resolve}))
    let submitted!:()=>void
    const started=new Promise<void>(resolve=>{submitted=resolve})
    let receipt:unknown
    const running=controller.run({runId:'cancel-with-navigation'},async operation=>{
      submitted()
      receipt=await operation.commit(()=>dispatchPointerMotion(wc,{action:'move',to:{x:500,y:300},motion:{durationMs:20000}}))
      operation.assertCurrent()
    }).catch(error=>{report.cancelError=String(error)})
    await started;await sleep(80)
    const begin=Date.now()
    let granted=false
    const taking=controller.takeControl().then(state=>{granted=true;return state})
    await running
    report.nativeCancellationMs=Date.now()-begin;report.cancelReceipt=receipt
    assert.ok(Date.now()-begin<5000,'Native cancellation must not wait for the 20-second batch or pending navigation')
    assert.equal(granted,false)
    navigationDone()
    const handoff=await taking
    assert.equal(handoff.owner,'user');assert.equal(handoff.nativeConfirmed,true)
    assert.equal(handoff.inputProtected,false);assert.equal(handoff.error,undefined)
    assert.equal(wc.getAutomationState().inputActive,false)
    checks.push('real-native-long-batch-cancelled-with-concurrent-navigation-and-confirmed-handoff')
    report.finalState=handoff;report.runtime=process.versions.electron;report.gpuFeatures=app.getGPUFeatureStatus();report.ok=true
  }catch(error){report.ok=false;report.error=error instanceof Error?error.stack:String(error);console.error(error)}
  finally{
    fs.writeFileSync(path.join(output,'cursor-visibility.json'),JSON.stringify(report,null,2))
    win?.destroy();console.log(`[cursor-visibility] ${checks.length} checks; ok=${report.ok}`);app.exit(report.ok?0:1)
  }
})
