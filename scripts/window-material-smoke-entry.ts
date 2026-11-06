import {app,BrowserWindow,WebContentsView,ipcMain,nativeTheme,screen} from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {createDefaultConfig} from '../shared/config'
import {appearancePalette} from '../shared/appearance'
import {WindowMaterialManager} from '../electron/modules/window-material'
import {mainWindowChrome} from '../electron/modules/window-chrome'
import type {WindowMaterialEnvironment,WindowMaterialRole} from '../shared/window-material'

const temporary=process.env.NAVORA_MATERIAL_SMOKE_ROOT,artifact=process.env.NAVORA_MATERIAL_SMOKE_ARTIFACT
if(!temporary||!path.isAbsolute(temporary)||!path.basename(temporary).startsWith('navora-window-material-')||!artifact)throw Error('Isolated test profile required')
const artifactRoot: string = artifact
app.setPath('userData',path.join(temporary,'profile'));app.setPath('sessionData',path.join(temporary,'sessions'))
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
void app.whenReady().then(async()=>{
  const windows:BrowserWindow[]=[],checks:string[]=[],shots:string[]=[],captureFocus:{name:string;before:boolean;after:boolean;focusedWindowId?:number;foregroundMatches?:boolean}[]=[]
  const config=createDefaultConfig()
  // Controlled theme provider in this isolated process, never a Windows setting.
  nativeTheme.themeSource='light'
  let forced:Partial<WindowMaterialEnvironment>={}
  const environment=():WindowMaterialEnvironment=>({platform:process.platform,release:os.release(),systemDark:nativeTheme.shouldUseDarkColors,highContrast:nativeTheme.shouldUseHighContrastColors,forcedColors:nativeTheme.inForcedColorsMode,reducedTransparency:nativeTheme.prefersReducedTransparency,...forced})
  const manager=new WindowMaterialManager({getConfig:()=>config,environment})
  const check=(name:string)=>{checks.push(name);console.log('[material] PASS',name)}
  ipcMain.handle('material.state',event=>manager.stateFor(event.sender,event.senderFrame))
  ipcMain.handle('material.config',()=>config)
  const apply=()=>{for(const win of windows){manager.apply(win);if(!win.isDestroyed())win.webContents.send('navora:config.changed',config)}}
  const waitFor=async(win:BrowserWindow,expression:string)=>{
    for(let i=0;i<80;i++){if(await win.webContents.executeJavaScript(expression))return;await delay(100)}
    throw Error(`Renderer did not reach ${expression}`)
  }
  async function inspect(win:BrowserWindow){return win.webContents.executeJavaScript(`(()=>{const bg=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).backgroundColor:null};return {mode:document.documentElement.dataset.navoraWindowMaterial,role:document.documentElement.dataset.navoraWindowRole,root:bg('html'),body:bg('body'),app:bg('.navora-app'),wrap:bg('.v-application__wrap'),shell:bg('.shell.main-shell'),title:bg('.window-titlebar,.detached-window-bar'),rail:bg('.activity-rail'),parent:bg('.content-surface'),sidebar:bg('aside.sidebar'),content:bg('.main,.file-host-content'),toolbar:bg('.browser-tab-toolbar')}})()`)}
  async function shot(win:BrowserWindow,name:string){
    // Capture only the controlled fixture rectangle. No installed app data is read.
    const before=win.isFocused()
    const display=screen.getDisplayMatching(win.getBounds())
    let foregroundMatches:boolean|undefined
    if(process.platform==='win32'){
      const bounds=win.getBounds(),file=path.join(artifactRoot,`${name}-gdi.png`)
      const handle=win.getNativeWindowHandle(),nativeHandle=handle.length>=8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())
      const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'scripts/window-material-screen-capture.ps1'),'-X',String(Math.round(bounds.x*display.scaleFactor)),'-Y',String(Math.round(bounds.y*display.scaleFactor)),'-Width',String(Math.round(bounds.width*display.scaleFactor)),'-Height',String(Math.round(bounds.height*display.scaleFactor)),'-ImagePath',file,'-ExpectedHandle',String(nativeHandle)],{encoding:'utf8',windowsHide:true,timeout:10000}).trim()
      foregroundMatches=output==='captured'
      if(foregroundMatches)shots.push(file)
    }
    captureFocus.push({name,before,after:win.isFocused(),focusedWindowId:BrowserWindow.getFocusedWindow()?.id,foregroundMatches})
  }
  let background:BrowserWindow|undefined
  try{
    fs.mkdirSync(artifact,{recursive:true})
    const display=screen.getPrimaryDisplay(),area=display.workArea
    background=new BrowserWindow({x:area.x,y:area.y,width:area.width,height:area.height,frame:false,show:false,skipTaskbar:true,webPreferences:{sandbox:true}})
    const backgroundReady = new Promise<void>(resolve => background!.once('ready-to-show', () => resolve()))
    await background.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><style>body{margin:0;height:100vh;background:repeating-linear-gradient(45deg,#2595c9 0 110px,#f0ab41 110px 220px,#9d62aa 220px 330px)}h1{font:32px system-ui;padding:16px;color:white}</style><body><h1>Navora isolated Acrylic fixture</h1></body></html>'))
    await backgroundReady
    background.showInactive()
    for(const [index,role] of (['main','browser','file'] as WindowMaterialRole[]).entries()){
      const win=new BrowserWindow({x:area.x+Math.max(40,Math.round((area.width-900)/2)),y:area.y+70+index*20,width:900,height:600,show:false,...mainWindowChrome(process.platform),backgroundColor:'#ffffff',webPreferences:{preload:path.join(temporary,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}})
      windows.push(win);manager.register(win,role)
      await win.loadFile(path.join(temporary,'index.html'),{hash:role})
      await waitFor(win,'!!document.documentElement.dataset.navoraWindowRole')
      background.moveTop();win.show();win.moveTop();win.focus();await delay(900)
      const state=manager.stateFor(win.webContents,win.webContents.mainFrame),css=await inspect(win)
      assert.equal(css.role,role);assert.equal(css.mode,state.mode)
      if(state.mode==='acrylic'){
        for(const key of ['root','body','app','wrap'])assert.equal(css[key],'rgba(0, 0, 0, 0)',`${role} ${key} must reveal material`)
        assert.match(css.title,/0\.28\)/,`${role} title has a translucent theme tint`)
        if(role==='main'){
          for(const key of ['shell','parent'])assert.equal(css[key],'rgba(0, 0, 0, 0)',key)
          assert.match(css.rail,/0\.28\)/)
          assert.match(css.sidebar,/0\.94\)/);assert.notEqual(css.content,'rgba(0, 0, 0, 0)')
          await win.webContents.executeJavaScript("document.querySelector('.main-shell').classList.add('sidebar-floating')")
          assert.doesNotMatch((await inspect(win)).sidebar,/0\.94\)/)
          await win.webContents.executeJavaScript("document.querySelector('.main-shell').classList.remove('sidebar-floating')")
          check('floating sidebar remains opaque while docked sidebar is tinted')
        }
        if(role==='browser')assert.notEqual(css.toolbar,'rgba(0, 0, 0, 0)')
        if(role==='file')assert.notEqual(css.content,'rgba(0, 0, 0, 0)')
      }
      check(`${role} real useAppearance and theme CSS obey host material state`)
      await shot(win,`${role}-${state.mode}`)
      win.hide()
    }
    const main=windows[0]!
    background.moveTop();main.show();main.moveTop();main.focus();await delay(900);await shot(main,'main-acrylic-reactivated');main.hide()
    const browser=windows[1]!,guest=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})
    browser.contentView.addChildView(guest);guest.setBounds({x:0,y:88,width:900,height:512})
    await guest.webContents.loadURL('data:text/html,<html><body style="background:%23fff"><h2>Live WebContentsView</h2><script>window.fixtureIdentity=Math.random();window.ticks=0;setInterval(()=>window.ticks++,50)</script></body></html>')
    const identity=await guest.webContents.executeJavaScript('window.fixtureIdentity'),id=guest.webContents.id
    config.app.window_acrylic=false;config.app.appearance_mode='dark';apply()
    for(const win of windows){await waitFor(win,"document.documentElement.dataset.navoraWindowMaterial==='solid'");assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).reason,'disabled');assert.notEqual((await inspect(win)).app,'rgba(0, 0, 0, 0)');assert.equal(win.getBackgroundColor().toLowerCase(),appearancePalette('mist','dark',false).shell.toLowerCase())}
    check('switch off restores dark solid clear color and revokes all renderer transparency')
    background.moveTop();browser.show();browser.moveTop();browser.focus();await delay(900);await shot(browser,'browser-solid-dark');browser.hide()
    config.app.window_acrylic=true;config.app.appearance_mode='auto';forced={highContrast:true};apply()
    for(const win of windows){await waitFor(win,"document.documentElement.dataset.navoraWindowMaterial==='solid'");assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).reason,'high_contrast')}
    check('observable accessibility fallback reaches all three existing hosts')
    forced={};config.app.appearance_mode='dark';apply()
    for(const win of windows){
      await waitFor(win,"document.documentElement.dataset.navoraWindowMaterial==='acrylic'&&document.documentElement.dataset.navoraColorScheme==='dark'")
      assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).systemDark,false)
      assert.match((await inspect(win)).title,/0\.84\)/)
      background.moveTop();win.show();win.moveTop();win.focus();await delay(500);await shot(win,`${manager.stateFor(win.webContents,win.webContents.mainFrame).role}-acrylic-app-dark-system-light`);win.hide()
    }
    assert.equal(nativeTheme.themeSource,'light')
    assert.equal(await guest.webContents.executeJavaScript("matchMedia('(prefers-color-scheme:dark)').matches"),false)
    check('forced dark application keeps all host materials and does not change guest media queries')
    nativeTheme.themeSource='dark';config.app.appearance_mode='light';apply()
    for(const win of windows){
      await waitFor(win,"document.documentElement.dataset.navoraWindowMaterial==='acrylic'&&document.documentElement.dataset.navoraColorScheme==='light'")
      assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).systemDark,true)
      assert.match((await inspect(win)).title,/0\.94\)/)
    }
    background.moveTop();main.show();main.moveTop();main.focus();await delay(500);await shot(main,'main-acrylic-app-light-system-dark');main.hide()
    assert.equal(nativeTheme.themeSource,'dark')
    check('forced light application keeps material over an isolated dark native theme')
    config.app.appearance_mode='auto';apply();await delay(200)
    for(const win of windows){await waitFor(win,"document.documentElement.dataset.navoraColorScheme==='dark'");assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).dark,true)}
    nativeTheme.themeSource='light';apply()
    for(const win of windows){await waitFor(win,"document.documentElement.dataset.navoraColorScheme==='light'");assert.equal(manager.stateFor(win.webContents,win.webContents.mainFrame).dark,false)}
    check('automatic appearance follows isolated native system-theme transitions')
    if(manager.stateFor(main.webContents,main.webContents.mainFrame).mode==='acrylic'){
      const original=main.setBackgroundMaterial.bind(main)
      main.setBackgroundMaterial=(value)=>{if(value==='acrylic')throw Error('fixture: observable material API failure');original(value)}
      config.app.appearance_theme='sage';apply()
      await waitFor(main,"document.documentElement.dataset.navoraWindowMaterial==='solid'")
      assert.equal(manager.stateFor(main.webContents,main.webContents.mainFrame).reason,'native_error')
      assert.notEqual((await inspect(main)).title,'rgba(0, 0, 0, 0)')
      assert.equal(main.getBackgroundColor().toLowerCase(),appearancePalette('sage','auto',nativeTheme.shouldUseDarkColors).shell.toLowerCase())
      check('injected observable native API failure revokes real renderer transparency and restores solid theme')
      main.setBackgroundMaterial=original;config.app.appearance_theme='mist';apply()
    }
    assert.equal(guest.webContents.id,id);assert.equal(await guest.webContents.executeJavaScript('window.fixtureIdentity'),identity);assert.ok(await guest.webContents.executeJavaScript('window.ticks>0'))
    check('material toggles keep the same live WebContentsView document running')
    guest.webContents.close()
    const report={electron:process.versions.electron,environment:environment(),checks,shots,captureFocus,visualStatus:'Controlled fixture screenshots require visual inspection. Host state reports a request, not DWM success. Opposite tone combinations use translucent application colors over the actual system material, not an independent DWM tone API.',accessibilityTesting:'Real public nativeTheme flags were read; fallback transitions use injected environment conditions rather than changing OS accessibility settings. Light/dark native themeSource is set only in this isolated test process.',unverified:['Other OS builds','mixed DPI','IME','remote desktop','DWM silent fallback','battery policy']}
    fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0)
  }catch(error){console.error(error);app.exit(1)}finally{for(const win of windows)if(!win.isDestroyed())win.destroy();if(background&&!background.isDestroyed())background.destroy()}
}).catch(error=>{console.error(error);app.exit(1)})
