import {app,BrowserWindow,session as electronSession} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {BrowserRegistry} from '../electron/modules/browser-registry'
import {BrowserNetworkManager} from '../electron/modules/browser-network'
import {PermissionGate} from '../electron/modules/permission-gate'
import {WorkspaceFiles} from '../electron/modules/workspace-files'
import {BrowserTabsService} from '../electron/modules/browser-tabs-service'
import {executeAgentTool,type ToolExecContext} from '../electron/modules/browser-tools'
import {createDefaultConfig} from '../shared/config'
import {DEFAULT_BROWSER_PARTITION,DEFAULT_BROWSER_SESSION_ID} from '../shared/browser-session'
import {browserWorkspaceV2Path} from '../electron/modules/browser-session-persistence'
import type {PermissionRequest,PermissionDecision} from '../shared/types'

const root=process.env.NAVORA_PUBLIC_SESSION_ROOT!,stage=process.env.NAVORA_PUBLIC_SESSION_STAGE!,origin=process.env.NAVORA_PUBLIC_SESSION_ORIGIN!,a='chat_public_a',b='chat_public_b',legacyId='sess_1234567890'
if(!root||!path.isAbsolute(root)||!path.basename(root).startsWith('navora-public-session-'))throw Error('Explicit isolated profile required')
const sessionRoot=path.join(root,stage==='relocated'?'relocated-sessions':'sessions')
fs.mkdirSync(path.join(root,'profile'),{recursive:true});fs.mkdirSync(sessionRoot,{recursive:true})
app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',sessionRoot);app.disableHardwareAcceleration()
BrowserWindow.prototype.show=function(){this.setPosition(-30000,-30000);this.showInactive()};BrowserWindow.prototype.focus=function(){}
const file=path.join(root,stage==='save-failure'?'missing-parent/browser-workspace.json':'browser-workspace.json'),wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check:()=>boolean|Promise<boolean>,label:string){for(let i=0;i<200;i++){if(await check())return;await wait(25)}throw Error('Timed out: '+label)}
void app.whenReady().then(async()=>{
  let checks=0,registry:BrowserRegistry|undefined,host:BrowserWindow|undefined
  const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;console.log(`[public-session/${stage}] ${label}`)}
  try{
    const config=createDefaultConfig();config.browser.max_windows_total=60;config.browser.show_agent_windows=false;config.permissions.preset='custom'
    for(const key of Object.keys(config.permissions.modes))config.permissions.modes[key as keyof typeof config.permissions.modes]='allow'
    const prompts:PermissionRequest[]=[],downloads:{chatId:string;state:string;savePath?:string;error?:string}[]=[]
    let decision:PermissionDecision='allow'
    const gate=new PermissionGate(()=>config,async request=>{prompts.push(request);return decision},undefined,chatId=>chatId===b?{preset:'custom',modes:{...config.permissions.modes,'browser.geolocation':'deny','file.download.passive':'deny'}}:null)
    registry=new BrowserRegistry(()=>config,{onBrowserDownload:info=>{downloads.push(info)}});host=new BrowserWindow({show:false});registry.hosts.bindMain(host)
    const files=new WorkspaceFiles(root,()=>config);registry.bindWorkspaceFiles(files);registry.bindPermissionGate(gate)
    const network=new BrowserNetworkManager(()=>config,id=>registry!.getSessionRecord(id)?.ses||null,()=>'',{isShared:id=>registry!.isPublicSession(id),resolveOwner:(id,details)=>registry!.networkRequestOwner(id,details.webContentsId)})
    registry.bindNetwork(network)
    if(stage==='seed'){
      fs.writeFileSync(file,JSON.stringify([{sessionId:legacyId,chatId:a,sessionIndex:4,name:'Legacy account',isDefault:true,pages:[]}]))
    }else if(stage==='invalid'){
      fs.writeFileSync(browserWorkspaceV2Path(file),'{"version":999,"sessions":[]}')
    }else if(stage==='missing-storage'){
      fs.writeFileSync(browserWorkspaceV2Path(file),JSON.stringify({version:2,sessions:[{scope:'default',sessionId:DEFAULT_BROWSER_SESSION_ID,partition:DEFAULT_BROWSER_PARTITION,storagePath:path.join(root,'missing-store'),pages:[]}]}))
    }
    registry.restorePersistent(file,id=>id===a||id===b)
    const context=(chatId:string)=>({chatId,registry:registry!,network,files,gate,getConfig:()=>config,signal:new AbortController().signal} as ToolExecContext)
    const tool=(chatId:string,name:string,args:Record<string,unknown>={})=>executeAgentTool(name,args,context(chatId)) as Promise<any>
    const page=async(chatId:string,sessionId=DEFAULT_BROWSER_SESSION_ID)=>{
      const tree=registry!.createWindow(sessionId,{chatId,url:'about:blank',show:false}),record=registry!.getWindowRecord(tree.windowId)!
      await record.win.webContents.loadURL(origin+'/fixture');return record
    }
    if(stage==='save-failure'){
      await assert.rejects(registry.resolveSession(a),/save_failed/)
      assert.throws(()=>registry!.createWindow(DEFAULT_BROWSER_SESSION_ID,{chatId:a,show:false}),/save_failed/)
      const native=registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID)!.ses,count=native.listenerCount('will-download')
      fs.mkdirSync(path.dirname(file),{recursive:true})
      const retried=await registry.resolveSession(a)
      check(retried.initialized===true&&native.listenerCount('will-download')===count,'A failed public identity save blocks page creation and retries the same native instance without duplicate hooks')
    }else if(stage==='invalid'||stage==='missing-storage'){
      const original=fs.readFileSync(browserWorkspaceV2Path(file),'utf8')
      await assert.rejects(registry.resolveSession(a),/restore_failed/)
      assert.throws(()=>registry!.savePersistent(true),/restore_failed/)
      registry.savePersistent();check(fs.readFileSync(browserWorkspaceV2Path(file),'utf8')===original,'Invalid versioned state fails closed and is never replaced by an empty workspace')
    }else if(stage==='seed'){
      check(registry.getTree(a)[0]!.initialized===false&&!registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID),'The zero-page default entry stays lazy and creates no native session')
      const legacy=registry.getSessionRecord(legacyId)!
      check(legacy.partition===`persist:${a}-4`&&fs.existsSync(file+'.v1-backup'),'Legacy migration backs up original state and preserves its exact partition')
      await assert.rejects(registry.resolveSession(a,{},async()=>({ok:false,reason:'fixture-denied'})),/fixture-denied/)
      check(!registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID),'Denied persistence never silently falls back to a different session')
      const native=electronSession.fromPartition(DEFAULT_BROWSER_PARTITION)
      let checkPermission:Parameters<typeof native.setPermissionCheckHandler>[0],requestPermission:Parameters<typeof native.setPermissionRequestHandler>[0]
      const setCheck=native.setPermissionCheckHandler.bind(native),setRequest=native.setPermissionRequestHandler.bind(native)
      native.setPermissionCheckHandler=callback=>{checkPermission=callback;setCheck(callback)};native.setPermissionRequestHandler=callback=>{requestPermission=callback;setRequest(callback)}
      let permissionHooks=0;const initialHooks=native.listenerCount('will-download')
      const resolved=await Promise.all([registry.resolveSession(a,{},async()=>{permissionHooks++;return{ok:true}}),registry.resolveSession(b,{},async()=>({ok:true}))])
      check(resolved.every(item=>item.sessionId===DEFAULT_BROWSER_SESSION_ID)&&registry.getAllTree([a,b]).filter(item=>item.scope==='default').length===1&&native.listenerCount('will-download')===initialHooks+1,'Concurrent first use creates one public record and one native download listener')
      const pa=await page(a),pb=await page(b),wa=pa.win.webContents,wb=pb.win.webContents
      await wa.executeJavaScript('localStorage.setItem("shared-storage","retained")');await native.cookies.set({url:origin,name:'shared-cookie',value:'retained',expirationDate:Math.floor(Date.now()/1000)+3600})
      check(await wb.executeJavaScript('localStorage.getItem("shared-storage")')==='retained'&&(await wb.executeJavaScript('fetch("/echo").then(r=>r.json())')).cookie.includes('shared-cookie=retained'),'Two real pages share persistent cookies and localStorage')
      assert.throws(()=>registry!.assertWindowOwned(a,pb.windowId),/window_wrong_chat/);assert.throws(()=>registry!.assertSessionOwned(a,DEFAULT_BROWSER_SESSION_ID),/session_wrong_chat/)
      check(registry.getTree(a)[0]!.windows.every(item=>item.chatId===a)&&registry.getTree(b)[0]!.windows.every(item=>item.chatId===b),'Sharing storage never grants access to another chat page')
      const isolated=await registry.resolveSession(a,{scope:'temporary'}),isolatedPage=await page(a,isolated.sessionId)
      check(await isolatedPage.win.webContents.executeJavaScript('localStorage.getItem("shared-storage")')===null&&(await registry.getCookies(isolated.sessionId,origin)).length===0,'An explicit temporary session has isolated cookies and storage')
      const persist=await registry.resolveSession(b,{persist:true},async()=>({ok:true}));check(persist.scope==='persistent'&&persist.partition!==DEFAULT_BROWSER_PARTITION,'An explicit legacy persist flag keeps a separate persistent account')
      const shared=registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID)!
      check(checkPermission!(wa,'geolocation',origin,{isMainFrame:true})===true&&checkPermission!(wb,'geolocation',origin,{isMainFrame:true})===false&&checkPermission!(null,'geolocation',origin,{isMainFrame:true})===false,'Native permission checks use the source page owner and deny unknown sources')
      const request=(wc:Electron.WebContents)=>new Promise<boolean>(resolve=>requestPermission!(wc,'geolocation',resolve,{requestingUrl:origin,isMainFrame:true}))
      check(await request(wa)===true&&await request(wb)===false&&await request(host.webContents)===false,'Native permission request callbacks preserve A/B policy and fail closed for unrelated contents')
      wa.downloadURL(origin+'/download?owner=a');await until(()=>downloads.some(item=>item.chatId===a&&item.state==='completed'),'A download completion')
      wb.downloadURL(origin+'/download?owner=b');await until(()=>downloads.some(item=>item.chatId===b&&item.state==='cancelled'),'B download denial')
      const accepted=downloads.find(item=>item.chatId===a&&item.state==='completed')!
      check(!!accepted.savePath&&fs.readFileSync(accepted.savePath,'utf8')==='isolated-download'&&!fs.existsSync(files.resolve(b,'downloads/owned-fixture.txt')),'Real passive downloads save only to the requesting allowed chat workspace')
      const beforeUnknown=downloads.length,unknownItem={getURL:()=>origin+'/download',getFilename:()=> 'unknown.txt',getTotalBytes:()=>1,setSavePath:()=>{},cancel:()=>{permissionHooks++}}
      native.emit('will-download',{} as any,unknownItem as any,host.webContents)
      check(downloads.length===beforeUnknown,'An unknown download source cannot create a receipt in either chat')
      for(const chatId of [a,b]){network.add(DEFAULT_BROWSER_SESSION_ID,{kind:'observe',urlPattern:'*'},chatId);network.add(DEFAULT_BROWSER_SESSION_ID,{kind:'modify',urlPattern:'*',headers:{'X-Fixture-Chat':chatId}},chatId)}
      const fetched=await Promise.all([tool(a,'browser_session_fetch',{url:origin+'/echo'}),tool(b,'browser_session_fetch',{url:origin+'/echo'})])
      check(fetched.every((result,index)=>result.ok&&JSON.parse(result.body).chat===[a,b][index]&&!JSON.parse(result.body).proof),'Default API-only tool fetches share login while concurrent request attribution stays distinct')
      check(network.getLog(DEFAULT_BROWSER_SESSION_ID,{},a).every(entry=>entry.chatId===a)&&network.getLog(DEFAULT_BROWSER_SESSION_ID,{},b).every(entry=>entry.chatId===b),'Network logs and rules remain local to their chat')
      decision='deny';const promptStart=prompts.length
      const denied=await tool(a,'browser_cookies_get',{sessionId:DEFAULT_BROWSER_SESSION_ID})
      check(denied.ok===false&&prompts.length===promptStart+1,'Shared raw Cookie reads require explicit confirmation even with an allow policy')
      decision='allow';const approved=await tool(a,'browser_cookies_get',{sessionId:DEFAULT_BROWSER_SESSION_ID})
      check(approved.ok&&approved.cookies.some((cookie:any)=>cookie.name==='shared-cookie'),'Confirmed shared Cookie reads use the public store')
      await assert.rejects(registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'clear-data'),/confirmation_required/)
      const closed=await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:a})
      check(closed.closedPages===1&&!!registry.getWindowRecord(pb.windowId)&&(await native.cookies.get({url:origin})).length>0,'Closing chat A public pages preserves chat B and shared login')
      assert.throws(()=>registry!.updateSession(DEFAULT_BROWSER_SESSION_ID,{name:'changed'}),/identity_is_fixed/);await assert.rejects(registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'delete'),/cannot_be_deleted/)
      check(true,'Public identity cannot be renamed or deleted')
      const cleared=await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'clear-data',{confirmedSharedImpact:true})
      check(cleared.remainingPages===0&&(await native.cookies.get({url:origin})).length===0,'Confirmed global cleanup closes real pages without nested transfer deadlock')
      const fresh=await page(a);await fresh.win.webContents.executeJavaScript('localStorage.setItem("shared-storage","retained")');await native.cookies.set({url:origin,name:'shared-cookie',value:'retained',expirationDate:Math.floor(Date.now()/1000)+3600})
      // An unsourced UI new tab uses the public store; source-based duplicates stay isolated.
      const tabs=new BrowserTabsService(registry,()=>config,id=>id===a||id===b),hostId=registry.hosts.mainHostId!
      const command=await tabs.action(hostId,{chatId:b,action:'new',background:true})
      check(!!command.pageId&&registry.getWindowRecord(command.pageId)!.sessionId===DEFAULT_BROWSER_SESSION_ID,'Unsourced new-tab commands use the public session')
      const inherited=await tabs.action(hostId,{chatId:a,action:'new',pageId:isolatedPage.windowId,background:true})
      check(!!inherited.pageId&&registry.getWindowRecord(inherited.pageId)!.sessionId===isolated.sessionId,'A source-based new tab inherits the original isolated session')
      const logsBeforeDelete=network.getLog(DEFAULT_BROWSER_SESSION_ID,{},b).length
      await registry.clearChat(a)
      check(!!registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID)&&registry.getTree(b)[0]!.windows.length>0&&(await native.cookies.get({url:origin})).length>0,'Deleting one chat retains other chat pages and the public store')
      check(network.list(DEFAULT_BROWSER_SESSION_ID,a).length===0&&network.getLog(DEFAULT_BROWSER_SESSION_ID,{},a).length===0&&network.list(DEFAULT_BROWSER_SESSION_ID,b).length===2&&network.getLog(DEFAULT_BROWSER_SESSION_ID,{},b).length===logsBeforeDelete,'Chat deletion clears only its network rules and receipts without disposing the shared hooks')
      // Leave a legacy private record plus >32 public pages for a true process restart.
      const preserved=registry.createSession(a,{persist:true,restoreId:legacyId})
      await registry.getSessionRecord(preserved.sessionId)!.ses.cookies.set({url:origin,name:'private-cookie',value:'retained-private',expirationDate:Math.floor(Date.now()/1000)+3600})
      await registry.getSessionRecord(preserved.sessionId)!.ses.cookies.flushStore()
      registry.updateSession(preserved.sessionId,{name:'Restart legacy'})
      for(const chatId of [a,b])for(let index=0;index<17;index++)registry.createWindow(DEFAULT_BROWSER_SESSION_ID,{chatId,url:origin+`/fixture?owner=${chatId}&index=${index}`,show:false,deferLoad:true})
      await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:b})
      // Recreate exactly 34 HTTP pages after testing per-chat close above.
      await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:a})
      for(const chatId of [a,b])for(let index=0;index<17;index++)registry.createWindow(DEFAULT_BROWSER_SESSION_ID,{chatId,url:origin+`/fixture?owner=${chatId}&index=${index}`,show:false,deferLoad:true})
      await shared.ses.cookies.flushStore();await shared.ses.flushStorageData();registry.savePersistent(true)
      const saved=JSON.parse(fs.readFileSync(browserWorkspaceV2Path(file),'utf8'))
      check(saved.sessions.find((entry:any)=>entry.scope==='default').pages.length===34&&saved.sessions.find((entry:any)=>entry.scope==='default').pages.every((entry:any)=>entry.chatId===a||entry.chatId===b),'Versioned persistence records all 34 public page owners without a legacy 32-page truncation')
      fs.writeFileSync(path.join(root,'expected.json'),JSON.stringify({storagePath:native.storagePath,legacyPartition:preserved.partition,privateStoragePath:registry.getSessionRecord(preserved.sessionId)!.ses.storagePath}))
    }else if(stage==='restore'){
      const expected=JSON.parse(fs.readFileSync(path.join(root,'expected.json'),'utf8')),shared=registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID)!
      const tree=registry.getAllTree([a,b])
      check(tree[0]!.windows.length===34&&registry.getTree(a)[0]!.windows.length===17&&registry.getTree(b)[0]!.windows.length===17,'A fresh Electron process restores all public pages with exact per-chat ownership')
      check(shared.ses.storagePath===expected.storagePath&&registry.getSessionRecord(legacyId)!.partition===expected.legacyPartition,'Public storage and existing private partition identity survive restart')
      const first=registry.getWindowRecord(tree[0]!.windows[0]!.windowId)!
      await first.win.webContents.loadURL(origin+'/fixture')
      const restoredStorage=await first.win.webContents.executeJavaScript('localStorage.getItem("shared-storage")'),restoredCookies=await shared.ses.cookies.get({url:origin})
      check(restoredStorage==='retained'&&restoredCookies.some(cookie=>cookie.value==='retained'),`Real cookies and localStorage survive a separate process restart (storage=${restoredStorage}, cookieNames=${restoredCookies.map(cookie=>cookie.name).join(',')})`)
      await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:a});await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:b});registry.savePersistent(true)
      check(JSON.parse(fs.readFileSync(browserWorkspaceV2Path(file),'utf8')).sessions.some((entry:any)=>entry.scope==='default'&&entry.pages.length===0),'Closing the last page persists a zero-page public identity')
    }else if(stage==='relocated'){
      const expected=JSON.parse(fs.readFileSync(path.join(root,'expected.json'),'utf8')),shared=registry.getSessionRecord(DEFAULT_BROWSER_SESSION_ID)!,privateSession=registry.getSessionRecord(legacyId)!
      check(shared.ses.storagePath===expected.storagePath&&privateSession.ses.storagePath===expected.privateStoragePath,'A changed sessionData root restores the exact saved public and private storage paths')
      check((await privateSession.ses.cookies.get({url:origin})).some(cookie=>cookie.name==='private-cookie'&&cookie.value==='retained-private'),'Private login cookies survive a changed sessionData root')
      await registry.resolveSession(b)
      const tabs=new BrowserTabsService(registry,()=>config,id=>id===a||id===b),created=await tabs.action(registry.hosts.mainHostId!,{chatId:b,action:'new',background:true}),record=registry.getWindowRecord(created.pageId!)!
      await record.win.webContents.loadURL(origin+'/fixture')
      check(record.sessionId===DEFAULT_BROWSER_SESSION_ID&&await record.win.webContents.executeJavaScript('localStorage.getItem("shared-storage")')==='retained'&&(await shared.ses.cookies.get({url:origin})).some(cookie=>cookie.name==='shared-cookie'&&cookie.value==='retained'),'New-tab creation succeeds after relocation and retains the original public login and localStorage')
      await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:b});registry.savePersistent(true)
      check(JSON.parse(fs.readFileSync(browserWorkspaceV2Path(file),'utf8')).sessions.find((saved:any)=>saved.scope==='default').storagePath===expected.storagePath,'Saving after relocation keeps the original storage identity')
    }else if(stage==='zero'){
      check(registry.getTree(a)[0]!.initialized===true&&registry.getTree(a)[0]!.windows.length===0,'A second restart restores the initialized default session with zero pages')
      const fresh=await page(b)
      check(await fresh.win.webContents.executeJavaScript('localStorage.getItem("shared-storage")')==='retained','Opening a page after the zero-page restart reuses retained login storage')
      await registry.manageSession(DEFAULT_BROWSER_SESSION_ID,'close-pages',{chatId:b})
    }else throw Error('Unknown fixture stage')
    registry.shutdown();registry=undefined;host.destroy();host=undefined
    console.log(`[public-session/${stage}] ${checks} checks passed using ${process.versions.electron}`);app.exit(0)
  }catch(error){console.error(`[public-session/${stage}]`,error);registry?.shutdown();host?.destroy();app.exit(1)}
})
