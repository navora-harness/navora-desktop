<template>
  <div ref="element" class="browser-tab-strip" :class="{'tab-widths-frozen':frozen}" role="tablist" :aria-label="ariaLabel" aria-multiselectable="true" :style="{...WORKSPACE_TAB_CSS_VARIABLES,width:`${idealWidth}px`}" @wheel="wheel" @pointerleave="releaseWidths" @dragstart="releaseWidths" @dragover="dragOver" @dragleave="stopEdgeScroll" @drop="stopEdgeScroll">
    <div class="browser-tab-strip-list"><slot /></div>
  </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onBeforeUpdate,onUpdated,onMounted,ref,watch} from 'vue'
import {workspaceTabStripWidth,WORKSPACE_TAB_CSS_VARIABLES} from '@shared/workspace-tab-geometry'
import {refreshTabDrop} from '@/composables/tabDragFeedback'
const props=withDefaults(defineProps<{count:number;pinnedCount?:number;activeKey?:string;ariaLabel?:string}>(),{pinnedCount:0,ariaLabel:'浏览器标签'})
const element=ref<HTMLElement|null>(null),frozen=ref(false),overflowing=ref(false)
const idealWidth=computed(()=>workspaceTabStripWidth(props.count,props.pinnedCount))
let releaseTimer:ReturnType<typeof setTimeout>|undefined,frame=0,measureFrame=0,edge=0,observer:ResizeObserver|undefined
let previous:{id:string;left:number}[]=[],animations:Animation[]=[]
const rows=()=>[...element.value?.querySelectorAll<HTMLElement>('.workspace-tab-item')||[]]
const rowId=(node:HTMLElement)=>{const tab=node.querySelector<HTMLElement>('[role=tab]');return tab?.dataset.fileKey||tab?.dataset.pageId||''}
onBeforeUpdate(()=>{previous=rows().map(node=>({id:rowId(node),left:node.getBoundingClientRect().left}));animations.forEach(animation=>animation.cancel());animations=[]})
onUpdated(()=>{const current=rows(),ids=current.map(rowId);if(previous.length!==ids.length||previous.some(item=>!ids.includes(item.id))||previous.every((item,index)=>item.id===ids[index])||matchMedia('(prefers-reduced-motion:reduce)').matches)return;for(const node of current){const before=previous.find(item=>item.id===rowId(node));if(!before)continue;const delta=before.left-node.getBoundingClientRect().left;if(Math.abs(delta)>.5)animations.push(node.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:150,easing:'cubic-bezier(.2,.7,.2,1)'}))}})
function measure(){measureFrame=0;const node=element.value,next=!!node&&node.scrollWidth>node.clientWidth+1;if(overflowing.value!==next)overflowing.value=next}
// Visibility of the overflow action must never mutate layout in a ResizeObserver delivery.
function scheduleMeasure(){if(!measureFrame)measureFrame=requestAnimationFrame(measure)}
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
function selectedButton(){return element.value?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')}
function focusSelected(){selectedButton()?.focus({preventScroll:true});selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})}
watch(()=>props.activeKey,()=>void nextTick(()=>selectedButton()?.scrollIntoView({block:'nearest',inline:'nearest'})))
watch(()=>props.count,(count,previous)=>{if(count>previous)releaseWidths();void nextTick(measure)})
watch(()=>props.pinnedCount,()=>void nextTick(measure))
function escape(event:KeyboardEvent){if(event.key==='Escape')stopEdgeScroll()}
onMounted(()=>{window.addEventListener('blur',stopEdgeScroll);window.addEventListener('keydown',escape,true);observer=new ResizeObserver(scheduleMeasure);if(element.value){observer.observe(element.value);const list=element.value.firstElementChild;if(list)observer.observe(list)}measure()})
onBeforeUnmount(()=>{window.removeEventListener('blur',stopEdgeScroll);window.removeEventListener('keydown',escape,true);observer?.disconnect();cancelAnimationFrame(measureFrame);releaseWidths();stopEdgeScroll();animations.forEach(animation=>animation.cancel())})
defineExpose({element,overflowing,focusSelected,freezeForClose,releaseWidths})
</script>
<style>
.browser-tab-strip{display:flex;flex:0 1 auto;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-app-region:no-drag}
.browser-tab-strip::-webkit-scrollbar{display:none;width:0;height:0}
.browser-tab-strip-list{position:relative;display:flex;align-items:center;gap:var(--workspace-tab-gap,4px);width:100%;min-width:0}
.browser-tab-strip .workspace-tab-item:not(.is-pinned){flex:0 1 var(--workspace-tab-ideal-width,220px);min-width:var(--workspace-tab-min-width,112px);max-width:var(--workspace-tab-max-width,260px)}
.browser-tab-strip .workspace-tab-item.is-pinned{flex:0 0 36px;min-width:36px;max-width:36px}
.browser-tab-strip.tab-widths-frozen .workspace-tab-item{flex:0 0 var(--browser-tab-frozen-width,220px);max-width:var(--browser-tab-frozen-width,260px)}
</style>
