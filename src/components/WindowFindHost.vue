<template>
  <Teleport to="body"><section ref="fallbackPanel" v-if="find.opened.value&&fallback&&find.active.value" class="window-find-fallback" role="search" aria-label="查找当前内容" :style="{width:`${width}px`,left:`${anchor.x}px`,top:`${anchor.y}px`}" @keydown="onFallbackKey">
    <div class="window-find-line"><AppIcon icon="magnifying-glass"/><input ref="input" v-model="find.query.value" aria-label="查找当前内容" :placeholder="find.active.value.target.scope==='chat'?'搜索当前聊天…':'搜索当前工作区…'" maxlength="1024"/>
      <button v-for="target in scopes" :key="target.scope" class="ui-icon-button" :aria-pressed="target.scope===find.active.value.target.scope" :aria-label="target.scope==='chat'?'当前聊天':'当前工作区'" :title="target.scope==='chat'?'当前聊天':target.label" @click="find.setScope(target.scope)"><AppIcon :icon="target.scope==='chat'?'comments':target.kind==='browser'?'globe':'file-lines'"/></button>
      <span v-if="scopes.length" class="window-find-close-divider" aria-hidden="true"/><button class="ui-icon-button" title="关闭查找" aria-label="关闭查找" @click="find.close()"><AppIcon icon="xmark"/></button></div>
    <div v-if="find.query.value.trim()" class="window-find-line window-find-footer"><button class="ui-icon-button" :disabled="find.state.value.status!=='ready'||!find.state.value.total" title="上一个" @click="find.step(-1)"><AppIcon icon="arrow-up"/></button><button class="ui-icon-button" :disabled="find.state.value.status!=='ready'||!find.state.value.total" title="下一个" @click="find.step(1)"><AppIcon icon="arrow-down"/></button><span>{{ find.state.value.notice||(find.state.value.status==='searching'?'查找中…':`${find.state.value.total?find.state.value.ordinal+' / ':''}${find.state.value.total} 个结果`) }}</span><button v-if="find.active.value.target.supportsCaseSensitive||find.active.value.target.supportsTools" class="ui-icon-button" title="查找选项" @click="showOptions=!showOptions"><AppIcon icon="sliders"/></button></div>
    <div v-if="showOptions&&find.query.value.trim()" class="window-find-line window-find-settings"><label v-if="find.active.value.target.supportsCaseSensitive"><input v-model="find.options.value.caseSensitive" type="checkbox"/>区分大小写</label><label v-if="find.active.value.target.supportsTools"><input v-model="find.options.value.includeTools" type="checkbox"/>包含工具与日志</label></div>
  </section></Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {useWindowFind} from '@/composables/useWindowFind'
