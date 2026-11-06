import {app,BrowserWindow,WebContentsView} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import {createDefaultBrowserAutomation,type BrowserAutomationState} from '../shared/browser-automation'
import {withBrowserInputOperation} from '../electron/modules/browser-input-context'
import {dispatchOwnedTargetMouse} from '../electron/modules/browser-target-input'

app.setPath('userData',path.join(process.env.NAVORA_ISOLATION_PROFILE!,'profile'))
app.commandLine.appendSwitch('disable-gpu')
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const systemInputSample=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class NavoraIsolationProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Point {public int X;public int Y;}
  [StructLayout(LayoutKind.Sequential)] public struct LastInput {public uint Size;public uint Tick;}
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LastInput input);
}
'@
$point=[NavoraIsolationProbe+Point]::new();[void][NavoraIsolationProbe]::GetCursorPos([ref]$point)
$inputState=[NavoraIsolationProbe+LastInput]::new();$inputState.Size=8;[void][NavoraIsolationProbe]::GetLastInputInfo([ref]$inputState)
@{foreground=[NavoraIsolationProbe]::GetForegroundWindow().ToInt64().ToString();x=$point.X;y=$point.Y;lastInputTick=$inputState.Tick}|ConvertTo-Json -Compress
`],{encoding:'utf8',windowsHide:true})) as {foreground:string;x:number;y:number;lastInputTick:number}
const checks:string[]=[]
const report:Record<string,unknown>={checks,limitation:'Never-shown mounted WebContentsView fixture. Does not certify physical IME, hardware pointer filtering or full cross-frame continuity.'}
let host:BrowserWindow|undefined,guest:WebContentsView|undefined
void app.whenReady().then(async()=>{
  try {
    host=new BrowserWindow({show:false,width:900,height:650,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
    await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<input id="host" value="宿主内容"><script>document.querySelector("input").focus();window.edits=0;document.addEventListener("input",()=>window.edits++)</script>'))
    guest=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:true}})
    host.contentView.addChildView(guest)
    guest.setBounds({x:0,y:100,width:700,height:450})
    const wc=guest.webContents
    await wc.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><input id="target" aria-label="后台文本"><canvas width="300" height="100"></canvas><script>window.edits=0;window.trusted=true;window.ticks=0;document.addEventListener("input",e=>{window.edits++;window.trusted&&=e.isTrusted});function animate(){window.ticks++;const c=document.querySelector("canvas").getContext("2d");c.fillStyle="rgb("+(window.ticks%255)+",40,80)";c.fillRect(0,0,300,100);requestAnimationFrame(animate)}requestAnimationFrame(animate)</script>'))
    const controller=getBrowserAutomationController(wc,{getSettings:()=>({...createDefaultBrowserAutomation(),show_virtual_cursor:false,protect_input:false})})
    await controller.claimRun('isolation-smoke')
    const state=wc.getAutomationState()
    assert.ok(state.isolateInput&&state.blockRealPointer&&state.blockRealKeyboard&&state.keepRendering)
    assert.equal(state.virtualCursor.enabled,false)
    const rendering=state.rendering as NonNullable<BrowserAutomationState['rendering']>
    assert.ok(rendering.viewAvailable&&rendering.keepAlive)
    assert.equal(rendering.effectiveBackgroundThrottling,false)
    assert.equal(host.isVisible(),false)
    checks.push('agent-lease-enables-all-four-options-despite-legacy-disabled-preference','hidden-cursor-independent-of-isolation-and-rendering')
    const ticksBefore=await wc.executeJavaScript('window.ticks')
    await wait(180)
    const ticksAfter=await wc.executeJavaScript('window.ticks')
    assert.ok(ticksAfter>ticksBefore,'Background animation must advance before any screenshot request')
    report.animationBeforeCapture={before:ticksBefore,after:ticksAfter}
    const image1=await wc.capturePage(undefined,{stayHidden:true})
    await wait(95)
    const image2=await wc.capturePage(undefined,{stayHidden:true})
    assert.notEqual(createHash('sha256').update(image1.toBitmap()).digest('hex'),createHash('sha256').update(image2.toBitmap()).digest('hex'))
    checks.push('never-shown-mounted-view-renders-before-capture','background-view-generates-new-pixels')
    const snapshot=await wc.findAgentElements({selector:'#target'})
    assert.equal(snapshot.complete,true)
    const target=snapshot.elements[0]?.target
    assert.ok(target)
    const systemBefore=systemInputSample()
    await controller.run({runId:'isolation-smoke'},async operation=>{
      const click=await operation.commit(()=>wc.clickElement({target}))
      assert.equal(click.status,'dispatched')
      const input=await operation.commit(()=>wc.dispatchInputSequence([
        {kind:'key',atMs:0,type:'char',text:'后台',target},
        {kind:'key',atMs:20,type:'char',text:'输入',target},
      ],{signal:operation.signal}))
      operation.noteResult(input)
      assert.equal(input.status,'completed')
    })
    assert.equal(await wc.executeJavaScript('document.querySelector("input").value'),'后台输入')
    assert.equal(await wc.executeJavaScript('window.trusted'),true)
    assert.equal(await host.webContents.executeJavaScript('document.querySelector("input").value'),'宿主内容')
    assert.equal(await host.webContents.executeJavaScript('window.edits'),0)
    assert.equal(host.isVisible(),false)
    const systemAfter=systemInputSample(),noConcurrentInput=systemBefore.lastInputTick===systemAfter.lastInputTick
    report.systemInputSample={before:systemBefore,after:systemAfter,status:noConcurrentInput?'observed_without_concurrent_system_input':'inconclusive_concurrent_system_input'}
    if(noConcurrentInput){
      assert.equal(systemAfter.foreground,systemBefore.foreground,'Background automation must not activate a system window')
      assert.deepEqual({x:systemAfter.x,y:systemAfter.y},{x:systemBefore.x,y:systemBefore.y},'Background automation must not move the system cursor')
      checks.push('background-input-preserves-sampled-system-foreground-and-cursor')
    }
    checks.push('trusted-background-text-reaches-only-target-document','background-operation-does-not-show-host-or-edit-host-field')
    await wait(60)
    assert.equal(wc.getAutomationState().isolateInput,true)
    await controller.finishRun('obsolete-run')
    assert.equal(wc.getAutomationState().isolateInput,true)
    checks.push('model-wait-and-obsolete-run-retain-current-isolation')
    await controller.finishRun('isolation-smoke')
    const released=wc.getAutomationState()
    assert.ok(!released.isolateInput&&!released.blockRealPointer&&!released.blockRealKeyboard&&!released.keepRendering&&!released.inputActive)
    const releasedRendering=released.rendering as NonNullable<BrowserAutomationState['rendering']>
    assert.equal(releasedRendering.requestedBackgroundThrottling,true)
    assert.equal(releasedRendering.effectiveBackgroundThrottling,true)
    checks.push('matching-finish-resets-input-and-restores-host-throttling')
    await controller.claimRun('cancel-smoke')
    const current=await wc.findAgentElements({selector:'#target'})
    const pressTarget=current.elements[0]!.target
    controller.noteObservation(controller.captureEpoch(),controller.captureDocumentEpoch())
    await wc.executeJavaScript('window.releaseEvents=0;document.addEventListener("mouseup",()=>window.releaseEvents++)')
    let pressed!:()=>void
    const downReady=new Promise<void>(resolve=>{pressed=resolve})
    const held=controller.run({runId:'cancel-smoke'},operation=>withBrowserInputOperation(wc,operation,async()=>{
      const down=await dispatchOwnedTargetMouse(wc,{target:pressTarget,type:'mousePressed',button:'left',buttons:1,clickCount:1})
      assert.equal(down.status,'dispatched')
      pressed()
      await new Promise<void>(resolve=>{if(operation.signal.aborted)resolve();else operation.signal.addEventListener('abort',()=>resolve(),{once:true})})
    }))
    const heldSettled=held.then(()=>undefined,error=>error)
    await Promise.race([downReady,held.then(()=>{throw Error('Held input ended before its press was confirmed')})])
    const cancelled=await controller.takeControl()
    await heldSettled
    assert.equal(cancelled.owner,'user')
    assert.equal(cancelled.nativeConfirmed,true)
    await wait(30)
    assert.equal(await wc.executeJavaScript('window.releaseEvents'),1,'Native reset and the host ledger must release only once')
    assert.equal(wc.getAutomationState().inputActive,false)
    checks.push('cancelled-held-target-input-releases-once-before-manual-handoff')
    await controller.resume()
    await controller.claimRun('handoff-smoke')
    const handoff=await controller.takeControl()
    assert.equal(handoff.owner,'user')
    assert.equal(handoff.nativeConfirmed,true)
    assert.equal(wc.getAutomationState().isolateInput,false)
    assert.equal(wc.getAutomationState().keepRendering,false)
    checks.push('manual-handoff-confirms-full-release')
    report.ok=true
  } catch(error) {
    report.ok=false;report.error=error instanceof Error?error.stack:String(error)
    console.error(error);process.exitCode=1
  } finally {
    if(guest&&!guest.webContents.isDestroyed())guest.webContents.close()
    host?.destroy()
    fs.writeFileSync(path.join(process.env.NAVORA_ISOLATION_OUTPUT!,'result.json'),JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify(report))
    app.exit(Number(process.exitCode)||0)
  }
})
