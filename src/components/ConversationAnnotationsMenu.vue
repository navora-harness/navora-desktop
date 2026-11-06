<template>
  <button ref="trigger" type="button" class="chat-resource-button conversation-annotations-trigger" :class="{selected:opened}" data-chat-resource="annotations" title="当前对话批注" aria-label="当前对话批注" aria-haspopup="dialog" :aria-expanded="opened" :aria-controls="panelId" :disabled="!chatId" @click="toggle"><AppIcon icon="annotate"/><span v-if="entries.length" class="conversation-annotations-count">{{entries.length>99?'99+':entries.length}}</span></button>
  <Teleport to="body">
    <section v-if="opened" ref="panel" :id="panelId" class="conversation-annotations-panel" data-browser-chrome-overlay role="dialog" aria-label="当前对话批注列表" :style="position" @keydown="key">
      <header><h2>批注 <span>{{entries.length}}</span></h2><button type="button" class="ui-icon-button" aria-label="刷新批注" @click="emit('refresh')"><AppIcon icon="arrow-rotate-right"/></button><button type="button" class="ui-icon-button" aria-label="关闭批注列表" @click="close()"><AppIcon icon="xmark"/></button></header>
      <label class="conversation-annotations-search"><AppIcon icon="magnifying-glass"/><input ref="search" v-model="query" type="search" placeholder="搜索批注、网页或网址" aria-label="搜索当前对话批注" maxlength="512"/></label>
      <p v-if="error" role="alert">{{error}} <button type="button" class="ui-button" @click="emit('refresh')">重试</button></p>
      <template v-if="model.selected"><div class="conversation-annotations-detail-head"><button type="button" class="ui-button" @click="selectedKey=''">返回批注列表</button></div><BrowserAnnotationChatCard :entry="model.selected" :busy="!!busyKey" @action="(action,copyId)=>dispatch(model.selected!,action,copyId)"/></template>
      <template v-else>
        <label class="conversation-annotations-filter">状态<select v-model="state" aria-label="筛选批注状态"><option v-for="item in annotationStates" :key="item.id" :value="item.id">{{item.label}}</option></select><span>{{model.matches.length}} 条</span></label>
        <div class="conversation-annotations-list" aria-label="批注列表">
          <button v-for="entry in model.visible" :key="entry.key" :data-annotation-key="entry.key" type="button" class="conversation-annotation-row" :disabled="!!busyKey" @click="selectedKey=entry.key"><AppIcon icon="annotate"/><span><strong>{{annotationEntryComment(entry)}}</strong><small>{{annotationEntrySelection(entry)?.title||annotationEntrySelection(entry)?.url||'网页'}}</small><small>{{annotationEntryLabel(entry)}} · {{new Date(entry.createdAt).toLocaleString()}}</small></span><AppIcon icon="chevron-right"/></button>
          <p v-if="!model.matches.length" role="status">{{entries.length?'没有匹配的批注，请调整搜索或状态。':'还没有批注。从网页工具栏开启批注后会显示在这里。'}}</p>
        </div>
        <footer v-if="model.pages>1"><button type="button" class="ui-button" :disabled="model.page===0" @click="page=model.page-1">上一页</button><span>{{model.page+1}} / {{model.pages}}</span><button type="button" class="ui-button" :disabled="model.page===model.pages-1" @click="page=model.page+1">下一页</button></footer>
      </template>
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {AnnotationChatAction,AnnotationChatEntry} from '@shared/browser-annotation-chat'
import {annotationStates,annotationEntryComment,annotationEntryLabel,annotationEntrySelection,conversationAnnotationsView,type AnnotationState} from '@shared/conversation-annotations'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import {composerOverlayBoundary,composerOverlayBounds} from '@/utils/composer-overlay'
import AppIcon from './icons/AppIcon.vue'
import BrowserAnnotationChatCard from './BrowserAnnotationChatCard.vue'
const props=withDefaults(defineProps<{chatId:string;entries:AnnotationChatEntry[];busyKey?:string;error?:string}>(),{busyKey:'',error:''})
const emit=defineEmits<{action:[entry:AnnotationChatEntry,action:AnnotationChatAction,copyId?:string];refresh:[]}>()
const trigger=ref<HTMLElement>(),panel=ref<HTMLElement>(),search=ref<HTMLInputElement>(),opened=ref(false),query=ref(''),state=ref<AnnotationState>('all'),selectedKey=ref(''),page=ref(0),position=ref({left:'8px',top:'48px',width:'400px',maxHeight:'500px'})
const panelId=`conversation-annotations-${crypto.randomUUID()}`
let generation=0,observer:ResizeObserver|undefined,frame=0
const model=computed(()=>conversationAnnotationsView({entries:props.entries,query:query.value,state:state.value,selectedKey:selectedKey.value,page:page.value}))
function close(focus=true){generation++;opened.value=false;observer?.disconnect();cancelAnimationFrame(frame);if(focus)trigger.value?.focus({preventScroll:true})}
async function toggle(){
  if(opened.value){close();return}
  if(!props.chatId||!trigger.value)return
  const ticket=++generation,owner=props.chatId
  query.value='';state.value='all';selectedKey.value='';page.value=0;emit('refresh')
  requestBrowserChromeOpen(panelId);opened.value=true;await nextTick()
  if(ticket!==generation||owner!==props.chatId||!opened.value)return
  resize();if(!opened.value)return
  search.value?.focus({preventScroll:true})
  observer ||= new ResizeObserver(schedule)
  const composer=conversationComposer()
  for(const element of [trigger.value,panel.value,composer&&composerOverlayBoundary(composer),composer?.closest<HTMLElement>('.main')])if(element)observer.observe(element)
}
function dispatch(entry:AnnotationChatEntry,action:AnnotationChatAction,copyId?:string){
  if(props.busyKey||!props.entries.some(current=>current.key===entry.key))return
  close();emit('action',entry,action,copyId)
}
function conversationComposer(){
  const root=trigger.value?.closest<HTMLElement>('.main')||document.querySelector<HTMLElement>('.main')
  return [...(root||document).querySelectorAll<HTMLElement>('.composer')].find(element=>element.checkVisibility()&&!element.closest('.subchat-detail'))
}
function resize(){
  const target=trigger.value,card=panel.value
  if(!opened.value||!target||!card)return
  if(!target.isConnected||!target.checkVisibility()){close(false);return}
  const composer=conversationComposer(),main=target.closest<HTMLElement>('.main')
  // A hidden conversation must not place its HTML panel on an active browser View.
  if(main&&!composer){close(false);return}
  const bounds=composer?composerOverlayBounds(composer):{left:8,right:innerWidth-8,top:8,bottom:innerHeight-8,width:innerWidth-16,height:innerHeight-16}
  if(bounds.width<160||bounds.height<100){close(false);return}
  const anchor=target.getBoundingClientRect(),width=Math.min(420,bounds.width),height=Math.min(620,bounds.height)
  card.style.width=`${width}px`;card.style.maxHeight=`${height}px`
  const rect=card.getBoundingClientRect()
  position.value={left:`${Math.max(bounds.left,Math.min(anchor.right-rect.width,bounds.right-rect.width))}px`,top:`${Math.max(bounds.top,Math.min(anchor.bottom+6,bounds.bottom-rect.height))}px`,width:`${width}px`,maxHeight:`${height}px`}
}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(resize)}
function key(event:KeyboardEvent){
  if(event.isComposing)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
  if(event.key==='Tab'&&panel.value){const controls=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,summary')].filter(control=>control.checkVisibility()),index=controls.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index<=0){event.preventDefault();controls.at(-1)?.focus()}else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0]?.focus()}}
}
function outside(event:PointerEvent){if(opened.value&&event.target instanceof Node&&!panel.value?.contains(event.target)&&!trigger.value?.contains(event.target))close(false)}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==panelId)close(false)}
function otherNative(){close(false)}
watch([query,state],()=>{page.value=0;selectedKey.value=''})
watch(model,()=>{void nextTick(schedule)},{deep:true})
watch(()=>props.chatId,()=>{close(false);query.value='';state.value='all';selectedKey.value='';page.value=0})
onMounted(()=>{window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);document.addEventListener('pointerdown',outside,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,otherNative)})
onBeforeUnmount(()=>{close(false);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('pointerdown',outside,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,otherNative)})
</script>
<style scoped>
.conversation-annotations-trigger{position:relative;gap:3px;width:auto;min-width:30px;padding:0 5px}.conversation-annotations-count{font-size:10px;line-height:1;color:var(--navora-muted)}
.conversation-annotations-panel{position:fixed;z-index:12001;box-sizing:border-box;overflow:auto;padding:12px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 8px 28px #0002;font-size:13px;line-height:1.5}
header{display:flex;align-items:center;gap:6px;margin-bottom:10px}h2{flex:1;margin:0;font-size:14px;font-weight:600}h2 span{margin-left:4px;color:var(--navora-muted);font-size:12px;font-weight:400}.ui-icon-button{width:28px;height:28px}svg{width:16px;height:16px;flex-shrink:0}
.conversation-annotations-search{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--navora-stroke);border-radius:7px;color:var(--navora-muted)}input{width:100%;min-width:0;outline:none;color:var(--navora-ink);font:inherit}.conversation-annotations-search:focus-within{outline:2px solid var(--navora-accent);outline-offset:1px}
.conversation-annotations-filter{display:flex;align-items:center;gap:8px;margin:10px 0;color:var(--navora-muted);font-size:12px}.conversation-annotations-filter select{color:var(--navora-ink);font:inherit;padding:3px}.conversation-annotations-filter>span{margin-left:auto}
.conversation-annotations-detail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
.conversation-annotations-list{display:flex;flex-direction:column;gap:3px}.conversation-annotation-row{display:flex;align-items:flex-start;gap:9px;width:100%;min-width:0;padding:10px 6px;border-radius:7px;text-align:left;color:inherit}.conversation-annotation-row>span{flex:1;min-width:0}.conversation-annotation-row strong,.conversation-annotation-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conversation-annotation-row strong{font-size:13px;font-weight:500}.conversation-annotation-row small{font-size:11px;color:var(--navora-muted);margin-top:3px}.conversation-annotation-row>svg{color:var(--navora-muted);margin-top:2px}.conversation-annotation-row:hover{background:color-mix(in srgb,var(--navora-accent) 9%,var(--navora-surface))}button:focus-visible,select:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px}.conversation-annotations-panel p{padding:10px 0;color:var(--navora-muted);overflow-wrap:anywhere}footer{display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-size:12px}
</style>
