import {app,BrowserWindow,NativePanel,ipcMain,screen,webContents} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
import {registerNativeUi} from '../electron/modules/native-ui'
import type {NativePanelContent,NativePanelHandle} from '../shared/native-ui'
import {WINDOW_FIND_SURFACE} from '../shared/window-find-panel'

const project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,profile=process.env.NAVORA_DATA_ROOT!
if(!profile||!path.isAbsolute(profile))throw Error('An isolated native restore profile is required')
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile),checks:string[]=[],events:unknown[]=[],patches:unknown[]=[],observations:any[]=[]
const handlers=new Map<string,Function>(),originalHandle=ipcMain.handle.bind(ipcMain),nativeShow=NativePanel.prototype.show,nativeUpdate=NativePanel.prototype.update,nativeHide=NativePanel.prototype.hide
ipcMain.handle=(channel,listener)=>{handlers.set(channel,listener);originalHandle(channel,listener)}
let owner:BrowserWindow|undefined,panel:NativePanel|undefined,handle:NativePanelHandle|undefined,shows=0,onNativeShow:(()=>void)|undefined
NativePanel.prototype.show=function(options){nativeShow.call(this,options);panel=this;shows++;onNativeShow?.()}
NativePanel.prototype.update=function(patch){patches.push(structuredClone(patch));return nativeUpdate.call(this,patch)}
NativePanel.prototype.hide=function(){const before=(this as unknown as {_getState():any})._getState();nativeHide.call(this);observations.push({phase:'native-hide',previouslyVisible:before.visible,bounds:before.bounds,owner:owner?.getContentBounds(),minimized:owner?.isMinimized()})}
const state=()=>{assert.ok(panel);return (panel as unknown as {_getState():any})._getState()}
const invoke=(name:string,...args:any[])=>handlers.get('navora:native-ui.'+name)!({sender:owner!.webContents,senderFrame:owner!.webContents.mainFrame},...args)
async function until(check:()=>boolean,label:string){const deadline=Date.now()+6000;while(Date.now()<deadline){if(check())return;await wait(30)}throw Error('Timed out: '+label)}
async function capture(name:string){
  const native=state();fs.writeFileSync(path.join(output,name+'-state.json'),JSON.stringify({owner:owner!.getContentBounds(),native},null,2))
  const {stdout}=await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(native.windowHandle),'--owner',String(native.parentWindowHandle),'--output',path.join(output,name+'.png')],{windowsHide:true,timeout:12000})
  assert.equal(JSON.parse(stdout).ok,true)
}

