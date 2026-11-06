// Native search cards include their own inset outside the requested content width.
import {currentFindGeometry} from '@shared/window-find-layout'
const panelChrome=24

export function searchPanelLayout(preferredWidth:number,fullscreen=false){
  const titlebar=[...document.querySelectorAll<HTMLElement>('.window-titlebar,.detached-window-bar')].find(element=>element.checkVisibility())
  const titlebarBounds=titlebar?.getBoundingClientRect()
  const platform=window.navora?.app.platform
  let left=8,right=innerWidth-8
  if(!fullscreen&&titlebarBounds){
    if(platform==='win32')right-=Math.max(138,parseFloat(getComputedStyle(titlebar!).paddingRight)||0)
    else if(platform==='darwin')left=Math.max(left,parseFloat(getComputedStyle(titlebar!).paddingLeft)||0)
  }
  const width=Math.max(160,Math.min(preferredWidth,innerWidth-48,right-left-panelChrome))
  const x=Math.max(left,Math.min(Math.round((innerWidth-width-panelChrome)/2),right-width-panelChrome))
  const y=fullscreen?8:titlebarBounds?Math.round(titlebarBounds.top+titlebarBounds.height/2):22
  return {width,anchor:{x,y,width:1,height:1}}
}

// Only Ctrl+F uses this placement. Ctrl+K retains searchPanelLayout unchanged.
export function currentFindPanelLayout(fullscreen=false){
  const titlebar=[...document.querySelectorAll<HTMLElement>('.window-titlebar,.detached-window-bar')].find(element=>element.checkVisibility())
  const bounds=titlebar?.getBoundingClientRect()
  let controlsLeft=innerWidth
  if(!fullscreen&&window.navora?.app.platform==='win32'){
    const overlay=(navigator as Navigator&{windowControlsOverlay?:{getTitlebarAreaRect:()=>DOMRect}}).windowControlsOverlay
    const area=overlay?.getTitlebarAreaRect()
    controlsLeft=area&&area.width>0?area.x+area.width:innerWidth-138
  }
  return currentFindGeometry({windowWidth:innerWidth,controlsLeft,top:fullscreen?8:bounds?Math.round(bounds.top+bounds.height/2):22})
}
