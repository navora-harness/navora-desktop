<template>
  <Teleport to="body">
    <div v-if="opened" class="ctx-scrim composer-attachment-scrim" @pointerdown.prevent="hide()" />
    <section v-if="opened" ref="panel" data-browser-chrome-overlay class="sidebar-ctx-panel composer-attachment-menu" :class="{'is-selecting':!!sourceView}" :style="{left:`${position.x}px`,top:`${position.y}px`,width:`${panelWidth}px`,maxHeight:`${maximumHeight}px`,'--attachment-max-height':`${maximumHeight}px`}" role="dialog" aria-label="附加" @keydown="key">
      <header v-if="sourceView" class="composer-attachment-heading"><button type="button" aria-label="返回全部附加来源" @click="back"><AppIcon icon="arrow-left" /></button><strong>{{ sourceTitle }}</strong><button type="button" aria-label="关闭附加" @click="hide()"><AppIcon icon="xmark" /></button></header>
      <template v-else>
      <label class="composer-attachment-search"><AppIcon icon="magnifying-glass" /><input ref="search" v-model="query" placeholder="搜索内容、声明或工具" aria-label="搜索内容、声明或工具" role="searchbox" aria-controls="composer-attachment-options" :aria-activedescendant="items[selected]?`composer-attach-${items[selected]!.id}`:undefined" @input="selected=0" /></label>
      <div id="composer-attachment-options" ref="list" class="composer-attachment-options" role="menu" aria-label="附加来源、声明与工具">
        <template v-for="(item,index) in items" :key="item.id"><div v-if="index===0||items[index-1]?.group!==item.group" class="composer-attachment-label" role="presentation">{{ item.group }}</div><button :id="`composer-attach-${item.id}`" type="button" :role="item.declaration?'menuitemcheckbox':'menuitem'" :aria-checked="item.declaration?!!selectedDeclarations?.includes(item.declaration):undefined" :class="{selected:selected===index}" :tabindex="-1" @pointermove="selected=index" @click="choose(item)"><AppIcon :icon="item.icon" /><span><b>{{ item.label }}</b><small v-if="item.detail">{{ item.detail }}</small></span><AppIcon v-if="item.declaration&&selectedDeclarations?.includes(item.declaration)" icon="check" /><AppIcon v-else-if="!item.declaration" icon="chevron-right" /></button></template>
        <p v-if="!items.length" class="composer-attachment-empty" role="status">没有匹配的来源或工具</p>
      </div>
      <footer><span>↑↓ 选择 · Enter 确认 · Esc 关闭</span></footer></template>
      <ComposerSourcePicker v-if="chatId" v-show="!!sourceView" ref="sourcePicker" embedded @source-change="sourceView=$event" :chat-id="chatId" :files="files" :messages="messages" @insert="insertSources" @closed="hide(false)" @notify="emit('notify',$event)" />
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import AppIcon from './icons/AppIcon.vue'
import ComposerSourcePicker,{type ComposerSourceInsert} from './ComposerSourcePicker.vue'
import type {ComposerContextBlock} from '@shared/composer-document'
import type {ChatMessage} from '@shared/types'
import type {WorkspaceResource} from '@shared/workspace-resources'
import {taskDeclarationDefinitions,type TaskDeclarationId} from '@shared/task-declarations'
type MenuItem={id:string;group:string;label:string;detail:string;icon:string;source?:string;creator?:'plugin'|'skill';extra?:boolean;declaration?:TaskDeclarationId;aliases?:readonly string[]}
const props=withDefaults(defineProps<{contextKey?:string;selectedDeclarations?:TaskDeclarationId[];chatId?:string;files?:WorkspaceResource[];messages?:ChatMessage[]}>(),{files:()=>[],messages:()=>[]})
const definitions:MenuItem[]=[
  {id:'file',source:'file',group:'添加',label:'对话文件',detail:'引用文件、图片或插入摘录',icon:'file-lines'},
  {id:'page',source:'page',group:'添加',label:'浏览器页面',detail:'引用页面、正文、选区或截图',icon:'globe'},
  {id:'annotation',source:'annotation',group:'添加',label:'已有批注',detail:'选择当前对话中已保存的网页批注',icon:'annotate',aliases:['网页标注','网页批注','评论']},
  {id:'session',source:'session',group:'添加',label:'浏览器会话',detail:'引用会话及其页面',icon:'browser'},
  ...taskDeclarationDefinitions.map(item=>({id:'declaration-'+item.id,declaration:item.id,group:'声明',label:item.label,detail:item.detail,icon:item.icon,aliases:item.aliases})),
  {id:'plugin-creator',creator:'plugin',group:'工具',label:'插件创建器',detail:'创建、编辑或验证插件',icon:'puzzle-piece'},
  {id:'skill-creator',creator:'skill',group:'工具',label:'技能创建器',detail:'创建、编辑或验证技能',icon:'book'},
  {id:'message',source:'message',group:'更多来源',label:'对话消息',detail:'当前聊天中的历史消息摘录',icon:'comments',extra:true},
  {id:'skill',source:'skill',group:'更多来源',label:'技能',detail:'',icon:'book',extra:true},
  {id:'plugin',source:'plugin',group:'更多来源',label:'插件',detail:'',icon:'puzzle-piece',extra:true},
  {id:'text',source:'text',group:'更多来源',label:'文字与代码',detail:'插入可编辑的资料副本',icon:'code',extra:true},
  {id:'url',source:'url',group:'更多来源',label:'网址',detail:'从历史记录选择或输入网址',icon:'link',extra:true},
  {id:'import',source:'import',group:'更多来源',label:'导入本地文件',detail:'将本地文件加入当前对话',icon:'paperclip',extra:true},
]
const emit=defineEmits<{declaration:[id:TaskDeclarationId];select:[source:string];creator:[kind:'plugin'|'skill'];closed:[committed:boolean];notify:[message:string];insert:[items:ComposerSourceInsert[],replacementId?:string]}>()
const opened=ref(false),query=ref(''),sourceView=ref(''),panelWidth=ref(310),selected=ref(0),panel=ref<HTMLElement>(),search=ref<HTMLInputElement>(),list=ref<HTMLElement>(),position=ref({x:8,y:8}),maximumHeight=ref(460)
const sourcePicker=ref<InstanceType<typeof ComposerSourcePicker>>()
const sourceTitle=computed(()=>definitions.find(item=>item.source===sourceView.value)?.label||'选择来源')
const items=computed(()=>definitions.filter(item=>(!query.value||(item.label+' '+item.detail+' '+(item.aliases||[]).join(' ')).toLowerCase().includes(query.value.toLowerCase()))))
let anchor:HTMLElement|null=null,previous:HTMLElement|null=null,observer:ResizeObserver|undefined
const chromeId=`composer-attachment-${crypto.randomUUID()}`
let generation=0
function resize(){void nextTick(()=>{if(!opened.value||!panel.value)return;const a=anchor?.getBoundingClientRect();if(!a||!anchor?.isConnected||!anchor.checkVisibility()){hide();return}const above=a.top-16;panelWidth.value=Math.max(0,Math.min(310,a.width,innerWidth-16));maximumHeight.value=Math.max(80,Math.min(560,Math.max(80,above),innerHeight-16));void nextTick(()=>{if(!panel.value)return;const box=panel.value.getBoundingClientRect();position.value={x:Math.max(8,Math.min(a.left,innerWidth-box.width-8)),y:Math.max(8,a.top-box.height-8)}})})}
async function show(target:HTMLElement,initialQuery='') {if(!target.isConnected||!target.checkVisibility())return false;const ticket=++generation;anchor=target;previous=document.activeElement instanceof HTMLElement?document.activeElement:null;query.value=initialQuery;sourceView.value='';selected.value=0;opened.value=true;requestBrowserChromeOpen(chromeId);resize();await nextTick();if(ticket!==generation||!opened.value)return false;search.value?.focus({preventScroll:true});if(panel.value){observer ||= new ResizeObserver(resize);observer.observe(panel.value);observer.observe(target)}return true}
function hide(committed=false){if(!opened.value)return;generation++;opened.value=false;observer?.disconnect();if(!committed&&previous?.isConnected)previous.focus({preventScroll:true});emit('closed',committed)}
async function showSource(target:HTMLElement,source='file',replacement?:ComposerContextBlock,files?:File[]){const owner=props.chatId,context=props.contextKey;if(!opened.value&&!await show(target))return;if(!opened.value||owner!==props.chatId||context!==props.contextKey||anchor!==target)return;const ticket=++generation;sourceView.value=source;resize();await nextTick();if(ticket!==generation||!opened.value||owner!==props.chatId||context!==props.contextKey)return;await sourcePicker.value?.show(source,replacement,files)}
function back(){sourceView.value='';resize();void nextTick(()=>search.value?.focus({preventScroll:true}))}
function insertSources(items:ComposerSourceInsert[],replacementId?:string){emit('insert',items,replacementId);hide(true)}
function choose(item:MenuItem){if(item.source){sourceView.value=item.source;resize();emit('select',item.source);return}hide(true);if(item.declaration)emit('declaration',item.declaration);else if(item.creator)emit('creator',item.creator);}
function move(index:number){selected.value=Math.max(0,Math.min(index,items.value.length-1));void nextTick(()=>list.value?.querySelector<HTMLElement>('.selected')?.scrollIntoView({block:'nearest'}))}
function key(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(sourceView.value)back();else hide();return}
  if(sourceView.value)return
  if(event.key==='Tab'){hide();return}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();move(event.key==='Home'?0:event.key==='End'?items.value.length-1:(selected.value+(event.key==='ArrowDown'?1:-1)+items.value.length)%items.value.length);return}
  if(event.key==='Enter'||event.key==='ArrowRight'&&!(event.target instanceof HTMLInputElement&&query.value)){const item=items.value[selected.value];if(item){event.preventDefault();event.stopPropagation();choose(item)}}
}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId)hide()}
function otherNativeChrome(){hide()}
function scroll(event:Event){if(panel.value?.contains(event.target as Node))return;resize()}
watch(()=>props.contextKey,()=>hide())
onMounted(()=>{window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,otherNativeChrome)})
onBeforeUnmount(()=>{generation++;observer?.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,otherNativeChrome)})
defineExpose({show,showSource,hide,open:opened})
</script>
<style>
.composer-attachment-scrim{position:fixed;inset:0;z-index:12000}
.composer-attachment-menu{position:fixed;z-index:12001;width:310px;max-width:calc(100vw - 16px);box-sizing:border-box;display:flex;flex-direction:column;padding:7px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 8px 30px #0002;font-size:12px}
.composer-attachment-menu svg{width:16px;height:16px;flex-shrink:0}.composer-attachment-search{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 7px;border-bottom:1px solid var(--navora-stroke);color:var(--navora-muted);cursor:text}.composer-attachment-search input{width:100%;min-width:0;background:transparent;color:var(--navora-ink);border:0;outline:none;padding:4px 0;font:inherit;cursor:text}.composer-attachment-search>svg{pointer-events:none}.composer-attachment-search:focus-within{box-shadow:inset 0 -2px var(--navora-accent)}
.composer-attachment-options{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:3px 0}.composer-attachment-label{font-size:11px;color:var(--navora-muted);padding:7px 9px 4px}.composer-attachment-options>button{display:flex;gap:10px;align-items:center;width:100%;min-height:42px;padding:7px 9px;border-radius:7px;text-align:left;color:inherit;font:inherit}.composer-attachment-options>button>span{min-width:0;flex:1}.composer-attachment-options b,.composer-attachment-options small{display:block;font-weight:400}.composer-attachment-options small{font-size:10px;color:var(--navora-muted);margin-top:2px}.composer-attachment-options button>svg:last-child{width:12px;height:12px;color:var(--navora-muted)}.composer-attachment-options>.selected{background:var(--control-selected);color:var(--navora-accent)}.composer-attachment-empty{padding:20px 10px;color:var(--navora-muted);text-align:center}
.composer-attachment-menu>footer{flex:0 0 auto;display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:space-between;padding:7px 6px 1px;border-top:1px solid var(--navora-stroke);font-size:10px;color:var(--navora-muted)}.composer-attachment-menu>footer button{display:flex;align-items:center;gap:4px;font-size:11px;padding:3px;color:var(--navora-ink)}.composer-attachment-menu>footer svg{width:12px;height:12px}.composer-attachment-menu>footer button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:1px}
.composer-attachment-heading{display:flex;align-items:center;gap:7px;flex:0 0 auto;min-height:42px;padding:5px 8px;border-bottom:1px solid var(--navora-stroke)}
.composer-attachment-heading strong{flex:1;font-size:12px;font-weight:550}.composer-attachment-heading button{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;color:var(--navora-muted)}.composer-attachment-heading button:hover{background:var(--control-hover);color:var(--navora-ink)}
.composer-attachment-menu.is-selecting{height:var(--attachment-max-height);padding:0;overflow:hidden}
.composer-attachment-options>button{min-height:38px}.composer-attachment-options .composer-attachment-label{padding-top:9px}
</style>
