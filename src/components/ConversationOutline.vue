<template>
  <nav v-if="items.length" class="conversation-outline" :class="{'is-narrow':paneWidth<480,'is-dragging':dragging}" aria-label="对话滚动导航">
    <div
      ref="outlineTrack"
      class="outline-track"
      role="scrollbar"
      tabindex="0"
      aria-label="对话位置"
      aria-orientation="vertical"
      :aria-controls="controlledId"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="Math.round(scrollProgress*100)"
      :aria-valuetext="`第 ${activeIndex+1} / ${items.length} 轮：${items[activeIndex]?.text||''}`"
      :aria-describedby="preview ? tooltipId : undefined"
      :style="{height:trackHeight+'px'}"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="cancelSeek"
      @lostpointercapture="cancelSeek"
      @keydown="onKeydown"
      @focus="showActivePreview"
      @blur="onTrackBlur"
    >
      <i v-for="marker in markers" :key="marker.key" class="outline-tick" :data-message-id="marker.key" :data-visibility="visibleFractions[marker.key]||0" :style="markerStyle(marker)" aria-hidden="true" />
    </div>
    <Teleport to="body">
      <Transition name="outline-preview">
        <div v-if="preview" :id="tooltipId" class="outline-preview" role="tooltip" :style="preview.style">
          <div class="outline-preview-meta">第 {{ preview.index+1 }} / {{ items.length }} 轮</div>
          <div class="outline-preview-question">{{ items[preview.index]?.text }}</div>
          <div class="outline-preview-answer">{{ items[preview.index]?.answer || '尚无回答' }}</div>
        </div>
      </Transition>
    </Teleport>
  </nav>
</template>

<script setup lang="ts">
import {computed,nextTick,onUnmounted,ref,useId,watch} from 'vue'
import type {ChatMessage} from '@shared/types'

const props=defineProps<{messages:ChatMessage[];scrollContainer:HTMLElement|null}>()
const emit=defineEmits<{jump:[messageId:string];navigate:[]}>()
type OutlineItem={id:string;text:string;answer:string;hasFinal:boolean}
type Marker={key:string;position:number}

