import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createDefaultConfig} from '../shared/config'
import {BrowserRegistry} from '../electron/modules/browser-registry'
import {configureBrowserAutomation} from '../electron/modules/browser-automation-controller'

app.setPath('userData',process.env.NAVORA_AUDIO_PROFILE!)
app.commandLine.appendSwitch('disable-gpu')
app.on('window-all-closed',()=>{})
void app.whenReady().then(async()=>{
  const config=createDefaultConfig(),registry=new BrowserRegistry(()=>config),host=new BrowserWindow({show:false,width:1000,height:800})
  registry.hosts.bindMain(host)
  const session=registry.createSession('audio-smoke',{persist:false}),created=registry.createWindow(session.sessionId,{url:'about:blank',show:false})
  const page=registry.assertWindowOwned('audio-smoke',created.windowId).win
  const checks:string[]=[]
  const check=(stage:string,muted:boolean)=>{
    const tree=registry.getTree('audio-smoke').flatMap(session=>session.windows).find(item=>item.windowId===page.id)
    assert.equal(page.webContents.isAudioMuted(),muted,stage)
    assert.equal(tree?.muted,muted,stage+' tree state')
    assert.equal(tree?.manualMuted,muted,stage+' manual preference')
    assert.equal(tree?.muteReason,muted?'manual':undefined,stage+' label')
    checks.push(stage)
  }
  try{
    await configureBrowserAutomation(config.browser.automation)
    await page.webContents.loadURL('about:blank')
    check('new-page-keeps-sound',false)
    await page.automation.claimRun('audio-run');check('task-start-keeps-sound',false)
    await page.automation.run({runId:'audio-run'},async operation=>{
      check('operation-keeps-sound',false)
      await operation.setActivity('waiting');check('waiting-keeps-sound',false)
    })
    check('between-operations-keeps-sound',false)
    registry.setPageMuted(page,true);check('manual-mute-during-task',true)
    await page.automation.run({runId:'audio-run'},async()=>{check('operation-preserves-manual-mute',true)})
    await page.automation.pause();check('pause-preserves-manual-mute',true)
    await page.automation.resume();check('resume-preserves-manual-mute',true)
    await page.automation.finishRun('audio-run');check('task-finish-preserves-manual-mute',true)
    const snapshot=registry.snapshotTab(page.id)!
    assert.equal(snapshot.muted,true)
    const restored=registry.createFromSnapshot(snapshot,page.hostId!)
    assert.equal(restored.webContents.isAudioMuted(),true)
    checks.push('restored-tab-preserves-manual-mute')
    await page.automation.claimRun('audio-unmute-run')
    registry.setPageMuted(page,false);check('manual-unmute-during-task',false)
    await page.automation.run({runId:'audio-unmute-run'},async()=>{check('next-operation-does-not-remute',false)})
    await page.automation.finishRun('audio-unmute-run');check('task-finish-keeps-manual-unmute',false)
    const output=process.env.NAVORA_AUDIO_OUTPUT!
    fs.mkdirSync(output,{recursive:true})
    fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({checks,runtime:process.versions.electron,scope:'Isolated hidden windows, no network or audible media'},null,2))
    console.log(JSON.stringify({checks,runtime:process.versions.electron}))
  }finally{registry.shutdown();host.destroy();app.quit()}
}).catch(error=>{console.error(error);app.exit(1)})
