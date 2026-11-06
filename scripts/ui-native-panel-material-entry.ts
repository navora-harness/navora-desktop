import {app,BrowserWindow,NativePanel,WebContentsView,ipcMain,nativeTheme,screen} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {registerNativeUi} from '../electron/modules/native-ui'
import {WindowMaterialManager} from '../electron/modules/window-material'
import {mainWindowChrome} from '../electron/modules/window-chrome'
import {createDefaultConfig} from '../shared/config'
import {appearancePalette} from '../shared/appearance'
import type {WindowMaterialEnvironment,WindowMaterialRole} from '../shared/window-material'
import type {NativePanelContent,NativePanelHandle,NativeUiTheme} from '../shared/native-ui'

const project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,profile=process.env.NAVORA_DATA_ROOT!
if(!profile||!path.isAbsolute(profile)||!project||!output)throw Error('An explicit isolated NativePanel material profile is required')
app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'sessions'))
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.on('window-all-closed',()=>{})
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),run=promisify(execFile),checks:string[]=[],observations:unknown[]=[],shots:string[]=[],panels:NativePanel[]=[],patches:Array<{panel:NativePanel;patch:Electron.NativePanelUpdateOptions}>=[]
const handlers=new Map<string,Function>(),originalHandle=ipcMain.handle.bind(ipcMain),nativeShow=NativePanel.prototype.show,nativeUpdate=NativePanel.prototype.update
ipcMain.handle=(channel,listener)=>{handlers.set(channel,listener);originalHandle(channel,listener)}
NativePanel.prototype.show=function(options){nativeShow.call(this,options);if(!panels.includes(this))panels.push(this)}
NativePanel.prototype.update=function(patch){patches.push({panel:this,patch});return nativeUpdate.call(this,patch)}
const config=createDefaultConfig(),windows:BrowserWindow[]=[],guests:WebContentsView[]=[]
let service:ReturnType<typeof registerNativeUi>|undefined,forced:Partial<WindowMaterialEnvironment>={}
const environment=():WindowMaterialEnvironment=>({platform:process.platform,release:os.release(),systemDark:nativeTheme.shouldUseDarkColors,highContrast:nativeTheme.shouldUseHighContrastColors,forcedColors:nativeTheme.inForcedColorsMode,reducedTransparency:nativeTheme.prefersReducedTransparency,...forced})
const manager=new WindowMaterialManager({getConfig:()=>config,environment})
const invoke=(owner:BrowserWindow,name:string,...args:unknown[])=>handlers.get('navora:native-ui.'+name)!({sender:owner.webContents,senderFrame:owner.webContents.mainFrame},...args)
function palette():NativeUiTheme{
  const p=appearancePalette(config.app.appearance_theme,config.app.appearance_mode,nativeTheme.shouldUseDarkColors)
  return {mode:p.dark?'dark':'light',background:p.surface,text:p.ink,muted:p.muted,accent:p.accent,border:p.stroke,fontFamily:'Segoe UI',fontSize:13}
}
function nativeState(panel:NativePanel){return (panel as unknown as {_getState:()=>any})._getState()}
async function until(check:()=>boolean,label:string){const deadline=Date.now()+5000;while(Date.now()<deadline){if(check())return;await wait(30)}throw Error('Timed out: '+label)}
function verifyMaterial(panel:NativePanel,requested:'acrylic'|'none',label:string){
  const state=panel.getDiagnostics()
  assert.ok(['acrylic','none'].includes(state.backgroundMaterialApplied),label+' reports a known applied material')
  if(requested==='none'){
    assert.equal(state.backgroundMaterialApplied,'none',label+' revokes acrylic')
    assert.equal(state.materialBackend,'none',label+' revokes the composition backend')
  }else if(state.backgroundMaterialApplied==='acrylic'){
    assert.equal(state.materialBackend,'composition-host-backdrop',label+' reports actual native material backend')
    assert.equal(state.materialFallbackReason,'')
    assert.ok(state.backdropWindowHandle&&state.backdropWindowHandle!=='0',label+' owns a material backdrop window')
  }else assert.ok(state.materialFallbackReason,label+' explains its solid fallback')
  observations.push({label,requested,native:state})
  return state
}
async function capture(panel:NativePanel,name:string){
  const state=nativeState(panel),destination=path.join(output,name+'.png')
  const {stdout}=await run('python',[path.join(project,'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',destination],{windowsHide:true,timeout:10000})
  assert.equal(JSON.parse(stdout).ok,true);shots.push(destination)
}

void app.whenReady().then(async()=>{
  try{
    const capabilities=NativePanel.getCapabilities()
    assert.equal(NativePanel.isSupported(),true);assert.equal(capabilities.apiVersion,2)
    config.app.window_acrylic=true;config.app.appearance_mode='light'
    service=registerNativeUi({trusted:sender=>windows.find(win=>win.webContents===sender&&!win.isDestroyed()),source:()=>{throw Error('This fixture has no source-page binding')},pageSettings:()=>{},materialState:sender=>manager.stateFor(sender,sender.mainFrame)})
    ipcMain.handle=originalHandle
    const area=screen.getPrimaryDisplay().workArea,roles:WindowMaterialRole[]=['main','browser','file']
    const rows:Array<{owner:BrowserWindow;panel:NativePanel;handle:NativePanelHandle;initial:any;guest:WebContentsView;identity:string}>=[]
    for(const [index,role]of roles.entries()){
      const owner=new BrowserWindow({show:false,x:area.x+40+index*20,y:area.y+70+index*20,width:700,height:500,...mainWindowChrome(process.platform),backgroundColor:'#ffffff',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      windows.push(owner);manager.register(owner,role)
      await owner.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Isolated NativePanel material</title><style>body{font:16px system-ui;background:repeating-linear-gradient(35deg,#548cb5 0 90px,#bde1d1 90px 180px,#e1b7a6 180px 270px)}</style><h1>原生面板材质</h1><p>测试配置变化时保留原生输入状态。</p>'))
      owner.showInactive();await wait(60)
      const guest=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      guests.push(guest);owner.contentView.addChildView(guest);guest.setBounds({x:15,y:300,width:650,height:150})
      await guest.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><script>window.fixtureIdentity=Math.random().toString(16);window.ticks=0;setInterval(()=>ticks++,30)</script><p>持续运行的独立网页</p>'))
      const identity=await guest.webContents.executeJavaScript('window.fixtureIdentity')
      const content:NativePanelContent={id:'material-root',type:'column',width:340,gap:8,children:[{id:'material-title',type:'text',text:`下载 · ${role}`,fontSize:16},{id:'material-query',type:'input',value:'保留中文草稿 😀',height:30},{id:'material-item',type:'item',height:48,children:[{id:'material-name',type:'text',text:'QQ_9.9.37_261103_x64_01.exe',singleLine:true},{id:'material-status',type:'text',text:'10.0 MB/s · 剩余 28 秒',muted:true}]}]}
      const handle:NativePanelHandle=invoke(owner,'show',{id:'material-'+role,content,anchor:{x:80,y:70,width:1,height:1},focusMode:'none',role:'editor',theme:palette(),dismissOnOutsideClick:false})
      assert.equal(handle.supported,true)
      const panel=panels.at(-1)!;await until(()=>panel.getDiagnostics().visible,role+' native panel visible')
      const host=manager.stateFor(owner.webContents,owner.webContents.mainFrame)
      verifyMaterial(panel,host.mode==='acrylic'?'acrylic':'none',role+' initial material')
      const initial=nativeState(panel)
      rows.push({owner,panel,handle,initial,guest,identity})
      await capture(panel,`01-${role}-${host.mode}-light`)
      checks.push(role+' host supplies the trusted material decision to a real NativePanel')
    }
    const assertRetained=(row:typeof rows[number],phase:string)=>{
      const current=nativeState(row.panel)
      assert.equal(current.windowHandle,row.initial.windowHandle,phase+' reuses the same HWND')
      assert.deepEqual(current.anchorBounds,row.initial.anchorBounds,phase+' retains its anchor')
      const before=row.initial.controls.find((control:any)=>control.id==='material-query'),after=current.controls.find((control:any)=>control.id==='material-query')
      assert.equal(after.value,before.value,phase+' retains native input text');assert.deepEqual(after.selection,before.selection,phase+' retains input selection')
      assert.equal(invoke(row.owner,'update',row.handle.id,row.handle.session,{anchor:{x:80,y:70,width:1,height:1}}),true,phase+' retains the app interaction session')
    }
    const apply=()=>{for(const owner of windows){manager.apply(owner);service!.refreshMaterials(owner)}}
    config.app.window_acrylic=false
    const beforeRefresh=patches.length;apply()
    assert.ok(patches.slice(beforeRefresh).filter(({patch})=>patch.backgroundMaterial==='none').every(({patch})=>!('content'in patch)&&!('anchorBounds'in patch)),'Material-only changes never replay the native tree or geometry')
    for(const row of rows){verifyMaterial(row.panel,'none','switch off');assertRetained(row,'switch off')}
    checks.push('turning off transparency refreshes all open panels without changing HWND, draft, selection or session')
    await capture(rows[0]!.panel,'02-main-solid-light')

    invoke(rows[2]!.owner,'hide',rows[2]!.handle.id,rows[2]!.handle.session)
    assert.equal(rows[2]!.panel.getDiagnostics().visible,false)
    config.app.window_acrylic=true;config.app.appearance_mode='dark';apply()
    for(const row of rows){
      invoke(row.owner,'update',row.handle.id,row.handle.session,{theme:palette()})
      const host=manager.stateFor(row.owner.webContents,row.owner.webContents.mainFrame)
      verifyMaterial(row.panel,host.mode==='acrylic'?'acrylic':'none','dark material');assertRetained(row,'dark material')
    }
    assert.equal(rows[2]!.panel.getDiagnostics().visible,false,'Refreshing hidden instances does not show them')
    checks.push('dark appearance and restored material update open and hidden instances without reopening hidden panels')
    await capture(rows[0]!.panel,'03-main-material-dark')

    for(const flag of ['highContrast','forcedColors','reducedTransparency']as const){
      forced={[flag]:true};apply()
      for(const row of rows){assert.equal(manager.stateFor(row.owner.webContents,row.owner.webContents.mainFrame).reason,{highContrast:'high_contrast',forcedColors:'forced_colors',reducedTransparency:'reduced_transparency'}[flag]);verifyMaterial(row.panel,'none',flag);assertRetained(row,flag)}
      checks.push(flag+' trusted system fallback immediately revokes all existing native materials')
    }
    forced={release:'10.0.19045'};apply()
    for(const row of rows){assert.equal(manager.stateFor(row.owner.webContents,row.owner.webContents.mainFrame).reason,'windows_version');verifyMaterial(row.panel,'none','unsupported OS')}
    checks.push('unsupported Windows version fails closed across all owner roles')
    forced={};config.app.appearance_mode='auto';apply()
    for(const row of rows){
      invoke(row.owner,'update',row.handle.id,row.handle.session,{theme:palette()})
      const host=manager.stateFor(row.owner.webContents,row.owner.webContents.mainFrame)
      assert.equal(host.dark,nativeTheme.shouldUseDarkColors)
      verifyMaterial(row.panel,host.mode==='acrylic'?'acrylic':'none','automatic appearance')
      assert.equal(await row.guest.webContents.executeJavaScript('window.fixtureIdentity'),row.identity)
      assert.ok(await row.guest.webContents.executeJavaScript('window.ticks>0'))
    }
    checks.push('automatic appearance follows OS tone while the original live WebContentsView documents keep running')
    assert.equal(panels.length,3,'All material transitions reuse the three original NativePanel instances')
    const distributionVersion=invoke(rows[0]!.owner,'capabilities').distributionVersion
    assert.equal(distributionVersion,'45.0.0-cloudbypass.11')
    fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,distributionVersion,electron:process.versions.electron,capabilities,environment:environment(),checks,observations,shots,scope:'Published runtime NativePanel v2, production native-ui bridge and WindowMaterialManager. Real diagnostics distinguish applied Acrylic, composition backend and explicit solid fallback. Accessibility and unsupported OS transitions inject only the isolated manager environment; Windows settings are never modified.',visualScope:'Owned popup PrintWindow captures show native content. PrintWindow alone does not prove desktop blur pixels or DWM policy behavior.'},null,2))
    console.log(JSON.stringify({ok:true,checks}))
  }catch(error){
    fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify({ok:false,error:String(error),stack:error instanceof Error?error.stack:undefined,checks,observations,diagnostics:panels.map(panel=>{try{return panel.getDiagnostics()}catch{return 'destroyed'}})},null,2));console.error(error);process.exitCode=1
  }finally{
    service?.dispose();ipcMain.handle=originalHandle
    for(const guest of guests)if(!guest.webContents.isDestroyed())guest.webContents.close()
    for(const owner of windows)if(!owner.isDestroyed())owner.destroy()
    await wait(60);app.exit(Number(process.exitCode||0))
  }
})
