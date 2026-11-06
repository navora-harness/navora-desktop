import {BrowserWindow,ipcMain,type IpcMainInvokeEvent,type WebContents} from 'electron'
import {randomUUID} from 'node:crypto'
import {makeFileTab,type FileTab} from '../../shared/file-tabs'
import type {FileTransfer} from '../../shared/file-windows'
import {detachedFileTabKey,type DetachedWorkspaceFileEntry as Entry} from '../../shared/detached-workspace'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserHostManager} from './browser-host'

/** File transfer/authorization shares the browser host's real window lifetime.
 * Files stay DOM previews; they never masquerade as native browser pages.
 */
export function registerFileWindows(options:{files:WorkspaceFiles;hosts:BrowserHostManager;getMain:()=>BrowserWindow|null;chatExists:(id:string)=>boolean}){
  const {hosts}=options,tokens=new Map<string,{entry:Entry;source:number;expires:number}>(),pending=new Map<string,{finish:(error?:string)=>void}>(),moving=new Set<number>()
  function hostForWindow(id:number){const win=BrowserWindow.fromId(id);return win?hosts.hostForSender(win.webContents):undefined}
  function idle(id:number){if(moving.has(id)||hostForWindow(id)?.closing)throw Error('file_window_busy')}
  async function exclusive<T>(ids:number[],run:()=>Promise<T>|T){
    const unique=[...new Set(ids)];unique.forEach(idle);unique.forEach(id=>moving.add(id))
    try{return await run()}finally{unique.forEach(id=>moving.delete(id))}
  }
  function sender(e:IpcMainInvokeEvent){
    const win=BrowserWindow.fromWebContents(e.sender),host=hosts.hostForSender(e.sender)
    if(!win||win.webContents!==e.sender||e.senderFrame!==e.sender.mainFrame||(win!==options.getMain()&&(!host||host.embedded)))throw Error('file_window_ui_only')
    return win
  }
  function changed(id:string){const host=hosts.getHost(id);if(host&&!host.window.isDestroyed())host.window.webContents.send('navora:file-tabs.changed',[...host.files.values()].map(entry=>entry.tab));hosts.notifyWorkspaceChanged()}
  function mainTransfer(event:FileTransfer){
    const main=options.getMain();if(!main||main.isDestroyed())throw Error('main_window_unavailable')
    if(event.kind==='remove'){main.webContents.send('navora:file-tabs.transfer',event);return Promise.resolve()}
    return new Promise<void>((resolve,reject)=>{
      const requestId=randomUUID(),timer=setTimeout(()=>finish('工作区没有响应，文件标签仍保留在原窗口'),5000)
      const finish=(error?:string)=>{clearTimeout(timer);pending.delete(requestId);if(error)reject(Error(error));else resolve()}
      pending.set(requestId,{finish});main.webContents.send('navora:file-tabs.transfer',{...event,requestId});main.show()
    })
  }
  async function entry(e:IpcMainInvokeEvent,tab:FileTab,viewerChatId:string):Promise<Entry>{
    const source=sender(e),host=hosts.hostForSender(source.webContents)
    if(host&&!host.embedded){const found=host.files.get(tab.key);if(!found)throw Error('file_tab_not_found');return found}
    if(!options.chatExists(viewerChatId)||tab.kind!==undefined||!options.chatExists(tab.chatId))throw Error('invalid_file_tab')
    const safe=makeFileTab(tab.chatId,tab.path);await options.files.resolveExisting(safe.chatId,safe.path);if((await options.files.stat(safe.chatId,safe.path)).type!=='file')throw Error('not_a_file');return {tab:safe,viewerChatId}
  }
  function remove(source:number,value:Entry){
    const host=hostForWindow(source)
    if(host&&!host.embedded){hosts.removeFile(host.id,value.tab.key);changed(host.id)}
    else if(source===options.getMain()?.id)void mainTransfer({kind:'remove',...value})
  }
  function newHost(value:Entry,point?:{x:number;y:number}){
    const id=hosts.createDetachedHost(point)
    try{hosts.addFile(id,value);changed(id);return hosts.getHost(id)!}
    catch(error){hosts.closeEmptyDetachedHosts([id]);throw error}
  }
  function handle(name:string,fn:(e:IpcMainInvokeEvent,...args:any[])=>unknown){ipcMain.handle(`navora:file-tabs.${name}`,fn)}
  function validToken(token:string){
    const tokenValue=tokens.get(token),source=tokenValue&&BrowserWindow.fromId(tokenValue.source),host=tokenValue&&hostForWindow(tokenValue.source)
    if(!tokenValue||tokenValue.expires<Date.now()||!source||source.isDestroyed()||(host&&!host.embedded&&host.files.get(tokenValue.entry.tab.key)!==tokenValue.entry))throw Error('file_drag_expired')
    return tokenValue
  }
  function mixedBefore(hostId:string,before?:string){
    if(!before)return undefined
    const tabs=hosts.hostTabs(hostId),tab=tabs.find(tab=>tab.key===before||tab.kind==='file'&&tab.file.key===before||tab.kind==='browser'&&tab.pageId===before)
    if(!tab)throw Error('file_tab_not_found')
    return tab.key
  }
  handle('completeTransfer',(e,requestId:string,error?:string)=>{if(sender(e)!==options.getMain())throw Error('main_window_required');pending.get(requestId)?.finish(error)})
  handle('state',e=>{const win=sender(e),host=hosts.hostForSender(win.webContents);return host&&!host.embedded?hosts.hostTabs(host.id).flatMap(tab=>tab.kind==='file'?[tab.file]:[]):[]})
  handle('open',async(e,chatId:string,path:string)=>{
    const source=sender(e),host=hosts.hostForSender(source.webContents)
    if(!host||host.embedded||!options.chatExists(chatId)||!hosts.ownsChat(host.id,chatId))throw Error('file_host_required')
    return exclusive([source.id],async()=>{
      const tab=makeFileTab(chatId,path),viewerChatId=host.files.get(tab.key)?.viewerChatId||hosts.contextChatId(host.id)||chatId
      await options.files.resolveExisting(chatId,path);if((await options.files.stat(chatId,path)).type!=='file')throw Error('not_a_file')
      if(source.isDestroyed()||!hosts.ownsChat(host.id,chatId))throw Error('file_host_required')
      hosts.addFile(host.id,{tab,viewerChatId});changed(host.id)
    })
  })
  handle('detach',(e,tab:FileTab,viewerChatId:string)=>{const source=sender(e).id;return exclusive([source],async()=>{const value=await entry(e,tab,viewerChatId);if(!BrowserWindow.fromId(source))throw Error('file_host_required');newHost(value);remove(source,value)})})
  handle('close',(e,key:string)=>{const win=sender(e);idle(win.id);const host=hosts.hostForSender(win.webContents);if(!host||host.embedded)throw Error('file_host_required');hosts.removeFile(host.id,key);changed(host.id)})
  handle('attach',(e,key:string)=>{
    const win=sender(e),host=hosts.hostForSender(win.webContents),value=host?.files.get(key)
    if(!host||host.embedded||!value)throw Error('file_tab_not_found')
    return exclusive([win.id,...(options.getMain()?[options.getMain()!.id]:[])],async()=>{await mainTransfer({kind:'open',...value});remove(win.id,value)})
  })
  handle('beginDrag',async(e,tab:FileTab,viewerChatId:string)=>{
    const source=sender(e).id;idle(source);const value=await entry(e,tab,viewerChatId);idle(source)
    for(const [key,token]of tokens)if(token.expires<Date.now())tokens.delete(key)
    const token=randomUUID();tokens.set(token,{entry:value,source,expires:Date.now()+30000});return token
  })
  handle('drop',async(e,token:string,viewerChatId?:string,before?:string)=>{
    const win=sender(e),tokenValue=validToken(token);tokens.delete(token)
    return exclusive([tokenValue.source,win.id],async()=>{
      const host=hosts.hostForSender(win.webContents),value=tokenValue.entry
      if(host&&!host.embedded){
        const beforeKey=mixedBefore(host.id,before)
        if(tokenValue.source===win.id){
          const key=detachedFileTabKey(value.tab.key);if(beforeKey!==key)hosts.reorderTabs(host.id,[key],beforeKey)
        }else hosts.addFile(host.id,value,beforeKey)
        changed(host.id)
      }else{
        const target=viewerChatId||value.viewerChatId;if(!options.chatExists(target))throw Error('invalid_file_owner')
        await mainTransfer({kind:'open',tab:value.tab,viewerChatId:target,before})
      }
      if(tokenValue.source!==win.id)remove(tokenValue.source,value)
    })
  })
  handle('endDrag',(e,token:string,outside:boolean,point?:{x:number;y:number})=>{
    const source=sender(e).id;if(!tokens.has(token))return
    const tokenValue=validToken(token);if(tokenValue.source!==source)throw Error('file_drag_expired');tokens.delete(token)
    if(outside){idle(source);newHost(tokenValue.entry,point);remove(source,tokenValue.entry)}
  })
  return {
    ownsSender(sender:WebContents){const host=hosts.hostForSender(sender);return !!host&&!host.embedded},
    ownsChat(sender:WebContents,chatId:string){const host=hosts.hostForSender(sender);return !!host&&!host.embedded&&hosts.ownsChat(host.id,chatId)},
    ownsFile(sender:WebContents,chatId:string,relative:string){const host=hosts.hostForSender(sender);if(!host||host.embedded)return false;try{return host.files.has(makeFileTab(chatId,relative).key)}catch{return false}},
    dispose(){for(const value of pending.values())value.finish('app_quitting');tokens.clear();for(const host of hosts.listHosts())if(!host.embedded&&!host.window.isDestroyed())host.window.destroy()},
  }
}
