<template>
  <Teleport to="body"><div ref="area" v-show="docked&&(modelValue||retaining)" class="browser-content-dock" :style="dockStyle" /></Teleport>
  <v-dialog :key="presentation" ref="dialog" v-bind="$attrs" :model-value="shown" :attach="docked&&area?area:undefined" :contained="docked" @update:model-value="events.updateModel" @after-enter="events.afterEnter" @after-leave="events.afterLeave"><slot /></v-dialog>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,shallowRef,useAttrs,watch} from 'vue'
import {browserViewports,browserDockFits,browserDockReady,reserveBrowserDock} from '@/composables/useBrowserSurfaceLayout'
import {createBrowserDialogLifecycle} from '@shared/browser-dialog-lifecycle'

defineOptions({inheritAttrs:false})
const props=defineProps<{modelValue:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:boolean];'after-enter':[];'after-leave':[]}>()
const attrs=useAttrs(),lifecycle=createBrowserDialogLifecycle()
const key=`content-${crypto.randomUUID()}`,area=ref<HTMLElement>(),dialog=ref<{contentEl?:HTMLElement}>(),box=ref({left:8,top:48,width:480,height:600}),retaining=ref(false),presentation=ref(0)
const docked=computed(()=>browserViewports.value.length>0&&(props.modelValue||retaining.value))
const ready=computed(()=>!!area.value&&box.value.width>=180&&browserDockReady.value)
const shown=computed(()=>props.modelValue&&(!docked.value||ready.value))
const dockStyle=computed(()=>({left:`${box.value.left}px`,top:`${box.value.top}px`,width:`${box.value.width}px`,height:`${box.value.height}px`}))
const events=shallowRef({afterEnter:()=>{},afterLeave:()=>{},updateModel:(_value:boolean)=>{}})
let timer:ReturnType<typeof setInterval>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined,disposed=false,notified=false
function finish(token:number){
  if(disposed||!lifecycle.afterLeave(token))return
  retaining.value=false;reserveBrowserDock(key,null);emit('after-leave')
}
function bindPresentation(){
  const token=lifecycle.current();presentation.value=token
  events.value={afterEnter:()=>{if(!disposed&&lifecycle.afterEnter(token))emit('after-enter')},afterLeave:()=>finish(token),updateModel:value=>{if(!disposed&&token===lifecycle.current())updateModel(value)}}
}
function updateModel(value:boolean){
  // A temporary hide while waiting for native geometry is not a user cancellation.
  if(!value&&!shown.value&&props.modelValue)return
  emit('update:modelValue',value)
}
function layout(){
  if(!docked.value){reserveBrowserDock(key,null);return}
  const main=[...document.querySelectorAll<HTMLElement>('.main,.browser-host-page')].find(element=>element.checkVisibility())?.getBoundingClientRect()
  const left=Math.max(8,(main?.left||0)+8),top=Math.max(8,(main?.top||40)+8),available=Math.max(0,Math.min(innerWidth,main?.right||innerWidth)-left-8)
  const viewLeft=Math.min(...browserViewports.value.map(rect=>rect.left)),safe=viewLeft-left-8
  const preferred=safe>=320?Math.min(620,safe):Math.max(180,Math.min(560,available*.52))
  box.value={left,top,width:Math.min(available,preferred),height:Math.max(0,innerHeight-top-8)}
  reserveBrowserDock(key,left+box.value.width+8)
}
watch(()=>props.modelValue,open=>{
  lifecycle.setOpen(open)
  if(open){retaining.value=true;notified=false;bindPresentation()}
  layout()
  if(!open){
    clearTimeout(noticeTimer)
    const token=lifecycle.current()
    // A panel canceled while layout was deferred may never mount a transition.
    void nextTick(()=>{if(!disposed&&!props.modelValue&&!dialog.value?.contentEl?.isConnected)finish(token)})
  }
},{immediate:true,flush:'sync'})
watch(docked,()=>{if(props.modelValue){lifecycle.changePresentation();bindPresentation()}layout()},{flush:'sync'})
watch(browserViewports,layout)
watch([shown,browserDockFits],()=>{
  clearTimeout(noticeTimer)
  if(!props.modelValue||!docked.value||ready.value||notified)return
  noticeTimer=setTimeout(()=>{
    if(disposed||!props.modelValue||ready.value)return
    notified=true
    const message=!browserDockFits.value||box.value.width<180?'窗口空间不足，请加宽窗口后打开面板。':'正在调整网页显示区域，当前操作结束后将打开面板。'
    window.dispatchEvent(new CustomEvent('navora:ui-notice',{detail:{message}}))
  },350)
},{immediate:true})
function keydown(event:KeyboardEvent){if(event.key==='Escape'&&props.modelValue&&docked.value&&!ready.value&&!attrs.persistent){event.preventDefault();event.stopPropagation();emit('update:modelValue',false)}}
onMounted(()=>{layout();window.addEventListener('resize',layout);window.addEventListener('keydown',keydown,true);timer=setInterval(()=>{if(props.modelValue||retaining.value)layout()},150)})
onBeforeUnmount(()=>{disposed=true;clearInterval(timer);clearTimeout(noticeTimer);window.removeEventListener('resize',layout);window.removeEventListener('keydown',keydown,true);reserveBrowserDock(key,null)})
</script>
<style>
.browser-content-dock{position:fixed;z-index:2400;pointer-events:none;contain:layout}.browser-content-dock>.v-overlay-container{position:absolute;inset:0}.browser-content-dock .v-overlay{position:absolute!important}.browser-content-dock .v-overlay__content{max-width:calc(100% - 16px)!important;max-height:calc(100% - 16px)!important;margin:8px!important}
</style>
