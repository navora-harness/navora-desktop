import {BrowserWindow,WebContentsView,View,type WebContents,type WebPreferences} from 'electron'
import {EventEmitter} from 'node:events'
import {startOwnedNavigation} from './browser-navigation-control'
import {randomUUID} from 'node:crypto'
import {browserRect,browserTabAfterRemoval,type BrowserRect,type BrowserLayoutResult,type BrowserLayoutInvalidation} from '../../shared/browser-workspace'
import type {BrowserTreeSession} from '../../shared/types'
import {detachedWindowChrome,resolveWindowIcon,wireDetachedWindowChrome} from './window-chrome'
import {registerWindowMaterial} from './window-material'
import {placeDetachedWindow} from './window-placement'
import {getBrowserAutomationController,type BrowserAutomationController} from './browser-automation-controller'
import {htmlFullscreenPage,windowFullscreen} from './window-fullscreen'
import {detachedBrowserTabKey,detachedFileTabKey,detachedWorkspaceOrder,type DetachedWorkspaceFileEntry,type DetachedWorkspaceTab} from '../../shared/detached-workspace'

type LayoutRequest={pageId:string;owner:string;generation:number;hostGeneration:number;bounds:BrowserRect}
type CommittedLayout=LayoutRequest&{pageBounds:BrowserRect}
type Host={ready:boolean;surface:View;id:string;window:BrowserWindow;embedded:boolean;active?:string;activeTab?:string;pages:Set<string>;files:Map<string,DetachedWorkspaceFileEntry>;tabOrder:string[];closing:boolean;requested:LayoutRequest|null;committed:CommittedLayout|null;generation:number;suspended:boolean;contentSize:ReturnType<BrowserWindow['getContentSize']>;resizeTimer?:ReturnType<typeof setTimeout>}
const sameRect=(a:BrowserRect,b:BrowserRect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height

/** Stable page facade retained for the existing windowId tool protocol. No OS window owns its lifetime. */
export class BrowserPage extends EventEmitter {
  view:WebContentsView
  readonly webContents:WebContents
  hostId:string|null=null
  layoutOwner=''
  layoutGeneration=0
  lastBounds:BrowserRect={x:0,y:0,width:1280,height:800}
  fixedViewport:{width:number;height:number}|null=null
  manualControl=false
  annotationSelecting=false
  navigationStopped=false
  activeOperations=0
  pinned=false
  readonly automation:BrowserAutomationController
  constructor(readonly id:string,readonly chatId:string,readonly manager:BrowserHostManager,preferences:WebPreferences){
    super();this.view=new WebContentsView({webPreferences:preferences});this.view.setVisible(false);this.webContents=this.view.webContents;this.webContents.setBackgroundThrottling(false)
    this.automation=getBrowserAutomationController(this.webContents,{
      getManualControl:()=>this.manualControl,setManualControl:manual=>{this.manualControl=manual},
      onChanged:()=>{this.emit('automation-changed');this.manager.onChanged?.()},
      onIdle:()=>this.manager.flushLayout(this),
    })
    this.webContents.once('destroyed',()=>{this.manager.remove(this);this.emit('closed')})
    this.webContents.on('focus',()=>this.manager.select(this))
  }
  loadURL(url:string){return startOwnedNavigation(this.webContents,undefined,()=>this.webContents.loadURL(url))}
  isDestroyed(){return this.webContents.isDestroyed()}
  getTitle(){return this.isDestroyed()?'':this.webContents.getTitle()}
  getBounds(){const host=this.manager.getHost(this.hostId||'');const zoom=this.webContents.getZoomFactor();return host&&!host.embedded?host.window.getBounds():{x:0,y:0,width:this.fixedViewport?Math.round(this.fixedViewport.width*zoom):this.lastBounds.width,height:this.fixedViewport?Math.round(this.fixedViewport.height*zoom):this.lastBounds.height}}
  getContentSize():[number,number]{return [this.lastBounds.width,this.lastBounds.height]}
  setBounds(bounds:BrowserRect){const host=this.manager.getHost(this.hostId||'');if(host&&!host.embedded){host.window.setBounds(bounds);this.fixedViewport=null}else this.manager.resizePage(this,browserRect(bounds))}
  show(){this.manager.present(this)}
  hide(){this.manager.hide(this)}
  isVisible(){return this.manager.isVisible(this)}
  focus(){this.manager.present(this);this.webContents.focus()}
  isFocused(){return !this.isDestroyed()&&this.webContents.isFocused()}
  destroy(){if(!this.isDestroyed())this.webContents.close({waitForBeforeUnload:false})}
  close(){if(!this.isDestroyed()){this.manager.onWillClose?.(this);this.webContents.close({waitForBeforeUnload:true})}}
}

/** Owns presentation only. A page keeps its webContents across host transfers. */
export class BrowserHostManager {
  private hosts=new Map<string,Host>()
  private presentationDeferred=false
  private pendingPresentation=new Set<string>()
  deferPresentation(){
    this.presentationDeferred=true
    for(const host of this.hosts.values())host.surface.setVisible(false)
  }
  resumePresentation(){
    this.presentationDeferred=false
    for(const host of this.hosts.values()){
      if(host.window.isDestroyed())continue
      host.surface.setVisible(true)
      if(this.pendingPresentation.has(host.id)){
        if(host.embedded)host.window.show()
        else host.window.showInactive()
      }
    }
    this.pendingPresentation.clear()
  }
  private showHost(host:Host){
    if(this.presentationDeferred){this.pendingPresentation.add(host.id);return}
    host.window.show()
  }
  readonly pages=new Map<string,BrowserPage>()
  mainHostId:string|null=null
  selectedPageId:string|undefined
  select(page:BrowserPage,notify=true){if(this.selectedPageId===page.id)return;this.selectedPageId=page.id;if(notify)this.onChanged?.()}
  configureDetached?:(win:BrowserWindow,hostId:string)=>void
  onChanged?:()=>void
  onActivate?:(page:BrowserPage)=>void
  onPresent?:(page:BrowserPage)=>void
  onPageCreated?:(page:BrowserPage)=>void
  onLayoutInvalidated?:(host:Host,value:BrowserLayoutInvalidation)=>void
  onHide?:(page:BrowserPage)=>void
  onWillClose?:(page:BrowserPage)=>void
  onCloseHost?:(hostId:string)=>Promise<boolean>|boolean
  notifyWorkspaceChanged(){
    for(const host of this.hosts.values())if(!host.embedded&&!host.window.isDestroyed()&&!host.window.webContents.isDestroyed())host.window.webContents.send('navora:browser.workspace-changed')
    this.onChanged?.()
  }
  bindMain(win:BrowserWindow){
    const id=`host_${win.id}`;this.mainHostId=id
    this.addHost(id,win,true)
    return id
  }
  private addHost(id:string,window:BrowserWindow,embedded:boolean){
    const surface=new View();window.contentView.addChildView(surface)
    surface.setVisible(!this.presentationDeferred)
    const host:Host={ready:false,surface,id,window,embedded,pages:new Set(),files:new Map(),tabOrder:[],closing:false,requested:null,committed:null,generation:0,suspended:false,contentSize:window.getContentSize()}
    this.hosts.set(id,host)
    window.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame&&!isInPlace){host.suspended=true;this.invalidateLayout(host);for(const id of host.pages){const page=this.pages.get(id);if(page){page.layoutOwner='';page.layoutGeneration=0}}}})
    window.on('resize',()=>this.resizeHost(host))
    window.on('show',()=>{this.changed(host);this.restorePresentation(host,'show')});window.on('hide',()=>this.changed(host))
    window.on('restore',()=>this.restorePresentation(host,'restore'))
    window.on('focus',()=>{const page=this.pages.get(host.active||'');if(page)this.select(page);this.restorePresentation(host,'focus')})
    window.on('closed',()=>{
      clearTimeout(host.resizeTimer)
      this.hosts.delete(id);if(this.mainHostId===id)this.mainHostId=null
      this.pendingPresentation.delete(id)
      for(const pageId of [...host.pages])this.pages.get(pageId)?.destroy()
    })
    if(!embedded)window.on('close',event=>{
      if(!host.pages.size)return
      event.preventDefault()
      if(host.closing)return
      if(this.onCloseHost){
        host.closing=true
        void Promise.resolve(this.onCloseHost(host.id)).then(closed=>{
          if(closed&&!host.pages.size&&!window.isDestroyed()){host.files.clear();window.destroy()}
        }).catch(error=>console.warn('[browser] window close interrupted',error)).finally(()=>{
          host.closing=false
          if(!window.isDestroyed()&&!host.activeTab){const next=this.syncTabOrder(host)[0];if(next)this.activateTab(host.id,next)}
        })
        return
      }
      for(const pageId of [...host.pages])this.pages.get(pageId)?.close()
    })
    return host
  }
  create(id:string,chatId:string,preferences:WebPreferences,size:{width:number;height:number},show:boolean){
    const page=new BrowserPage(id,chatId,this,preferences);this.pages.set(id,page)
    page.lastBounds={x:0,y:0,...size};page.view.setBounds(page.lastBounds)
    let host=this.mainHostId?this.hosts.get(this.mainHostId):undefined
    if(!host)host=this.newDetached(size,show)
    this.transfer(page,host.id,false)
    if(show)this.present(page)
    this.onPageCreated?.(page)
    return page
  }
  private newDetached(size:{width:number;height:number},show=true,point?:{x:number;y:number}){
    const icon=resolveWindowIcon(process.platform)
    const window=new BrowserWindow({width:Math.max(500,size.width),height:Math.max(400,size.height+100),minWidth:500,minHeight:360,show:false,title:'Navora Browser',...(icon?{icon}:{}),...detachedWindowChrome(process.platform),backgroundColor:'#ffffff',
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,...this.detachedPreferences}})
    registerWindowMaterial(window,'browser')
    const host=this.addHost(`host_${randomUUID().slice(0,12)}`,window,false)
    wireDetachedWindowChrome(window)
    placeDetachedWindow(window,point)
    window.setMenu(null);this.configureDetached?.(window,host.id)
    if(show)this.showHost(host)
    return host
  }
  detachedPreferences:WebPreferences={}
  hostForSender(sender:WebContents){return [...this.hosts.values()].find(h=>!h.window.isDestroyed()&&h.window.webContents===sender)}
  hostPages(hostId:string){return [...(this.hosts.get(hostId)?.pages||[])]}
  private syncTabOrder(host:Host){
    const available=[...host.pages].map(detachedBrowserTabKey).concat([...host.files.keys()].map(detachedFileTabKey)),pinned=new Set([...host.pages].filter(id=>this.pages.get(id)?.pinned).map(detachedBrowserTabKey))
    host.tabOrder=detachedWorkspaceOrder(host.tabOrder,available,pinned)
    return host.tabOrder
  }
  hostTabs(hostId:string):DetachedWorkspaceTab[]{
    const host=this.hosts.get(hostId);if(!host)return []
    const byKey=new Map<string,DetachedWorkspaceTab>()
    for(const id of host.pages){const page=this.pages.get(id);if(page&&!page.isDestroyed()){const key=detachedBrowserTabKey(id);byKey.set(key,{kind:'browser',key,pageId:id,chatId:page.chatId})}}
    for(const {tab,viewerChatId} of host.files.values()){const key=detachedFileTabKey(tab.key);byKey.set(key,{kind:'file',key,chatId:tab.chatId,file:tab,viewerChatId})}
    return this.syncTabOrder(host).map(key=>byKey.get(key)!).filter(Boolean)
  }
  contextChatId(hostId:string){const host=this.hosts.get(hostId);return this.pages.get([...host?.pages||[]][0]||'')?.chatId||[...host?.files.values()||[]][0]?.viewerChatId||null}
  ownsChat(hostId:string,chatId:string){const host=this.hosts.get(hostId);return !!host&&([...host.pages].some(id=>this.pages.get(id)?.chatId===chatId)||[...host.files.values()].some(entry=>entry.tab.chatId===chatId||entry.viewerChatId===chatId))}
  activateTab(hostId:string,key:string){
    const host=this.hosts.get(hostId),tab=this.hostTabs(hostId).find(tab=>tab.key===key)
    if(!host||!tab||host.closing)throw Error('browser_tab_not_found')
    if(tab.kind==='browser'){this.present(this.pages.get(tab.pageId)!);return}
    this.invalidateLayout(host);host.active=undefined;host.activeTab=key;host.suspended=true
    // In-flight layout/claim replies from the old browser renderer must not
    // regain presentation over a file. Returning to that page needs a new lease.
    for(const id of host.pages){const page=this.pages.get(id);if(page){page.layoutOwner='';page.layoutGeneration=0}}
    host.window.setTitle(`${tab.file.path.split('/').at(-1)||'文件'} — Navora`);this.showHost(host);host.window.webContents.focus();this.notifyWorkspaceChanged()
  }
  reorderTabs(hostId:string,keys:string[],beforeKey?:string|null){
    const host=this.hosts.get(hostId);if(!host||host.closing)throw Error('browser_host_unavailable')
    const order=[...this.syncTabOrder(host)],available=new Set(order)
    if(!Array.isArray(keys)||!keys.length||keys.length>256||keys.some(key=>typeof key!=='string'||!available.has(key))||beforeKey!=null&&(typeof beforeKey!=='string'||!available.has(beforeKey)))throw Error('invalid_browser_tab')
    const selected=new Set(keys);if(beforeKey&&selected.has(beforeKey))return
    const moved=order.filter(key=>selected.has(key)),rest=order.filter(key=>!selected.has(key)),at=beforeKey?rest.indexOf(beforeKey):-1
    rest.splice(at<0?rest.length:at,0,...moved);host.tabOrder=rest;this.syncTabOrder(host)
    host.pages=new Set(host.tabOrder.flatMap(key=>key.startsWith('browser:')?[key.slice(8)]:[]));this.notifyWorkspaceChanged()
  }
  restoreTabOrder(hostId:string,order:string[]){
    const host=this.hosts.get(hostId);if(!host)return
    host.tabOrder=[...order];this.syncTabOrder(host);host.pages=new Set(host.tabOrder.flatMap(key=>key.startsWith('browser:')?[key.slice(8)]:[]));this.notifyWorkspaceChanged()
  }
  addFile(hostId:string,entry:DetachedWorkspaceFileEntry,beforeKey?:string){
    const host=this.hosts.get(hostId);if(!host||host.embedded||host.closing||host.window.isDestroyed())throw Error('file_host_required')
    if(!host.files.has(entry.tab.key)&&host.files.size>=32)throw Error('file_tab_limit')
    const key=detachedFileTabKey(entry.tab.key),order=this.syncTabOrder(host).filter(value=>value!==key),existing=host.files.has(entry.tab.key)
    if(beforeKey&&!order.includes(beforeKey))throw Error('file_tab_not_found')
    const at=beforeKey?order.indexOf(beforeKey):existing?host.tabOrder.indexOf(key):host.activeTab?order.indexOf(host.activeTab)+1:order.length
    order.splice(at<0?order.length:at,0,key);host.files.set(entry.tab.key,entry);host.tabOrder=order;this.syncTabOrder(host);this.activateTab(host.id,key)
  }
  removeFile(hostId:string,key:string){
    const host=this.hosts.get(hostId);if(!host||!host.files.has(key))return
    const previous=[...this.syncTabOrder(host)],contentKey=detachedFileTabKey(key);host.files.delete(key);this.syncTabOrder(host)
    if(host.activeTab===contentKey){host.activeTab=undefined;this.activateNextContent(host,previous,contentKey)}
    this.closeEmptyDetachedHosts([hostId]);this.notifyWorkspaceChanged()
  }
  private activateNextContent(host:Host,previous:string[],removedKey:string){
    const key=browserTabAfterRemoval(previous,removedKey,this.syncTabOrder(host))
    if(key&&!host.closing)this.activateTab(host.id,key)
  }
  listHosts(){return [...this.hosts.values()].filter(host=>!host.window.isDestroyed())}
  setOrder(hostId:string,order:string[]){
    const host=this.hosts.get(hostId);if(!host)return
    const existing=this.hostPages(hostId),available=new Set(existing),next=[...new Set([...order,...existing])].filter(id=>available.has(id))
    next.sort((a,b)=>Number(!!this.pages.get(b)?.pinned)-Number(!!this.pages.get(a)?.pinned))
    const normalOrder=[...this.syncTabOrder(host)],browserKeys=next.map(detachedBrowserTabKey);let at=0
    host.tabOrder=normalOrder.flatMap(key=>key.startsWith('browser:')?browserKeys[at++]?[browserKeys[at-1]!]:[]:[key]).concat(browserKeys.slice(at))
    const changed=next.length!==existing.length||next.some((id,index)=>id!==existing[index])
    host.pages=new Set(next);this.syncTabOrder(host);if(changed)this.notifyWorkspaceChanged()
  }
  createDetachedHost(point?:{x:number;y:number}){return this.newDetached({width:1100,height:760},true,point).id}
  closeEmptyDetachedHosts(hostIds:string[]){for(const id of hostIds){const host=this.hosts.get(id);if(host&&!host.embedded&&!host.pages.size&&!host.files.size&&!host.window.isDestroyed())host.window.destroy()}}
  reorder(hostId:string,pageIds:string[],beforeId?:string|null){
    if(!this.hosts.get(hostId)?.embedded){this.reorderTabs(hostId,pageIds.map(detachedBrowserTabKey),beforeId?detachedBrowserTabKey(beforeId):beforeId);return}
    const order=this.hostPages(hostId),selected=new Set(pageIds),moved=order.filter(id=>selected.has(id)),rest=order.filter(id=>!selected.has(id))
    if(!moved.length)return
    const at=beforeId?rest.indexOf(beforeId):-1
    rest.splice(at<0?rest.length:at,0,...moved);this.setOrder(hostId,rest)
  }
  insertAfter(page:BrowserPage,sourceId?:string){
    if(!page.hostId)return
    const host=this.hosts.get(page.hostId)
    if(host&&!host.embedded){
      const key=detachedBrowserTabKey(page.id),order=this.syncTabOrder(host).filter(value=>value!==key),source=sourceId?detachedBrowserTabKey(sourceId):host.activeTab,at=source?order.indexOf(source)+1:order.length
      order.splice(at<0?order.length:at,0,key);host.tabOrder=order;this.syncTabOrder(host);host.pages=new Set(host.tabOrder.flatMap(key=>key.startsWith('browser:')?[key.slice(8)]:[]));this.notifyWorkspaceChanged();return
    }
    const order=this.hostPages(page.hostId).filter(id=>id!==page.id),source=this.pages.get(sourceId||'')
    const firstNormal=order.findIndex(id=>!this.pages.get(id)?.pinned)
    const at=source?.pinned?(firstNormal<0?order.length:firstNormal):sourceId?order.indexOf(sourceId)+1:order.length
    order.splice(at<0?order.length:at,0,page.id);this.setOrder(page.hostId,order)
  }
  setPinned(page:BrowserPage,pinned:boolean){if(page.pinned===pinned)return;page.pinned=pinned;if(page.hostId)this.setOrder(page.hostId,this.hostPages(page.hostId));this.onChanged?.()}
  getHost(id:string){return this.hosts.get(id)}
  notifyDetachedTreeChanged(payload:{chatId:string;tree:BrowserTreeSession[];counts:Record<string,number>}){
    // The source host also needs this update after a page moves elsewhere.
    for(const host of this.hosts.values()){
      if(host.embedded||host.window.isDestroyed())continue
      if(!this.ownsChat(host.id,payload.chatId))continue
      host.window.webContents.send('navora:browser.treeUpdated',payload)
    }
  }
  presentation(page:BrowserPage){return this.hosts.get(page.hostId||'')?.embedded?'embedded' as const:'detached' as const}
  transfer(page:BrowserPage,targetId:string,activatePage=true,closeEmptySource=true){
    if(page.activeOperations>0||page.automation.isBusy())throw Error('browser_busy_finish_action_first')
    const target=this.hosts.get(targetId)
    if(!target||target.window.isDestroyed()||page.isDestroyed())throw Error('browser_host_unavailable')
    const source=this.hosts.get(page.hostId||'')
    if(target.closing||source?.closing)throw Error('browser_busy_wait_for_current_action')
    if(source===target){if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}return}
    page.emit('presentation-invalidated')
    const wasActive=source?.active===page.id,previousOrder=source?this.hostPages(source.id):[],previousTabs=source?[...this.syncTabOrder(source)]:[]
    page.view.setVisible(false);source?.surface.removeChildView(page.view)
    try{target.surface.addChildView(page.view)}catch(error){
      if(source&&!source.window.isDestroyed()){source.surface.addChildView(page.view);if(wasActive)this.activate(page)}
      throw error
    }
    source?.pages.delete(page.id);target.pages.add(page.id);page.hostId=targetId
    if(source)this.syncTabOrder(source);this.syncTabOrder(target)
    page.layoutOwner='';page.layoutGeneration=0
    if(wasActive&&source)this.invalidateLayout(source)
    if(activatePage)this.invalidateLayout(target)
    this.setOrder(targetId,this.hostPages(targetId))
    if(wasActive&&source){source.active=undefined;source.activeTab=undefined;if(source.embedded)this.activateNext(source,previousOrder,page.id,page.chatId);else this.activateNextContent(source,previousTabs,detachedBrowserTabKey(page.id))}
    if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}
    if(closeEmptySource&&source)this.closeEmptyDetachedHosts([source.id])
    this.notifyWorkspaceChanged()
  }
  detach(page:BrowserPage,point?:{x:number;y:number}){
    // Sidebar viewports are narrow and tall; a torn-out page gets a roomy
    // desktop window instead of inheriting the side panel's dimensions.
    const host=this.newDetached({width:1100,height:760},true,point)
    try{this.transfer(page,host.id)}catch(error){host.window.destroy();throw error}
    return host.id
  }
  attachMain(page:BrowserPage){if(!this.mainHostId)throw Error('main_browser_host_unavailable');this.transfer(page,this.mainHostId);this.present(page)}
  private activateNext(host:Host,previous:string[]=[],removedId='',chatId?:string){
    const remaining=this.hostPages(host.id).filter(id=>!chatId||this.pages.get(id)?.chatId===chatId),id=browserTabAfterRemoval(previous,removedId,remaining)
    if(host.embedded)host.suspended=true
    if(id)this.activate(this.pages.get(id)!)
  }
  activate(page:BrowserPage){
    const host=this.hosts.get(page.hostId||'');if(!host)return
    const previous=this.pages.get(host.active||'');if(previous&&previous!==page)previous.view.setVisible(false)
    if(previous!==page){this.invalidateLayout(host);this.select(page,false)}
    host.active=page.id;host.activeTab=detachedBrowserTabKey(page.id);this.layout(page,host);this.updateWindowTitle(page);this.notifyWorkspaceChanged()
    this.onActivate?.(page)
  }
  updateWindowTitle(page:BrowserPage){
    const host=this.hosts.get(page.hostId||'');if(!host||host.embedded||host.window.isDestroyed()||host.active!==page.id||host.activeTab!==detachedBrowserTabKey(page.id))return
    const pageTitle=page.getTitle().trim(),url=page.webContents.getURL()
    let title=pageTitle
    if(!title||/^(新标签页|新窗口|Navora Browser)$/i.test(title)){
      try{title=new URL(url).hostname}catch{title=''}
    }
    host.window.setTitle(title?`${title} — Navora Browser`:'Navora Browser')
  }
  present(page:BrowserPage){
    const host=this.hosts.get(page.hostId||'');if(!host)return
    if(host.embedded&&host.active!==page.id)host.suspended=true
    this.select(page,false);this.activate(page);this.showHost(host);page.emit('show');this.onPresent?.(page)
  }
  hide(page:BrowserPage){page.view.setVisible(false);const host=this.hosts.get(page.hostId||'');if(host?.active===page.id){this.invalidateLayout(host);host.active=undefined}page.emit('hide');this.onHide?.(page);this.onChanged?.()}
  isVisible(page:BrowserPage){const host=this.hosts.get(page.hostId||'');return !!host&&this.canDisplay(page,host)&&host.window.isVisible()}
  private invalidateLayout(host:Host){const fullscreenPage=htmlFullscreenPage(host.window);if(fullscreenPage)windowFullscreen(host.window).revokeHtml(fullscreenPage);clearTimeout(host.resizeTimer);host.resizeTimer=undefined;host.generation++;host.requested=null;host.ready=false;for(const id of host.pages){const page=this.pages.get(id);page?.emit('presentation-invalidated');page?.view.setVisible(false)}}
  private resizeHost(host:Host){
    const size=host.window.getContentSize()
    // Native move notifications can report an unchanged client size. They do
    // not invalidate the page's window-local coordinates or its presentation.
    if(size[0]===host.contentSize[0]&&size[1]===host.contentSize[1]&&host.ready)return
    host.contentSize=size
    if(host.suspended||!host.active||host.resizeTimer)return
    // Keep the committed live view while the renderer measures the new slot.
    // Only page/owner changes and explicit hiding revoke that presentation.
    host.resizeTimer=setTimeout(()=>{
      host.resizeTimer=undefined
      if(host.window.isDestroyed()||host.suspended)return
      host.generation++
      this.pages.get(host.active||'')?.emit('presentation-invalidated')
      this.requestLayout(host,'resize')
    },16)
  }
  private requestLayout(host:Host,reason:BrowserLayoutInvalidation['reason']){
    const page=this.pages.get(host.active||'')
    if(!page||page.isDestroyed()||page.hostId!==host.id||!page.layoutOwner||host.window.isDestroyed())return
    this.onLayoutInvalidated?.(host,{pageId:page.id,owner:page.layoutOwner,hostGeneration:host.generation,reason})
  }
  private restorePresentation(host:Host,reason:BrowserLayoutInvalidation['reason']){
    const page=this.pages.get(host.active||'')
    if(!page||page.isDestroyed()||host.window.isDestroyed())return
    // A modal, hidden workspace or intentionally hidden page must stay hidden.
    // Focus changes alone never claim ownership or change the active page.
    if(this.canDisplay(page,host)){page.view.setVisible(true);return}
    if(host.requested&&!host.suspended){this.layout(page,host);return}
    if(!host.suspended)this.requestLayout(host,reason)
  }
  claimLayout(hostId:string,pageId:string){
    const host=this.hosts.get(hostId),page=this.pages.get(pageId)
    if(!host||!page||page.isDestroyed()||page.hostId!==hostId)throw Error('browser_page_wrong_host')
    if(!host.embedded&&host.activeTab&&host.activeTab!==detachedBrowserTabKey(pageId))throw Error('browser_page_not_visible')
    if(host.active&&host.active!==pageId)throw Error('browser_page_not_visible')
    page.layoutOwner=randomUUID();page.layoutGeneration=0
    if(host.active===page.id)this.invalidateLayout(host)
    return page.layoutOwner
  }
  private canDisplay(page:BrowserPage,host:Host){
    const request=host.requested,committed=host.committed
    // A newer rectangle may wait for in-flight input. The committed rectangle
    // still belongs to this page/owner and may stay visible until it is applied.
    return !!request&&!!committed&&host.ready&&!host.suspended&&host.active===page.id&&page.hostId===host.id&&!page.isDestroyed()&&request.pageId===page.id&&request.owner===page.layoutOwner&&committed.pageId===page.id&&committed.owner===page.layoutOwner
  }
  private layoutResult(host:Host,pageId:string|null,status:BrowserLayoutResult['status'],reason?:BrowserLayoutResult['reason']):BrowserLayoutResult{
    const page=pageId?this.pages.get(pageId):undefined
    return {status,pageId,owner:page?.layoutOwner||'',generation:page?.layoutGeneration||0,hostGeneration:host.generation,visible:!!page&&this.canDisplay(page,host),...(reason?{reason}:{})}
  }
  setLayout(hostId:string,pageId:string|null,bounds:BrowserRect|null,owner?:string,generation?:number):BrowserLayoutResult{
    const host=this.hosts.get(hostId);if(!host)throw Error('browser_host_unavailable')
    const page=pageId?this.pages.get(pageId):undefined
    if(pageId&&(!page||page.isDestroyed()||page.hostId!==hostId))return this.layoutResult(host,pageId,'stale','unavailable')
    if(!host.embedded&&host.activeTab&&host.activeTab!==detachedBrowserTabKey(pageId||''))return this.layoutResult(host,pageId,'stale','inactive')
    if(page&&owner!==undefined&&page.layoutOwner!==owner)return this.layoutResult(host,pageId,'stale','owner')
    if(generation!==undefined&&(!Number.isSafeInteger(generation)||generation<1))throw Error('invalid_browser_layout_generation')
    if(page&&generation!==undefined&&generation<=page.layoutGeneration)return this.layoutResult(host,pageId,'stale','generation')
    if(page&&host.active&&host.active!==page.id)return this.layoutResult(host,pageId,'stale','inactive')
    if(bounds&&(!page||bounds.width<=0||bounds.height<=0))throw Error('invalid_browser_bounds')
    const normalized=bounds?browserRect(bounds):null
    if(page)page.layoutGeneration=generation??page.layoutGeneration+1
    if(!normalized||!page){host.suspended=true;this.invalidateLayout(host);return this.layoutResult(host,pageId,'applied')}
    if(host.active!==page.id)this.activate(page)
    host.requested={pageId:page.id,owner:page.layoutOwner,generation:page.layoutGeneration,hostGeneration:++host.generation,bounds:normalized}
    host.suspended=false
    return this.layout(page,host)
  }
  suspend(hostId:string,suspended:boolean){
    const host=this.hosts.get(hostId);if(!host)return
    host.suspended=suspended
    const page=this.pages.get(host.active||'');if(page)page.view.setVisible(this.canDisplay(page,host))
  }
  private layout(page:BrowserPage,host:Host):BrowserLayoutResult{
    const request=host.requested
    if(!request||request.pageId!==page.id||request.owner!==page.layoutOwner||host.active!==page.id||page.hostId!==host.id||page.isDestroyed()){page.view.setVisible(false);return this.layoutResult(host,page.id,'stale','inactive')}
    const htmlFullscreen=htmlFullscreenPage(host.window)===page.id,size=host.window.getContentSize()
    const surfaceBounds=htmlFullscreen?{x:0,y:0,width:size[0],height:size[1]}:request.bounds
    const bounds=htmlFullscreen?{...surfaceBounds}:{...request.bounds,x:-(request.bounds.scrollLeft||0),y:-(request.bounds.scrollTop||0)}
    if(page.fixedViewport&&!htmlFullscreen){const zoom=page.webContents.getZoomFactor();bounds.width=Math.round(page.fixedViewport.width*zoom);bounds.height=Math.round(page.fixedViewport.height*zoom)}
    const surfaceChanged=!sameRect(host.surface.getBounds(),surfaceBounds),viewChanged=!sameRect(page.view.getBounds(),bounds)
    const reusable=host.committed?.pageId===page.id&&host.committed.owner===page.layoutOwner&&!surfaceChanged&&!viewChanged
    if((page.activeOperations>0||page.automation.isBusy())&&!reusable)return this.layoutResult(host,page.id,'deferred','busy')
    try{
      if(surfaceChanged)host.surface.setBounds(surfaceBounds)
      if(viewChanged)page.view.setBounds(bounds)
      page.lastBounds={...bounds}
      host.committed={...request,bounds:{...surfaceBounds},pageBounds:{...bounds}};host.ready=true
      if(surfaceChanged||viewChanged)page.automation.geometryChanged()
      const visible=this.canDisplay(page,host)
      if(page.view.getVisible()!==visible)page.view.setVisible(visible)
      return this.layoutResult(host,page.id,'applied')
    }catch{host.ready=false;page.view.setVisible(false);return this.layoutResult(host,page.id,'deferred','apply-failed')}
  }
  flushLayout(page:BrowserPage){const host=this.hosts.get(page.hostId||'');if(host?.active===page.id){const before=host.committed?.hostGeneration,result=this.layout(page,host);if(result.status==='applied'&&host.committed?.hostGeneration!==before)this.onChanged?.();return result}}
  resizePage(page:BrowserPage,bounds:BrowserRect){
    page.fixedViewport={width:bounds.width,height:bounds.height}
    const host=this.hosts.get(page.hostId||'');if(host&&host.active===page.id)this.layout(page,host)
    else if(!sameRect(page.lastBounds,bounds)&&!page.automation.isBusy()){page.lastBounds=bounds;page.view.setBounds(bounds);page.automation.geometryChanged()}
  }
  dispose(){for(const page of [...this.pages.values()])page.destroy()}
  remove(page:BrowserPage){
    if(this.selectedPageId===page.id)this.selectedPageId=undefined
    this.pages.delete(page.id)
    const host=this.hosts.get(page.hostId||'');if(!host)return
    const previous=this.hostPages(host.id),previousTabs=[...this.syncTabOrder(host)]
    host.pages.delete(page.id)
    this.syncTabOrder(host)
    if(host.active===page.id){this.invalidateLayout(host);host.active=undefined;host.activeTab=undefined;if(host.embedded)this.activateNext(host,previous,page.id,page.chatId);else this.activateNextContent(host,previousTabs,detachedBrowserTabKey(page.id))}
    this.closeEmptyDetachedHosts([host.id]);this.notifyWorkspaceChanged()
  }
  private changed(host:Host){for(const id of host.pages)this.pages.get(id)?.emit(host.window.isVisible()?'show':'hide');this.onChanged?.()}
}
