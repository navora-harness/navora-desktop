import {ipcMain,type BrowserWindow,type IpcMainInvokeEvent} from 'electron'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import type {BrowserRegistry} from './browser-registry'
import {BrowserAnnotationService} from './browser-annotations'
import {BrowserAnnotationDraftStore} from './browser-annotation-drafts'
import {browserAddress,browserRect,type BrowserAnnotation} from '../../shared/browser-workspace'
import type {BrowserPage} from './browser-host'
import {isUrlAllowed} from '../../shared/url-allowlist'
import type {AppConfig} from '../../shared/config'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserStartStore} from './browser-start-store'

export function registerBrowserWorkspace(options:{registry:BrowserRegistry;files:WorkspaceFiles;start:BrowserStartStore;getConfig:()=>AppConfig;chatExists:(id:string)=>boolean;getMain:()=>BrowserWindow|null;preload:string;loadHost:(win:BrowserWindow,id:string)=>void}){
  const {registry,files}=options,hosts=registry.hosts,annotations=new BrowserAnnotationService(registry,files)
  const keys=new Map<string,string>(),drags=new Map<string,{pageId:string;source:string;expires:number}>()
  hosts.detachedPreferences={preload:options.preload}
  hosts.configureDetached=options.loadHost
  hosts.onPresent=page=>{
    hosts.getHost(page.hostId||'')?.window.webContents.send('navora:browser.present',{chatId:page.chatId,pageId:page.id})
  }
  hosts.onHide=page=>{if(hosts.presentation(page)==='embedded')options.getMain()?.webContents.send('navora:browser.present',{chatId:page.chatId,pageId:page.id,hidden:true})}
  const host=(e:IpcMainInvokeEvent)=>{const h=hosts.hostForSender(e.sender);if(!h||e.senderFrame!==e.sender.mainFrame)throw Error('browser_ui_only');return h}
  const page=(e:IpcMainInvokeEvent,id:string)=>{const h=host(e),p=hosts.pages.get(id);if(!p||p.isDestroyed())throw Error('browser_page_not_found');if(!h.embedded&&p.hostId!==h.id)throw Error('browser_page_wrong_host');return p}
  function handle(name:string,fn:(e:IpcMainInvokeEvent,...args:any[])=>unknown){ipcMain.handle(`navora:browser.workspace.${name}`,fn)}
  handle('ensure',(e,chatId:string,key:string,url?:string)=>{
    const h=host(e);if(!options.chatExists(chatId)||typeof key!=='string'||key.length>180)throw Error('invalid_browser_tab')
    if(!h.embedded&&[...h.pages].some(id=>hosts.pages.get(id)?.chatId!==chatId))throw Error('browser_chat_mismatch')
    const existing=keys.get(`${chatId}:${key}`)||registry.getTree(chatId).flatMap(s=>s.windows).find(w=>w.tabKey===key)?.windowId||key.replace(/^browser:/,'')
    const live=registry.getWindowRecord(existing)
    if(live){if(live.chatId!==chatId)throw Error('browser_wrong_chat');return live.windowId}
    const tree=registry.getTree(chatId),session=tree[0]||registry.createSession(chatId,{persist:true})
    const target=browserAddress(url||'about:blank')
    if(target!=='about:blank'&&!isUrlAllowed(target,options.getConfig().browser.url_allowlist))throw Error('url_not_allowed')
    const record=registry.createWindow(session.sessionId,{url:target,show:false})
    const p=hosts.pages.get(record.windowId)!;if(p.hostId!==h.id)hosts.transfer(p,h.id)
    keys.set(`${chatId}:${key}`,record.windowId);registry.getWindowRecord(record.windowId)!.tabKey=key
    return record.windowId
  })
  handle('state',e=>{const h=host(e),owners=new Set([...hosts.pages.values()].map(p=>p.chatId));return {hostId:h.id,embedded:h.embedded,pages:[...owners].flatMap(id=>registry.getTree(id)).map(s=>({...s,windows:s.windows.filter(p=>p.hostWindowId===h.id)}))}})
  handle('claimLayout',(e,id:string)=>{const h=host(e),p=page(e,id);if(p.hostId!==h.id)throw Error('browser_page_wrong_host');return p.layoutOwner=randomUUID()})
  handle('layout',(e,id:string|null,bounds:unknown,owner?:string)=>{const h=host(e),p=id?hosts.pages.get(id):undefined;if(id&&p?.hostId!==h.id)return;if(owner&&p?.layoutOwner!==owner)return;hosts.setLayout(h.id,id,bounds?browserRect(bounds):null)})
  handle('preview',async(e,id:string)=>{
    const h=host(e),p=page(e,id)
    if(p.hostId!==h.id||h.active!==id||h.suspended)return null
    // Offscreen UI hosts do not have a native compositor surface to capture.
    if(h.window.webContents.isOffscreen())return null
    const image=await p.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})
    if(image.isEmpty())return null
    if(p.isDestroyed()||p.hostId!==h.id||h.active!==id||h.suspended)return null
    const size=image.getSize(),scale=Math.min(1,1920/size.width,1920/size.height)
    const preview=scale<1?image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))}):image
    return `data:image/jpeg;base64,${preview.toJPEG(85).toString('base64')}`
  })
  const searches=new WeakMap<BrowserPage,{token:string;requestId:number}>(),findListeners=new WeakSet<BrowserPage>()
  handle('find',(e,id:string,text:string,options:{token:string;forward?:boolean;next?:boolean})=>{
    const h=host(e),p=page(e,id)
    if(p.hostId!==h.id||h.active!==id||h.suspended)throw Error('browser_page_not_visible')
    if(p.annotationSelecting||p.activeOperations)throw Error('browser_busy_wait_for_current_action')
    if(typeof text!=='string'||!text.trim()||text.length>1024||typeof options?.token!=='string'||options.token.length>100)throw Error('invalid_browser_find')
    if(!findListeners.has(p)){
      findListeners.add(p)
      p.webContents.on('before-input-event',(event,input)=>{
        if(input.type!=='keyDown'||input.key!=='Escape'||!searches.has(p)||input.isComposing)return
        const current=hosts.getHost(p.hostId||'')
        if(!current||current.active!==p.id||current.suspended)return
        event.preventDefault();current.window.webContents.send('navora:browser.find-shortcut',{pageId:p.id,action:'close'})
      })
      p.webContents.on('found-in-page',(_event,result)=>{
        const search=searches.get(p),current=hosts.getHost(p.hostId||'')
        if(search&&search.requestId===result.requestId&&current&&!current.window.isDestroyed())current.window.webContents.send('navora:browser.find-result',{pageId:p.id,token:search.token,...result})
      })
    }
    const previous=searches.get(p),search={token:options.token,requestId:0}
    searches.set(p,search)
    // Electron calls the start-of-session flag findNext; subsequent matches use false.
    search.requestId=p.webContents.findInPage(text,{forward:options.forward!==false,findNext:!options.next||previous?.token!==options.token})
  })
  handle('stopFind',(e,id:string,token:string)=>{
    const p=page(e,id)
    if(searches.get(p)?.token!==token)return
    searches.delete(p)
    if(!p.webContents.isCrashed())p.webContents.stopFindInPage('clearSelection')
  })
  const navigations=new WeakMap<BrowserPage,{cancelled:boolean}>()
  handle('command',async(e,id:string,command:string,value:unknown)=>{
    const p=page(e,id),wc=p.webContents
    const cancelPending=()=>{const current=navigations.get(p);if(current)current.cancelled=true}
    // Stopping navigation is a user cancellation and must remain available while
    // an Agent operation or annotation state is holding the page command lock.
    if(command==='stop'){
      cancelPending()
      registry.markNavigationStopped(id)
      if(!wc.isCrashed())wc.stop()
      return
    }
    if(command==='focus'){if(hosts.isVisible(p))wc.focus();return}
    if(command==='resume'){await annotations.cancel(p.chatId,id,true);return}
    if(p.activeOperations)throw Error('browser_busy_wait_for_current_action')
    if(command==='takeControl'){p.manualControl=true;return}
    // Manual control pauses agent tools, while the user's own navigation stays available.
    if(p.annotationSelecting)throw Error('browser_busy_finish_action_first')
    switch(command){
      case 'navigate':{
        const url=browserAddress(String(value))
        if(url!=='about:blank'&&!isUrlAllowed(url,options.getConfig().browser.url_allowlist))throw Error('url_not_allowed')
        cancelPending();const attempt={cancelled:false};navigations.set(p,attempt)
        try{await wc.loadURL(url)}catch(error){
          const aborted=error as {code?:string;errno?:number}
          if(attempt.cancelled||aborted.code==='ERR_ABORTED'||aborted.errno===-3)break
          if(registry.getWindowRecord(id)?.loadError)throw Error('browser_navigation_failed')
          throw error
        }finally{if(navigations.get(p)===attempt)navigations.delete(p)}
        break
      }
      case 'back':if(wc.navigationHistory.canGoBack()){cancelPending();wc.navigationHistory.goBack()}break
      case 'forward':if(wc.navigationHistory.canGoForward()){cancelPending();wc.navigationHistory.goForward()}break
      case 'reload':cancelPending();wc.reload();break
      case 'zoom':{const zoom=Number(value);if(!Number.isFinite(zoom)||zoom<0.25||zoom>3)throw Error('invalid_zoom');wc.setZoomFactor(zoom);hosts.flushLayout(p);break}
      case 'viewport':{
        if(value===null)p.fixedViewport=null
        else{const size=browserRect({x:0,y:0,...value as object});p.fixedViewport={width:size.width,height:size.height}}
        hosts.activate(p);break
      }
      default:throw Error('unknown_browser_command')
    }
  })
  handle('detach',(e,id:string)=>{const p=page(e,id);if(p.manualControl||p.activeOperations)throw Error('browser_busy_finish_action_first');hosts.detach(p)})
  handle('attach',(e,id:string)=>{const p=page(e,id);if(p.manualControl||p.activeOperations)throw Error('browser_busy_finish_action_first');hosts.attachMain(p)})
  handle('beginDrag',(e,id:string)=>{
    const p=page(e,id);if(p.manualControl||p.activeOperations)throw Error('browser_busy_finish_action_first')
    for(const [token,d] of drags)if(d.expires<Date.now())drags.delete(token)
    const token=randomUUID();drags.set(token,{pageId:id,source:host(e).id,expires:Date.now()+30000});return token
  })
  handle('drop',(e,token:string)=>{
    const h=host(e),d=drags.get(token);if(!d||d.expires<Date.now())throw Error('browser_drag_expired')
    drags.delete(token)
    const p=hosts.pages.get(d.pageId);if(!p||p.hostId!==d.source)throw Error('browser_drag_stale')
    if(p.manualControl||p.activeOperations)throw Error('browser_busy_finish_action_first')
    if(!h.embedded&&[...h.pages].some(id=>hosts.pages.get(id)?.chatId!==p.chatId))throw Error('browser_chat_mismatch')
    hosts.transfer(p,h.id);hosts.onPresent?.(p);return p.id
  })
  handle('endDrag',(e,token:string,outside:boolean,point?:{x:number;y:number})=>{const d=drags.get(token);if(!d)return;if(d.source!==host(e).id)throw Error('browser_drag_wrong_source');drags.delete(token);if(outside&&d.expires>Date.now()){const p=hosts.pages.get(d.pageId);if(p&&p.hostId===d.source){if(p.manualControl||p.activeOperations)throw Error('browser_busy_finish_action_first');hosts.detach(p,point)}}})
  const owned=(e:IpcMainInvokeEvent,chatId:string,id:string)=>{const p=page(e,id);if(p.chatId!==chatId)throw Error('browser_wrong_chat');return p}
  handle('annotation.begin',async(e,chatId:string,id:string,kind:'element'|'region')=>{owned(e,chatId,id);if(!['element','region'].includes(kind))throw Error('invalid_annotation_kind');await annotations.begin(chatId,id,kind)})
  handle('annotation.collect',async(e,chatId:string,id:string)=>{owned(e,chatId,id);return annotations.collect(chatId,id)})
  handle('annotation.cancel',async(e,chatId:string,id:string)=>{owned(e,chatId,id);return annotations.cancel(chatId,id)})
  const checkChat=(e:IpcMainInvokeEvent,id:string)=>{const h=host(e);if(!options.chatExists(id)||!h.embedded&&![...h.pages].some(p=>hosts.pages.get(p)?.chatId===id))throw Error('browser_wrong_chat')}
  options.start.onChanged=chatId=>{for(const h of new Set([...hosts.pages.values()].map(page=>page.hostId))){const target=hosts.getHost(h||'');if(target&&!target.window.isDestroyed())target.window.webContents.send('navora:browser.start-changed',chatId)}}
  handle('start.state',(e,chatId:string)=>{checkChat(e,chatId);return options.start.state(chatId)})
  handle('start.saveLink',(e,chatId:string,input)=>{checkChat(e,chatId);return options.start.saveLink(input)})
  handle('start.removeLink',(e,chatId:string,id:string)=>{checkChat(e,chatId);return options.start.removeLink(id)})
  handle('start.clearHistory',(e,chatId:string,url?:string)=>{checkChat(e,chatId);if(url!==undefined&&typeof url!=='string')throw Error('invalid_browser_address');return options.start.clearHistory(chatId,url)})
  const drafts=new BrowserAnnotationDraftStore(files)
  handle('annotation.drafts',(e,chatId:string)=>{checkChat(e,chatId);const live=new Set(annotations.list(chatId).map(note=>note.id));return drafts.list(chatId).filter(draft=>live.has(draft.annotationId))})
  handle('annotation.writeDraft',(e,chatId:string,id:string,version:number,input:import('../../shared/browser-workspace').BrowserDraftInput)=>{checkChat(e,chatId);annotations.get(chatId,id);return drafts.write(chatId,id,version,input)})
  handle('annotation.draftRecovery',(e,chatId:string)=>{
    checkChat(e,chatId)
    const live=new Set(annotations.list(chatId).map(note=>note.id)),result=drafts.recovery(chatId)
    return {...result,copies:result.copies.filter(copy=>live.has(copy.annotationId))}
  })
  handle('annotation.resolveDraft',(e,chatId:string,id:string,version:number,input:import('../../shared/browser-workspace').BrowserDraftInput,copy:{id:string;sequence:number})=>{checkChat(e,chatId);annotations.get(chatId,id);return drafts.resolve(chatId,id,version,input,copy)})
  handle('annotation.list',(e,chatId:string)=>{checkChat(e,chatId);return annotations.list(chatId).map(a=>({...a,anchorState:'stale' as const}))})
  handle('annotation.update',(e,chatId:string,id:string,revision:number,patch:{comment?:string;taskState?:BrowserAnnotation['taskState']})=>{checkChat(e,chatId);return annotations.update(chatId,id,revision,patch)})
  handle('annotation.remove',(e,chatId:string,id:string)=>{checkChat(e,chatId);annotations.remove(chatId,id);drafts.remove(chatId,id)})
  handle('annotation.locate',(e,chatId:string,id:string)=>{checkChat(e,chatId);return annotations.locate(chatId,id)})
  handle('annotation.compare',(e,chatId:string,id:string)=>{checkChat(e,chatId);return annotations.compare(chatId,id)})
  handle('annotation.present',(e,chatId:string,id:string)=>{
    checkChat(e,chatId);const row=annotations.get(chatId,id);if(!row.comment.trim())throw Error('annotation_comment_required')
    const evidencePath=`browser-annotations/${row.id}-r${row.revision}.json`
    const file=files.resolve(chatId,evidencePath)
    if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({...row,taskState:'pending'}))
    const ref={kind:'annotation' as const,annotationId:row.id,annotationRevision:row.revision,sessionId:row.sessionId,windowId:row.pageId,label:row.comment.slice(0,100),url:row.selection.url}
    if(row.taskState==='draft')annotations.update(chatId,id,row.revision,{taskState:'pending'})
    options.getMain()?.show();options.getMain()?.webContents.send('navora:browser.present',{chatId,pageId:row.pageId,annotation:ref})
    return ref
  })
  return annotations
}
