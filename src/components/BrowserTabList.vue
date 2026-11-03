<template>
  <button ref="trigger" type="button" class="ui-icon-button browser-tab-list-button" :style="{visibility:available?'visible':'hidden'}" :inert="!available" :disabled="!available" :aria-hidden="!available||undefined" :tabindex="available?0:-1" :aria-label="`列出和搜索${scopeLabel}标签页`" title="列出和搜索标签页" :aria-expanded="open" @click="toggle"><AppIcon icon="list-ul" /></button>
  <Teleport to="body">
    <template v-if="open">
      <div class="browser-tab-list-scrim" @pointerdown="hide" />
      <section ref="panel" class="sidebar-ctx-panel browser-tab-list-panel" :style="position" :aria-label="`搜索${scopeLabel}标签页`" @keydown.esc.stop.prevent="hide">
        <input ref="input" v-model="query" type="search" placeholder="搜索标题、路径或网址" aria-label="搜索标签页" @keydown.down.prevent="focusFirst" />
        <div class="browser-tab-list-results"><button v-for="tab in matches" :key="tab.id" type="button" :class="{current:tab.id===activeId}" :title="tab.description||tab.title" @click="choose(tab.id)" @keydown="resultKey"><AppIcon :icon="tab.pinned?'thumbtack':tab.icon||'globe'" /><span><strong dir="auto">{{ tab.title || '新标签页' }}</strong><small dir="auto">{{ tab.description||displayUrl(tab.url) }}</small></span><AppIcon v-if="tab.id===activeId" icon="check" /></button><p v-if="!matches.length">没有匹配的标签页</p></div>
      </section>
    </template>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
const props=withDefaults(defineProps<{tabs:{id:string;title:string;url?:string;pinned?:boolean;icon?:string;description?:string}[];activeId:string;scopeLabel?:string;available?:boolean}>(),{scopeLabel:'浏览器',available:true})
const emit=defineEmits<{select:[id:string]}>()
const open=ref(false),query=ref(''),trigger=ref<HTMLElement|null>(null),panel=ref<HTMLElement|null>(null),input=ref<HTMLInputElement|null>(null),position=ref({left:'8px',top:'8px'})
const chromeId=`tab-list-${crypto.randomUUID()}`
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId)open.value=false}
const matches=computed(()=>props.tabs.filter(tab=>!query.value||`${tab.title} ${tab.description||''} ${tab.url||''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
function displayUrl(url?:string){try{return url&&url!=='about:blank'?new URL(url).host:'空白新标签页'}catch{return ''}}
function locate(){const bounds=trigger.value?.getBoundingClientRect();if(!bounds)return;const width=Math.min(360,innerWidth-16),height=panel.value?.offsetHeight||300;position.value={left:`${Math.max(8,Math.min(bounds.right-width,innerWidth-width-8))}px`,top:`${Math.max(8,Math.min(bounds.bottom+4,innerHeight-height-8))}px`}}
async function toggle(){if(open.value){hide();return}requestBrowserChromeOpen(chromeId);query.value='';open.value=true;await nextTick();if(!open.value)return;locate();input.value?.focus()}
function hide(){if(!open.value)return;open.value=false;trigger.value?.focus({preventScroll:true})}
function choose(id:string){hide();emit('select',id)}
function focusFirst(){panel.value?.querySelector<HTMLButtonElement>('.browser-tab-list-results button')?.focus()}
function resultKey(event:KeyboardEvent){if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...panel.value?.querySelectorAll<HTMLButtonElement>('.browser-tab-list-results button')||[]],at=buttons.indexOf(event.currentTarget as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus()}
watch(open,value=>{if(value)window.addEventListener('resize',hide);else window.removeEventListener('resize',hide)})
watch(()=>props.tabs.length,()=>{if(open.value)void nextTick(locate)})
watch(()=>props.activeId,()=>{open.value=false})
watch(()=>props.available,value=>{if(!value)open.value=false})
onMounted(()=>window.addEventListener(BROWSER_CHROME_OPEN,otherChrome))
onBeforeUnmount(()=>{window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener('resize',hide)})
</script>
<style>
.browser-tab-list-button{width:32px;min-width:32px;height:32px;flex:0 0 32px;border-radius:7px;cursor:default!important}
.browser-tab-list-button>.app-icon{width:18px;height:18px}
.browser-tab-list-scrim{position:fixed;inset:0;z-index:12000}
.browser-tab-list-panel{position:fixed;width:min(360px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:hidden;padding:8px;border-radius:12px;background:var(--navora-surface,#fff);border:1px solid var(--navora-stroke,#d8dee7);color:var(--navora-ink,#263b55);box-sizing:border-box;z-index:12001}
.browser-tab-list-panel>input{display:block;width:100%;padding:8px 10px;border:1px solid var(--navora-stroke,#d8dee7);border-radius:7px;font:inherit;font-size:13px;outline-color:var(--navora-accent,#3269ac);background:var(--navora-surface,#fff);color:inherit}
.browser-tab-list-results{max-height:min(380px,60dvh);overflow:auto;margin-top:6px}
.browser-tab-list-results>button{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;cursor:default}
.browser-tab-list-results>button:hover,.browser-tab-list-results>button.current{background:var(--control-hover,#edf2f7)}
.browser-tab-list-results>button:focus-visible{outline:2px solid var(--navora-accent,#3269ac);outline-offset:-2px}
.browser-tab-list-results>button>.app-icon{width:16px;height:16px;flex-shrink:0}
.browser-tab-list-results>button>span{flex:1;min-width:0}
.browser-tab-list-results strong,.browser-tab-list-results small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.browser-tab-list-results strong{font-size:13px;font-weight:500}.browser-tab-list-results small,.browser-tab-list-results>p{font-size:11px;color:var(--navora-muted,#727b8a)}
</style>