// Previews are bounded plain text. They never render Markdown, links, or media.
function previewText(value:string,limit:number){
  return value.slice(0,6000).replace(/```[\s\S]*?```/g,' [代码] ').replace(/!\[[^\]]*\]\([^)]*\)/g,' [图片] ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,' ').replace(/(^|\n)\s{0,3}(?:#{1,6}|>|[-*+])\s+/g,' ')
    .replace(/[`*_~]/g,'').replace(/\s+/g,' ').trim().slice(0,limit)
}
const items=computed(()=>{
  const result:OutlineItem[]=[]
  for(const message of props.messages){
    if(message.role==='user')result.push({id:message.id,text:previewText(message.content,260)||'附带资源的提问',answer:'',hasFinal:false})
    else if(message.role==='assistant'&&result.length){
      const item=result[result.length-1]!,text=previewText(message.content,300)
      if(!text)continue
      if(message.meta?.phase==='final'){item.answer=text;item.hasFinal=true}
      else if(!item.hasFinal)item.answer=text
    }
  }
  return result
})
const uid=useId(),tooltipId=`outline-tip-${uid}`,generatedContainerId=`outline-scroll-${uid}`
const outlineTrack=ref<HTMLElement|null>(null),controlledId=ref(''),viewportHeight=ref(600),paneWidth=ref(800),scrollProgress=ref(0)
const activeIndex=ref(0),hoverFraction=ref<number|null>(null),dragging=ref(false),visibleFractions=ref<Record<string,number>>({})
const markers=computed<Marker[]>(()=>items.value.map((item,index)=>({key:item.id,position:items.value.length>1?index/(items.value.length-1):.5})))
const trackHeight=computed(()=>Math.max(48,Math.min(viewportHeight.value-40,(items.value.length-1)*15)))
const preview=ref<{index:number;style:Record<string,string>}|null>(null)
let frame=0,pointerFrame=0,previewTimer:ReturnType<typeof setTimeout>|undefined
let detach=()=>{},seek:{pointerId:number;startY:number;moved:boolean}|null=null,pendingPointer:{y:number;seek:boolean}|null=null

function maximumScroll(){const container=props.scrollContainer;return container?Math.max(0,container.scrollHeight-container.clientHeight):0}
function turnAtOffset(top:number){
  const container=props.scrollContainer
  if(!container||!items.value.length)return 0
  const boundary=container.getBoundingClientRect().top+container.clientTop+top-container.scrollTop
  let low=0,high=items.value.length-1,current=0
  // Only a logarithmic number of message positions is read during scrolling.
  while(low<=high){
    const middle=(low+high)>>>1,element=container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(items.value[middle]!.id)}"]`)
    if(element&&element.getBoundingClientRect().top<=boundary){current=middle;low=middle+1}else high=middle-1
  }
  return current
}
function updatePosition(){
  frame=0
  const container=props.scrollContainer
  if(!container)return
  viewportHeight.value=container.clientHeight;paneWidth.value=container.clientWidth
  const maximum=maximumScroll()
  scrollProgress.value=maximum?Math.min(1,Math.max(0,container.scrollTop/maximum)):0
  activeIndex.value=maximum-container.scrollTop<6?Math.max(0,items.value.length-1):turnAtOffset(container.scrollTop)
  updateVisibleFractions()
}
function schedulePosition(){if(!frame)frame=requestAnimationFrame(updatePosition)}
function updateVisibleFractions(){
  const container=props.scrollContainer,fractions:Record<string,number>={}
  if(container&&items.value.length){
    const viewportTop=container.getBoundingClientRect().top+container.clientTop,viewportBottom=viewportTop+container.clientHeight
    // Read only the visible turns and their boundaries, preserving skipped offscreen content.
    for(let index=turnAtOffset(container.scrollTop);index<items.value.length;index++){
      const item=items.value[index]!,element=container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(item.id)}"]`)
      if(!element)continue
      const top=element.getBoundingClientRect().top
      if(top>=viewportBottom)break
      const next=items.value[index+1],nextElement=next?container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(next.id)}"]`):null
      const bottom=nextElement?nextElement.getBoundingClientRect().top:viewportTop+container.scrollHeight-container.scrollTop
      const visible=Math.max(0,Math.min(bottom,viewportBottom)-Math.max(top,viewportTop))
      if(visible>0)fractions[item.id]=Math.min(1,visible/Math.max(1,bottom-top))
    }
  }
  visibleFractions.value=fractions
}
function scheduleLayout(){schedulePosition()}
function onScroll(){schedulePosition();if(!seek)hidePreview()}
function onResize(){hidePreview();scheduleLayout()}
window.addEventListener('resize',onResize)
watch(()=>props.scrollContainer,container=>{
  detach();cancelSeek();hidePreview();visibleFractions.value={}
  if(!container){controlledId.value='';return}
  const assignedId=!container.id
  if(assignedId)container.id=generatedContainerId
  controlledId.value=container.id
  container.addEventListener('scroll',onScroll,{passive:true})
  container.addEventListener('load',scheduleLayout,true)
  container.addEventListener('contentvisibilityautostatechange',scheduleLayout,true)
  const resize=new ResizeObserver(scheduleLayout),content=new MutationObserver(scheduleLayout)
  resize.observe(container)
  if(container.firstElementChild)resize.observe(container.firstElementChild)
  content.observe(container,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open']})
  detach=()=>{container.removeEventListener('scroll',onScroll);container.removeEventListener('load',scheduleLayout,true);container.removeEventListener('contentvisibilityautostatechange',scheduleLayout,true);resize.disconnect();content.disconnect();if(assignedId&&container.id===generatedContainerId)container.removeAttribute('id')}
  void nextTick(schedulePosition)
},{immediate:true,flush:'post'})
watch(()=>items.value.map(item=>item.id).join(','),()=>{hidePreview();activeIndex.value=0;void nextTick(scheduleLayout)})

function markerStyle(marker:Marker){
  const {position}=marker
  const distance=hoverFraction.value===null?Infinity:Math.abs(position-hoverFraction.value)*trackHeight.value
  const proximity=Math.exp(-(distance*distance)/(2*25*25))
  // Keep the first and last tick centers inside the track's pointer hit region.
  return{top:`calc(${position*100}% + ${1-position*2}px)`,width:9+proximity*21+'px',opacity:String(.26+(visibleFractions.value[marker.key]||0)*.74)}
}
function turnAtFraction(fraction:number){return Math.round(fraction*Math.max(0,items.value.length-1))}
function fractionAt(y:number){const bounds=outlineTrack.value?.getBoundingClientRect();return bounds?Math.max(0,Math.min(1,(y-bounds.top-1)/Math.max(1,bounds.height-2))):0}
function showPreview(index:number,y:number,immediate=false){
  clearTimeout(previewTimer)
  const show=()=>{
    const track=outlineTrack.value
    if(!track||!items.value[index])return
    const width=Math.min(330,innerWidth-64),bounds=track.getBoundingClientRect()
    preview.value={index,style:{width:`${width}px`,left:`${Math.max(12,bounds.left-width-14)}px`,top:`${Math.max(12,Math.min(innerHeight-210,y-44))}px`}}
  }
  if(immediate||preview.value)show();else previewTimer=setTimeout(show,90)
}
function hidePreview(){clearTimeout(previewTimer);preview.value=null}
function showActivePreview(){const bounds=outlineTrack.value?.getBoundingClientRect(),marker=markers.value[activeIndex.value];if(bounds&&marker)showPreview(activeIndex.value,bounds.top+marker.position*bounds.height,true)}
function applyPointer(){
  pointerFrame=0
  const pending=pendingPointer;pendingPointer=null
  if(!pending)return
  const fraction=fractionAt(pending.y),top=fraction*maximumScroll()
  hoverFraction.value=fraction
  if(pending.seek&&props.scrollContainer)props.scrollContainer.scrollTo({top,behavior:'instant'})
  showPreview(pending.seek?turnAtOffset(top):turnAtFraction(fraction),pending.y,!!seek)
}
function onPointerMove(event:PointerEvent){
  if(event.pointerType==='touch'&&!seek)return
  if(seek&&event.pointerId!==seek.pointerId)return
  if(seek&&Math.abs(event.clientY-seek.startY)>3){seek.moved=true;dragging.value=true}
  pendingPointer={y:event.clientY,seek:!!seek?.moved}
  if(!pointerFrame)pointerFrame=requestAnimationFrame(applyPointer)
}
function onPointerLeave(){if(!seek){cancelAnimationFrame(pointerFrame);pointerFrame=0;pendingPointer=null;hoverFraction.value=null;hidePreview()}}
function onTrackBlur(){hidePreview();if(!outlineTrack.value?.matches(':hover'))hoverFraction.value=null}
function onPointerDown(event:PointerEvent){
  if(event.button!==0||!props.scrollContainer)return
  event.preventDefault();emit('navigate');outlineTrack.value?.focus({preventScroll:true})
  seek={pointerId:event.pointerId,startY:event.clientY,moved:false}
  outlineTrack.value?.setPointerCapture(event.pointerId)
  onPointerMove(event)
}
function onPointerUp(event:PointerEvent){
  if(!seek||event.pointerId!==seek.pointerId)return
  const moved=seek.moved
  cancelAnimationFrame(pointerFrame);pointerFrame=0;pendingPointer=null
  if(moved&&props.scrollContainer)props.scrollContainer.scrollTo({top:fractionAt(event.clientY)*maximumScroll(),behavior:'instant'})
  else jump(turnAtFraction(fractionAt(event.clientY)))
  cancelSeek()
}
function cancelSeek(){
  const pointerId=seek?.pointerId;seek=null;dragging.value=false;pendingPointer=null
  cancelAnimationFrame(pointerFrame);pointerFrame=0
  if(pointerId!==undefined&&outlineTrack.value?.hasPointerCapture(pointerId))outlineTrack.value.releasePointerCapture(pointerId)
  if(!outlineTrack.value?.matches(':hover')){hoverFraction.value=null;hidePreview()}
}
function jump(index:number){const item=items.value[index];if(!item)return;hidePreview();activeIndex.value=index;emit('navigate');emit('jump',item.id)}
function onKeydown(event:KeyboardEvent){
  if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Enter',' ','Escape'].includes(event.key)||event.isComposing)return
  event.preventDefault();event.stopPropagation()
  if(event.key==='Escape'){hoverFraction.value=null;hidePreview();return}
  if(event.key==='Enter'||event.key===' '){jump(preview.value?.index??activeIndex.value);return}
  if((event.key==='ArrowUp'||event.key==='ArrowDown')&&items.value.length>1){jump(Math.max(0,Math.min(items.value.length-1,activeIndex.value+(event.key==='ArrowDown'?1:-1))));return}
  const container=props.scrollContainer;if(!container)return
  emit('navigate');hidePreview()
  const top=event.key==='Home'?0:event.key==='End'?maximumScroll():event.key==='ArrowUp'||event.key==='ArrowDown'?container.scrollTop+(event.key==='ArrowDown'?48:-48):container.scrollTop+(event.key==='PageDown'?1:-1)*container.clientHeight*.8
  container.scrollTo({top,behavior:'instant'})
}
onUnmounted(()=>{clearTimeout(previewTimer);cancelSeek();detach();cancelAnimationFrame(frame);window.removeEventListener('resize',onResize)})
</script>

<style scoped>
.conversation-outline{--outline-tick-ink:#34373b;position:absolute;right:5px;top:12px;bottom:12px;width:44px;display:flex;align-items:center;justify-content:flex-end;z-index:3;pointer-events:none;color:var(--outline-tick-ink)}
:global(:root[data-navora-color-scheme=dark] .conversation-outline){--outline-tick-ink:#e3e5e8}
.outline-track{position:relative;width:42px;max-height:calc(100% - 16px);min-height:48px;margin:8px 0;outline:0;pointer-events:auto;touch-action:none;cursor:pointer;user-select:none;-webkit-user-select:none}
.outline-tick{position:absolute;right:8px;display:block;height:2px;border-radius:999px;transform:translateY(-50%);pointer-events:none}
.outline-tick{background:var(--outline-tick-ink);transition:width 160ms cubic-bezier(.2,.75,.2,1),opacity 140ms ease}
.outline-track:focus-visible{outline:1px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:-2px;border-radius:6px}
.is-dragging .outline-track{cursor:grabbing}.is-narrow{right:2px;width:30px}.is-narrow .outline-track{width:28px}.is-narrow .outline-tick{right:5px}
.outline-preview{position:fixed;z-index:2400;max-height:192px;box-sizing:border-box;overflow:hidden;padding:13px 15px;border:1px solid var(--appearance-stroke,var(--navora-stroke,#e2e4e7));border-radius:12px;background:var(--appearance-surface,var(--navora-surface,#fff));color:var(--appearance-ink,var(--navora-ink,#30343a));box-shadow:0 5px 22px #00000013;font:12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;pointer-events:none}
.outline-preview-meta{margin-bottom:5px;font-size:10px;color:var(--appearance-muted,var(--navora-muted,#7c828a));font-variant-numeric:tabular-nums}
.outline-preview-question,.outline-preview-answer{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;white-space:normal}
.outline-preview-question{-webkit-line-clamp:2;font-size:13px;font-weight:600;line-height:1.55}
.outline-preview-answer{-webkit-line-clamp:3;margin-top:7px;color:var(--appearance-muted,var(--navora-muted,#72777f));line-height:1.65}
.outline-preview-enter-active,.outline-preview-leave-active{transition:opacity 120ms ease,transform 140ms cubic-bezier(.2,.75,.2,1)}
.outline-preview-enter-from,.outline-preview-leave-to{opacity:0;transform:translateX(4px)}
@media(prefers-reduced-motion:reduce){.outline-tick,.outline-preview-enter-active,.outline-preview-leave-active{transition:none}.outline-preview-enter-from,.outline-preview-leave-to{transform:none}}
</style>
