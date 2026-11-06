<template>
  <section v-if="opened&&active&&!nativeSearch" ref="panel" :data-find-owner="uid" class="conversation-find" role="search" aria-label="在当前聊天中查找" @keydown="onKey">
    <div class="conversation-find-input"><AppIcon icon="magnifying-glass"/><input ref="input" v-model="query" type="search" aria-label="在当前聊天中查找" placeholder="查找当前聊天内容…" maxlength="1024" autocomplete="off" @compositionstart="composing=true" @compositionend="finishComposition"/></div>
    <span class="conversation-find-count" role="status" aria-live="polite">{{ !query.trim()?'':pending?'查找中…':matches.length?`${activeIndex+1} / ${matches.length}${truncated?'+':''}`:'未找到' }}</span>
    <button type="button" class="ui-icon-button" title="上一个（Shift Enter）" aria-label="上一个匹配项" :disabled="!matches.length||pending" @click="step(-1)"><AppIcon icon="chevron-up"/></button>
    <button type="button" class="ui-icon-button" title="下一个（Enter）" aria-label="下一个匹配项" :disabled="!matches.length||pending" @click="step(1)"><AppIcon icon="chevron-down"/></button>
    <ActionMenu ref="optionsMenu" class="conversation-find-options" label="查找选项" icon="sliders" :context-key="`${chatId}:${opened}:${active}`" :disabled="!active" :items="optionItems" @select="changeOption" @open="optionsOpen=$event" />
    <button type="button" class="ui-icon-button" title="关闭查找（Esc）" aria-label="关闭当前聊天查找" @click="close()"><AppIcon icon="xmark"/></button>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import ActionMenu from './ActionMenu.vue'
