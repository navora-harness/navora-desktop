<template>
  <span ref="anchor" class="composer-context-inline" :class="{'is-selected':selected,'is-invalid':invalid,'is-message':isMessage,'is-open':opened}" contenteditable="false">
    <button type="button" :title="block.label" :aria-label="`查看 ${block.label}`" aria-haspopup="dialog" :aria-expanded="opened" :aria-controls="cardId" @mousedown.prevent @click.stop="toggle"><AppIcon :icon="icon" /><span v-if="isMessage" class="composer-message-summary"><span class="composer-message-heading">对话摘要<span v-if="messageAuthor"> · {{ messageAuthor }}</span></span><span class="composer-message-preview">{{ messagePreview||'查看引用的对话消息' }}</span></span><span v-else>{{ block.label||'未命名来源' }}</span><AppIcon v-if="invalid" icon="circle-exclamation" /></button>
  </span>
  <section v-show="opened" :id="cardId" ref="card" popover="manual" data-browser-chrome-overlay class="sidebar-ctx-panel composer-context-card" role="dialog" :aria-label="`${block.label}的描述信息`" :style="{left:`${position.x}px`,top:`${position.y}px`,maxWidth:`${width}px`,maxHeight:`${height}px`}" @pointerdown.stop @click.stop @keydown="key">
    <header contenteditable="false"><AppIcon :icon="icon" /><slot name="title"><strong>{{ block.label||'未命名来源' }}</strong></slot><button type="button" aria-label="收起描述信息" @mousedown.prevent @click="close(true)"><AppIcon icon="xmark" /></button></header>
    <div class="composer-context-metadata" contenteditable="false"><span>{{ kindLabel }}{{ block.mode==='excerpt'?' · 资料副本':'' }}</span><span v-if="stateLabel">{{ stateLabel }}</span><p v-if="location">{{ location }}</p><p v-if="rangeLabel">{{ rangeLabel }}</p></div>
    <img v-if="safePreview" class="composer-context-preview" :src="safePreview" :alt="block.label" contenteditable="false" draggable="false" />
    <div class="composer-context-card-body"><slot /></div>
    <footer contenteditable="false"><slot name="actions" /></footer>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {ComposerContextBlock} from '@shared/composer-document'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import {composerOverlayBoundary,composerOverlayBounds} from '@/utils/composer-overlay'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{block:ComposerContextBlock;editor:HTMLElement;selected?:boolean;preview?:string}>()
