import {computed,shallowRef} from 'vue'

export type BrowserConfirmationKind='delete-chat'|'delete-file'|'quit'|'close-session'|'clear-session-data'|'delete-session'
type Rect={left:number;top:number;right:number;bottom:number;width:number;height:number}
const viewports=shallowRef<Record<string,Rect>>({})
const committed=shallowRef<Record<string,{x:number;width:number}>>({})
const confirmations=shallowRef<Record<string,{kind:BrowserConfirmationKind;contextKey:string}>>({})
const docks=shallowRef<Record<string,number>>({})
export const browserViewports=computed(()=>Object.values(viewports.value))
export const browserConfirmationActive=computed(()=>Object.keys(confirmations.value).length>0)
export const browserDockRight=computed(()=>Math.max(0,...Object.values(docks.value)))
export const browserDockFits=computed(()=>Object.values(viewports.value).every(rect=>browserDockRight.value<=rect.left||browserDockRight.value<=rect.right-120))
export const browserDockReady=computed(()=>browserDockFits.value&&Object.keys(viewports.value).every(key=>!!committed.value[key]&&committed.value[key]!.x>=browserDockRight.value-1))
export function reportBrowserViewport(key:string,rect:Rect|null){
  const previous=viewports.value[key]
  if(rect&&previous&&['left','top','right','bottom','width','height'].every(name=>rect[name as keyof Rect]===previous[name as keyof Rect]))return
  if(!rect&&!previous)return
  const next={...viewports.value};if(rect)next[key]={left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};else delete next[key];viewports.value=next
  if(!rect){const layouts={...committed.value};delete layouts[key];committed.value=layouts}
}
export function reportBrowserLayout(key:string,bounds:{x:number;width:number}|null){
  if(!bounds){if(!(key in committed.value))return;const next={...committed.value};delete next[key];committed.value=next;return}
  if(committed.value[key]?.x===bounds.x&&committed.value[key]?.width===bounds.width)return
  committed.value={...committed.value,[key]:{x:bounds.x,width:bounds.width}}
}
export function registerBrowserConfirmation(key:string,value:{kind:BrowserConfirmationKind;contextKey:string}|null){
  const next={...confirmations.value};if(value)next[key]=value;else delete next[key];confirmations.value=next
}
export function reserveBrowserDock(key:string,right:number|null){
  if(right!==null&&!Number.isFinite(right))right=null
  if(right!==null&&docks.value[key]===right||right===null&&!(key in docks.value))return
  const next={...docks.value};if(right===null)delete next[key];else next[key]=right;docks.value=next
}
