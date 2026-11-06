<template>
  <Teleport to="body">
    <div v-if="visible" ref="panel" popover="manual" data-browser-chrome-overlay class="sidebar-ctx-panel composer-selection-panel" :class="{'is-below':below}" role="toolbar" aria-label="选中文字的格式" :style="{left:`${position.x}px`,top:`${position.y}px`,maxWidth:`${width}px`,maxHeight:`${height}px`}" @pointerdown="keepSelection" @keydown="key">
      <div class="composer-selection-actions">
        <button type="button" aria-label="添加或编辑链接" title="添加或编辑链接（Ctrl / ⌘ Shift K）" :disabled="!singleBlock" @click="link"><AppIcon icon="link" /></button>
        <button type="button" aria-label="加粗" title="加粗（Ctrl / ⌘ B）" :aria-pressed="active('bold')" @click="format('bold')"><b>B</b></button>
        <button type="button" aria-label="斜体" title="斜体（Ctrl / ⌘ I）" :aria-pressed="active('italic')" @click="format('italic')"><i>I</i></button>
        <span class="composer-selection-divider" />
        <button ref="styleTrigger" type="button" class="composer-selection-style" aria-haspopup="menu" :aria-expanded="stylesOpen" :disabled="insideExcerpt" :title="insideExcerpt?'摘录中保留正文或代码格式':'段落格式'" @click="toggleStyles"><span>{{ styleLabel }}</span><AppIcon icon="chevron-down" /></button>
      </div>
      <div v-if="stylesOpen" class="composer-selection-styles" role="menu" aria-label="段落格式">
        <button v-for="item in styles" :key="item.id" type="button" role="menuitemradio" :aria-checked="currentStyle===item.id" @click="blockStyle(item.id)"><span>{{ item.label }}</span><AppIcon v-if="currentStyle===item.id" icon="check" /></button>
      </div>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {Editor} from '@tiptap/core'
