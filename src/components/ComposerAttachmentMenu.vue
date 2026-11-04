<template>
  <Teleport to="body">
    <div v-if="opened" class="ctx-scrim composer-attachment-scrim" @pointerdown.prevent="hide()" />
    <section v-if="opened" ref="panel" data-browser-chrome-overlay class="sidebar-ctx-panel composer-attachment-menu" :style="{left:`${position.x}px`,top:`${position.y}px`,maxHeight:`${maximumHeight}px`}" role="dialog" aria-label="附加" @keydown="key">
      <label class="composer-attachment-search"><AppIcon icon="magnifying-glass" /><input ref="search" v-model="query" placeholder="搜索附加内容或工具" aria-label="搜索附加内容或工具" role="combobox" aria-autocomplete="list" aria-controls="composer-attachment-options" :aria-activedescendant="items[selected]?`composer-attach-${items[selected]!.id}`:undefined" aria-expanded="true" @input="selected=0" /></label>
      <div id="composer-attachment-options" ref="list" class="composer-attachment-options" role="listbox" aria-label="附加来源与工具">
        <template v-for="(item,index) in items" :key="item.id"><div v-if="index===0||items[index-1]?.group!==item.group" class="composer-attachment-label" role="presentation">{{ item.group }}</div><button :id="`composer-attach-${item.id}`" type="button" role="option" :aria-selected="selected===index" :class="{selected:selected===index}" :tabindex="-1" @pointermove="selected=index" @click="choose(item)"><AppIcon :icon="item.icon" /><span><b>{{ item.label }}</b><small>{{ item.detail }}</small></span><AppIcon icon="chevron-right" /></button></template>
        <p v-if="!items.length" class="composer-attachment-empty" role="status">没有匹配的来源或工具</p>
      </div>
      <footer><button v-if="!more&&!query" type="button" @click="more=true;selected=0;resize()">更多来源<AppIcon icon="chevron-right" /></button><button v-else-if="more&&!query" type="button" @click="more=false;selected=0;resize()"><AppIcon icon="chevron-left" />常用来源</button><span>↑↓ 选择 · Enter 确认 · Esc 关闭</span></footer>
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import AppIcon from './icons/AppIcon.vue'
type MenuItem={id:string;group:string;label:string;detail:string;icon:string;source?:string;creator?:'plugin'|'skill';extra?:boolean}
const props=defineProps<{contextKey?:string}>()
const definitions:MenuItem[]=[
  {id:'file',source:'file',group:'添加',label:'对话文件',detail:'引用文件、图片或插入摘录',icon:'file-lines'},
  {id:'page',source:'page',group:'添加',label:'浏览器页面',detail:'引用页面、正文、选区或截图',icon:'globe'},
  {id:'session',source:'session',group:'添加',label:'浏览器会话',detail:'引用会话及其页面',icon:'browser'},
  {id:'plugin-creator',creator:'plugin',group:'工具',label:'插件创建器',detail:'创建、编辑或验证插件',icon:'puzzle-piece'},
  {id:'skill-creator',creator:'skill',group:'工具',label:'技能创建器',detail:'创建、编辑或验证技能',icon:'book'},
  {id:'message',source:'message',group:'更多来源',label:'对话消息',detail:'当前聊天中的历史消息摘录',icon:'comments',extra:true},
  {id:'skill',source:'skill',group:'更多来源',label:'技能说明',detail:'附加已安装技能的说明副本',icon:'book',extra:true},
  {id:'plugin',source:'plugin',group:'更多来源',label:'插件说明',detail:'附加插件文档与工具说明',icon:'puzzle-piece',extra:true},
  {id:'annotation',source:'annotation',group:'更多来源',label:'网页标注',detail:'引用已保存的网页标注',icon:'annotate',extra:true},
  {id:'text',source:'text',group:'更多来源',label:'文字与代码',detail:'插入可编辑的资料副本',icon:'code',extra:true},
  {id:'url',source:'url',group:'更多来源',label:'网址',detail:'附加链接与使用说明',icon:'link',extra:true},
  {id:'import',source:'import',group:'更多来源',label:'导入本地文件',detail:'将本地文件加入当前对话',icon:'paperclip',extra:true},
]
const emit=defineEmits<{select:[source:string];creator:[kind:'plugin'|'skill'];closed:[committed:boolean];notify:[message:string]}>()
const opened=ref(false),query=ref(''),more=ref(false),selected=ref(0),panel=ref<HTMLElement>(),search=ref<HTMLInputElement>(),list=ref<HTMLElement>(),position=ref({x:8,y:8}),maximumHeight=ref(460)
const items=computed(()=>definitions.filter(item=>(query.value||more.value||!item.extra)&&(!query.value||(item.label+' '+item.detail).toLowerCase().includes(query.value.toLowerCase()))))
let anchor:HTMLElement|null=null,previous:HTMLElement|null=null,observer:ResizeObserver|undefined
const chromeId=`composer-attachment-${crypto.randomUUID()}`
let generation=0
function resize(){void nextTick(()=>{if(!opened.value||!panel.value)return;const a=anchor?.getBoundingClientRect();if(!a){hide();return}const above=a.top-16;maximumHeight.value=Math.max(44,Math.min(490,Math.max(44,above),innerHeight-16));void nextTick(()=>{if(!panel.value)return;const box=panel.value.getBoundingClientRect();position.value={x:Math.max(8,Math.min(a.left,innerWidth-box.width-8)),y:Math.max(8,a.top-box.height-8)}})})}
async function show(target:HTMLElement,initialQuery='') {const ticket=++generation;anchor=target;previous=document.activeElement instanceof HTMLElement?document.activeElement:null;query.value=initialQuery;more.value=false;selected.value=0;opened.value=true;requestBrowserChromeOpen(chromeId);resize();await nextTick();if(ticket!==generation||!opened.value)return;search.value?.focus({preventScroll:true});if(panel.value){observer ||= new ResizeObserver(resize);observer.observe(panel.value)}}
function hide(committed=false){if(!opened.value)return;generation++;opened.value=false;observer?.disconnect();if(!committed&&previous?.isConnected)previous.focus({preventScroll:true});emit('closed',committed)}
function choose(item:MenuItem){hide(true);if(item.creator)emit('creator',item.creator);else if(item.source)emit('select',item.source)}
function move(index:number){selected.value=Math.max(0,Math.min(index,items.value.length-1));void nextTick(()=>list.value?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({block:'nearest'}))}
function key(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(more.value&&!query.value){more.value=false;move(0);resize()}else hide();return}
  if(event.key==='Tab'){hide();return}
  if(event.key==='ArrowLeft'&&more.value&&!(event.target instanceof HTMLInputElement&&query.value)){event.preventDefault();more.value=false;move(0);resize();return}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();move(event.key==='Home'?0:event.key==='End'?items.value.length-1:(selected.value+(event.key==='ArrowDown'?1:-1)+items.value.length)%items.value.length);return}
  if(event.key==='Enter'||event.key==='ArrowRight'&&!(event.target instanceof HTMLInputElement&&query.value)){const item=items.value[selected.value];if(item){event.preventDefault();event.stopPropagation();choose(item)}}
}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId)hide()}
function otherNativeChrome(){hide()}
function scroll(event:Event){if(panel.value?.contains(event.target as Node))return;resize()}
watch(()=>props.contextKey,()=>hide())
onMounted(()=>{window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,otherNativeChrome)})
onBeforeUnmount(()=>{generation++;observer?.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,otherNativeChrome)})
defineExpose({show,hide,open:opened})
</script>
<style>
.composer-attachment-scrim{position:fixed;inset:0;z-index:12000}
.composer-attachment-menu{position:fixed;z-index:12001;width:310px;max-width:calc(100vw - 16px);box-sizing:border-box;display:flex;flex-direction:column;padding:7px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 8px 30px #0002;font-size:12px}
.composer-attachment-menu svg{width:16px;height:16px;flex-shrink:0}.composer-attachment-search{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 7px;border-bottom:1px solid var(--navora-stroke);color:var(--navora-muted)}.composer-attachment-search input{width:100%;min-width:0;background:transparent;color:var(--navora-ink);border:0;outline:none;padding:4px 0;font:inherit}.composer-attachment-search:focus-within{box-shadow:inset 0 -2px var(--navora-accent)}
.composer-attachment-options{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:3px 0}.composer-attachment-label{font-size:11px;color:var(--navora-muted);padding:7px 9px 4px}.composer-attachment-options>button{display:flex;gap:10px;align-items:center;width:100%;min-height:42px;padding:7px 9px;border-radius:7px;text-align:left;color:inherit;font:inherit}.composer-attachment-options>button>span{min-width:0;flex:1}.composer-attachment-options b,.composer-attachment-options small{display:block;font-weight:400}.composer-attachment-options small{font-size:10px;color:var(--navora-muted);margin-top:2px}.composer-attachment-options button>svg:last-child{width:12px;height:12px;color:var(--navora-muted)}.composer-attachment-options>.selected{background:var(--control-selected);color:var(--navora-accent)}.composer-attachment-empty{padding:20px 10px;color:var(--navora-muted);text-align:center}
.composer-attachment-menu footer{flex:0 0 auto;display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:space-between;padding:7px 6px 1px;border-top:1px solid var(--navora-stroke);font-size:10px;color:var(--navora-muted)}.composer-attachment-menu footer button{display:flex;align-items:center;gap:4px;font-size:11px;padding:3px;color:var(--navora-ink)}.composer-attachment-menu footer svg{width:12px;height:12px}.composer-attachment-menu footer button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:1px}
</style>
