<template><span hidden aria-hidden="true" /></template>
<script setup lang="ts">
import {onBeforeUnmount} from 'vue'
import {useNativePanel} from '@/composables/useNativeUi'
import {WORKSPACE_TAB_INFO_REQUEST,WORKSPACE_TAB_INFO_LEAVE,type WorkspaceTabInfoRequest,type WorkspaceTabInfoLeave} from '@/composables/workspaceTabInfo'
import {BROWSER_CHROME_OPEN} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN,type NativePanelContent} from '@shared/native-ui'

// One owner-window instance survives tab changes. This hint has no page actions or focus.
let current:WorkspaceTabInfoRequest|undefined,epoch=0,disposed=false,showing=false,observer:MutationObserver|undefined
let showTimer:ReturnType<typeof setTimeout>|undefined,leaveTimer:ReturnType<typeof setTimeout>|undefined
const panel=useNativePanel({key:'workspace-tab-info',role:'passive',contextKey:()=> 'workspace-tab-info',onAction:()=>{},onDismissed:closed,onClosed:closed})
function overlaysOpen(){return !!document.querySelector('.sidebar-ctx-panel:not([data-browser-tab-preview]),.v-overlay--active,.browser-address-suggestions,.browser-page-menu,.browser-downloads-menu,[aria-haspopup][aria-expanded="true"],.browser-address-bar.has-suggestions')||document.documentElement.classList.contains('tab-dragging')}
function valid(request:WorkspaceTabInfoRequest){return !disposed&&request.anchor.isConnected&&request.anchor.checkVisibility()&&!overlaysOpen()}
function stopTimers(){clearTimeout(showTimer);clearTimeout(leaveTimer);showTimer=undefined;leaveTimer=undefined}
function closed(){epoch++;current=undefined;stopTimers();observer?.disconnect();observer=undefined}
function hide(){closed();void panel.hide().catch(()=>{})}
function observe(){if(observer)return;observer=new MutationObserver(()=>{if(current&&!valid(current))hide()});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']})}
async function present(){
  const request=current,ticket=epoch
  if(!request||!valid(request)){hide();return}
  if(showing||panel.pending.value)return
  const bounds=request.anchor.getBoundingClientRect(),width=Math.max(160,Math.min(320,innerWidth-24))
  const anchor={x:Math.max(8,Math.min(bounds.left,innerWidth-width-8)),y:Math.max(8,bounds.bottom+6),width:1,height:1}
  const children:NativePanelContent[]=[{id:'tab-title',type:'text',text:request.title.slice(0,480),fontSize:13,height:40,maxLines:2,style:{fontWeight:'bold',lineHeight:20}}]
  if(request.detail)children.push({id:'tab-detail',type:'text',text:request.detail.slice(0,320),muted:true,fontSize:12,height:20,singleLine:true})
  if(request.status)children.push({id:'tab-status',type:'text',text:request.status.slice(0,240),muted:true,fontSize:12,height:20,singleLine:true})
  const content:NativePanelContent={id:'tab-hover-content',type:'column',width,gap:4,children}
  observe();showing=true
  try{
    const shown=panel.open.value?await panel.update(content,anchor):await panel.show(content,anchor,{placement:'bottom-start',focusMode:'none',role:'passive',radius:12,contentInset:12})
    if(disposed)return
    if(!current){void panel.hide().catch(()=>{});return}
    if(ticket!==epoch||current!==request){showing=false;await present();return}
    if(!shown||!valid(request))hide()
  }catch{if(ticket===epoch)hide()}
  finally{showing=false}
}
function requested(event:Event){
  const request=(event as CustomEvent<WorkspaceTabInfoRequest>).detail
  if(!request||!valid(request))return
  clearTimeout(leaveTimer);leaveTimer=undefined;clearTimeout(showTimer)
  current=request;epoch++
  // Once visible, adjacent tabs update the existing native surface immediately.
  if(panel.open.value||panel.pending.value||showing)void present()
  else showTimer=setTimeout(()=>{showTimer=undefined;void present()},Math.max(0,request.delay))
}
function left(event:Event){
  const leave=(event as CustomEvent<WorkspaceTabInfoLeave>).detail
  if(!leave||leave.owner!==current?.owner)return
  if(leave.immediate){hide();return}
  clearTimeout(leaveTimer);leaveTimer=setTimeout(hide,60)
}
function nativeOpened(event:Event){const detail=(event as CustomEvent<{id?:string;role?:string}>).detail;if(detail?.id!==panel.id&&detail?.role!=='passive')hide()}
window.addEventListener(WORKSPACE_TAB_INFO_REQUEST,requested)
window.addEventListener(WORKSPACE_TAB_INFO_LEAVE,left)
window.addEventListener('navora:tab-hover-dismiss',hide)
window.addEventListener(BROWSER_CHROME_OPEN,hide)
window.addEventListener(NATIVE_UI_OPEN,nativeOpened)
window.addEventListener('blur',hide);window.addEventListener('resize',hide)
for(const type of ['scroll','wheel','pointerdown','keydown','dragstart'])document.addEventListener(type,hide,true)
onBeforeUnmount(()=>{disposed=true;hide();window.removeEventListener(WORKSPACE_TAB_INFO_REQUEST,requested);window.removeEventListener(WORKSPACE_TAB_INFO_LEAVE,left);window.removeEventListener('navora:tab-hover-dismiss',hide);window.removeEventListener(BROWSER_CHROME_OPEN,hide);window.removeEventListener(NATIVE_UI_OPEN,nativeOpened);window.removeEventListener('blur',hide);window.removeEventListener('resize',hide);for(const type of ['scroll','wheel','pointerdown','keydown','dragstart'])document.removeEventListener(type,hide,true)})
</script>