const emit=defineEmits<{opened:[];closed:[]}>()
const anchor=ref<HTMLElement>(),card=ref<HTMLElement>(),opened=ref(false),position=ref({x:8,y:8}),width=ref(360),height=ref(380)
const cardId=`composer-context-${crypto.randomUUID()}`
let observer:ResizeObserver|undefined,frame=0
const invalid=computed(()=>props.block.status==='missing'||props.block.status==='error')
const isMessage=computed(()=>props.block.source.kind==='message')
const messageAuthor=computed(()=>props.block.label.match(/^(助手|我|用户|Navora)[:：]\s*/)?.[1]||'')
const messagePreview=computed(()=>props.block.label.replace(/^(助手|我|用户|Navora)[:：]\s*/,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim())
const icon=computed(()=>props.block.source.identity.startsWith('skill:')?'book':props.block.source.identity.startsWith('plugin:')?'puzzle-piece':({file:'file-lines',image:'image',page:'globe',url:'link',session:'browser',annotation:'annotate',message:'comments',text:'align-left'}[props.block.source.kind]))
const kindLabel=computed(()=>props.block.source.identity.startsWith('skill:')?'技能说明':props.block.source.identity.startsWith('plugin:')?'插件说明':({file:'对话文件',image:'图片',page:'浏览器页面',url:'链接',session:'浏览器会话',annotation:'网页标注',message:'历史消息',text:'文字与代码'}[props.block.source.kind]))
const location=computed(()=>props.block.source.path||props.block.source.url||props.block.source.browserRef?.label||'')
const stateLabel=computed(()=>({loading:'正在读取',missing:'来源已失效',stale:'来源已变化',error:'读取失败',ready:''}[props.block.status||'ready']))
const rangeLabel=computed(()=>{const range=props.block.range;if(range?.startLine)return `第 ${range.startLine}${range.endLine&&range.endLine!==range.startLine?`–${range.endLine}`:''} 行`;if(range?.pageStart)return `第 ${range.pageStart}${range.pageEnd?`–${range.pageEnd}`:''} 页`;return ''})
const safePreview=computed(()=>props.preview&&/^(?:data:image\/(?:png|jpeg|webp|gif);base64,|blob:)/i.test(props.preview)?props.preview:undefined)
function place(){
  const target=anchor.value,panel=card.value;if(!opened.value||!target||!panel)return
  if(!target.checkVisibility()||!props.editor.checkVisibility()){close();return}
  const bounds=composerOverlayBounds(props.editor),a=target.getBoundingClientRect(),above=Math.max(0,a.top-bounds.top-8),under=Math.max(0,bounds.bottom-a.bottom-8)
  width.value=Math.min(380,bounds.width);height.value=Math.min(440,Math.max(120,above,under),bounds.height)
  panel.style.maxWidth=`${width.value}px`;panel.style.maxHeight=`${height.value}px`
  const rect=panel.getBoundingClientRect(),below=above<rect.height&&under>=rect.height
  position.value={x:Math.max(bounds.left,Math.min(a.left,bounds.right-rect.width)),y:Math.max(bounds.top,Math.min(below?a.bottom+8:a.top-rect.height-8,bounds.bottom-rect.height))}
}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(place)}
async function open(){if(opened.value)return;const bounds=composerOverlayBounds(props.editor);width.value=Math.min(380,bounds.width);height.value=Math.min(440,bounds.height);position.value={x:bounds.left,y:bounds.top};requestBrowserChromeOpen(cardId);opened.value=true;emit('opened');await nextTick();if(!opened.value)return;card.value?.showPopover();place();observer||=new ResizeObserver(schedule);if(anchor.value)observer.observe(anchor.value);if(card.value)observer.observe(card.value);observer.observe(composerOverlayBoundary(props.editor))}
function close(focus=false){if(!opened.value)return;if(card.value?.matches(':popover-open'))card.value.hidePopover();opened.value=false;observer?.disconnect();emit('closed');if(focus)anchor.value?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true})}
function toggle(){if(opened.value)close();else void open()}
function related(target:EventTarget|null){return target instanceof Element&&!!target.closest('.composer-selection-panel,.composer-link-panel')}
function outside(event:Event){if(!opened.value||anchor.value?.contains(event.target as Node)||card.value?.contains(event.target as Node)||related(event.target))return;close()}
function otherChrome(event:Event){const id=(event as CustomEvent<string>).detail;if(id===cardId)return;if(id?.startsWith('composer-selection-')&&card.value?.contains(document.getSelection()?.anchorNode||null))return;close()}
function nativeChrome(){close()}
function scroll(event:Event){if(card.value?.contains(event.target as Node))return;schedule()}
function key(event:KeyboardEvent){if(!event.isComposing&&event.keyCode!==229&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true)}}
function globalKey(event:KeyboardEvent){if(opened.value&&!related(event.target))key(event)}
watch(()=>JSON.stringify([props.block.id,props.block.source]),()=>close())
onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',globalKey,true);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome);window.addEventListener(NATIVE_UI_OPEN,nativeChrome);window.addEventListener('blur',nativeChrome);window.addEventListener('resize',schedule);window.addEventListener('scroll',scroll,true)})
onBeforeUnmount(()=>{cancelAnimationFrame(frame);observer?.disconnect();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',globalKey,true);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome);window.removeEventListener(NATIVE_UI_OPEN,nativeChrome);window.removeEventListener('blur',nativeChrome);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',scroll,true)})
defineExpose({open,close,opened})
</script>
<style>
.composer-context-inline{display:inline-flex;vertical-align:baseline;max-width:min(250px,100%);margin:0 2px;white-space:nowrap;line-height:1.5}
.composer-context-inline>button{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-width:0;text-align:left;white-space:nowrap;cursor:pointer;user-select:none;padding:1px 6px;border:1px solid var(--navora-stroke);border-radius:5px;background:var(--control-selected);color:var(--navora-accent);font:inherit;font-size:12px;vertical-align:baseline}
.composer-context-inline>button>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.composer-context-inline svg{width:13px;height:13px;flex-shrink:0}.composer-context-inline.is-invalid>button{border-color:var(--control-danger);color:var(--control-danger)}.composer-context-inline>button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:1px}
.composer-context-inline.is-message{width:360px;max-width:100%;margin:3px 0;vertical-align:middle;white-space:normal}
.composer-context-inline.is-message>button{align-items:flex-start;gap:8px;width:100%;padding:8px 10px;border-radius:8px}
.composer-context-inline.is-message>button>.app-icon{margin-top:3px}
.composer-context-inline>button>.composer-message-summary{display:flex;flex-direction:column;gap:3px;flex:1;white-space:normal}
.composer-message-heading{font-size:11px;font-weight:600;line-height:16px;color:var(--navora-accent)}
.composer-message-heading>span{font-weight:400;color:var(--navora-muted)}
.composer-message-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;white-space:normal;text-align:left;font-size:12px;font-weight:400;line-height:19px;color:var(--navora-ink)}
.composer-context-inline>button:hover,.composer-context-inline.is-open>button{border-color:var(--navora-accent);background:color-mix(in srgb,var(--control-selected) 88%,var(--navora-accent));color:var(--navora-accent)}
.composer-context-card{position:fixed;inset:auto;margin:0;z-index:12001;display:flex;flex-direction:column;width:380px;box-sizing:border-box;padding:12px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 8px 28px #18203029;font-size:13px;line-height:1.6;white-space:normal;text-align:left;user-select:text;-webkit-user-select:text}
.composer-context-card>header{display:flex;align-items:center;gap:8px;flex-shrink:0}.composer-context-card>header>strong{flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px}.composer-context-card>header>button{display:grid;place-items:center;flex-shrink:0;width:24px;height:24px;margin-left:auto;border-radius:5px;color:var(--navora-muted)}.composer-context-card svg{width:14px;height:14px;flex-shrink:0}
.composer-context-metadata{font-size:11px;color:var(--navora-muted);margin:5px 0 9px;overflow-wrap:anywhere;flex-shrink:0}.composer-context-metadata>span+span{margin-left:8px}.composer-context-metadata p{margin:2px 0!important}.composer-context-card-body{min-height:0;flex:1 1 auto;overflow:auto;overscroll-behavior:contain}
.composer-context-card .composer-context-preview{display:block;max-width:100%;max-height:180px;object-fit:contain;flex-shrink:0;margin:0 0 8px;border-radius:6px}.composer-context-card>footer{display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--navora-stroke);padding-top:8px;margin-top:9px;flex-shrink:0}.composer-context-card>footer button,.composer-context-card summary{padding:4px 7px;border-radius:5px;font:inherit;font-size:11px;color:var(--navora-muted)}.composer-context-card button:hover:not(:disabled),.composer-context-card summary:hover{background:var(--control-hover)}.composer-context-card button:disabled{opacity:.45}.composer-context-card button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-1px}
.composer-context-card details{width:100%}.composer-context-card details>div{display:flex;flex-wrap:wrap;gap:4px;padding-top:5px}.composer-context-description{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;margin:0}.composer-context-card input{min-width:0;color:inherit;background:transparent;border:1px solid var(--navora-stroke);border-radius:5px;padding:4px 6px;font:inherit}
</style>
