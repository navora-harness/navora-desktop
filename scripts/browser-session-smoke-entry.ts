import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserRegistry } from '../electron/modules/browser-registry'
import { createDefaultConfig } from '../shared/config'

const profile=process.env.NAVORA_SESSION_PROFILE!,output=process.env.NAVORA_SESSION_OUTPUT!
app.setPath('userData',path.join(profile,'profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()}
BrowserWindow.prototype.focus=function(){}
const checks:string[]=[],report:Record<string,unknown>={checks}
void app.whenReady().then(async()=>{
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Session fixture</title><input value="draft">')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`
  const registry=new BrowserRegistry(createDefaultConfig),host=new BrowserWindow({show:false}),file=path.join(profile,'sessions.json')
  registry.hosts.bindMain(host);registry.restorePersistent(file,()=>true)
  try{
    const first=registry.createSession('chat-session',{persist:true}),second=registry.createSession('chat-session',{persist:true}),other=registry.createSession('chat-other',{persist:false})
    const partition=first.partition
    registry.updateSession(first.sessionId,{name:'项目资料',isDefault:true});registry.updateSession(other.sessionId,{isDefault:true})
    assert.equal(registry.getTree('chat-session')[0]!.name,'项目资料');assert.equal(registry.getTree('chat-session')[0]!.partition,partition)
    checks.push('rename-preserves-session-id-and-native-partition')
    registry.updateSession(second.sessionId,{isDefault:true})
    assert.equal(registry.getTree('chat-session').filter(session=>session.isDefault).length,1)
    assert.equal(registry.getTree('chat-other')[0]!.isDefault,true)
    registry.updateSession(first.sessionId,{isDefault:true})
    checks.push('one-default-per-chat-without-changing-other-chat')
    const page=registry.createWindow(first.sessionId,{url:'about:blank',show:false}),contents=registry.getWindowRecord(page.windowId)!.win.webContents
    await contents.loadURL(url);await contents.executeJavaScript('localStorage.setItem("retained","yes")')
    const nativeSession=registry.getSessionRecord(first.sessionId)!.ses
    await nativeSession.cookies.set({url,name:'retained-cookie',value:'yes'})
    const closed=await registry.manageSession(first.sessionId,'close-pages')
    assert.equal(closed.closedPages,1);assert.equal(closed.deleted,false);assert.equal(registry.getTree('chat-session')[0]!.windows.length,0)
    assert.equal((await nativeSession.cookies.get({url}))[0]!.value,'yes')
    checks.push('close-pages-preserves-session-and-cookie')
    const reopened=registry.createWindow(first.sessionId,{url:'about:blank',show:false}),again=registry.getWindowRecord(reopened.windowId)!.win.webContents
    await again.loadURL(url);assert.equal(await again.executeJavaScript('localStorage.getItem("retained")'),'yes')
    checks.push('close-and-reopen-preserves-real-site-storage')
    const cancelPage=registry.getWindowRecord(reopened.windowId)!.win,originalClose=cancelPage.close
    cancelPage.close=()=>{cancelPage.emit('close-cancelled')}
    await assert.rejects(registry.manageSession(first.sessionId,'clear-data'),/browser_session_close_cancelled/)
    assert.equal((await nativeSession.cookies.get({url}))[0]!.value,'yes')
    assert.equal(cancelPage.isDestroyed(),false)
    cancelPage.close=originalClose
    checks.push('cancelled-page-close-prevents-site-data-cleanup')
    const cleaned=await registry.manageSession(first.sessionId,'clear-data')
    assert.equal(cleaned.deleted,false);assert.equal(cleaned.remainingPages,0);assert.equal((await nativeSession.cookies.get({url})).length,0)
    const retained=registry.getTree('chat-session').find(session=>session.sessionId===first.sessionId)!
    assert.equal(retained.name,'项目资料');assert.equal(retained.isDefault,true)
    checks.push('clear-data-keeps-metadata-and-confirms-cookie-clear')
    const cleanPage=registry.createWindow(first.sessionId,{url:'about:blank',show:false}),cleanContents=registry.getWindowRecord(cleanPage.windowId)!.win.webContents
    await cleanContents.loadURL(url);assert.equal(await cleanContents.executeJavaScript('localStorage.getItem("retained")'),null)
    checks.push('clear-data-clears-real-local-storage')
    await registry.manageSession(first.sessionId,'close-pages')
    registry.savePersistent()
    const persisted=JSON.parse(fs.readFileSync(file,'utf8'))
    assert.equal(persisted.find((session:{sessionId:string})=>session.sessionId===first.sessionId).name,'项目资料')
    const restored=new BrowserRegistry(createDefaultConfig),restoreHost=new BrowserWindow({show:false})
    restored.hosts.bindMain(restoreHost);restored.restorePersistent(file,()=>true)
    assert.equal(restored.getTree('chat-session')[0]!.name,'项目资料');assert.equal(restored.getTree('chat-session')[0]!.isDefault,true)
    restored.shutdown();restoreHost.destroy()
    checks.push('empty-persistent-session-name-and-default-survive-restore')
    const internal=registry as unknown as {persistenceFile:string|null}
    internal.persistenceFile=path.join(profile,'absent-parent','sessions.json')
    assert.throws(()=>registry.updateSession(second.sessionId,{name:'未保存的名称',isDefault:true}),/browser_session_save_failed/)
    assert.equal(registry.getTree('chat-session').find(session=>session.sessionId===first.sessionId)!.isDefault,true)
    assert.equal(registry.getTree('chat-session').find(session=>session.sessionId===second.sessionId)!.name,undefined)
    internal.persistenceFile=file
    checks.push('metadata-save-failure-rolls-back-name-and-default-together')
    let release!:()=>void
    const original=nativeSession.clearData.bind(nativeSession)
    nativeSession.clearData=()=>new Promise<void>(resolve=>{release=resolve})
    const pending=registry.manageSession(first.sessionId,'clear-data')
    await Promise.resolve()
    assert.throws(()=>registry.createWindow(first.sessionId),/browser_session_busy/)
    await assert.rejects(registry.manageSession(first.sessionId,'delete'),/browser_session_busy/)
    release();await pending;nativeSession.clearData=original
    checks.push('management-lock-rejects-concurrent-create-and-delete')
    nativeSession.clearData=async()=>{throw Error('fixture cleanup failure')}
    await assert.rejects(registry.manageSession(first.sessionId,'delete'),/fixture cleanup failure/)
    assert.ok(registry.getSessionRecord(first.sessionId),'Failed cleanup never reports the session as deleted')
    nativeSession.clearData=original
    checks.push('cleanup-failure-preserves-session-for-retry')
    internal.persistenceFile=path.join(profile,'absent-parent','sessions.json')
    await assert.rejects(registry.manageSession(first.sessionId,'delete'),/browser_session_save_failed/)
    assert.ok(registry.getSessionRecord(first.sessionId),'An unpersisted deletion retains a retryable session record')
    internal.persistenceFile=file
    checks.push('unpersisted-deletion-is-not-reported-as-success')
    const removed=await registry.manageSession(first.sessionId,'delete')
    assert.equal(removed.deleted,true);assert.equal(registry.getSessionRecord(first.sessionId),undefined)
    checks.push('delete-removes-only-target-session-after-successful-cleanup')
    assert.ok(registry.getSessionRecord(second.sessionId));assert.ok(registry.getSessionRecord(other.sessionId))
    checks.push('other-session-partitions-are-untouched')
    report.ok=true
  }catch(error){report.ok=false;report.error=error instanceof Error?error.stack:String(error);console.error(error)}
  finally{registry.shutdown();host.destroy();server.close();fs.writeFileSync(path.join(output,'browser-session-native.json'),JSON.stringify(report,null,2));console.log(`[browser-session] ${checks.length} native checks; ok=${report.ok}`);app.exit(report.ok?0:1)}
})
