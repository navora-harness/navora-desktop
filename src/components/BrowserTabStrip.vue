<template>
  <div ref="element" class="browser-tab-strip" :class="{'tab-widths-frozen':frozen}" role="tablist" :aria-label="ariaLabel" aria-multiselectable="true" :style="{...WORKSPACE_TAB_CSS_VARIABLES,width:`${idealWidth}px`,'--workspace-tab-slot-width':slotWidth===undefined?undefined:`${slotWidth}px`}" @wheel="wheel" @pointerleave="releaseWidths" @dragstart="releaseWidths" @dragover="dragOver" @dragleave="stopEdgeScroll" @drop="stopEdgeScroll">
    <TransitionGroup tag="div" class="browser-tab-strip-list" name="workspace-tab-motion" @before-enter="enterTab" @before-leave="leaveTab" @after-enter="scheduleMeasure" @after-leave="scheduleMeasure" @leave-cancelled="enterTab"><slot /></TransitionGroup>
  </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {workspaceTabSlotWidth,workspaceTabStripWidth,WORKSPACE_TAB_CSS_VARIABLES} from '@shared/workspace-tab-geometry'
import {refreshTabDrop} from '@/composables/tabDragFeedback'
const props=withDefaults(defineProps<{count:number;pinnedCount?:number;activeKey?:string;ariaLabel?:string}>(),{pinnedCount:0,ariaLabel:'浏览器标签'})
const element=ref<HTMLElement|null>(null),frozen=ref(false),overflowing=ref(false),slotWidth=ref<number>()
const idealWidth=computed(()=>workspaceTabStripWidth(props.count,props.pinnedCount))
let releaseTimer:ReturnType<typeof setTimeout>|undefined,frame=0,measureFrame=0,allocationFrame=0,edge=0,observer:ResizeObserver|undefined,hostObserver:ResizeObserver|undefined
let hostWidth=-1,stripWidth=0
let structuralAllocation=true
function enterTab(node:Element){if(node instanceof HTMLElement){node.inert=false;node.removeAttribute('aria-hidden')}}
function leaveTab(node:Element){if(node instanceof HTMLElement){node.inert=true;node.setAttribute('aria-hidden','true')}}
function measure(){measureFrame=0;const node=element.value,next=!!node&&node.scrollWidth>node.clientWidth+1;if(overflowing.value!==next)overflowing.value=next}
// Visibility of the overflow action must never mutate layout in a ResizeObserver delivery.
function scheduleMeasure(){if(!measureFrame)measureFrame=requestAnimationFrame(measure)}
function allocate(){
  allocationFrame=0
  const node=element.value
  const width=node?.getBoundingClientRect().width
  if(width&&width>0)slotWidth.value=workspaceTabSlotWidth(props.count,props.pinnedCount,width)
  scheduleMeasure()
}
function scheduleAllocation(){if(!allocationFrame)allocationFrame=requestAnimationFrame(allocate)}
function releaseWidths(){clearTimeout(releaseTimer);frozen.value=false;element.value?.querySelectorAll<HTMLElement>('.workspace-tab-item').forEach(node=>node.style.removeProperty('--browser-tab-frozen-width'))}
function freezeForClose(){
  if(!element.value?.matches(':hover'))return
  element.value.querySelectorAll<HTMLElement>('.workspace-tab-item').forEach(node=>node.style.setProperty('--browser-tab-frozen-width',`${node.getBoundingClientRect().width}px`))
  frozen.value=true;clearTimeout(releaseTimer);releaseTimer=setTimeout(releaseWidths,3000)
}
function wheel(event:WheelEvent){
  const node=element.value;if(!node||node.scrollWidth<=node.clientWidth+1)return
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY
  const rtl=getComputedStyle(node).direction==='rtl',max=node.scrollWidth-node.clientWidth
  const next=Math.max(rtl?-max:0,Math.min(rtl?0:max,node.scrollLeft+delta))
  if(next===node.scrollLeft)return
  event.preventDefault();node.scrollLeft=next
}
function stopEdgeScroll(){cancelAnimationFrame(frame);frame=0;edge=0}
function tick(){const node=element.value;if(!node||!edge){frame=0;return}const previous=node.scrollLeft;node.scrollLeft+=edge;if(Math.abs(previous-node.scrollLeft)<.1){stopEdgeScroll();return}refreshTabDrop();frame=requestAnimationFrame(tick)}
function dragOver(event:DragEvent){
  const node=element.value;if(!node||!event.dataTransfer?.types.some(type=>type.startsWith('application/x-navora-')))return
  const bounds=node.getBoundingClientRect();edge=event.clientX<bounds.left+28?-8:event.clientX>bounds.right-28?8:0
  if(edge&&!frame)frame=requestAnimationFrame(tick);else if(!edge)stopEdgeScroll()
}
function selectedButton(){return element.value?.querySelector<HTMLButtonElement>('.workspace-tab-item:not(.workspace-tab-motion-leave-active) [role=tab][aria-selected=true]')}
function focusSelected(){selectedButton()?.focus({preventScroll:true});selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})}
watch(()=>[props.count,props.pinnedCount,props.activeKey] as const,([count,pinned,active],[previousCount,previousPinned,previousActive])=>{
  // Count and active key often change together; process them atomically so a
  // selection update cannot cancel the new tabs' pending width allocation.
  if(count!==previousCount||pinned!==previousPinned){
    structuralAllocation=true
    if(count>previousCount)releaseWidths()
    void nextTick(scheduleAllocation)
  }else if(active!==previousActive)structuralAllocation=false
  if(active!==previousActive)void nextTick(()=>selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'}))
})
function escape(event:KeyboardEvent){if(event.key==='Escape')stopEdgeScroll()}
onMounted(()=>{
  window.addEventListener('blur',stopEdgeScroll);window.addEventListener('keydown',escape,true)
  observer=new ResizeObserver(()=>{
    const width=element.value?.getBoundingClientRect().width||0
    // New tabs can settle before their host and teleported tools finish layout.
    // Follow those width changes for structural edits. Selecting an existing
    // tab still keeps its slots stable when only the adjacent tools change.
    if(width>0&&(structuralAllocation||slotWidth.value===undefined||stripWidth===0))scheduleAllocation()
    stripWidth=width;scheduleMeasure()
  })
  hostObserver=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width??0;if(Math.abs(width-hostWidth)>.1){hostWidth=width;scheduleAllocation()}})
  if(element.value){observer.observe(element.value);const list=element.value.firstElementChild;if(list)observer.observe(list);const host=element.value.parentElement;if(host)hostObserver.observe(host)}
  scheduleAllocation();measure()
})
onBeforeUnmount(()=>{window.removeEventListener('blur',stopEdgeScroll);window.removeEventListener('keydown',escape,true);observer?.disconnect();hostObserver?.disconnect();cancelAnimationFrame(measureFrame);cancelAnimationFrame(allocationFrame);releaseWidths();stopEdgeScroll()})
defineExpose({element,overflowing,focusSelected,freezeForClose,releaseWidths})
</script>
<style>
.browser-tab-strip{--workspace-tab-motion-duration:220ms;--workspace-tab-motion-easing:cubic-bezier(.2,.7,.2,1);display:flex;flex:0 1 auto;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain;transition:width var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing);-webkit-app-region:no-drag}
.browser-tab-strip::-webkit-scrollbar{display:none;width:0;height:0}
.browser-tab-strip-list{position:relative;display:flex;align-items:center;gap:var(--workspace-tab-gap,4px);width:100%;min-width:0}
.browser-tab-strip .workspace-tab-item:not(.is-pinned){flex:0 0 var(--workspace-tab-slot-width,var(--workspace-tab-ideal-width,220px));min-width:var(--workspace-tab-min-width,112px);max-width:var(--workspace-tab-max-width,260px)}
.browser-tab-strip .workspace-tab-item.is-pinned{flex:0 0 36px;min-width:36px;max-width:36px}
.browser-tab-strip .workspace-tab-item{transition:flex-basis var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),min-width var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),max-width var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),margin-inline-end var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),transform var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),opacity 160ms ease,border-inline-width var(--workspace-tab-motion-duration) var(--workspace-tab-motion-easing),background-color 120ms ease,border-color 120ms ease,color 120ms ease}
.browser-tab-strip.tab-widths-frozen .workspace-tab-item{flex:0 0 var(--browser-tab-frozen-width,220px);max-width:var(--browser-tab-frozen-width,260px)}
.browser-tab-strip.tab-widths-frozen .workspace-tab-item:not(.workspace-tab-motion-leave-active){transition-property:transform,opacity,background-color,border-color,color}
.browser-tab-strip .workspace-tab-item.workspace-tab-motion-enter-from,.browser-tab-strip .workspace-tab-item.workspace-tab-motion-leave-to{flex-basis:0;min-width:0;max-width:0;margin-inline-end:calc(-1 * var(--workspace-tab-gap,4px));border-inline-width:0;opacity:0}
.browser-tab-strip .workspace-tab-motion-leave-active{pointer-events:none}
@media(prefers-reduced-motion:reduce){.browser-tab-strip,.browser-tab-strip .workspace-tab-item{transition:none!important}}
</style>
