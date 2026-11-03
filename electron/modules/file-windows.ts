import {BrowserWindow,ipcMain,type IpcMainInvokeEvent,type WebContents} from 'electron'
import {randomUUID} from 'node:crypto'
import {makeFileTab,type FileTab,type WorkspaceFileTab} from '../../shared/file-tabs'
import type {FileTransfer} from '../../shared/file-windows'
import type {WorkspaceFiles} from './workspace-files'
import {detachedWindowChrome,resolveWindowIcon,wireDetachedWindowChrome} from './window-chrome'
import {placeDetachedWindow} from './window-placement'

type Entry={tab:WorkspaceFileTab;viewerChatId:string}
type Host={window:BrowserWindow;tabs:Entry[]}
export function registerFileWindows(options:{files:WorkspaceFiles;getMain:()=>BrowserWindow|null;chatExists:(id:string)=>boolean;browserOwnsChat?:(sender:WebContents,chatId:string)=>boolean;preload:string;load:(win:BrowserWindow)=>void}){
  const hosts=new Map<number,Host>(),tokens=new Map<string,{entry:Entry;source:number;expires:number}>()
  const pending=new Map<string,{finish:(error?:string)=>void}>()
  const moving=new Set<number>()
  function idle(id:number){if(moving.has(id))throw Error('file_window_busy')}
  async function exclusive<T>(ids:number[],run:()=>Promise<T>|T){
    const unique=[...new Set(ids)];unique.forEach(idle);unique.forEach(id=>moving.add(id))
    try{return await run()}finally{unique.forEach(id=>moving.delete(id))}
  }
  function sender(e:IpcMainInvokeEvent){const win=BrowserWindow.fromWebContents(e.sender);if(!win||e.senderFrame!==e.sender.mainFrame||(win!==options.getMain()&&!hosts.has(win.id)))throw Error('file_window_ui_only');return win}
  function changed(h:Host){if(!h.window.isDestroyed())h.window.webContents.send('navora:file-tabs.changed',h.tabs.map(e=>e.tab))}
  function mainTransfer(event:FileTransfer){
    const main=options.getMain();if(!main||main.isDestroyed())throw Error('main_window_unavailable')
    if(event.kind==='remove'){main.webContents.send('navora:file-tabs.transfer',event);return Promise.resolve()}
    return new Promise<void>((resolve,reject)=>{
      const requestId=randomUUID(),timer=setTimeout(()=>finish('工作区没有响应，文件标签仍保留在原窗口'),5000)
      const finish=(error?:string)=>{clearTimeout(timer);pending.delete(requestId);if(error)reject(Error(error));else resolve()}
      pending.set(requestId,{finish});main.webContents.send('navora:file-tabs.transfer',{...event,requestId});main.show()
    })
  }
  async function entry(e:IpcMainInvokeEvent,tab:FileTab,viewerChatId:string){
    const source=sender(e),h=hosts.get(source.id)
    if(h){const found=h.tabs.find(v=>v.tab.key===tab.key);if(!found)throw Error('file_tab_not_found');return found}
    if(!options.chatExists(viewerChatId)||tab.kind!==undefined||!options.chatExists(tab.chatId))throw Error('invalid_file_tab')
    const safe=makeFileTab(tab.chatId,tab.path);await options.files.resolveExisting(safe.chatId,safe.path);if((await options.files.stat(safe.chatId,safe.path)).type!=='file')throw Error('not_a_file');return {tab:safe,viewerChatId}
  }
  function remove(source:number,value:Entry){const h=hosts.get(source);if(h){h.tabs=h.tabs.filter(e=>e.tab.key!==value.tab.key);if(h.tabs.length)changed(h);else h.window.destroy()}else if(source===options.getMain()?.id)void mainTransfer({kind:'remove',...value})}
  function newHost(value:Entry,point?:{x:number;y:number}){
    const icon=resolveWindowIcon(process.platform)
    const win=new BrowserWindow({width:1000,height:760,minWidth:500,minHeight:360,show:false,title:value.tab.path.split('/').at(-1),...(icon?{icon}:{}),backgroundColor:'#fff',...detachedWindowChrome(process.platform),webPreferences:{preload:options.preload,contextIsolation:true,nodeIntegration:false,sandbox:false}})
    const h:Host={window:win,tabs:[value]};hosts.set(win.id,h);wireDetachedWindowChrome(win);win.setMenu(null)
    win.on('closed',()=>hosts.delete(win.id));win.once('ready-to-show',()=>win.show())
    placeDetachedWindow(win,point)
    options.load(win);return h
  }
  function handle(name:string,fn:(e:IpcMainInvokeEvent,...args:any[])=>unknown){ipcMain.handle(`navora:file-tabs.${name}`,fn)}
  function validToken(token:string){const t=tokens.get(token),source=t&&BrowserWindow.fromId(t.source);if(!t||t.expires<Date.now()||!source||source.isDestroyed()||(hosts.has(t.source)&&!hosts.get(t.source)!.tabs.some(v=>v.tab.key===t.entry.tab.key)))throw Error('file_drag_expired');return t}
  handle('completeTransfer',(e,requestId:string,error?:string)=>{if(sender(e)!==options.getMain())throw Error('main_window_required');pending.get(requestId)?.finish(error)})
  handle('state',e=>{const win=sender(e);return hosts.get(win.id)?.tabs.map(e=>e.tab)||[]})
  handle('open',async(e,chatId:string,path:string)=>{
    // Browser UI may open files from its own conversation in the main workspace.
    // Web pages and subframes never qualify as an application host.
    if(e.senderFrame===e.sender.mainFrame&&options.browserOwnsChat?.(e.sender,chatId)){
      const source=BrowserWindow.fromWebContents(e.sender)
      if(!source||source.isDestroyed()||!options.chatExists(chatId))throw Error('invalid_file_owner')
      return exclusive([source.id],async()=>{
        const tab=makeFileTab(chatId,path)
        await options.files.resolveExisting(tab.chatId,tab.path)
        if((await options.files.stat(tab.chatId,tab.path)).type!=='file')throw Error('not_a_file')
        if(source.isDestroyed()||!options.browserOwnsChat?.(e.sender,chatId))throw Error('file_window_ui_only')
        await mainTransfer({kind:'open',tab,viewerChatId:chatId})
      })
    }
    const source=sender(e).id
    return exclusive([source],async()=>{const h=hosts.get(source);if(!h||!options.chatExists(chatId))throw Error('file_host_required');const tab=makeFileTab(chatId,path);await options.files.resolveExisting(chatId,path);if((await options.files.stat(chatId,path)).type!=='file')throw Error('not_a_file');if(h.window.isDestroyed())throw Error('file_host_required');if(h.tabs.length>=32&&!h.tabs.some(v=>v.tab.key===tab.key))throw Error('file_tab_limit');if(!h.tabs.some(v=>v.tab.key===tab.key))h.tabs.push({tab,viewerChatId:h.tabs[0]?.viewerChatId||chatId});changed(h)})
  })
  handle('detach',(e,tab:FileTab,viewerChatId:string)=>{const source=sender(e).id;return exclusive([source],async()=>{const value=await entry(e,tab,viewerChatId);if(!BrowserWindow.fromId(source))throw Error('file_host_required');newHost(value);remove(source,value)})})
  handle('close',(e,key:string)=>{const source=sender(e).id;idle(source);const h=hosts.get(source);if(!h)throw Error('file_host_required');const value=h.tabs.find(v=>v.tab.key===key);if(value)remove(h.window.id,value)})
  handle('attach',(e,key:string)=>{const h=hosts.get(sender(e).id),value=h?.tabs.find(v=>v.tab.key===key);if(!h||!value)throw Error('file_tab_not_found');return exclusive([h.window.id,...(options.getMain()?[options.getMain()!.id]:[])],async()=>{await mainTransfer({kind:'open',...value});remove(h.window.id,value)})})
  handle('beginDrag',async(e,tab:FileTab,viewerChatId:string)=>{const source=sender(e).id;idle(source);const value=await entry(e,tab,viewerChatId);idle(source);for(const [key,t] of tokens)if(t.expires<Date.now())tokens.delete(key);const token=randomUUID();tokens.set(token,{entry:value,source,expires:Date.now()+30000});return token})
  handle('drop',async(e,token:string,viewerChatId?:string,before?:string)=>{
    const win=sender(e),t=validToken(token)
    tokens.delete(token)
    if(t.source===win.id&&before===t.entry.tab.key)return
    return exclusive([t.source,win.id],async()=>{
    const h=hosts.get(win.id)
    if(h){const rest=h.tabs.filter(v=>v.tab.key!==t.entry.tab.key),at=rest.findIndex(v=>v.tab.key===before);if(rest.length>=32)throw Error('file_tab_limit');rest.splice(at<0?rest.length:at,0,t.entry);h.tabs=rest;changed(h)}
    else{const target=viewerChatId||t.entry.viewerChatId;if(!options.chatExists(target))throw Error('invalid_file_owner');await mainTransfer({kind:'open',tab:t.entry.tab,viewerChatId:target,before})}
    if(t.source!==win.id)remove(t.source,t.entry)
    })
  })
  handle('endDrag',(e,token:string,outside:boolean,point?:{x:number;y:number})=>{const source=sender(e).id;if(!tokens.has(token))return;const t=validToken(token);if(t.source!==source)throw Error('file_drag_expired');tokens.delete(token);if(outside){idle(source);newHost(t.entry,point);remove(source,t.entry)}})
  return {ownsSender(sender:WebContents){const win=BrowserWindow.fromWebContents(sender);return !!win&&hosts.get(win.id)?.window.webContents===sender},dispose(){for(const value of pending.values())value.finish('app_quitting');for(const h of [...hosts.values()])h.window.destroy();hosts.clear();tokens.clear()}}
}
