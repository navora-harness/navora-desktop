import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../shared/config'

const root = process.env.NAVORA_DATA_ROOT!
const output = process.env.NAVORA_UI_OUTPUT!
const config = createDefaultConfig()
const reducedMotion = process.env.NAVORA_UI_REDUCED_MOTION === '1'
if(reducedMotion) app.commandLine.appendSwitch('force-prefers-reduced-motion','1')
config.app.onboarding_completed = true
config.app.show_main_on_start = true
// Use the product's own configuration loader, IPC, preload and renderer in an isolated profile.
// JSON is also valid YAML, and contains only default test configuration.
fs.writeFileSync(path.join(root,'config.yml'),JSON.stringify(config))
app.setPath('userData',root)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve,ms))
let tested = false

app.on('browser-window-created',(_event,win) => {
  if (tested) return
  tested = true
  win.webContents.setBackgroundThrottling(false)
  if(win.webContents.isOffscreen()) {
    win.webContents.setFrameRate(60)
    win.webContents.on('paint',() => {})
  }
  const errors: string[] = []
  win.webContents.on('console-message',(event) => { if(event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load',() => {
    void (async () => {
      try {
        for(let i=0;i<50;i++) {
          if(await win.webContents.executeJavaScript('!!window.navora && !!document.querySelector(".composer")')) break
          await wait(100)
        }
        assert.equal(await win.webContents.executeJavaScript('!!window.navora'),true,'Product preload must expose the API')
        assert.equal(await win.webContents.executeJavaScript('!!document.querySelector(".composer")'),true)
        if(reducedMotion) assert.equal(await win.webContents.executeJavaScript(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true)
        win.setMinimumSize(0,0)
        win.setContentSize(1440,900)
        await wait(300)
        const capture = async (name: string) => {
          await win.webContents.capturePage(undefined,{stayHidden:true})
          await wait(150)
          fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG())
        }
        await capture('navora-desktop.png')
        assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.sidebar')).backgroundColor`),'rgb(239, 241, 245)')
        const menuButton = `document.querySelector('.sidebar-foot button[title="更多"]')`
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(500)
        await capture('navora-menu.png')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.v-menu.v-overlay--active')`),true)
        assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.sidebar-more-item')).color`),'rgb(26, 35, 50)')
        await win.webContents.executeJavaScript(`${menuButton}.click()`)
        await wait(500)
        await win.webContents.executeJavaScript(`(async()=>{const button=${menuButton};for(let i=0;i<4;i++){button.click();await new Promise(resolve=>setTimeout(resolve,25))}})()`)
        await wait(500)
        await capture('navora-menu-closed.png')
        await wait(450)
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[data-pp-menu-pending]').length`),0)
        assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(${menuButton}).opacity`),'1')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.sidebar-settings-btn')`),true)
        await win.webContents.executeJavaScript(`document.querySelector('.sidebar-settings-btn').click()`)
        await wait(700)
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-dialog-content')`),true)
        await capture('navora-settings.png')
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.settings-close')`),true)
        await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`)
        await wait(500)
        win.setContentSize(390,844)
        await wait(300)
        await capture('navora-mobile.png')
        const layout = await win.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth,mobile:!!document.querySelector('.mobile-layout'),sidebarTransform:getComputedStyle(document.querySelector('.sidebar')).transform,sidebarOpen:document.querySelector('.shell').classList.contains('sidebar-open')})`)
        assert.equal(layout.mobile,true)
        assert.equal(layout.sidebarOpen,false)
        assert.notEqual(layout.sidebarTransform,'none')
        assert.ok(layout.scroll <= layout.width + 1,'No horizontal page overflow')
        assert.deepEqual(errors,[])
        console.log(JSON.stringify({ok:true,reducedMotion,checks:['real-app-preload','desktop-shell','postpile-theme','menu-open-close','menu-interruption-cleanup','settings-dialog','close-button','mobile-layout'],output}))
        app.exit(0)
      } catch(error) {
        console.error(error)
        if(errors.length) console.error(JSON.stringify({rendererErrors:errors}))
        app.exit(1)
      }
    })()
  })
})

void import('../electron/main')