import {useNativePanel} from '@/composables/useNativeUi'
import {windowFindPanel,windowFindScopeButtons,WINDOW_FIND_SURFACE} from '@shared/window-find-panel'
import type {NativePanelAction} from '@shared/native-ui'
import {currentFindPanelLayout} from '@/utils/search-panel-layout'
import {browserPopupNotice,useSafeBrowserPopup} from '@/utils/browser-popup-placement'
const find=useWindowFind(),width=ref(360),fallback=ref(false),input=ref<HTMLInputElement>(),showOptions=ref(false),fullscreen=ref(false)
const anchor=ref(currentFindPanelLayout().anchor)
const scopes=computed(()=>windowFindScopeButtons(find.targets.value.map(item=>item.target)))
// A window-level owner keeps the card stable while the underlying tab changes.
// Each adapter separately validates its current page/document before acting.
const panel=useNativePanel({key:'window-find',role:'search',contextKey:()=> 'window-find',onAction:action,onDismissed:()=>find.close(),onClosed:()=>{}})
const content=computed(()=>find.active.value?windowFindPanel({width:width.value,query:find.query.value,target:find.active.value.target,targets:find.targets.value.map(item=>item.target),state:find.state.value,options:find.options.value,showOptions:showOptions.value}):null)
const fallbackPanel=ref<HTMLElement>()
useSafeBrowserPopup(()=>fallback.value&&find.opened.value?fallbackPanel.value:null,()=>find.close())
let nativeFailed=false,disposed=false,running=false,revision=0,focused=-1,offFullscreen:(()=>void)|undefined
async function showFallback(){fallback.value=true;await panel.hide().catch(()=>{});await nextTick();input.value?.focus();input.value?.select()}
function onFallbackKey(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();find.close()}else if(event.key==='Enter'&&event.target===input.value){event.preventDefault();event.stopPropagation();void find.step(event.shiftKey?-1:1)}}
function resize(){
  if(disposed||document.visibilityState==='hidden'||innerWidth<=0||innerHeight<=0)return
  const layout=currentFindPanelLayout(fullscreen.value),current=anchor.value,next=layout.anchor
  // Focus and visibility both fire on restore. Keep the existing native tree
  // when its local geometry is unchanged instead of repainting it after show.
  if(width.value===layout.width&&current.x===next.x&&current.y===next.y&&current.width===next.width&&current.height===next.height)return
  width.value=layout.width;anchor.value=next;queue()
}
function visibilityChanged(){if(document.visibilityState==='visible')requestAnimationFrame(resize)}
function action(event:NativePanelAction){
  if(!find.opened.value)return
  if(event.id==='find-query'&&typeof event.value==='string'){find.query.value=event.value;if(event.type==='submit')void find.step(1)}
  else if(event.id==='find-close')find.close()
  else if(event.id==='find-scope-chat')find.setScope('chat')
  else if(event.id==='find-scope-workspace')find.setScope('workspace')
  else if(event.id==='find-next')void find.step(1)
  else if(event.id==='find-previous')void find.step(-1)
  else if(event.id==='find-options')showOptions.value=!showOptions.value
  else if(event.id==='find-case'&&typeof event.value==='boolean')find.options.value={...find.options.value,caseSensitive:event.value}
  else if(event.id==='find-tools'&&typeof event.value==='boolean')find.options.value={...find.options.value,includeTools:event.value}
}
function queue(){revision++;void present()}
async function present(){
  if(running||disposed)return;running=true
  try{let seen=-1;while(!disposed&&seen!==revision){seen=revision
    if(!find.opened.value||!content.value){focused=-1;nativeFailed=false;fallback.value=false;await panel.hide();continue}
    await panel.ready();if(disposed||!find.opened.value)continue
    const focus=find.focusRequest.value
    if(!panel.supported.value||nativeFailed){if(!fallback.value||focused!==focus){focused=focus;await showFallback()}continue}
    fallback.value=false
    if(focused!==focus||!panel.open.value){
      const tree=windowFindPanel({width:width.value,query:find.query.value,target:find.active.value!.target,targets:find.targets.value.map(item=>item.target),state:find.state.value,options:find.options.value,showOptions:showOptions.value,includeValue:true})
      focused=focus
      const shown=await panel.showFocused(tree,anchor.value,{role:'search',placement:'bottom-start',focusMode:'input',dismissOnOutsideClick:false,dismissOnEscape:true,iconButtonSize:20,...WINDOW_FIND_SURFACE})
      if(!shown&&find.opened.value){nativeFailed=true;await showFallback()}
    }else await panel.update(content.value,anchor.value,true)
  }}catch(error){console.warn('[window-find] Could not present search',error);if(find.opened.value){nativeFailed=true;await showFallback();browserPopupNotice('查找面板暂时无法使用原生界面，已切换为兼容界面。')}}
  finally{running=false}
}
watch([find.opened,find.focusRequest,content],queue,{flush:'post'})
onMounted(()=>{resize();window.addEventListener('resize',resize);window.addEventListener('focus',resize);document.addEventListener('visibilitychange',visibilityChanged);let received=false;offFullscreen=window.navora?.app.onFullscreen?.(value=>{received=true;fullscreen.value=value;requestAnimationFrame(resize)});void window.navora?.app.isFullscreen?.().then(value=>{if(!received){fullscreen.value=value.fullscreen;resize()}}).catch(()=>{})})
onBeforeUnmount(()=>{disposed=true;offFullscreen?.();window.removeEventListener('resize',resize);window.removeEventListener('focus',resize);document.removeEventListener('visibilitychange',visibilityChanged)})
</script>
<style scoped>
.window-find-fallback{position:fixed;z-index:10020;border:1px solid var(--navora-stroke);background:var(--navora-surface);color:var(--navora-text);border-radius:16px;padding:8px 12px;box-shadow:0 8px 24px #18202b18}.window-find-line{display:flex;align-items:center;gap:4px}.window-find-line>svg{width:16px;height:16px;flex-shrink:0}.window-find-line input{flex:1;min-width:0;padding:5px 4px;outline:none;background:transparent}.window-find-line .ui-icon-button{width:26px;height:26px;flex-shrink:0}.window-find-line .is-active{background:var(--control-selected);border-radius:7px}.window-find-footer{border-top:1px solid var(--navora-stroke);margin-top:6px;padding-top:5px}.window-find-footer span{margin-left:auto;color:var(--navora-muted);font-size:12px}
</style>
<style scoped>
.window-find-settings{flex-direction:column;align-items:stretch;gap:4px}.window-find-settings label{display:flex;align-items:center;gap:8px;min-height:24px}.window-find-settings input[type=checkbox]{flex:none;width:14px;height:14px;padding:0}
</style>
<style scoped>
.window-find-fallback{box-sizing:border-box;border-radius:20px;padding:8px 16px;box-shadow:none;color:var(--navora-ink)}.window-find-line{min-height:28px}.window-find-line+.window-find-line{margin-top:6px}.window-find-line input{box-sizing:border-box;height:28px;padding:0 4px;font-size:13px}.window-find-line .ui-icon-button{width:26px;height:26px;border-radius:7px}.window-find-line .ui-icon-button[aria-pressed=true]{color:var(--navora-ink);background:transparent}.window-find-close-divider{height:16px;width:1px;flex:none;background:var(--navora-stroke);margin:0 3px}.window-find-footer{border-top:0;margin-top:6px;padding-top:0}
</style>
