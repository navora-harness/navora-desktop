import {BrowserWindow,WebContentsView,View,type WebContents,type WebPreferences} from 'electron'
import {EventEmitter} from 'node:events'
import {startOwnedNavigation} from './browser-navigation-control'
import {randomUUID} from 'node:crypto'
import {browserRect,browserTabAfterRemoval,type BrowserRect,type BrowserLayoutResult} from '../../shared/browser-workspace'
import type {BrowserTreeSession} from '../../shared/types'
import {detachedWindowChrome,resolveWindowIcon,wireDetachedWindowChrome} from './window-chrome'
import {placeDetachedWindow} from './window-placement'
import {getBrowserAutomationController,type BrowserAutomationController} from './browser-automation-controller'

type LayoutRequest={pageId:string;owner:string;generation:number;hostGeneration:number;bounds:BrowserRect}
type CommittedLayout=LayoutRequest&{pageBounds:BrowserRect}
type Host={ready:boolean;surface:View;id:string;window:BrowserWindow;embedded:boolean;active?:string;pages:Set<string>;requested:LayoutRequest|null;committed:CommittedLayout|null;generation:number;suspended:boolean}
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
    super();this.view=new WebContentsView({webPreferences:preferences});this.view.setVisible(false);this.view.setBorderRadius(12);this.webContents=this.view.webContents;this.webContents.setBackgroundThrottling(false)
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
  readonly pages=new Map<string,BrowserPage>()
  mainHostId:string|null=null
  selectedPageId:string|undefined
  select(page:BrowserPage,notify=true){if(this.selectedPageId===page.id)return;this.selectedPageId=page.id;if(notify)this.onChanged?.()}
  configureDetached?:(win:BrowserWindow,hostId:string)=>void
  onChanged?:()=>void
  onActivate?:(page:BrowserPage)=>void
  onPresent?:(page:BrowserPage)=>void
  onHide?:(page:BrowserPage)=>void
  onWillClose?:(page:BrowserPage)=>void
  onCloseHost?:(hostId:string)=>void
  bindMain(win:BrowserWindow){
    const id=`host_${win.id}`;this.mainHostId=id
    this.addHost(id,win,true)
    return id
  }
  private addHost(id:string,window:BrowserWindow,embedded:boolean){
    const surface=new View();window.contentView.addChildView(surface)
    const host:Host={ready:false,surface,id,window,embedded,pages:new Set(),requested:null,committed:null,generation:0,suspended:false}
    this.hosts.set(id,host)
    window.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame&&!isInPlace){host.suspended=true;this.invalidateLayout(host);for(const id of host.pages){const page=this.pages.get(id);if(page){page.layoutOwner='';page.layoutGeneration=0}}}})
    window.on('resize',()=>this.invalidateLayout(host))
    window.on('show',()=>this.changed(host));window.on('hide',()=>this.changed(host))
    window.on('focus',()=>{const page=this.pages.get(host.active||'');if(page)this.select(page)})
    window.on('closed',()=>{
      this.hosts.delete(id);if(this.mainHostId===id)this.mainHostId=null
      for(const pageId of [...host.pages])this.pages.get(pageId)?.destroy()
    })
    if(!embedded)window.on('close',event=>{
      if(!host.pages.size)return
      event.preventDefault()
      if(this.onCloseHost){this.onCloseHost(host.id);return}
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
    return page
  }
  private newDetached(size:{width:number;height:number},show=true,point?:{x:number;y:number}){
    const icon=resolveWindowIcon(process.platform)
    const window=new BrowserWindow({width:Math.max(500,size.width),height:Math.max(400,size.height+100),minWidth:500,minHeight:360,show:false,title:'Navora Browser',...(icon?{icon}:{}),...detachedWindowChrome(process.platform),backgroundColor:'#ffffff',
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,...this.detachedPreferences}})
    const host=this.addHost(`host_${randomUUID().slice(0,12)}`,window,false)
    wireDetachedWindowChrome(window)
    placeDetachedWindow(window,point)
    window.setMenu(null);this.configureDetached?.(window,host.id)
    if(show)window.show()
    return host
  }
  detachedPreferences:WebPreferences={}
  hostForSender(sender:WebContents){return [...this.hosts.values()].find(h=>h.window.webContents===sender)}
  hostPages(hostId:string){return [...(this.hosts.get(hostId)?.pages||[])]}
  listHosts(){return [...this.hosts.values()].filter(host=>!host.window.isDestroyed())}
  setOrder(hostId:string,order:string[]){
    const host=this.hosts.get(hostId);if(!host)return
    const existing=this.hostPages(hostId),available=new Set(existing),next=[...new Set([...order,...existing])].filter(id=>available.has(id))
    next.sort((a,b)=>Number(!!this.pages.get(b)?.pinned)-Number(!!this.pages.get(a)?.pinned))
    if(next.length===existing.length&&next.every((id,index)=>id===existing[index]))return
    host.pages=new Set(next);this.onChanged?.()
  }
  createDetachedHost(point?:{x:number;y:number}){return this.newDetached({width:1100,height:760},true,point).id}
  closeEmptyDetachedHosts(hostIds:string[]){for(const id of hostIds){const host=this.hosts.get(id);if(host&&!host.embedded&&!host.pages.size&&!host.window.isDestroyed())host.window.destroy()}}
  reorder(hostId:string,pageIds:string[],beforeId?:string|null){
    const order=this.hostPages(hostId),selected=new Set(pageIds),moved=order.filter(id=>selected.has(id)),rest=order.filter(id=>!selected.has(id))
    if(!moved.length)return
    const at=beforeId?rest.indexOf(beforeId):-1
    rest.splice(at<0?rest.length:at,0,...moved);this.setOrder(hostId,rest)
  }
  insertAfter(page:BrowserPage,sourceId?:string){
    if(!page.hostId)return
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
      if(![...host.pages].some(id=>this.pages.get(id)?.chatId===payload.chatId))continue
      host.window.webContents.send('navora:browser.treeUpdated',payload)
    }
  }
  presentation(page:BrowserPage){return this.hosts.get(page.hostId||'')?.embedded?'embedded' as const:'detached' as const}
  transfer(page:BrowserPage,targetId:string,activatePage=true,closeEmptySource=true){
    if(page.activeOperations>0||page.automation.isBusy())throw Error('browser_busy_finish_action_first')
    const target=this.hosts.get(targetId)
    if(!target||target.window.isDestroyed()||page.isDestroyed())throw Error('browser_host_unavailable')
    const source=this.hosts.get(page.hostId||'')
    if(source===target){if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}return}
    const wasActive=source?.active===page.id,previousOrder=source?this.hostPages(source.id):[]
    page.view.setVisible(false);source?.surface.removeChildView(page.view)
    try{target.surface.addChildView(page.view)}catch(error){
      if(source&&!source.window.isDestroyed()){source.surface.addChildView(page.view);if(wasActive)this.activate(page)}
      throw error
    }
    source?.pages.delete(page.id);target.pages.add(page.id);page.hostId=targetId
    page.layoutOwner='';page.layoutGeneration=0
    if(wasActive&&source)this.invalidateLayout(source)
    if(activatePage)this.invalidateLayout(target)
    this.setOrder(targetId,this.hostPages(targetId))
    if(wasActive&&source){source.active=undefined;this.activateNext(source,previousOrder,page.id,page.chatId)}
    if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}
    if(closeEmptySource&&source&&!source.embedded&&!source.pages.size)source.window.destroy()
    this.onChanged?.()
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
    host.active=page.id;this.layout(page,host);this.updateWindowTitle(page);this.onChanged?.()
    this.onActivate?.(page)
  }
  updateWindowTitle(page:BrowserPage){
    const host=this.hosts.get(page.hostId||'');if(!host||host.embedded||host.window.isDestroyed())return
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
    this.select(page,false);this.activate(page);host.window.show();page.emit('show');this.onPresent?.(page)
  }
  hide(page:BrowserPage){page.view.setVisible(false);const host=this.hosts.get(page.hostId||'');if(host?.active===page.id){this.invalidateLayout(host);host.active=undefined}page.emit('hide');this.onHide?.(page);this.onChanged?.()}
  isVisible(page:BrowserPage){const host=this.hosts.get(page.hostId||'');return !!host&&this.canDisplay(page,host)&&host.window.isVisible()}
  private invalidateLayout(host:Host){host.generation++;host.requested=null;host.ready=false;for(const id of host.pages)this.pages.get(id)?.view.setVisible(false)}
  claimLayout(hostId:string,pageId:string){
    const host=this.hosts.get(hostId),page=this.pages.get(pageId)
    if(!host||!page||page.isDestroyed()||page.hostId!==hostId)throw Error('browser_page_wrong_host')
    if(host.active&&host.active!==pageId)throw Error('browser_page_not_visible')
    page.layoutOwner=randomUUID();page.layoutGeneration=0
    if(host.active===page.id)this.invalidateLayout(host)
    return page.layoutOwner
  }
  private canDisplay(page:BrowserPage,host:Host){
    const request=host.requested,committed=host.committed
    return !!request&&!!committed&&host.ready&&!host.suspended&&host.active===page.id&&page.hostId===host.id&&!page.isDestroyed()&&request.pageId===page.id&&request.owner===page.layoutOwner&&committed.hostGeneration===request.hostGeneration&&committed.pageId===page.id&&committed.owner===page.layoutOwner
  }
  private layoutResult(host:Host,pageId:string|null,status:BrowserLayoutResult['status'],reason?:BrowserLayoutResult['reason']):BrowserLayoutResult{
    const page=pageId?this.pages.get(pageId):undefined
    return {status,pageId,owner:page?.layoutOwner||'',generation:page?.layoutGeneration||0,hostGeneration:host.generation,visible:!!page&&this.canDisplay(page,host),...(reason?{reason}:{})}
  }
  setLayout(hostId:string,pageId:string|null,bounds:BrowserRect|null,owner?:string,generation?:number):BrowserLayoutResult{
    const host=this.hosts.get(hostId);if(!host)throw Error('browser_host_unavailable')
    const page=pageId?this.pages.get(pageId):undefined
    if(pageId&&(!page||page.isDestroyed()||page.hostId!==hostId))return this.layoutResult(host,pageId,'stale','unavailable')
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
    const bounds={...request.bounds,x:-(request.bounds.scrollLeft||0),y:-(request.bounds.scrollTop||0)}
    if(page.fixedViewport){const zoom=page.webContents.getZoomFactor();bounds.width=Math.round(page.fixedViewport.width*zoom);bounds.height=Math.round(page.fixedViewport.height*zoom)}
    const surfaceChanged=!sameRect(host.surface.getBounds(),request.bounds),viewChanged=!sameRect(page.view.getBounds(),bounds)
    const reusable=host.committed?.pageId===page.id&&host.committed.owner===page.layoutOwner&&!surfaceChanged&&!viewChanged
    if((page.activeOperations>0||page.automation.isBusy())&&!reusable){host.ready=false;page.view.setVisible(false);return this.layoutResult(host,page.id,'deferred','busy')}
    try{
      if(surfaceChanged||viewChanged)page.view.setVisible(false)
      if(surfaceChanged)host.surface.setBounds(request.bounds)
      if(viewChanged)page.view.setBounds(bounds)
      page.lastBounds={...bounds}
      host.committed={...request,bounds:{...request.bounds},pageBounds:{...bounds}};host.ready=true
      if(surfaceChanged||viewChanged)page.automation.geometryChanged()
      page.view.setVisible(this.canDisplay(page,host))
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
    const previous=this.hostPages(host.id)
    host.pages.delete(page.id)
    if(host.active===page.id){this.invalidateLayout(host);host.active=undefined;this.activateNext(host,previous,page.id,page.chatId)}
    if(!host.embedded&&!host.pages.size&&!host.window.isDestroyed())host.window.destroy()
    this.onChanged?.()
  }
  private changed(host:Host){for(const id of host.pages)this.pages.get(id)?.emit(host.window.isVisible()?'show':'hide');this.onChanged?.()}
}
