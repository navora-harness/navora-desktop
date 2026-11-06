const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
app.setPath('userData',process.env.NAVORA_SETTINGS_PROFILE)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[]
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}})
  const js=code=>win.webContents.executeJavaScript(code)
  const until=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await wait(30)}throw Error('Timeout: '+code)}
  const check=async(name,code)=>{assert.equal(await js(code),true,name);checks.push(name);console.log('[material-settings] PASS',name)}
  const control='document.querySelector('+JSON.stringify('input[aria-label="窗口透明与模糊"]')+')'
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  win.webContents.on('paint',()=>{});win.webContents.setFrameRate(30)
  try{
    await win.loadURL(process.env.NAVORA_SETTINGS_URL)
    await until('!!window.settingsFixture');await js('document.querySelector("#settingsGear").click()')
    await until('!!document.querySelector(".settings-page .shell")')
    await js('[...document.querySelectorAll(".settings-navigation .nav-item")].find(e=>e.textContent.includes("外观")).click()')
    await until('!!'+control)
    await check('unknown host capability disables the actual setting without rewriting its preference',`${control}.disabled&&settingsFixture.saved.app.window_acrylic===false&&settingsFixture.commits===0`)
    await js('settingsFixture.setMaterial({supported:true,supportReason:"supported",requested:false,mode:"solid",reason:"disabled"})')
    await until('!'+control+'.disabled')
    await check('supported but switched-off host leaves the setting available',`!${control}.checked&&!${control}.disabled`)
    await js(control+'.click()');await until('settingsFixture.saved.app.window_acrylic===true')
    await check('supported off to on persists through the real automatic-save flow',`${control}.checked&&settingsFixture.commits===1`)
    await js('settingsFixture.setMaterial({supported:true,supportReason:"supported",mode:"solid",reason:"high_contrast"})')
    await until('!'+control+'.disabled')
    await check('temporary accessibility fallback does not masquerade as unsupported platform',`!${control}.disabled&&${control}.checked&&settingsFixture.saved.app.window_acrylic===true`)
    await js('settingsFixture.setMaterial({supported:true,supportReason:"supported",mode:"solid",reason:"tone_mismatch"})')
    await check('temporary tone fallback still allows preference changes',`!${control}.disabled`)
    for(const reason of ['windows_version','platform','api_unavailable','system_unknown']){
      const before=await js('settingsFixture.commits')
      await js(`settingsFixture.setMaterial({supported:false,supportReason:${JSON.stringify(reason)},mode:"solid",reason:${JSON.stringify(reason)}})`)
      await until(control+'.disabled');await js(control+'.click()');await wait(180)
      await check(reason+' disables input, preserves the saved choice, and sends no save',`${control}.disabled&&${control}.checked&&settingsFixture.saved.app.window_acrylic===true&&settingsFixture.commits===${before}`)
    }
    await js('document.querySelector(".settings-back").click()');await until('!settingsFixture.open')
    const before=await js('settingsFixture.commits')
    await js('window.navora.app.platform="web";document.querySelector("#settingsGear").click()')
    await until('!!'+control);await js(control+'.click()');await wait(180)
    await check('remote settings stay disabled without rewriting the host preference',`${control}.disabled&&settingsFixture.saved.app.window_acrylic===true&&settingsFixture.commits===${before}`)
    assert.deepEqual(errors,[])
    const output=path.resolve('artifacts/settings-material-control');fs.mkdirSync(output,{recursive:true})
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({ok:true,checks,boundary:'Hidden Electron renderer loads actual SettingsPage/Vuetify source through isolated Vite. Host state and config persistence are controlled bridges; native policy/IPC ownership have separate tests. No desktop capture or installed profile read.'},null,2))
    win.destroy();app.exit(0)
  }catch(error){console.error(error);win.destroy();app.exit(1)}
}).catch(error=>{console.error(error);app.exit(1)})
