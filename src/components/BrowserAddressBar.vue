<template>
  <div ref="anchor" class="browser-address-bar" :class="{'is-focused':focused,'has-suggestions':open}" @keydown.esc.stop.prevent="siteInfoOpen=false">
    <button v-if="siteSecurity" type="button" class="address-site-info" :class="siteSecurity" :aria-label="`${siteSecurityTitle}，点击查看连接信息`" :aria-expanded="siteInfoOpen" title="查看连接信息" @pointerdown.prevent.stop @click.stop="siteInfoOpen=!siteInfoOpen"><AppIcon :icon="siteSecurityIcon" /></button>
    <AppIcon v-else :icon="focused || url==='about:blank'?'magnifying-glass':'globe'" class="address-leading" />
    <section v-if="siteInfoOpen && siteSecurity" class="address-site-popover" role="dialog" aria-label="连接安全信息" @pointerdown.stop>
      <header><span class="address-site-state-icon" :class="siteSecurity"><AppIcon :icon="siteSecurityIcon" /></span><div><strong>{{ siteSecurityTitle }}</strong><small>{{ siteHost }}</small></div><button type="button" aria-label="关闭连接信息" @click="siteInfoOpen=false"><AppIcon icon="xmark" /></button></header>
      <p>{{ siteSecurityDescription }}</p>
      <div class="address-site-protocol"><span>连接方式</span><strong>{{ siteSecurity==='secure'?'HTTPS 加密':siteSecurity==='certificate-error'?'证书验证失败':'HTTP 未加密' }}</strong></div>
    </section>
    <input ref="input" v-model="draft" role="combobox" aria-label="浏览器地址" placeholder="搜索或输入网址" autocomplete="off" spellcheck="false" :aria-expanded="open" :aria-controls="open?listId:undefined" :aria-activedescendant="open&&selected>=0?`${listId}-${selected}`:undefined" @focus="focusInput" @blur="blurInput" @input="typed=true;dismissed=false;selected=-1;position()" @keydown="keydown" />
    <button v-if="/^https?:\/\//.test(url)" type="button" class="address-save" :class="{'is-saved':saved}" :disabled="saving" :aria-label="saved?'从快捷访问移除':'添加到快捷访问'" :title="saved?'从快捷访问移除':'添加到快捷访问'" :aria-pressed="saved" @pointerdown.prevent @click="$emit('save')"><AppIcon icon="star" /></button>
    <Teleport to="body">
      <div v-if="open" :id="listId" class="browser-address-suggestions" role="listbox" aria-label="地址建议" :style="popupStyle" @pointerdown.prevent>
        <button v-for="(item,index) in choices" :id="`${listId}-${index}`" :key="item.url" type="button" role="option" :aria-selected="selected===index" :class="{'is-selected':selected===index}" tabindex="-1" @pointermove="selected=index" @click="go(item.url)"><AppIcon :icon="choiceIcon(item.kind)" /><span><strong>{{ item.title }}</strong><small>{{ item.kind==='input'?'按 Enter 打开':browserDisplayAddress(item.url) }}</small></span><AppIcon icon="arrow-right" class="address-go-icon" /></button>
      </div>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {browserDisplayAddress,browserInputTarget,browserSuggestions,type BrowserStartState} from '@shared/browser-start'
