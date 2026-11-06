import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {BrowserHostManager} from '../electron/modules/browser-host'
import {BrowserTabsService} from '../electron/modules/browser-tabs-service'
import {registerFileWindows} from '../electron/modules/file-windows'
import {makeFileTab} from '../shared/file-tabs'
import {detachedBrowserTabKey as bkey,detachedFileTabKey as fkey} from '../shared/detached-workspace'
import {createDefaultConfig} from '../shared/config'
import type {BrowserRegistry} from '../electron/modules/browser-registry'
import type {WorkspaceFiles} from '../electron/modules/workspace-files'
const profile=process.env.NAVORA_MIXED_PROFILE!,preload=process.env.NAVORA_MIXED_PRELOAD!,output=process.env.NAVORA_MIXED_OUTPUT!
app.setPath('userData',profile)
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),checks:string[]=[],errors:string[]=[]
const html='data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><h1>Isolated mixed workspace host</h1>')
const hosts=new BrowserHostManager()
const loaded=new Map<string,Promise<void>>()
hosts.detachedPreferences={preload}
hosts.configureDetached=(win,id)=>{win.show=()=>{};loaded.set(id,win.loadURL(html));win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})}
const ready=async(id:string)=>{await loaded.get(id);return hosts.getHost(id)!}
const call=(win:BrowserWindow,name:string,...args:unknown[])=>win.webContents.executeJavaScript(`fixture.invoke(${JSON.stringify('navora:file-tabs.'+name)},...${JSON.stringify(args)})`)
const order=(id:string)=>hosts.hostTabs(id).map(tab=>tab.key)
void app.whenReady().then(async()=>{
  let main:BrowserWindow|undefined,files:ReturnType<typeof registerFileWindows>|undefined
  try{
    main=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:false}});await main.loadURL(html);hosts.bindMain(main)
    files=registerFileWindows({files:{resolveExisting:async()=>'/fixture/file',stat:async()=>({type:'file'})} as unknown as WorkspaceFiles,hosts,getMain:()=>main||null,chatExists:id=>id==='chat-a'||id==='chat-b'})
    const fileA=makeFileTab('chat-a','docs/a.md'),fileB=makeFileTab('chat-b','images/b.jpg')
    await call(main,'detach',fileA,'chat-a');const first=hosts.listHosts().find(host=>!host.embedded)!;await ready(first.id)
    assert.equal(first.files.size,1);assert.equal(hosts.contextChatId(first.id),'chat-a');assert.equal(first.activeTab,fkey(fileA.key));assert.equal(first.pages.size,0);checks.push('File detach creates a genuine BrowserHost with file selection, not a fake native page')
    let sequence=0
    const create=async(chatId='chat-a')=>{const page=hosts.create('fixture-page-'+(++sequence),chatId,{contextIsolation:true,sandbox:true},{width:700,height:500},false);await page.loadURL(html);return page}
    const page=await create();hosts.transfer(page,first.id);assert.equal(first.window,hosts.getHost(page.hostId!)!.window);assert.equal(first.files.size,1);assert.equal(hosts.hostTabs(first.id).length,2);checks.push('A browser page transfers into the exact file window and both tab kinds survive')
    const lease=hosts.claimLayout(first.id,page.id),bounds={x:0,y:100,width:700,height:500};assert.equal(hosts.setLayout(first.id,page.id,bounds,lease,1).status,'applied');assert.equal(page.view.getVisible(),true)
    hosts.activateTab(first.id,fkey(fileA.key));assert.equal(page.view.getVisible(),false);assert.equal(page.layoutOwner,'');assert.equal(hosts.setLayout(first.id,page.id,bounds,lease,2).status,'stale');assert.equal(hosts.setLayout(first.id,page.id,null,lease,3).status,'stale');assert.throws(()=>hosts.claimLayout(first.id,page.id),/browser_page_not_visible/);assert.equal(first.activeTab,fkey(fileA.key));assert.equal(first.active,undefined);assert.equal(page.view.getVisible(),false);checks.push('A file revokes browser leases; late positive/null layouts and claims cannot cover the file')
    const fileTitle=first.window.getTitle();await page.webContents.executeJavaScript('document.title="Background page updated"');hosts.updateWindowTitle(page);assert.equal(first.window.getTitle(),fileTitle);checks.push('Background browser title updates cannot replace the selected file window title')
    hosts.activateTab(first.id,bkey(page.id));const freshLease=hosts.claimLayout(first.id,page.id);assert.notEqual(freshLease,lease);assert.equal(hosts.setLayout(first.id,page.id,bounds,freshLease,1).status,'applied');assert.equal(page.view.getVisible(),true);checks.push('Explicit browser activation obtains a fresh lease and resumes the same live WebContentsView')
    const token=await call(main,'beginDrag',fileB,'chat-a') as string;await call(first.window,'drop',token,'chat-a',bkey(page.id));const windows=hosts.listHosts().length;await call(main,'endDrag',token,true,{x:200,y:200});assert.equal(hosts.listHosts().length,windows);assert.equal(first.files.get(fileB.key)?.tab.chatId,'chat-b');assert.equal(hosts.contextChatId(first.id),'chat-a');assert.equal(files.ownsFile(first.window.webContents,'chat-b','images/b.jpg'),true);assert.equal(files.ownsFile(first.window.webContents,'chat-b','images/other.jpg'),false);assert.deepEqual(order(first.id),[fkey(fileA.key),fkey(fileB.key),bkey(page.id)]);checks.push('File drag enters a browser window at a mixed position exactly once and retains its actual file owner')
    const foreign=await create('chat-b'),service=new BrowserTabsService({hosts,getTree:()=>[],recentlyClosed:()=>[],tabRevision:0} as unknown as BrowserRegistry,createDefaultConfig,id=>['chat-a','chat-b'].includes(id))
    await assert.rejects(service.transferPages([foreign.id],first.id),/browser_chat_mismatch/);checks.push('Files may have another owner while cross-chat browser merging remains rejected')
    const moving=await create();first.closing=true;assert.throws(()=>hosts.transfer(moving,first.id),/browser_busy_wait_for_current_action/);await assert.rejects(service.transferPages([moving.id],first.id),/browser_busy_wait_for_current_action/);await assert.rejects(call(first.window,'beginDrag',fileA,'chat-a'),/file_window_busy/);first.closing=false;checks.push('Closing hosts reject incoming pages and file drag preparation')
    hosts.activateTab(first.id,fkey(fileA.key));hosts.transfer(moving,first.id,false);hosts.insertAfter(moving);assert.equal(order(first.id).indexOf(bkey(moving.id)),order(first.id).indexOf(fkey(fileA.key))+1);checks.push('A new browser tab inserts after the selected file in the one mixed order')
    const secondId=hosts.createDetachedHost(),second=await ready(secondId);hosts.addFile(secondId,{tab:makeFileTab('chat-a','docs/target.md'),viewerChatId:'chat-a'})
    hosts.restoreTabOrder(first.id,[bkey(page.id),fkey(fileA.key),bkey(moving.id),fkey(fileB.key)]);hosts.activateTab(first.id,fkey(fileB.key));const sourceOrder=order(first.id),targetOrder=order(second.id),transfer=hosts.transfer.bind(hosts)
    hosts.transfer=((candidate,target,...rest)=>{if(candidate.id===moving.id&&target===second.id)throw Error('fixture-transfer-failure');return transfer(candidate,target,...rest)}) as typeof hosts.transfer
    await assert.rejects(service.transferPages([page.id,moving.id],second.id),/fixture-transfer-failure/);hosts.transfer=transfer;assert.deepEqual(order(first.id),sourceOrder);assert.deepEqual(order(second.id),targetOrder);assert.equal(first.activeTab,fkey(fileB.key));checks.push('A partial browser-batch transfer failure restores the complete mixed order and file selection')
    await main.webContents.executeJavaScript('fixture.ack("hold")');const attachToken=await call(first.window,'beginDrag',fileB,'chat-a') as string
    const dropping=call(main,'drop',attachToken,'chat-a');await wait(40);await call(first.window,'endDrag',attachToken,true,{x:250,y:250});assert.equal(first.files.has(fileB.key),true);assert.equal(hosts.listHosts().length,windows+1)
    const requestId=await main.webContents.executeJavaScript('fixture.transfers().filter(value=>value.requestId).at(-1).requestId');await main.webContents.executeJavaScript(`fixture.complete(${JSON.stringify(requestId)})`);await dropping;assert.equal(first.files.has(fileB.key),false);checks.push('Drop consumes its token before main ACK; endDrag cannot tear out a duplicate and source waits for ACK')
    await main.webContents.executeJavaScript('fixture.ack("fail")');await assert.rejects(call(first.window,'attach',fileA.key),/fixture-rejected/);assert.equal(first.files.has(fileA.key),true);await main.webContents.executeJavaScript('fixture.ack("auto")');checks.push('A failed main-workspace ACK preserves the file in its source host')
    hosts.transfer(page,hosts.mainHostId!);hosts.transfer(moving,hosts.mainHostId!);assert.equal(first.window.isDestroyed(),false);assert.equal(first.pages.size,0);assert.equal(first.files.size,1);assert.equal(first.activeTab,fkey(fileA.key));await call(first.window,'close',fileA.key).catch(error=>{if(!first.window.isDestroyed())throw error});assert.equal(first.window.isDestroyed(),true);checks.push('Moving the last browser retains file content; removing the final content destroys the host')
    const targetFile=[...second.files.keys()][0]!;const survivor=await create();hosts.transfer(survivor,second.id);await call(second.window,'close',targetFile);assert.equal(second.window.isDestroyed(),false);assert.equal(second.pages.size,1);checks.push('Closing the last file retains its browser page and window')
    hosts.addFile(second.id,{tab:makeFileTab('chat-a','docs/close.md'),viewerChatId:'chat-a'});hosts.onCloseHost=async()=>false;second.window.close();await wait(60);assert.equal(second.window.isDestroyed(),false);assert.equal(second.files.size,1);assert.equal(second.pages.size,1);hosts.onCloseHost=async id=>{for(const pageId of hosts.hostPages(id)){const page=hosts.pages.get(pageId);if(page)await new Promise<void>(resolve=>{page.once('closed',resolve);page.destroy()})}return true};second.window.close();await wait(100);assert.equal(second.window.isDestroyed(),true);assert.equal(survivor.isDestroyed(),true);checks.push('Window close honors browser cancellation; confirmed whole-window close releases files and native pages together')
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'completed.json'),JSON.stringify({ok:true,checks,errors,boundary:'Actual BrowserHostManager, BrowserPage/WebContentsView, BrowserTabsService and file-windows IPC with isolated Electron. Synthetic workspace stat boundary; no personal files or external sites. Native beforeunload acceptance is represented by the registry callback contract; full application fixture validates UI.'},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));files.dispose();main.destroy();app.exit(0)
  }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({ok:false,error:String(error),checks,errors},null,2));console.error(error);files?.dispose();for(const host of hosts.listHosts())if(!host.window.isDestroyed())host.window.destroy();main?.destroy();app.exit(1)}
}).catch(error=>{console.error(error);app.exit(1)})
