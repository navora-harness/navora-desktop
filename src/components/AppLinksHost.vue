<template></template>
<script setup lang="ts">
import {onBeforeUnmount,onMounted} from 'vue'
import {useAppLinks} from '@/composables/useAppLinks'
import {appLinkError} from '@shared/app-links'
let offError:(()=>void)|undefined
function notify(message:string){window.dispatchEvent(new CustomEvent('navora:ui-notice',{detail:{message}}))}
const links=useAppLinks(notify)
function target(event:MouseEvent|KeyboardEvent) {
  if(!(event.target instanceof Element)||event.target.closest('input,textarea'))return
  if(event.target.closest('[data-composer-editor],[contenteditable=true]')&&!(event.type==='click'&&(event.ctrlKey||event.metaKey)))return
  const anchor=event.target.closest('a[href]')
  if(!anchor)return
  const href=anchor.getAttribute('href')||''
  if(!/^https?:\/\//i.test(href))return
  return {url:href,chatId:anchor.closest<HTMLElement>('[data-chat-id]')?.dataset.chatId}
}
function click(event:MouseEvent) {
  if(event.button!==0&&event.button!==1)return
  const link=target(event);if(!link)return
  event.preventDefault();event.stopImmediatePropagation()
  void links.openLink(link.url,link.chatId,event.shiftKey?'window':undefined)
}
function context(event:MouseEvent) {
  if(window.navora?.app.platform==='web')return
  const link=target(event);if(!link)return
  event.stopImmediatePropagation();void links.showLinkMenu(link.url,event,link.chatId)
}
function contextKey(event:KeyboardEvent){
  if(event.defaultPrevented||event.isComposing||event.repeat||window.navora?.app.platform==='web'||!(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey))return
  const link=target(event);if(!link)return
  event.preventDefault();event.stopImmediatePropagation();void links.showLinkMenu(link.url,event,link.chatId)
}
onMounted(()=>{offError=window.navora?.app.onLinkError?.(error=>notify(appLinkError(error)));document.addEventListener('click',click,true);document.addEventListener('auxclick',click,true);document.addEventListener('contextmenu',context,true);document.addEventListener('keydown',contextKey,true)})
onBeforeUnmount(()=>{offError?.();document.removeEventListener('click',click,true);document.removeEventListener('auxclick',click,true);document.removeEventListener('contextmenu',context,true);document.removeEventListener('keydown',contextKey,true)})
</script>
