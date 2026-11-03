import {BrowserWindow,WebContentsView,View,type WebContents,type WebPreferences} from 'electron'
import {EventEmitter} from 'node:events'
import {randomUUID} from 'node:crypto'
import {browserRect,type BrowserRect} from '../../shared/browser-workspace'
import {detachedWindowChrome,resolveWindowIcon,wireDetachedWindowChrome} from './window-chrome'
import {placeDetachedWindow} from './window-placement'

type Host={ready:boolean;surface:View;id:string;window:BrowserWindow;embedded:boolean;active?:string;pages:Set<string>;bounds:BrowserRect;suspended:boolean}

/** Stable page facade retained for the existing windowId tool protocol. No OS window owns its lifetime. */
export class BrowserPage extends EventEmitter {
  view:WebContentsView
  readonly webContents:WebContents
  hostId:string|null=null
  layoutOwner=''
  lastBounds:BrowserRect={x:0,y:0,width:1280,height:800}
  fixedViewport:{width:number;height:number}|null=null
  manualControl=false
  annotationSelecting=false
  navigationStopped=false
  activeOperations=0
  constructor(readonly id:string,readonly chatId:string,readonly manager:BrowserHostManager,preferences:WebPreferences){
    super();this.view=new WebContentsView({webPreferences:preferences});this.view.setVisible(false);this.webContents=this.view.webContents;this.webContents.setBackgroundThrottling(false)
    this.webContents.once('destroyed',()=>{this.manager.remove(this);this.emit('closed')})
    this.webContents.on('focus',()=>this.manager.select(this))
  }
  loadURL(url:string){return this.webContents.loadURL(url)}
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
  close(){if(!this.isDestroyed())this.webContents.close({waitForBeforeUnload:true})}
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
  bindMain(win:BrowserWindow){
    const id=`host_${win.id}`;this.mainHostId=id
    this.addHost(id,win,true)
    return id
  }
  private addHost(id:string,window:BrowserWindow,embedded:boolean){
    const surface=new View();window.contentView.addChildView(surface)
    const host:Host={ready:false,surface,id,window,embedded,pages:new Set(),bounds:{x:0,y:0,width:800,height:600},suspended:false}
    this.hosts.set(id,host)
    window.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame&&!isInPlace){host.suspended=true;for(const id of host.pages)this.pages.get(id)?.view.setVisible(false)}})
    window.on('show',()=>this.changed(host));window.on('hide',()=>this.changed(host))
    window.on('focus',()=>{const page=this.pages.get(host.active||'');if(page)this.select(page)})
    window.on('closed',()=>{
      this.hosts.delete(id);if(this.mainHostId===id)this.mainHostId=null
      for(const pageId of [...host.pages])this.pages.get(pageId)?.destroy()
    })
    if(!embedded)window.on('close',event=>{
      if(!host.pages.size)return
      event.preventDefault()
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
  getHost(id:string){return this.hosts.get(id)}
  presentation(page:BrowserPage){return this.hosts.get(page.hostId||'')?.embedded?'embedded' as const:'detached' as const}
  transfer(page:BrowserPage,targetId:string,activatePage=true){
    const target=this.hosts.get(targetId)
    if(!target||target.window.isDestroyed()||page.isDestroyed())throw Error('browser_host_unavailable')
    const source=this.hosts.get(page.hostId||'')
    if(source===target){if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}return}
    const wasActive=source?.active===page.id
    page.view.setVisible(false);source?.surface.removeChildView(page.view)
    try{target.surface.addChildView(page.view)}catch(error){
      if(source&&!source.window.isDestroyed()){source.surface.addChildView(page.view);if(wasActive)this.activate(page)}
      throw error
    }
    source?.pages.delete(page.id);target.pages.add(page.id);page.hostId=targetId
    if(wasActive&&source){source.active=undefined;this.activateNext(source)}
    if(activatePage){if(target.embedded&&target.active!==page.id)target.suspended=true;this.activate(page)}
    if(source&&!source.embedded&&!source.pages.size)source.window.destroy()
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
  private activateNext(host:Host){const id=[...host.pages].at(-1);if(host.embedded)host.suspended=true;if(id)this.activate(this.pages.get(id)!)}
  activate(page:BrowserPage){
    const host=this.hosts.get(page.hostId||'');if(!host)return
    const previous=this.pages.get(host.active||'');if(previous&&previous!==page)previous.view.setVisible(false)
    if(previous!==page)this.select(page,false)
    host.active=page.id;this.layout(page,host);page.view.setVisible(host.ready&&!host.suspended);this.updateWindowTitle(page);this.onChanged?.()
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
  hide(page:BrowserPage){page.view.setVisible(false);const host=this.hosts.get(page.hostId||'');if(host?.active===page.id)host.active=undefined;page.emit('hide');this.onHide?.(page);this.onChanged?.()}
  isVisible(page:BrowserPage){const host=this.hosts.get(page.hostId||'');return !!host&&host.ready&&!host.suspended&&host.active===page.id&&host.window.isVisible()}
  setLayout(hostId:string,pageId:string|null,bounds:BrowserRect|null){
    const host=this.hosts.get(hostId);if(!host)throw Error('browser_host_unavailable')
    if(!bounds||!pageId){if(pageId&&host.active!==pageId)return;host.suspended=true;for(const id of host.pages)this.pages.get(id)?.view.setVisible(false);return}
    const page=this.pages.get(pageId);if(!page||page.hostId!==hostId)throw Error('browser_page_wrong_host')
    host.bounds=browserRect(bounds);host.ready=true;host.suspended=false;this.activate(page)
  }
  suspend(hostId:string,suspended:boolean){
    const host=this.hosts.get(hostId);if(!host)return
    host.suspended=suspended
    const page=this.pages.get(host.active||'');if(page)page.view.setVisible(!suspended)
  }
  private layout(page:BrowserPage,host:Host){
    if(page.activeOperations>0)return
    host.surface.setBounds(host.bounds)
    const bounds={...host.bounds,x:-(host.bounds.scrollLeft||0),y:-(host.bounds.scrollTop||0)}
    if(page.fixedViewport){const zoom=page.webContents.getZoomFactor();bounds.width=Math.round(page.fixedViewport.width*zoom);bounds.height=Math.round(page.fixedViewport.height*zoom)}
    page.lastBounds=bounds;page.view.setBounds(bounds)
  }
  flushLayout(page:BrowserPage){const host=this.hosts.get(page.hostId||'');if(host?.active===page.id)this.layout(page,host)}
  resizePage(page:BrowserPage,bounds:BrowserRect){
    page.fixedViewport={width:bounds.width,height:bounds.height}
    const host=this.hosts.get(page.hostId||'');if(host)this.layout(page,host)
    else{page.lastBounds=bounds;page.view.setBounds(bounds)}
  }
  dispose(){for(const page of [...this.pages.values()])page.destroy()}
  remove(page:BrowserPage){
    if(this.selectedPageId===page.id)this.selectedPageId=undefined
    this.pages.delete(page.id)
    const host=this.hosts.get(page.hostId||'');if(!host)return
    host.pages.delete(page.id)
    if(host.active===page.id){host.active=undefined;this.activateNext(host)}
    if(!host.embedded&&!host.pages.size&&!host.window.isDestroyed())host.window.destroy()
    this.onChanged?.()
  }
  private changed(host:Host){for(const id of host.pages)this.pages.get(id)?.emit(host.window.isVisible()?'show':'hide');this.onChanged?.()}
}
