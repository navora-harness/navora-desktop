import type {BrowserWindow,WebContents,WebFrameMain,Rectangle,Input} from 'electron'

export const WINDOW_FULLSCREEN_CHANGED='navora:app.window.fullscreen'
export type WindowRestoreState={bounds:Rectangle;maximized:boolean}
type HtmlOwner={pageId:string;exit:()=>Promise<unknown>;changed:()=>void}
const windows=new Map<WebContents,WindowFullscreenController>()
const controllers=new WeakMap<BrowserWindow,WindowFullscreenController>()

/** Window fullscreen and document fullscreen have independent lifetimes. */
export class WindowFullscreenController {
  private userFullscreen:boolean
  private restore?:WindowRestoreState
  private html?:HtmlOwner
  private changing=false
  private leaving=false
  constructor(readonly window:BrowserWindow){
    const contents=window.webContents
    this.userFullscreen=window.isFullScreen()
    window.on('enter-full-screen',()=>{this.publish();this.html?.changed()})
    window.on('leave-full-screen',()=>{
      // An OS exit is also authoritative; never immediately force fullscreen back.
      if(!this.changing&&!this.leaving)this.userFullscreen=false
      this.finishRestore();this.publish();this.html?.changed()
    })
    window.webContents.on('did-finish-load',()=>this.publish())
    window.webContents.on('before-input-event',(event,input)=>{
      if(!fullscreenShortcut(input))return
      event.preventDefault();void this.toggle().catch(error=>console.warn('[window] fullscreen failed',error))
    })
    window.once('closed',()=>{windows.delete(contents);this.html=undefined})
  }
  snapshot(){return {fullscreen:!this.window.isDestroyed()&&this.window.isFullScreen()}}
  restoreState(){return this.restore?{bounds:{...this.restore.bounds},maximized:this.restore.maximized}:undefined}
  htmlPage(){return this.html?.pageId}
  private remember(){
    if(!this.restore)this.restore={bounds:{...this.window.getNormalBounds()},maximized:this.window.isMaximized()}
  }
  private publish(){if(!this.window.isDestroyed()&&!this.window.webContents.isDestroyed())this.window.webContents.send(WINDOW_FULLSCREEN_CHANGED,this.window.isFullScreen())}
  private finishRestore(){
    if(!this.restore||this.window.isFullScreen()||this.userFullscreen||this.html)return
    const saved=this.restore;this.restore=undefined;this.leaving=false
    // Fullscreen bounds must not replace the normal rectangle, including when
    // entering from maximized. Windows normally restores this rectangle itself.
    // Reapplying an equal DIP rectangle grows it on some fractional-DPI displays.
    const same=(a:Rectangle,b:Rectangle)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height
    if(!same(this.window.getNormalBounds(),saved.bounds)){
      if(this.window.isMaximized())this.window.unmaximize()
      if(!same(this.window.getBounds(),saved.bounds))this.window.setBounds(saved.bounds)
    }
    if(saved.maximized&&!this.window.isMaximized())this.window.maximize()
    else if(!saved.maximized&&this.window.isMaximized())this.window.unmaximize()
  }
  private apply(){
    if(this.window.isDestroyed())return
    const target=this.userFullscreen||!!this.html
    if(target)this.remember()
    if(target!==this.window.isFullScreen()){
      this.leaving=!target;this.changing=true
      try{this.window.setFullScreen(target)}finally{this.changing=false}
    }
    if(!target)this.finishRestore()
    this.publish();this.html?.changed()
  }
  async toggle(){
    if(this.window.isDestroyed())throw Error('fullscreen_window_closed')
    const target=!this.window.isFullScreen()
    if(!target&&this.html){
      // Exit the document first. A failed exit does not masquerade as a released
      // document or put a still-fullscreen page into an ordinary tiny rectangle.
      const previous=this.html
      await previous.exit()
      if(this.html===previous){this.html=undefined;previous.changed()}
    }
    this.userFullscreen=target;this.apply()
    return {ok:true as const,...this.snapshot()}
  }
  enterHtml(owner:HtmlOwner){
    if(this.window.isDestroyed())return
    if(this.html&&this.html.pageId!==owner.pageId)throw Error('fullscreen_page_already_active')
    this.html=owner;this.apply()
  }
  leaveHtml(pageId:string){
    if(this.html?.pageId!==pageId)return
    const previous=this.html;this.html=undefined;previous.changed();this.apply()
  }
  /** Navigation, tab changes and transfer revoke only that document's claim. */
  revokeHtml(pageId:string){
    if(this.html?.pageId!==pageId)return
    const previous=this.html;this.html=undefined
    void previous.exit().catch(()=>{})
    previous.changed();this.apply()
  }
}

export function fullscreenShortcut(input:Pick<Input,'key'|'type'|'control'|'meta'|'alt'|'shift'|'isAutoRepeat'|'isComposing'>){
  return input.type==='keyDown'&&input.key.toLowerCase()==='f11'&&!input.control&&!input.meta&&!input.alt&&!input.shift&&!input.isAutoRepeat&&!input.isComposing
}
export function registerWindowFullscreen(window:BrowserWindow){
  let controller=controllers.get(window)
  if(!controller){controller=new WindowFullscreenController(window);controllers.set(window,controller);windows.set(window.webContents,controller)}
  return controller
}
export function windowFullscreen(window:BrowserWindow){return controllers.get(window)||registerWindowFullscreen(window)}
export function fullscreenForSender(sender:WebContents,frame:WebFrameMain|null){
  const controller=windows.get(sender)
  if(!controller||sender.isDestroyed()||frame!==sender.mainFrame||controller.window.isDestroyed()||controller.window.webContents!==sender)throw Error('fullscreen_local_host_only')
  return controller
}
export function fullscreenRestoreState(window:BrowserWindow){return controllers.get(window)?.restoreState()}
export function htmlFullscreenPage(window:BrowserWindow){return controllers.get(window)?.htmlPage()}

/** Chromium enforces activation for normal fullscreen. automatic-fullscreen is
 * separately denied; permission details do not contain a reliable gesture bit. */
export function foregroundFullscreenPage(page:{id:string;hostId:string|null;isDestroyed:()=>boolean;view:{getVisible:()=>boolean}},host:{id:string;active?:string;ready:boolean;suspended:boolean;window:BrowserWindow}|undefined){
  return !!host&&!page.isDestroyed()&&page.hostId===host.id&&host.active===page.id&&host.ready&&!host.suspended&&page.view.getVisible()&&!host.window.isDestroyed()&&host.window.isVisible()&&!host.window.isMinimized()&&host.window.isFocused()
}