import type {BrowserLoadError} from '@shared/browser-workspace'
const props=defineProps<{url:string;state:BrowserStartState;active:boolean;saved:boolean;saving:boolean;loadError?:BrowserLoadError}>()
const emit=defineEmits<{navigate:[input:string];focused:[value:boolean];open:[value:boolean];save:[]}>()
const input=ref<HTMLInputElement>(),anchor=ref<HTMLElement>(),focused=ref(false),typed=ref(false),dismissed=ref(false),selected=ref(-1),draft=ref(browserDisplayAddress(props.url)),popupStyle=ref<Record<string,string>>({}),siteInfoOpen=ref(false),listId=`browser-address-${crypto.randomUUID()}`
let resizeObserver:ResizeObserver|undefined
const siteSecurity=computed(()=>{
  if(props.loadError&&props.loadError.code<=-200&&props.loadError.code>=-299)return 'certificate-error'
  try{const protocol=new URL(props.url).protocol;return protocol==='https:'?'secure':protocol==='http:'?'insecure':''}catch{return ''}
})
const siteSecurityIcon=computed(()=>siteSecurity.value==='secure'?'lock':siteSecurity.value==='certificate-error'?'triangle-exclamation':'unlock')
const siteSecurityTitle=computed(()=>siteSecurity.value==='secure'?'连接安全':siteSecurity.value==='certificate-error'?'证书验证失败':'连接不安全')
const siteSecurityDescription=computed(()=>siteSecurity.value==='secure'?'此网页通过 HTTPS 加密传输。此处显示连接方式，不代表 Navora 提供独立的证书审计。':siteSecurity.value==='certificate-error'?'浏览器检测到网页证书错误，请谨慎继续访问。':siteSecurity.value==='insecure'?'此网页使用 HTTP，传输内容未加密，请勿在此提交敏感信息。':'')
const siteHost=computed(()=>{try{return new URL(props.url).host}catch{return ''}})
const matches=computed(()=>browserSuggestions(props.state,typed.value?draft.value:''))
const choiceIcon=(kind:string)=>({history:'clock',link:'star',input:'magnifying-glass'}[kind]||'globe')
const choices=computed(()=>{
  const result=matches.value.map(row=>({url:row.url,title:row.title,kind:row.kind as 'link'|'history'|'input'}))
  if(typed.value&&draft.value.trim()){
    let search=true;try{search=browserInputTarget(draft.value).startsWith('https://www.bing.com/search?q=')}catch{/* Invalid schemes are rejected by navigation. */}
    result.unshift({url:draft.value,title:`${search?'搜索':'访问'} ${draft.value.trim()}`,kind:'input'})
  }
  return result
})
const open=computed(()=>props.active&&focused.value&&!dismissed.value&&choices.value.length>0)
watch(open,async value=>{emit('open',value);if(value){position();await nextTick();position()}})
watch(()=>props.url,url=>{if(!focused.value)draft.value=browserDisplayAddress(url)})
watch(()=>[props.url,props.loadError?.code],()=>{siteInfoOpen.value=false})
watch(()=>props.active,active=>{if(!active){dismissed.value=true;input.value?.blur()}})
watch(choices,(rows,previous)=>{if(selected.value>=0){const url=previous?.[selected.value]?.url;selected.value=rows.findIndex(row=>row.url===url)}})
function position(){
  if(!open.value)return
  const r=anchor.value?.getBoundingClientRect(),panel=anchor.value?.closest('.browser-tab-panel')?.getBoundingClientRect();if(!r||!panel)return
  const pad=8,gap=7,width=Math.max(0,Math.min(520,panel.width-pad*2,innerWidth-pad*2))
  const left=Math.max(pad,Math.min(r.left,panel.right-width-pad,innerWidth-width-pad))
  const below=Math.max(0,innerHeight-pad-r.bottom-gap),above=Math.max(0,r.top-gap-pad)
  const upwards=below<Math.min(160,above)&&above>below,height=Math.min(360,upwards?above:below)
  popupStyle.value={position:'fixed',left:`${left}px`,width:`${width}px`,maxHeight:`${height}px`,
    ...(upwards?{bottom:`${Math.max(pad,innerHeight-r.top+gap)}px`}:{top:`${Math.max(pad,Math.min(r.bottom+gap,innerHeight-pad-height))}px`})}
}
function focusInput(){focused.value=true;typed.value=false;dismissed.value=false;selected.value=-1;draft.value=props.url==='about:blank'?'':props.url;emit('focused',true);position();void nextTick(()=>input.value?.select())}
function blurInput(){focused.value=false;emit('focused',false);draft.value=browserDisplayAddress(props.url)}
function go(value:string){dismissed.value=true;emit('navigate',value);input.value?.blur()}
function keydown(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();event.stopPropagation();dismissed.value=false
    const count=choices.value.length;if(count)selected.value=selected.value<0?(event.key==='ArrowUp'?count-1:0):(selected.value+(event.key==='ArrowDown'?1:-1)+count)%count
    void nextTick(()=>document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({block:'nearest'}))
  }else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();go(selected.value>=0?choices.value[selected.value]?.url||draft.value:draft.value)}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(open.value)dismissed.value=true;else input.value?.blur()}
}
defineExpose({focus:()=>input.value?.focus(),select:()=>input.value?.select()})
onMounted(()=>{
  document.addEventListener('pointerdown',onOutsidePointerDown,true)
  window.addEventListener('resize',position)
  window.addEventListener('scroll',position,true)
  resizeObserver=new ResizeObserver(position)
  if(anchor.value){resizeObserver.observe(anchor.value);const panel=anchor.value.closest('.browser-tab-panel');if(panel)resizeObserver.observe(panel)}
})
function onOutsidePointerDown(event:PointerEvent){if(siteInfoOpen.value&&anchor.value&&!anchor.value.contains(event.target as Node))siteInfoOpen.value=false}
onBeforeUnmount(()=>{resizeObserver?.disconnect();document.removeEventListener('pointerdown',onOutsidePointerDown,true);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);emit('open',false)})
</script>
<style scoped>
.browser-address-bar{position:relative;display:flex;align-items:center;gap:7px;flex:1;min-width:56px;height:34px;padding:0 9px;border:1px solid transparent;border-radius:9px;background:var(--navora-background);color:var(--navora-ink)}.browser-address-bar.is-focused{border-color:var(--navora-accent);background:var(--navora-surface);box-shadow:0 0 0 2px var(--control-selected)}.address-leading{width:14px;height:14px;color:var(--navora-muted)}.address-site-info{display:grid;place-items:center;width:22px;height:24px;flex:0 0 22px;border-radius:6px;color:#788595}.address-site-info.secure{color:#37805a}.address-site-info.insecure{color:#a8742c}.address-site-info.certificate-error{color:#bd4545}.address-site-info:hover{background:var(--control-hover)}.address-site-info:focus-visible{outline:2px solid var(--control-focus)}.address-site-info>.app-icon{width:15px;height:15px}input{flex:1;min-width:0;width:0;outline:none!important;border:0;background:transparent;color:inherit;font-size:12px;height:100%;padding:0}input::placeholder{color:var(--navora-muted)}.address-save{display:grid;place-items:center;width:22px;height:24px;flex-shrink:0;border-radius:5px;color:var(--navora-muted)}.address-save svg{width:16px;height:16px}.address-save:hover{background:var(--control-hover)}.address-save.is-saved{color:var(--navora-accent)}.address-save.is-saved svg{fill:var(--control-selected)}.address-save:focus-visible{outline:2px solid var(--control-focus)}
.address-site-popover{position:absolute;z-index:2601;top:calc(100% + 8px);left:0;width:min(320px,calc(100vw - 24px));padding:14px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 12px 32px #18202b20;text-align:left}.address-site-popover header{display:flex;align-items:center;gap:10px}.address-site-state-icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:10px;background:var(--navora-background);color:#788595}.address-site-state-icon.secure{color:#37805a;background:#edf7f0}.address-site-state-icon.insecure{color:#a8742c;background:#fff7e9}.address-site-state-icon.certificate-error{color:#bd4545;background:#fff0ef}.address-site-state-icon>.app-icon{width:18px;height:18px}.address-site-popover header>div{display:grid;gap:3px;min-width:0;flex:1}.address-site-popover header strong{font-size:13px;font-weight:600}.address-site-popover header small{overflow:hidden;color:var(--navora-muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.address-site-popover header>button{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:var(--navora-muted)}.address-site-popover header>button>.app-icon{width:14px;height:14px}.address-site-popover p{margin:12px 0;color:var(--navora-muted);font-size:12px;line-height:1.55}.address-site-protocol{display:flex;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--navora-stroke);font-size:11px}.address-site-protocol span{color:var(--navora-muted)}.address-site-protocol strong{font-weight:550}
.browser-address-bar button,.browser-address-suggestions button,.address-site-popover button{cursor:pointer}
</style>
<style scoped>
.browser-address-bar{transition:background-color 140ms ease,border-color 140ms ease,box-shadow 140ms ease}
.browser-address-bar:hover:not(.is-focused){border-color:#d5dde7;background:var(--navora-surface)}
</style>
<style>
.browser-address-suggestions{z-index:2600;padding:5px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 8px 28px #18202b17;overflow:auto;scrollbar-width:thin;font-size:12px}.browser-address-suggestions button{display:flex;align-items:center;gap:10px;padding:9px 10px;width:100%;min-width:0;border-radius:7px;text-align:left}.browser-address-suggestions button>svg{width:15px;height:15px;flex-shrink:0;color:var(--navora-muted)}.browser-address-suggestions button>span{display:grid;gap:3px;flex:1;min-width:0}.browser-address-suggestions strong,.browser-address-suggestions small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.browser-address-suggestions strong{font-size:12px;font-weight:400}.browser-address-suggestions small{font-size:10px;color:var(--navora-muted)}.browser-address-suggestions .is-selected{background:var(--control-selected)}.browser-address-suggestions .address-go-icon{width:12px;height:12px;opacity:.5}
</style>