import {TextSelection,type Transaction} from '@tiptap/pm/state'
import {BROWSER_CHROME_OPEN,requestBrowserChromeOpen} from '@shared/browser-chrome-events'
import {NATIVE_UI_OPEN} from '@shared/native-ui'
import {composerOverlayBoundary,composerOverlayBounds} from '@/utils/composer-overlay'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{editor:Editor;blocked?:boolean}>(),emit=defineEmits<{link:[];notify:[message:string]}>()
const panel=ref<HTMLElement>(),styleTrigger=ref<HTMLButtonElement>(),visible=ref(false),stylesOpen=ref(false),position=ref({x:8,y:8}),below=ref(false),height=ref(380),width=ref(285),version=ref(0)
const styles=[{id:'paragraph',label:'正文'},{id:'h1',label:'标题 1'},{id:'h2',label:'标题 2'},{id:'h3',label:'标题 3'},{id:'orderedList',label:'编号列表'},{id:'bulletList',label:'项目符号列表'}]
let range={from:1,to:1},frame=0,suppressed=false,observer:ResizeObserver|undefined
const chromeId=`composer-selection-${crypto.randomUUID()}`
const active=(name:string)=>{void version.value;return props.editor.isActive(name)}
const insideExcerpt=computed(()=>{void version.value;return props.editor.isActive('contextBlock')})
const singleBlock=computed(()=>{void version.value;const {$from,$to}=props.editor.state.selection;return $from.sameParent($to)})
const currentStyle=computed(()=>{void version.value;const e=props.editor;if(e.isActive('bulletList'))return 'bulletList';if(e.isActive('orderedList'))return 'orderedList';const level=[1,2,3].find(value=>e.isActive('heading',{level:value}));return level?'h'+level:'paragraph'})
const styleLabel=computed(()=>styles.find(item=>item.id===currentStyle.value)?.label||'正文')
function eligible(){
  const e=props.editor,{from,to,empty,$from,$to}=e.state.selection
  if(props.blocked||!e.isEditable||e.view.composing||empty||!e.view.dom.checkVisibility()||!e.state.doc.textBetween(from,to,' ').trim())return false
  if(!$from.parent.isTextblock||!$to.parent.isTextblock)return false
  const contextAt=(pos:typeof $from)=>{for(let depth=pos.depth;depth>0;depth--)if(pos.node(depth).type.name==='contextBlock')return pos.before(depth);return -1}
  const context=contextAt($from);if(context!==contextAt($to))return false
  let bad=false;e.state.doc.nodesBetween(from,to,node=>{if(node.type.name==='contextInline'||node.type.name==='codeBlock'||node.type.name==='contextBlock'&&context<0||node.marks.some(mark=>mark.type.name==='code'))bad=true})
  return !bad
}
function close(){visible.value=false;stylesOpen.value=false}
function place(){
  const el=panel.value;if(!el||!visible.value)return
  try{const e=props.editor,bounds=composerOverlayBounds(e.view.dom),a=e.view.coordsAtPos(range.from),b=e.view.coordsAtPos(range.to),top=Math.min(a.top,b.top),bottom=Math.max(a.bottom,b.bottom),above=Math.max(0,top-bounds.top-8),under=Math.max(0,bounds.bottom-bottom-8)
    width.value=bounds.width;height.value=Math.min(380,Math.max(44,above,under),bounds.height)
    el.style.maxWidth=`${width.value}px`;el.style.maxHeight=`${height.value}px`
    const rect=el.getBoundingClientRect();below.value=above<rect.height&&under>=rect.height
    position.value={x:Math.max(bounds.left,Math.min((a.left+b.left-rect.width)/2,bounds.right-rect.width)),y:Math.max(bounds.top,Math.min(below.value?bottom+8:top-rect.height-8,bounds.bottom-rect.height))}
  }catch{close()}
}
function sync(){
  frame=0;version.value++
  const e=props.editor,focused=document.activeElement
  if(suppressed||!eligible()||!e.view.dom.contains(focused)&&!panel.value?.contains(focused)){close();return}
  range={from:e.state.selection.from,to:e.state.selection.to}
  if(!visible.value){const bounds=composerOverlayBounds(e.view.dom);width.value=bounds.width;position.value={x:bounds.left,y:bounds.top};requestBrowserChromeOpen(chromeId);visible.value=true}
  void nextTick(place)
}
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(sync)}
function selected(){suppressed=false;schedule()}
function transaction({transaction:tr}:{transaction:Transaction}){if(tr.docChanged){range={from:tr.mapping.map(range.from,1),to:tr.mapping.map(range.to,-1)}}schedule()}
function restore(focusEditor=true){const e=props.editor;if(range.from>=range.to||range.to>e.state.doc.content.size)return false;e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc,range.from,range.to)));if(focusEditor)e.view.focus();return true}
function keepSelection(event:PointerEvent){if((event.target as Element).closest('button'))event.preventDefault()}
function format(name:'bold'|'italic'){if(!restore())return;const chain=props.editor.chain().focus();if(name==='bold')chain.toggleBold();else chain.toggleItalic();chain.run();schedule()}
function link(){if(!restore())return;close();emit('link')}
function toggleStyles(){stylesOpen.value=!stylesOpen.value;void nextTick(()=>{place();if(stylesOpen.value)panel.value?.querySelector<HTMLElement>('[aria-checked=true]')?.focus({preventScroll:true})})}
function blockStyle(id:string){
  if(insideExcerpt.value||!restore())return
  const e=props.editor,chain=e.chain().focus()
  if(id==='bulletList')chain.toggleBulletList()
  else if(id==='orderedList')chain.toggleOrderedList()
  else{if(e.isActive('bulletList'))chain.toggleBulletList();if(e.isActive('orderedList'))chain.toggleOrderedList();if(id==='paragraph')chain.setParagraph();else chain.setHeading({level:Number(id.slice(1)) as 1|2|3})}
  chain.run();stylesOpen.value=false;schedule()
}
function key(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(stylesOpen.value){stylesOpen.value=false;styleTrigger.value?.focus();void nextTick(place)}else{suppressed=true;close();restore()}return}
  if(event.key==='Tab'){suppressed=true;close();return}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return
  const selector=stylesOpen.value?'.composer-selection-styles button':'.composer-selection-actions button:not(:disabled)',items=[...panel.value?.querySelectorAll<HTMLButtonElement>(selector)||[]],at=items.indexOf(document.activeElement as HTMLButtonElement)
  event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+items.length)%items.length
  items[next]?.focus({preventScroll:true});items[next]?.scrollIntoView({block:'nearest',inline:'nearest'})
}
function focus(){suppressed=false;if(!eligible())return false;range={from:props.editor.state.selection.from,to:props.editor.state.selection.to};const bounds=composerOverlayBounds(props.editor.view.dom);width.value=bounds.width;position.value={x:bounds.left,y:bounds.top};requestBrowserChromeOpen(chromeId);visible.value=true;void nextTick(()=>{place();panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true})});return true}
function outside(event:Event){if(panel.value?.contains(event.target as Node)||props.editor.view.dom.contains(event.target as Node))return;suppressed=true;close()}
function scroll(event:Event){if(panel.value?.contains(event.target as Node))return;if(panel.value?.contains(document.activeElement))place();else close()}
function otherNativeChrome(){suppressed=true;close()}
function otherChrome(event:Event){if((event as CustomEvent<string>).detail!==chromeId){suppressed=true;close()}}
watch(()=>props.blocked,value=>{if(value)close()})
watch(visible,async value=>{if(!value)return;await nextTick();if(visible.value){panel.value?.showPopover();place()}})
watch(panel,(element,previous)=>{if(previous)observer?.unobserve(previous);if(element)observer?.observe(element)})
onMounted(()=>{const e=props.editor;e.on('selectionUpdate',selected);e.on('transaction',transaction);e.on('focus',schedule);e.on('blur',schedule);e.view.dom.addEventListener('compositionstart',close);e.view.dom.addEventListener('compositionend',schedule);observer=new ResizeObserver(schedule);observer.observe(e.view.dom);observer.observe(composerOverlayBoundary(e.view.dom));document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',schedule);window.addEventListener(NATIVE_UI_OPEN,otherNativeChrome);window.addEventListener(BROWSER_CHROME_OPEN,otherChrome)})
onBeforeUnmount(()=>{cancelAnimationFrame(frame);observer?.disconnect();const e=props.editor;e.off('selectionUpdate',selected);e.off('transaction',transaction);e.off('focus',schedule);e.off('blur',schedule);if(!e.isDestroyed){e.view.dom.removeEventListener('compositionstart',close);e.view.dom.removeEventListener('compositionend',schedule)}document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',schedule);window.removeEventListener(NATIVE_UI_OPEN,otherNativeChrome);window.removeEventListener(BROWSER_CHROME_OPEN,otherChrome)})
defineExpose({focus,close})
</script>
<style>
.composer-selection-panel{position:fixed;inset:auto;margin:0;z-index:12001;display:flex;flex-direction:column;width:max-content;max-width:calc(100vw - 16px);padding:5px;border:1px solid var(--navora-stroke);border-radius:12px;background:var(--navora-surface);color:var(--navora-ink);box-shadow:0 6px 24px #0002;box-sizing:border-box}
.composer-selection-actions{display:flex;align-items:center;gap:2px;order:2;flex:0 0 auto;max-width:100%;overflow-x:auto;overscroll-behavior:contain;scrollbar-width:thin}.composer-selection-actions button{height:32px;min-width:32px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:7px;font-size:16px;flex-shrink:0}.composer-selection-actions button[aria-pressed=true]{background:var(--control-selected);color:var(--navora-accent)}.composer-selection-panel button:hover:not(:disabled){background:var(--control-hover)}.composer-selection-panel svg{width:16px;height:16px}.composer-selection-actions .composer-selection-style{padding:0 9px;font-size:13px}.composer-selection-divider{height:18px;width:1px;background:var(--navora-stroke);margin:0 4px}
.composer-selection-styles{order:1;flex:1 1 auto;min-height:0;width:245px;max-width:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;border-bottom:1px solid var(--navora-stroke);margin-bottom:5px;padding-bottom:5px}.composer-selection-styles button{display:flex;justify-content:space-between;gap:12px;align-items:center;width:100%;min-height:35px;text-align:left;padding:6px 10px;border-radius:7px;font-size:13px}.composer-selection-panel.is-below .composer-selection-actions{order:0}.composer-selection-panel button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:-2px}.composer-selection-panel button:disabled{opacity:.45}
</style>