void app.whenReady().then(async()=>{
  let service:ReturnType<typeof registerNativeUi>|undefined
  try{
    const work=screen.getPrimaryDisplay().workArea
    owner=new BrowserWindow({show:false,x:work.x+50,y:work.y+80,width:Math.min(800,work.width-100),height:Math.min(600,work.height-160),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
    await owner.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Isolated native popup restore verification</title><p>Synthetic data only. Native popup restore check.</p>'));owner.showInactive();owner.webContents.setZoomFactor(1);await wait(180)
    const send=owner.webContents.send.bind(owner.webContents);owner.webContents.send=(channel,...args)=>{if(channel==='navora:native-ui.event')events.push(structuredClone(args[0]));send(channel,...args)}
    service=registerNativeUi({trusted:sender=>sender===owner!.webContents?owner:undefined,source:()=>{throw Error('No remote source is used')},pageSettings:()=>{}});ipcMain.handle=originalHandle
    const viewport=await owner.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})'),logical={x:Math.max(8,viewport.width-400),y:22,width:1,height:1},content:NativePanelContent={id:'restore-find',type:'row',height:28,width:360,gap:4,children:[{id:'restore-query',type:'input',value:'保留搜索草稿',flex:1,height:28,style:{borderless:true}},{id:'restore-close',type:'button',text:'×',width:26,height:26,variant:'plain'}]}
    handle=invoke('show',{id:'restore-fixture',contextKey:'restore-fixture',content,anchor:logical,placement:'bottom-start',focusMode:'input',role:'search',dismissOnOutsideClick:false,...WINDOW_FIND_SURFACE})
    assert.equal(handle!.supported,true);await until(()=>state().visible,'native panel visible');await wait(150)
    const before=state(),beforeOwner=owner.getContentBounds(),beforeShows=shows
    observations.push({phase:'public-focus-before-minimize',focusedContents:webContents.getFocusedWebContents()?.id,ownerFocused:owner.isFocused(),mainContentsFocused:owner.webContents.isFocused()})
    await capture('01-before-minimize')
    for(const message of [0x112,0x46,0x47,0x3,0x5,0x18])if(!owner.isWindowMessageHooked(message))owner.hookWindowMessage(message,(wParam,lParam)=>{
      const native=state();observations.push({phase:'parent-window-message',message,wParam:wParam.readUInt32LE(0),lParam:lParam.readInt32LE(0),visible:native.visible,bounds:native.bounds,anchor:native.anchorBounds,owner:owner!.getContentBounds(),minimized:owner!.isMinimized()})
    })
    const minimizeFrames:any[]=[],minimizeStarted=performance.now()
    const sampleMinimize=(phase:string)=>{const native=state();minimizeFrames.push({phase,ms:performance.now()-minimizeStarted,visible:native.visible,bounds:native.bounds,anchor:native.anchorBounds,owner:owner!.getContentBounds(),minimized:owner!.isMinimized()})}
    const moved=()=>sampleMinimize('move-event'),minimized=()=>sampleMinimize('minimize-event')
    owner.on('move',moved);owner.on('minimize',minimized);sampleMinimize('before-minimize-call')
    owner.minimize();sampleMinimize('after-minimize-call');await until(()=>owner!.isMinimized(),'owner minimized');await wait(120);owner.removeListener('move',moved);owner.removeListener('minimize',minimized);observations.push({phase:'minimize-frame-sequence',frames:minimizeFrames},{phase:'minimized',native:state(),owner:owner.getContentBounds()})
    const restoreFrames:any[]=[],restoreStarted=performance.now()
    const sampleRestore=(phase:string)=>{const native=state();restoreFrames.push({phase,ms:performance.now()-restoreStarted,visible:native.visible,bounds:native.bounds,anchor:native.anchorBounds,owner:owner!.getContentBounds(),minimized:owner!.isMinimized()})}
    onNativeShow=()=>sampleRestore('native-show-complete')
    const sampleTimer=setInterval(()=>sampleRestore('tick'),1)
    owner.once('restore',()=>sampleRestore('restore-event'));sampleRestore('before-restore-call')
    owner.restore();sampleRestore('after-restore-call');owner.showInactive();sampleRestore('after-show-inactive');await until(()=>!owner!.isMinimized()&&owner!.isVisible(),'owner restored');await wait(240);clearInterval(sampleTimer)
    onNativeShow=undefined;observations.push({phase:'restore-frame-sequence',frames:restoreFrames})
    const after=state(),afterOwner=owner.getContentBounds()
    observations.push({phase:'before',native:before,owner:beforeOwner},{phase:'restored',native:after,owner:afterOwner})
    assert.equal(after.windowHandle,before.windowHandle);assert.equal(shows,beforeShows+1);assert.equal(after.visible,true)
    assert.equal(after.controls.find((control:any)=>control.id==='restore-query').value,'保留搜索草稿')
    assert.deepEqual(after.controls.find((control:any)=>control.id==='restore-query').selection,before.controls.find((control:any)=>control.id==='restore-query').selection)
    assert.deepEqual(after.anchorBounds,{x:Math.round(afterOwner.x+logical.x),y:Math.round(afterOwner.y+logical.y),width:1,height:1})
    assert.ok(Math.abs((after.bounds.x-afterOwner.x)-(before.bounds.x-beforeOwner.x))<=2,'restored popup keeps its horizontal position within the owner')
    assert.ok(Math.abs((after.bounds.y-afterOwner.y)-(before.bounds.y-beforeOwner.y))<=2,'restored popup keeps its vertical position within the owner')
    assert.equal(invoke('update',handle!.id,handle!.session,{anchor:logical}),true)
    const visibleFrames=restoreFrames.filter(frame=>frame.visible)
    assert.ok(visibleFrames.length>0);assert.ok(visibleFrames.every(frame=>Math.abs(frame.bounds.x-after.bounds.x)<=1&&Math.abs(frame.bounds.y-after.bounds.y)<=1),'Every observed visible frame is already at the restored position')
    assert.equal(restoreFrames.filter(frame=>frame.phase==='native-show-complete').length,1,'Restore displays the same native popup once')
    checks.push('restore-displays-once-without-observed-visible-origin-frame')
    checks.push('actual-owner-minimize-and-restore-preserve-native-popup-position-HWND-query-caret-session-with-same-instance-show')
    await capture('02-after-restore')
    owner.maximize();await until(()=>owner!.isMaximized(),'owner maximized');await wait(180)
    const maximizedBefore=state(),maximizedShows=shows
    owner.minimize();await until(()=>owner!.isMinimized(),'maximized owner minimized')
    owner.restore();owner.showInactive();await until(()=>owner!.isMaximized()&&state().visible,'maximized owner and popup restored');await wait(80)
    const maximizedAfter=state()
    assert.equal(shows,maximizedShows+1);assert.equal(maximizedAfter.windowHandle,maximizedBefore.windowHandle)
    assert.deepEqual(maximizedAfter.bounds,maximizedBefore.bounds)
    assert.equal(maximizedAfter.controls.find((control:any)=>control.id==='restore-query').value,'保留搜索草稿')
    assert.deepEqual(maximizedAfter.controls.find((control:any)=>control.id==='restore-query').selection,maximizedBefore.controls.find((control:any)=>control.id==='restore-query').selection)
    observations.push({phase:'maximized-restore',before:maximizedBefore.bounds,after:maximizedAfter.bounds})
    checks.push('maximized-owner-restore-keeps-native-window-position-query-and-selection')
    const showsBeforeClosedCycle=shows
    invoke('hide',handle!.id,handle!.session);const dismissedPatches=patches.length
    owner.minimize();await until(()=>owner!.isMinimized(),'closed-popup owner minimized');owner.restore();owner.showInactive();await until(()=>!owner!.isMinimized(),'closed-popup owner restored');await wait(220)
    assert.equal(state().visible,false);assert.equal(shows,showsBeforeClosedCycle);assert.equal(patches.length,dismissedPatches);checks.push('actual-owner-restore-does-not-revive-explicitly-hidden-popup')
    const minimizedMessages=observations.filter(item=>item.phase==='parent-window-message'&&item.minimized)
    assert.ok(minimizedMessages.length>0);assert.ok(minimizedMessages.every(item=>!item.visible),'Native popup is hidden before minimized parent position messages are processed')
    assert.ok(observations.some(item=>item.phase==='native-hide'&&item.previouslyVisible&&item.bounds.x===before.bounds.x&&item.bounds.y===before.bounds.y),'First pre-hide happens at the original position')
    checks.push('system-minimize-pre-hides-popup-before-owner-position-following')
    fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,observations,patches,events,electron:process.versions.electron,scope:'Actual customized Electron NativePanel and production native-ui service; isolated synthetic owner temporarily shown inactive on the primary display. Only the owned popup HWND is captured. Owner minimize/restore are real BrowserWindow calls. Renderer host visibility handlers are not used, proving the native service restores the anchor independently.'},null,2))
    console.log(JSON.stringify({ok:true,checks}))
  }catch(error){fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({ok:false,error:String(error),stack:error instanceof Error?error.stack:undefined,checks,observations,patches,events,native:panel?state():undefined},null,2));console.error(error);process.exitCode=1}
  finally{service?.dispose();if(owner&&!owner.isDestroyed())owner.destroy();await wait(100);app.exit(Number(process.exitCode||0))}
})
