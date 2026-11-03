import {app,BrowserWindow,nativeTheme} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {APPEARANCE_THEMES,appearancePalette} from '../shared/appearance'
import {ConfigService} from '../electron/modules/config-service'

const root=process.env.NAVORA_DATA_ROOT!,output=process.env.NAVORA_UI_OUTPUT!
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('force-device-scale-factor','1')
app.setPath('userData',root)
nativeTheme.themeSource='light'
const config=createDefaultConfig();config.app.onboarding_completed=true;config.remote.enabled=false
delete config.app.appearance_theme
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
fs.mkdirSync(path.join(root,'chats'),{recursive:true})
fs.writeFileSync(path.join(root,'chats','chat_appearance.json'),JSON.stringify({id:'chat_appearance',title:'主题切换验证',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}))
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>Promise<unknown>,label:string){for(let i=0;i<120;i++){if(await check())return;await wait(60)}throw Error('Timed out: '+label)}
let started=false
app.on('browser-window-created',(_event,win)=>{
 if(started)return;started=true
 win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=(code:string)=>win.webContents.executeJavaScript(code)
  try{
   await until(()=>js('!!document.querySelector(".composer")&&document.documentElement.dataset.navoraTheme==="mist"'),'default theme and main UI')
   win.setContentSize(1560,1000)
   if(!await js('!!document.querySelector(".file-workspace [role=tab]")'))await js('document.querySelector("[data-chat-resource=workspace]").click()')
   await until(()=>js('!!document.querySelector(".browser-start-page")'),'browser start')
   const page=await js('(async()=>(await window.navora.browser.workspace.state()).pages.flatMap(s=>s.windows)[0].windowId)()')
   await js('window.navora.browser.workspace.detach('+JSON.stringify(page)+')')
   await until(()=>Promise.resolve(BrowserWindow.getAllWindows().some(w=>w!==win&&w.webContents.getURL().includes('browser-host'))),'detached host')
   const host=BrowserWindow.getAllWindows().find(w=>w!==win&&w.webContents.getURL().includes('browser-host'))!
   await until(()=>host.webContents.executeJavaScript('document.documentElement.dataset.navoraTheme==="mist"'),'new host theme')
   await js('document.querySelector(".sidebar-settings-btn").click()')
   await until(()=>js('!!document.querySelector("input[max=\\"200000\\"]")'),'basic settings')
   await js('(()=>{const input=document.querySelector("input[max=\\"200000\\"]");input.value="24000";input.dispatchEvent(new Event("input",{bubbles:true}))})()')
   await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(b=>b.textContent.includes("外观")).click()')
   await until(()=>js('document.querySelectorAll("[data-appearance-theme]").length==='+APPEARANCE_THEMES.length),'appearance choices')
   await js('document.querySelector("[data-appearance-mode=light]").click()')
   await until(()=>js('(async()=>(await window.navora.config.get()).app.appearance_mode==="light")()'),'light mode saved')
   for(const theme of APPEARANCE_THEMES){
    await js('document.querySelector("[data-appearance-theme='+theme.id+']").click()')
    const matches='document.documentElement.dataset.navoraTheme==='+JSON.stringify(theme.id)
    await until(()=>js('(async()=>'+matches+'&&(await window.navora.config.get()).app.appearance_theme==='+JSON.stringify(theme.id)+')()'),'main saves '+theme.id)
    await until(()=>host.webContents.executeJavaScript(matches),'host synchronizes '+theme.id)
    const layering=await js('(()=>{const s=x=>getComputedStyle(document.querySelector(x));return {shell:s(".window-titlebar").backgroundColor,rail:s(".activity-rail").backgroundColor,radius:s(".content-surface").borderTopLeftRadius}})()')
    assert.equal(layering.shell,layering.rail);assert.equal(layering.radius,'12px')
    assert.equal(new ConfigService(root).get().app.appearance_theme,theme.id,'A new service restores the theme')
    assert.equal(new ConfigService(root).get().app.max_composer_chars,config.app.max_composer_chars,'Unrelated numeric edits stay unapplied')
    assert.equal(await js('document.querySelector(".settings-save-status").textContent.includes("组未保存")'),true,'Unapplied edits stay in the draft')
    await wait(180)
    fs.writeFileSync(path.join(output,'appearance-settings-'+theme.id+'.png'),(await win.webContents.capturePage()).toPNG())
   }
   async function expectScheme(scheme:'light'|'dark'){
    await until(()=>js('document.documentElement.dataset.navoraColorScheme==='+JSON.stringify(scheme)),'main scheme '+scheme)
    await until(()=>host.webContents.executeJavaScript('document.documentElement.dataset.navoraColorScheme==='+JSON.stringify(scheme)),'browser scheme '+scheme)
   }
   await js('document.querySelector("[data-appearance-mode=dark]").click()')
   await expectScheme('dark')
   for(const theme of APPEARANCE_THEMES){
    await js('document.querySelector("[data-appearance-theme='+theme.id+']").click()')
    await until(()=>host.webContents.executeJavaScript('document.documentElement.dataset.navoraTheme==='+JSON.stringify(theme.id)),'dark browser theme '+theme.id)
    await wait(140)
    fs.writeFileSync(path.join(output,'appearance-dark-'+theme.id+'.png'),(await win.webContents.capturePage()).toPNG())
   }
   nativeTheme.themeSource='light'
   await expectScheme('dark')
   await js('document.querySelector("[data-appearance-mode=light]").click()')
   await expectScheme('light')
   nativeTheme.themeSource='dark'
   await wait(160)
   await expectScheme('light')
   await js('document.querySelector("[data-appearance-mode=auto]").click()')
   await expectScheme('dark')
   nativeTheme.themeSource='light'
   await expectScheme('light')
   const lastTheme=APPEARANCE_THEMES[APPEARANCE_THEMES.length-1]!.id
   const palette=appearancePalette(lastTheme,'auto',false)
   assert.equal(win.getBackgroundColor().toUpperCase(),palette.shell.toUpperCase(),'Native chrome follows the same palette')
   assert.equal(host.getBackgroundColor().toUpperCase(),palette.shell.toUpperCase())
   await host.loadFile(path.join(process.cwd(),'dist','index.html'),{hash:host.webContents.getURL().split('#')[1]})
   await until(()=>host.webContents.executeJavaScript('document.documentElement.dataset.navoraTheme==='+JSON.stringify(lastTheme)).catch(()=>false),'reloaded browser restores theme')
   await js('document.querySelector("[data-appearance-theme=sage]").click();document.querySelector(".settings-back").click()')
   await until(()=>js('(async()=>(await window.navora.config.get()).app.appearance_theme==="sage")()'),'closing settings flushes the theme')
   assert.equal(new ConfigService(root).get().app.appearance_theme,'sage')
   assert.equal(new ConfigService(root).get().app.appearance_mode,'auto')
   await until(()=>js('!!document.querySelector(".model-panel-trigger")'),'conversation after settings')
   await js('window.navora.config.save({app:{appearance_mode:"dark"}})')
   await expectScheme('dark')
   await js('document.querySelector(".model-panel-trigger").click()')
   await until(()=>js('!!document.querySelector(".unified-model-panel .composer-perm-item-label")'),'dark model popup')
   const popup=await js('(()=>{const panel=document.querySelector(".unified-model-panel"),label=panel.querySelector(".composer-perm-item-label"),c=getComputedStyle(panel);return {surface:c.backgroundColor,ink:c.color,label:getComputedStyle(label).color}})()')
   assert.equal(popup.label,popup.ink,'Teleported model labels inherit the active dark palette')
   assert.notEqual(popup.surface,'rgb(255, 255, 255)','The model popup is not a hardcoded white surface in dark mode')
   await wait(220)
   fs.writeFileSync(path.join(output,'appearance-dark-model-menu.png'),(await win.webContents.capturePage()).toPNG())
   await js('document.querySelector("[aria-label=关闭模型面板]").click();document.querySelector(".usage-ring-btn").click()')
   await until(()=>js('!!document.querySelector(".composer-usage-panel")'),'dark usage popup')
   assert.equal(await js('getComputedStyle(document.querySelector(".composer-usage-panel")).color'),popup.ink,'Usage popup uses the same theme text colour')
   assert.equal(await js('getComputedStyle(document.querySelector(".composer-usage-row strong")).color'),popup.ink,'Estimated values remain readable in the dark palette')
   assert.equal(await js('(()=>{const r=document.querySelector(".usage-dot.message-history").getBoundingClientRect();return r.width<=12&&r.height<=12})()'),true,'The usage legend is a compact dot and does not inherit transcript layout')
   await wait(220)
   fs.writeFileSync(path.join(output,'appearance-dark-usage-menu.png'),(await win.webContents.capturePage()).toPNG())
   console.log('Appearance checks passed: themes, light/dark/auto, system changes, native captions, cross-window sync, reload, persistence, draft isolation and close-time save.')
   fs.writeFileSync(path.join(output,'appearance-completed.json'),JSON.stringify({ok:true,themes:APPEARANCE_THEMES.map(t=>t.id)},null,2))
   app.exit(0)
  }catch(error){console.error(error);fs.writeFileSync(path.join(output,'appearance-failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1)}
 })())
})
await import('../electron/main')