import {renderMarkdown} from '@/utils/markdown'
import {findConversationText,type ConversationMatch} from '@shared/conversation-find'
import {isQuietResourceLog} from '@shared/message-presentation'
import type {ChatMessage} from '@shared/types'
import type {ConversationFindViewState} from '@shared/conversation-session'
import {registerWindowFindTarget,useWindowFind,openWindowFind} from '@/composables/useWindowFind'
import type {WindowFindScope} from '@shared/window-find'
const props=withDefaults(defineProps<{chatId:string;messages:ChatMessage[];liveText?:string;root:HTMLElement|null;displayText:(message:ChatMessage)=>string;locate:(id:string,match?:ConversationMatch)=>Promise<void>;active?:boolean;nativeSearch?:boolean;findScope?:WindowFindScope;targetTitle?:string;targetKey?:string}>(),{active:true,nativeSearch:true,findScope:'chat'})
const emit=defineEmits<{open:[value:boolean];navigate:[]}>()
const opened=ref(false),query=ref(''),caseSensitive=ref(false),includeTools=ref(false),input=ref<HTMLInputElement|null>(null),panel=ref<HTMLElement|null>(null),matches=ref<ConversationMatch[]>([]),activeIndex=ref(0),pending=ref(false),truncated=ref(false)
const optionsMenu=ref<InstanceType<typeof ActionMenu>>()
const optionsOpen=ref(false)
const windowFind=useWindowFind(),searchable=computed(()=>props.active||props.nativeSearch&&props.findScope==='chat')
const targetKey=computed(()=>`${props.findScope}:${props.targetKey||props.chatId}`)
const unregister=registerWindowFindTarget({
  target:()=>props.nativeSearch&&props.chatId&&searchable.value?{key:targetKey.value,scope:props.findScope,kind:props.findScope==='chat'?'chat':'subchat',label:props.targetTitle||'当前聊天',supportsCaseSensitive:true,supportsTools:true}:null,
  state:()=>({status:pending.value?'searching':query.value.trim()?'ready':'idle',total:matches.value.length,ordinal:matches.value.length?activeIndex.value+1:0,truncated:truncated.value,...(truncated.value?{notice:'结果过多，请缩小查找范围'}:{})}),
  setQuery:(value,options)=>{if(!opened.value){opened.value=true;emit('open',true)}query.value=value;caseSensitive.value=options.caseSensitive;includeTools.value=options.includeTools;schedule(props.active)},
  step:direction=>step(direction),stop:()=>close(false)
})
const optionItems=computed(()=>[{id:'case',label:'区分大小写',checked:caseSensitive.value},{id:'tools',label:'包含工具与日志',checked:includeTools.value}])
function changeOption(id:string){if(!props.active||!opened.value)return;if(id==='case')caseSensitive.value=!caseSensitive.value;else if(id==='tools')includeTools.value=!includeTools.value}
let composing=false,compositionTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined,token=0,returnFocus:HTMLElement|null=null
const cache=new Map<string,{source:string;text:string}>()
type HighlightCtor=new(...ranges:Range[])=>unknown
const highlightHost=globalThis as unknown as {Highlight?:HighlightCtor;CSS?:{highlights?:Map<string,unknown>}}
const uid=useId().replace(/[^a-zA-Z0-9_-]/g,'-')
let highlightNames=namesFor(props.chatId),highlightStyle:HTMLStyleElement|undefined,restoredIndex:number|undefined
function namesFor(chatId:string){let hash=2166136261;for(const char of chatId)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;const base=`navora-chat-find-${uid}-${hash.toString(36)}`;return [base,`${base}-active`] as const}
function styleHighlights(){if(!highlightStyle){highlightStyle=document.createElement('style');highlightStyle.dataset.conversationFind=uid;document.head.append(highlightStyle)}highlightStyle.textContent=`::highlight(${highlightNames[0]}){background:#f8e6a3;color:#332a10}::highlight(${highlightNames[1]}){background:#dca34d;color:#201606}`}
function clearHighlights(){for(const name of highlightNames)highlightHost.CSS?.highlights?.delete(name)}
function textFor(message:ChatMessage){
  // Tool result offsets map to the visible result pre, never to a fabricated
  // clipboard heading or the separate tool-argument pre.
  const source=message.role==='tool'?message.content:props.displayText(message),key=message.id,known=cache.get(key)
  if(known?.source===source)return known.text
  let text=source
  if(message.role==='user'||message.role==='assistant'){const container=document.createElement('div');container.innerHTML=renderMarkdown(source);text=container.textContent||''}
  cache.set(key,{source,text});return text
}
function rangeFor(root:HTMLElement,from:number,to:number){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let node:Node|null,offset=0,started=false
  while((node=walker.nextNode())){const size=node.textContent?.length||0;if(!started&&from<offset+size){range.setStart(node,from-offset);started=true}if(started&&to<=offset+size){range.setEnd(node,to-offset);return range}offset+=size}
  return null
}
function highlight(){
  clearHighlights();if(!props.active||!opened.value||!props.root||!highlightHost.Highlight||!highlightHost.CSS?.highlights)return
  const ranges:Range[]=[],activeRanges:Range[]=[],grouped=new Map<string,ConversationMatch[]>()
  for(const match of matches.value){const list=grouped.get(match.messageId)||[];list.push(match);grouped.set(match.messageId,list)}
  for(const [id,list] of grouped){
    const host=id==='__live__'?props.root.querySelector<HTMLElement>('[data-live-answer]'):props.root.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`)
    const body=host?.querySelector<HTMLElement>('.msg-md-content')||host?.querySelector<HTMLElement>('.tool-detail .tool-section:last-child pre,.transcript-activity-detail .tool-section:last-of-type pre,.log-card-text,.run-item-text,.log-content,.msg-body')
    if(!body)continue
    const start=Number(body.dataset.findOffset)||0,end=start+(body.textContent?.length||0)
    for(const match of list){if(match.from<start||match.to>end)continue;const range=rangeFor(body,match.from-start,match.to-start);if(range){ranges.push(range);if(match===matches.value[activeIndex.value])activeRanges.push(range)}}
  }
  highlightHost.CSS.highlights.set(highlightNames[0],new highlightHost.Highlight(...ranges));highlightHost.CSS.highlights.set(highlightNames[1],new highlightHost.Highlight(...activeRanges))
  return activeRanges[0]
}
async function locateActive(){
  const match=matches.value[activeIndex.value],chatId=props.chatId,requestedQuery=query.value,requestedCase=caseSensitive.value,requestedTools=includeTools.value;if(!searchable.value||!match)return
  emit('navigate')
  // Revealing a hidden conversation legitimately refreshes its visibility
  // generation. Keep the requested match, but reject a new query/selection.
  await nextTick();if(chatId!==props.chatId||!opened.value||query.value!==requestedQuery||caseSensitive.value!==requestedCase||includeTools.value!==requestedTools||matches.value[activeIndex.value]!==match)return
  const generation=token
  if(match.messageId==='__live__')props.root?.querySelector('[data-live-answer]')?.scrollIntoView({block:'center'})
  else await props.locate(match.messageId,match)
  await nextTick();if(generation!==token||chatId!==props.chatId||!opened.value||!props.active)return
  const range=highlight();if(range){const rect=range.getBoundingClientRect(),box=props.root?.getBoundingClientRect();if(box&&props.root)props.root.scrollTop+=rect.top-box.top-box.height/3}
}
function schedule(navigate=true){
  if(!searchable.value||!opened.value||composing)return;clearTimeout(timer);const generation=++token;pending.value=true
  timer=setTimeout(async()=>{
    const previous=matches.value[activeIndex.value],items=props.messages.filter(message=>!isQuietResourceLog(message)&&(message.role==='user'||message.role==='assistant'||includeTools.value&&(message.role==='tool'||message.role==='log'))).map(message=>({id:message.id,text:textFor(message)}))
    let committedLiveId:string|undefined
    if(props.liveText){const container=document.createElement('div');container.innerHTML=renderMarkdown(props.liveText);const text=container.textContent||'';if(props.messages.at(-1)?.role!=='assistant'||items.at(-1)?.text!==text)items.push({id:'__live__',text});else committedLiveId=items.at(-1)?.id}
    const result=findConversationText(items,query.value,caseSensitive.value);if(generation!==token||!searchable.value)return
    matches.value=result.matches;truncated.value=result.truncated;pending.value=false
    const previousId=previous?.messageId==='__live__'&&committedLiveId?committedLiveId:previous?.messageId
    const same=previous?result.matches.findIndex(match=>match.messageId===previousId&&match.from===previous.from):-1;activeIndex.value=same>=0?same:restoredIndex!==undefined?Math.min(restoredIndex,Math.max(0,result.matches.length-1)):0;if(result.matches.length||!query.value.trim())restoredIndex=undefined
    await nextTick();if(generation!==token||!searchable.value)return
    highlight();if(navigate&&result.matches.length)await locateActive()
  },120)
}
function step(direction:number){if(!searchable.value||composing||pending.value||!matches.value.length)return;activeIndex.value=(activeIndex.value+direction+matches.value.length)%matches.value.length;void locateActive()}
function open(){if(!searchable.value)return;const selection=getSelection(),selected=selection?.anchorNode&&props.root?.contains(selection.anchorNode)?selection.toString().slice(0,1024):'';if(props.nativeSearch){if(selected)windowFind.query.value=selected;openWindowFind(props.findScope);return}if(!opened.value){returnFocus=document.activeElement as HTMLElement;query.value=selected||query.value;opened.value=true;emit('open',true);schedule()}void nextTick(()=>{if(!props.active||!opened.value)return;input.value?.focus();input.value?.select()})}
function close(restore=true){token++;clearTimeout(timer);clearTimeout(compositionTimer);composing=false;optionsMenu.value?.hide();opened.value=false;pending.value=false;matches.value=[];clearHighlights();emit('open',false);if(restore&&props.active&&returnFocus?.isConnected&&returnFocus.checkVisibility())returnFocus.focus({preventScroll:true})}
function finishComposition(){clearTimeout(compositionTimer);compositionTimer=setTimeout(()=>{composing=false;schedule()},0)}
function onKey(event:KeyboardEvent){if(!props.active||event.isComposing||event.keyCode===229||composing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(optionsOpen.value){optionsMenu.value?.hide();return}close()}else if(event.key==='F3'){event.preventDefault();event.stopPropagation();step(event.shiftKey?-1:1)}else if(event.key==='Enter'&&event.target===input.value){event.preventDefault();event.stopPropagation();step(event.shiftKey?-1:1)}}
watch([query,caseSensitive,includeTools],()=>schedule(props.active))
watch(()=>[props.messages.map(message=>[message.id,message.content]),props.liveText],()=>{if(opened.value)schedule(false)},{deep:true})
watch(()=>props.chatId,()=>{close(false);query.value='';cache.clear();highlightNames=namesFor(props.chatId);styleHighlights()})
watch(()=>props.active,()=>{token++;clearTimeout(timer);clearTimeout(compositionTimer);composing=false;pending.value=false;clearHighlights();if(searchable.value&&opened.value)schedule(false);else optionsMenu.value?.hide()})
onMounted(styleHighlights)
onBeforeUnmount(()=>{unregister();close(false);highlightStyle?.remove();clearTimeout(compositionTimer)})
function snapshot():ConversationFindViewState{return {opened:opened.value,query:query.value,caseSensitive:caseSensitive.value,includeTools:includeTools.value,activeIndex:activeIndex.value}}
function restore(saved:ConversationFindViewState){close(false);query.value=saved.query;caseSensitive.value=saved.caseSensitive;includeTools.value=saved.includeTools;restoredIndex=saved.activeIndex;opened.value=saved.opened;emit('open',saved.opened);if(props.active&&saved.opened)schedule(false)}
function dismiss(restore=true){if(props.nativeSearch&&windowFind.active.value?.target.key===targetKey.value)windowFind.close();close(restore)}
defineExpose({open,close:dismiss,step,snapshot,restore,get opened(){return opened.value},get highlightNames(){return highlightNames}})
</script>
<style>
/* The chat container uses display:contents, so this bar is a fourth grid item.
   Reserve its own automatic row instead of letting the message row cover it. */
.navora-app .shell:not(.mobile-layout)>.content-surface>.main:not(.workspace-single):has(>.conversation-content:not([inert])>.conversation-find){grid-template-rows:auto auto minmax(0,1fr) auto}
.conversation-find{position:relative;z-index:3}
.conversation-find{display:flex;flex-wrap:wrap;align-items:center;gap:4px;flex:0 0 auto;padding:7px 12px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-surface);min-width:0}.conversation-find-input{display:flex;align-items:center;gap:7px;border:1px solid var(--navora-stroke);border-radius:8px;padding:6px 9px;flex:1 1 120px;min-width:70px}.conversation-find-input:focus-within{border-color:var(--navora-accent);box-shadow:0 0 0 2px var(--control-selected)}.conversation-find-input>svg{width:14px;height:14px;color:var(--navora-muted)}.conversation-find-input input{width:100%;min-width:0;font-size:12px;outline:0!important;background:transparent}.conversation-find .ui-icon-button{width:28px;height:28px;flex-shrink:0}.conversation-find-count{font-size:11px;white-space:nowrap;color:var(--navora-muted)}.conversation-find-options{position:relative;margin-left:auto}.conversation-find-options summary{list-style:none;display:grid;place-items:center;width:28px;height:28px;border-radius:6px;cursor:pointer}.conversation-find-options summary>svg{width:16px;height:16px}.conversation-find-options>div{position:absolute;right:0;top:34px;z-index:50;padding:12px;min-width:min(180px,calc(100vw - 24px));max-width:calc(100vw - 24px);border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-surface);box-shadow:0 8px 24px #18202b20}.conversation-find-options label{display:flex;gap:8px;font-size:12px;align-items:center;white-space:nowrap;padding:5px 0}
</style>
