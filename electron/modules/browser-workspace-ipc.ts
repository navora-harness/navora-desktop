import {ipcMain,type BrowserWindow,type IpcMainInvokeEvent} from 'electron'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import type {BrowserRegistry} from './browser-registry'
import {BrowserAnnotationService} from './browser-annotations'
import {BrowserAnnotationDraftStore} from './browser-annotation-drafts'
import {BrowserTabsService} from './browser-tabs-service'
import {browserAddress,browserRect,browserLayoutRect,type BrowserAnnotation,type BrowserTabCommandInput,type BrowserEditCommand,type BrowserEditState} from '../../shared/browser-workspace'
import type {BrowserPage} from './browser-host'
import {isUrlAllowed} from '../../shared/url-allowlist'
import type {AppConfig} from '../../shared/config'
import type {WorkspaceFiles} from './workspace-files'
import type {BrowserStartStore} from './browser-start-store'

export function registerBrowserWorkspace(options:{registry:BrowserRegistry;files:WorkspaceFiles;start:BrowserStartStore;getConfig:()=>AppConfig;chatExists:(id:string)=>boolean;getMain:()=>BrowserWindow|null;preload:string;loadHost:(win:BrowserWindow,id:string)=>void}){
  const {registry,files}=options,hosts=registry.hosts,annotations=new BrowserAnnotationService(registry,files)
  const drags=new Map<string,{pageId:string;pageIds:string[];source:string;expires:number}>(),tabs=new BrowserTabsService(registry,options.getConfig,options.chatExists)
  hosts.detachedPreferences={preload:options.preload}
  hosts.configureDetached=options.loadHost
  hosts.onPresent=page=>{
    hosts.getHost(page.hostId||'')?.window.webContents.send('navora:browser.present',{chatId:page.chatId,pageId:page.id})
  }
  hosts.onHide=page=>{if(hosts.presentation(page)==='embedded')options.getMain()?.webContents.send('navora:browser.present',{chatId:page.chatId,pageId:page.id,hidden:true})}
  const host=(e:IpcMainInvokeEvent)=>{const h=hosts.hostForSender(e.sender);if(!h||e.senderFrame!==e.sender.mainFrame)throw Error('browser_ui_only');return h}
  const page=(e:IpcMainInvokeEvent,id:string)=>{const h=host(e),p=hosts.pages.get(id);if(!p||p.isDestroyed())throw Error('browser_page_not_found');if(!h.embedded&&p.hostId!==h.id)throw Error('browser_page_wrong_host');return p}
  function handle(name:string,fn:(e:IpcMainInvokeEvent,...args:any[])=>unknown){ipcMain.handle(`navora:browser.workspace.${name}`,fn)}
  handle('ensure',async(e,chatId:string,key:string,url?:string)=>{
    const h=host(e)
    // Old persisted keys can name a page directly before tabKey was introduced.
    const live=registry.getWindowRecord(typeof key==='string'?key.replace(/^browser:/,''):'')
    if(live){if(live.chatId!==chatId)throw Error('browser_wrong_chat');if(live.win.hostId!==h.id)throw Error('browser_page_wrong_host');return live.windowId}
    return (await tabs.action(h.id,{chatId,action:'new',key,url,background:true})).pageId!
  })
  handle('tabState',(e,chatId:string)=>tabs.state(host(e).id,chatId))
  handle('tabAction',(e,input:BrowserTabCommandInput)=>tabs.action(host(e).id,input))
  const editingPage=(e:IpcMainInvokeEvent,id:string)=>{const h=host(e),p=page(e,id);if(p.hostId!==h.id||h.active!==id)throw Error('browser_page_not_visible');return p}
  async function editState(e:IpcMainInvokeEvent,id:string):Promise<BrowserEditState>{
    const p=editingPage(e,id),epoch=p.automation.captureDocumentEpoch()
    const state=await p.webContents.executeJavaScriptInIsolatedWorld(1006,[{code:`(()=>{const el=document.activeElement,isInput=el instanceof HTMLInputElement,isTextArea=el instanceof HTMLTextAreaElement,password=isInput&&el.type==='password',editable=!!el&&(el.isContentEditable||isTextArea||isInput&&['text','search','url','tel','email','password','number',''].includes(el.type)),writable=editable&&!el.readOnly&&!el.disabled;let selection=false;if((isInput||isTextArea)&&typeof el.selectionStart==='number')selection=el.selectionEnd>el.selectionStart;else selection=!!getSelection()?.toString();const can=name=>{try{return !!document.queryCommandEnabled(name)}catch{return false}};return {undo:writable&&can('undo'),redo:writable&&can('redo'),cut:writable&&selection&&!password,copy:selection&&!password,paste:writable,pastePlain:writable,delete:writable&&selection,selectAll:!!document.body};})()`}]) as BrowserEditState
    editingPage(e,id);if(epoch!==p.automation.captureDocumentEpoch())throw Error('composer_source_changed')
    return state
  }
  handle('editState',editState)
  handle('openSettings',(e,id:string)=>{
    const source=host(e),current=page(e,id),main=options.getMain()
    if(current.hostId!==source.id||source.active!==id)throw Error('browser_page_not_visible')
    if(!main||main.isDestroyed())throw Error('main_window_unavailable')
    if(main.isMinimized())main.restore()
    main.show();main.focus();main.webContents.focus()
    main.webContents.send('navora:browser.open-settings',{section:'browser',pageId:id,sourceHostId:source.id})
  })
  handle('edit',async(e,id:string,command:BrowserEditCommand)=>{
    if(!['undo','redo','cut','copy','paste','pastePlain','delete','selectAll'].includes(command))throw Error('invalid_browser_edit_command')
    const p=editingPage(e,id),state=await editState(e,id)
    if(!state[command])throw Error('browser_edit_unavailable')
    if(!['copy','selectAll'].includes(command)){
      if(p.annotationSelecting)throw Error('browser_busy_finish_action_first')
      const control=await p.automation.takeControl();if(control.error)throw Error(control.error)
    }
    editingPage(e,id)
    const wc=p.webContents;wc.focus()
    if(command==='pastePlain')wc.pasteAndMatchStyle()
    else wc[command]()
  })
  handle('state',e=>{const h=host(e),owners=new Set([...hosts.pages.values()].map(p=>p.chatId));return {hostId:h.id,embedded:h.embedded,pages:[...owners].flatMap(id=>registry.getTree(id)).map(s=>({...s,windows:s.windows.filter(p=>p.hostWindowId===h.id)}))}})
  handle('claimLayout',(e,id:string)=>hosts.claimLayout(host(e).id,page(e,id).id))
  handle('layout',(e,id:string|null,bounds:unknown,owner?:string,generation?:number)=>{
    const h=host(e)
    if(typeof id!=='string'||!id||typeof owner!=='string'||!owner)throw Error('invalid_browser_layout_owner')
    // Renderer geometry is CSS pixels; native View bounds are content-area DIP.
    // BrowserWindow zoom is the conversion, not the monitor's devicePixelRatio.
    const rect=bounds?browserLayoutRect(bounds,e.sender.getZoomFactor()):null
    return hosts.setLayout(h.id,id,rect,owner,generation)
  })
  handle('preview',async(e,id:string)=>{
    const h=host(e),p=hosts.pages.get(id)
    if(!p||p.isDestroyed())return null
    if(p.hostId!==h.id||h.active!==id||h.suspended)return null
    // Offscreen UI hosts do not have a native compositor surface to capture.
    if(h.window.webContents.isOffscreen())return null
    const image=await p.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true}).catch(()=>null)
    if(!image||image.isEmpty())return null
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
      const stopped=p.automation.pause()
      registry.markNavigationStopped(id)
      if(!wc.isCrashed())wc.stop()
      await stopped
      return
    }
    if(command==='focus'){if(hosts.isVisible(p))wc.focus();return}
    if(command==='resume'){await annotations.cancel(p.chatId,id);await p.automation.resume();return}
    if(command==='takeControl'||command==='pause'||command==='retryAutomation'){
      if(p.annotationSelecting)await annotations.cancel(p.chatId,id)
      const state=await (command==='takeControl'?p.automation.takeControl():command==='pause'?p.automation.pause():p.automation.retryRelease())
      if(state.error)throw Error(state.error)
      return
    }
    // Manual control pauses agent tools, while the user's own navigation stays available.
    if(p.annotationSelecting)throw Error('browser_busy_finish_action_first')
    // User navigation/geometry changes interrupt this page only, including tools
    // still waiting for a permission decision. Never wait for the old action lock.
    if(['navigate','back','forward','reload','reloadIgnoringCache','zoom','viewport'].includes(command)){
      const state=await p.automation.takeControl()
      // A confirmed unlock permits explicit user navigation to replace a document
      // whose old held-input cleanup failed; no old release is sent into the new one.
      const recoveryNavigation=['navigate','back','forward','reload','reloadIgnoringCache'].includes(command)&&state.error==='cleanup_unconfirmed'&&state.nativeConfirmed&&!state.inputProtected
      if(state.error&&!recoveryNavigation)throw Error(state.error)
    }
    switch(command){
      case 'navigate':{
        const url=browserAddress(String(value))
        if(url!=='about:blank'&&!isUrlAllowed(url,options.getConfig().browser.url_allowlist))throw Error('url_not_allowed')
        registry.markDesiredUrl(id,url)
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
      case 'reloadIgnoringCache':cancelPending();wc.reloadIgnoringCache();break
      case 'zoom':{const zoom=Number(value);if(!Number.isFinite(zoom)||zoom<0.25||zoom>3)throw Error('invalid_zoom');if(wc.getZoomFactor()!==zoom){wc.setZoomFactor(zoom);p.automation.geometryChanged()}hosts.flushLayout(p);break}
      case 'viewport':{
        if(value===null)p.fixedViewport=null
        else{const size=browserRect({x:0,y:0,...value as object});p.fixedViewport={width:size.width,height:size.height}}
        hosts.activate(p);break
      }
      default:throw Error('unknown_browser_command')
    }
  })
  handle('detach',async(e,id:string)=>{const p=page(e,id);if(p.annotationSelecting)throw Error('browser_busy_finish_action_first');await p.automation.withTransfer(()=>hosts.detach(p))})
  handle('attach',async(e,id:string)=>{const p=page(e,id);if(p.annotationSelecting)throw Error('browser_busy_finish_action_first');await p.automation.withTransfer(()=>hosts.attachMain(p))})
  handle('beginDrag',(e,id:string,pageIds?:string[])=>{
    const h=host(e),p=page(e,id),requested=pageIds?.length?pageIds:[id]
    if(!Array.isArray(requested)||requested.length>256||requested.some(value=>typeof value!=='string'))throw Error('invalid_browser_tab')
    const selected=new Set([...requested,id]),ordered=hosts.hostPages(h.id).filter(value=>selected.has(value))
    for(const value of selected){const candidate=page(e,value);if(candidate.hostId!==h.id)throw Error('browser_page_wrong_host');if(candidate.chatId!==p.chatId)throw Error('browser_chat_mismatch');if(candidate.annotationSelecting)throw Error('browser_busy_finish_action_first')}
    for(const [token,d] of drags)if(d.expires<Date.now())drags.delete(token)
    const token=randomUUID();drags.set(token,{pageId:id,pageIds:ordered,source:h.id,expires:Date.now()+30000});return token
  })
  const dropTabs=async(e:IpcMainInvokeEvent,token:string)=>{
    const h=host(e),d=drags.get(token);if(!d||d.expires<Date.now())throw Error('browser_drag_expired')
    drags.delete(token)
    const p=hosts.pages.get(d.pageId);if(!p||p.hostId!==d.source)throw Error('browser_drag_stale')
    await tabs.transferPages(d.pageIds,h.id,d.source);hosts.present(p);return {pageId:p.id,pageIds:[...d.pageIds]}
  }
  handle('dropTabs',dropTabs)
  handle('drop',async(e,token:string)=>(await dropTabs(e,token)).pageId)
  handle('endDrag',async(e,token:string,outside:boolean,point?:{x:number;y:number})=>{
    const d=drags.get(token);if(!d)return
    if(d.source!==host(e).id)throw Error('browser_drag_wrong_source')
    drags.delete(token)
    if(outside&&d.expires>Date.now()){
      const p=hosts.pages.get(d.pageId)
      if(p&&p.hostId===d.source){
        const newHost=hosts.createDetachedHost(point)
        try{await tabs.transferPages(d.pageIds,newHost,d.source);hosts.present(p)}
        finally{hosts.closeEmptyDetachedHosts([newHost])}
      }
    }
  })
  const owned=(e:IpcMainInvokeEvent,chatId:string,id:string)=>{const p=page(e,id);if(p.chatId!==chatId)throw Error('browser_wrong_chat');return p}
  handle('annotation.begin',async(e,chatId:string,id:string,kind:'auto'|'element'|'region')=>{const p=owned(e,chatId,id);if(!['auto','element','region'].includes(kind))throw Error('invalid_annotation_kind');if(hosts.getHost(p.hostId||'')?.active!==p.id)throw Error('browser_page_not_visible');await annotations.begin(chatId,id,kind)})
  handle('annotation.collect',async(e,chatId:string,id:string)=>{owned(e,chatId,id);return annotations.collect(chatId,id)})
  handle('annotation.cancel',async(e,chatId:string,id:string)=>{owned(e,chatId,id);return annotations.cancel(chatId,id)})
  handle('annotation.mode',async(e,chatId:string,id:string,mode:'armed'|'passthrough')=>{owned(e,chatId,id);if(!['armed','passthrough'].includes(mode))throw Error('invalid_annotation_mode');await annotations.mode(chatId,id,mode)})
  handle('annotation.targets',(e,chatId:string,id:string)=>{owned(e,chatId,id);return annotations.listTargets(chatId,id)})
  handle('annotation.writeTarget',(e,chatId:string,id:string,version:number,input)=>{host(e);const target=annotations.getTarget(chatId,id);owned(e,chatId,target.pageId);return annotations.writeTarget(chatId,id,version,input)})
  handle('annotation.commitTarget',(e,chatId:string,pageId:string,id:string,version:number)=>{owned(e,chatId,pageId);return annotations.commitTarget(chatId,pageId,id,version)})
  handle('annotation.discardTarget',(e,chatId:string,pageId:string,id:string,version:number)=>{owned(e,chatId,pageId);return annotations.discardTarget(chatId,pageId,id,version)})
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
