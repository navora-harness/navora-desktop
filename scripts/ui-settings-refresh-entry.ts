import {app,BrowserWindow,ipcMain} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createDefaultConfig,modesForPreset} from '../shared/config'
import {getUiIcon} from '../shared/ui-icons'
import {version as productVersion} from '../package.json'

const profile=process.env.NAVORA_DATA_ROOT!,project=process.env.NAVORA_NATIVE_PROJECT!,output=process.env.NAVORA_UI_OUTPUT!,chat='chat_settings_refresh_fixture'
const installedOnly=process.env.NAVORA_SETTINGS_ABOUT_INSTALLED_ONLY==='1',resultName=installedOnly?'about-installed-result.json':'result.json',failureName=installedOnly?'about-installed-failed':'failed'
const profileRelative=profile&&path.relative(path.resolve(os.tmpdir()),path.resolve(profile))
if(!profile||!path.isAbsolute(profile)||!project||!output||!profileRelative||path.isAbsolute(profileRelative)||profileRelative.startsWith('..')||!path.basename(path.dirname(profile)).startsWith('navora-settings-refresh-')||path.basename(profile)!=='profile')throw Error('An isolated temporary settings profile is required')
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const config=createDefaultConfig()
config.app.onboarding_completed=true;config.app.appearance_mode='light';config.remote.enabled=false;config.ai.providers=[];config.ai.default_provider='';config.files.custom_root=path.join(profile,'workspaces')
fs.writeFileSync(path.join(profile,'config.yml'),JSON.stringify(config));fs.mkdirSync(path.join(profile,'chats'),{recursive:true})
fs.writeFileSync(path.join(profile,'chats',chat+'.json'),JSON.stringify({id:chat,title:'设置界面检查',createdAt:Date.now(),updatedAt:Date.now(),permissions:config.permissions,messages:[{id:'settings-user',role:'user',content:'这是一段合成的设置界面检查对话。',createdAt:Date.now()-1000},{id:'settings-answer',role:'assistant',content:'仅检查设置界面，不调用模型。',createdAt:Date.now()}]}))
const showInactive=BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);showInactive.call(this)}
BrowserWindow.prototype.focus=function(){}
const checks:string[]=[],errors:string[]=[],screenshots:string[]=[],observations:unknown[]=[],permissionCommits:unknown[]=[]
let started=false,modelRequests=0,actualPortable:boolean|undefined
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
  if(channel==='navora:agent.run'){modelRequests++;throw Error('Settings fixture must not invoke an Agent')}
  const result=await listener(event,...args)
  if(channel==='navora:app.info'&&installedOnly){actualPortable=result.portable;return {...result,portable:false}}
  if(channel==='navora:config.commit'&&args[0]?.patch?.permissions)permissionCommits.push(structuredClone(args[0]))
  return result
})
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>|unknown,label:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await check())return;await wait(40)}throw Error('Timed out: '+label)}
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=(code:string):Promise<any>=>win.webContents.executeJavaScript(code)
    const visible=(selector:string)=>js(`!![...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility())`)
    const click=async(selector:string)=>{await js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing: '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});el.click()})()`);await wait(70)}
    const selected=()=>js('document.querySelector(".perm-preset .v-select__selection-text")?.textContent.trim()')
    const savedPermissions=()=>js('window.navora.config.get().then(config=>config.permissions)')
    const tab=async(label:string)=>{
      await js(`(()=>{const el=[...document.querySelectorAll('.settings-navigation .nav-item')].find(el=>el.querySelector('.nav-label')?.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('Missing settings category: '+${JSON.stringify(label)});el.click()})()`)
      await until(()=>js(`document.querySelector('.settings-page .section-head h2')?.textContent.trim()===${JSON.stringify(label)}`),'settings category '+label)
      await js('document.querySelector(".settings-page #settings-content").scrollTo({top:0})');await wait(100)
    }
    const fits=async(selector:string)=>{
      const bounds=await js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing bounds: '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,client:el.clientWidth,scroll:el.scrollWidth}})()`)
      assert.ok(bounds.left>=-1&&bounds.right<=bounds.viewportWidth+1,selector+' exceeds window: '+JSON.stringify(bounds))
      assert.ok(bounds.scroll<=bounds.client+2,selector+' has horizontal overflow: '+JSON.stringify(bounds))
      return bounds
    }
    const capture=async(name:string)=>{
      await js('document.fonts.ready');await wait(180)
      const image=await win.webContents.capturePage(undefined,{stayHidden:true}),size=image.getSize()
      assert.ok(size.width>100&&size.height>100,'Capture contains the actual renderer')
      const file=name+'.png';fs.writeFileSync(path.join(output,file),image.toPNG());screenshots.push(file)
      observations.push({screenshot:file,size,theme:await js('document.documentElement.dataset.navoraColorScheme'),settingsBounds:await fits('.settings-page')})
    }
    const openConfirm=async()=>{
      // Vuetify opens selects from mousedown:control rather than click alone.
      await js('(()=>{const field=document.querySelector(".perm-preset .v-field");field.scrollIntoView({block:"nearest"});field.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0}))})()')
      await until(()=>js('[...document.querySelectorAll(".v-overlay--active .v-list-item")].some(el=>el.checkVisibility()&&el.textContent.trim()==="放手")'),'permission preset choices')
      await js('(()=>{const el=[...document.querySelectorAll(".v-overlay--active .v-list-item")].find(el=>el.checkVisibility()&&el.textContent.trim()==="放手");el.click()})()')
      await until(()=>visible('[data-settings-permission-confirm]'),'permission confirmation card')
      await until(()=>js('document.activeElement?.id==="settings-permission-keep"'),'safe initial confirmation focus')
      assert.equal(await visible('.settings-permission-confirm-overlay'),true)
      assert.equal(await selected(),'均衡','Opening confirmation retains the selected preset')
      const bounds=await fits('.settings-permission-confirm-overlay .skill-dlg-card')
      assert.ok(bounds.top>=-1&&bounds.bottom<=bounds.viewportHeight+1,'Confirmation fits the window vertically')
      assert.match(await js('document.querySelector("[data-settings-permission-confirm]").textContent'),/确认.*自动保存/)
    }
    const closedConfirm=()=>until(async()=>!await visible('[data-settings-permission-confirm]'),'permission confirmation closed')
    const unchanged=async(baseline:unknown,commits:number)=>{await wait(650);assert.equal(await selected(),'均衡');assert.deepEqual(await savedPermissions(),baseline);assert.equal(permissionCommits.length,commits)}
    const theme=async(mode:'light'|'dark')=>{
      await tab('外观');await click(`[data-appearance-mode="${mode}"]`)
      await until(()=>js(`document.documentElement.dataset.navoraColorScheme===${JSON.stringify(mode)}&&document.querySelector('[data-appearance-mode="${mode}"]')?.getAttribute('aria-pressed')==='true'`),'saved '+mode+' appearance')
      await until(()=>js(`window.navora.config.get().then(config=>config.app.appearance_mode===${JSON.stringify(mode)})`),'appearance persisted');await wait(100)
    }
    const about=async()=>{
      await tab('关于');await until(()=>visible('[data-about-version]'),'application version')
      const info=await js('window.navora.app.info()'),details=await js('(()=>{const card=document.querySelector(".about-card"),version=card.querySelector("[data-about-version]"),engine=card.querySelector(".about-dl dd"),image=card.querySelector("img");return {text:card.textContent,name:card.querySelector(".about-name")?.textContent.trim(),version:version?.textContent.trim(),versionSize:parseFloat(getComputedStyle(version).fontSize),engineSize:parseFloat(getComputedStyle(engine).fontSize),fields:[...card.querySelectorAll("dt")].map(el=>el.textContent.trim()),portable:!!card.querySelector(".about-portable"),logo:!!image&&image.complete&&image.naturalWidth>0,links:card.querySelectorAll("a").length}})()')
      assert.equal(details.name,'Navora');assert.equal(details.version,productVersion);assert.equal(info.version,productVersion)
      assert.deepEqual(details.fields,['Electron','Chromium']);assert.ok(details.versionSize>details.engineSize)
      assert.equal(details.portable,!!info.portable);assert.equal(details.logo,true);assert.equal(details.links,0)
      for(const excluded of ['数据目录','运行模式','安装版',profile])assert.equal(details.text.includes(excluded),false,'About omits '+excluded)
      await fits('.about-card');observations.push({phase:'about',version:details.version,fields:details.fields,portable:details.portable})
    }
    try{
      win.setMinimumSize(0,0);win.setContentSize(1440,920)
      await until(()=>visible('.composer'),'main Vue application')
      if(installedOnly){
        await js('location.hash="#/?settings=about"');await until(()=>visible('.about-card'),'About through real settings route')
        await about();assert.equal(await visible('.about-portable'),false);await capture('11-about-installed-light')
        await js('window.navora.config.save({app:{appearance_mode:"dark"}})')
        await until(()=>js('document.documentElement.dataset.navoraColorScheme==="dark"'),'dark About theme')
        await about();assert.equal(await visible('.about-portable'),false);await capture('12-about-installed-dark')
        assert.equal(modelRequests,0);assert.deepEqual(errors,[])
        checks.push('synthetic-AppInfo-portable-false-hides-portable-badge-and-runtime-details-in-both-themes')
        fs.writeFileSync(path.join(output,resultName),JSON.stringify({ok:true,checks,screenshots,observations,errors,modelRequests,actualRuntimePortable:actualPortable,syntheticAppInfo:{portable:false},scope:'Actual built main/Vue/preload and isolated synthetic profile. Only app.info().portable is overridden to false inside this fixture to exercise the installed About display branch. This does not launch an installed package or change the production runtime mode/API. No personal data, model calls or global input.'},null,2))
        app.exit(0);return
      }
      await js('location.hash="#/?settings=appearance"')
      await until(()=>visible('.settings-page [data-appearance-mode="light"]'),'real settings route')
      const icon=await js('(()=>{const nav=[...document.querySelectorAll(".settings-navigation .nav-item")].find(el=>el.querySelector(".nav-label")?.textContent.trim()==="外观"),svg=nav?.querySelector("svg");return {name:svg?.dataset.icon,size:Number(svg?.dataset.iconSize),paths:[...svg.querySelectorAll("path")].map(path=>path.getAttribute("d"))}})()')
      assert.equal(icon.name,'palette');assert.deepEqual(icon.paths,getUiIcon('palette',icon.size).paths.map(item=>item.d));checks.push('appearance-entry-renders-official-Fluent-color-icon')
      await fits('.settings-page #settings-content');await capture('01-appearance-light-wide')
      await tab('权限');await until(async()=>await selected()==='均衡','balanced baseline')
      const baseline=await savedPermissions(),before=permissionCommits.length
      assert.deepEqual(baseline,config.permissions)
      await openConfirm();await capture('02-permission-confirm-light-wide');await click('#settings-permission-keep');await closedConfirm();await unchanged(baseline,before)
      checks.push('cancel-retains-preset-and-all-persisted-permission-modes')
      await openConfirm();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await closedConfirm();await unchanged(baseline,before)
      checks.push('targeted-Escape-cancels-without-saving-permissions')
      await openConfirm();await click('.settings-permission-confirm-overlay .skill-dlg-close');await closedConfirm();await unchanged(baseline,before)
      checks.push('close-button-cancels-without-saving-permissions')
      await about();await capture('03-about-light-wide')
      await theme('dark');await capture('04-appearance-dark-wide')
      await tab('权限');await openConfirm();await capture('05-permission-confirm-dark-wide');await click('#settings-permission-keep');await closedConfirm();await unchanged(baseline,before)
      await about();await capture('06-about-dark-wide')
      win.setContentSize(640,820);await wait(180)
      await theme('dark');await fits('.settings-page #settings-content');await capture('07-appearance-dark-narrow')
      await tab('权限');await openConfirm();await capture('08-permission-confirm-dark-narrow');await click('#settings-permission-keep');await closedConfirm();await unchanged(baseline,before)
      await about();await capture('09-about-dark-narrow');checks.push('appearance-confirmation-and-about-fit-light-dark-and-narrow-layouts')
      win.setContentSize(1440,920);await wait(100);await tab('权限');await openConfirm()
      await js('(()=>{const button=document.querySelector("#settings-permission-switch");button.click();button.click()})()')
      await closedConfirm();await until(async()=>await selected()==='放手','confirmed preset shown')
      await until(async()=>(await savedPermissions()).preset==='open','confirmed preset automatically saved')
      await wait(650);assert.equal(permissionCommits.length,before+1,'One explicit confirmation produces one permission commit')
      assert.deepEqual(await savedPermissions(),{...baseline,preset:'open',modes:modesForPreset('open')})
      assert.deepEqual(await js(`window.navora.chats.get(${JSON.stringify(chat)}).then(chat=>chat.permissions)`),baseline,'A conversation with existing messages keeps its own permissions')
      checks.push('explicit-confirmation-saves-once-and-keeps-existing-conversation-permissions')
      await capture('10-permissions-confirmed-dark-wide')
      assert.equal(modelRequests,0);assert.deepEqual(errors,[])
      fs.writeFileSync(path.join(output,resultName),JSON.stringify({ok:true,checks,screenshots,observations,errors,permissionCommits:permissionCommits.length,modelRequests,scope:'Actual main/Vue/preload, isolated synthetic profile and chat. Real settings route and DOM controls. Escape is a targeted WebContents input event; no global input, personal data, model calls or NativePanel screenshots. Permission confirmation retains existing automatic saving semantics.'},null,2))
      app.exit(0)
    }catch(error){
      console.error(error)
      try{fs.writeFileSync(path.join(output,failureName+'.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:undefined,checks,screenshots,errors,permissionCommits,modelRequests,observations},null,2));fs.writeFileSync(path.join(output,failureName+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())}catch{}
      app.exit(1)
    }
  })())
})
await import('../electron/main')
