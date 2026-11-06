<template>
  <BrowserContentDialog v-if="initialized&&!available" v-bind="$attrs" :model-value="modelValue&&active" @update:model-value="emit('update:modelValue',$event)" @after-enter="emit('after-enter')" @after-leave="emit('after-leave')"><slot /></BrowserContentDialog>
</template>
<script setup lang="ts">
import {computed,onActivated,onBeforeUnmount,onDeactivated,onMounted,ref,watch} from 'vue'
import BrowserContentDialog from './BrowserContentDialog.vue'
import type {NativePanelAction,NativePanelContent,NativePanelRole} from '@shared/native-ui'
import {fitNativeDialogContent,nativeDialogMetrics} from '@shared/native-dialog-panels'
import {useNativePanel} from '@/composables/useNativeUi'
import {searchPanelLayout} from '@/utils/search-panel-layout'
defineOptions({inheritAttrs:false})
// Non-modal app surfaces only. NativePanel does not block its owner like v-dialog.
const props=withDefaults(defineProps<{modelValue:boolean;content:NativePanelContent;initialContent?:NativePanelContent;contextKey:string;title:string;focusMode?:'menu'|'input';role?:NativePanelRole;position?:'center'|'top';focusRequest?:number;requireItems?:boolean;active?:boolean;ownerElement?:HTMLElement}>(),{focusMode:'menu',position:'center',focusRequest:0,requireItems:true,active:true})
const emit=defineEmits<{'update:modelValue':[open:boolean];action:[action:NativePanelAction];error:[message:string];'after-enter':[];'after-leave':[]}>()
const initialized=ref(false)
const suspended=ref(false)
const fullscreen=ref(false)
let offFullscreen:(()=>void)|undefined
let generation=0,displayedContext='',state:'closed'|'opening'|'shown'='closed',disposed=false,layoutKey='',ownerTimer:ReturnType<typeof setInterval>|undefined
const ownerVisible=()=>!props.ownerElement||props.ownerElement.isConnected&&props.ownerElement.checkVisibility()&&!props.ownerElement.closest('[inert]')
const native=useNativePanel({key:`dialog-${crypto.randomUUID()}`,contextKey:()=>props.contextKey,onAction:action=>{if(state==='shown'&&props.modelValue&&props.active&&ownerVisible()&&displayedContext===props.contextKey)emit('action',action)},onDismissed:closed,onClosed:closed})
const available=computed(()=>native.supported.value&&(!props.requireItems||native.itemsSupported.value))
function layout(content=props.content){
  const chrome=nativeDialogMetrics(props.role)
  if(props.position==='top'&&props.role==='search'&&!props.ownerElement){
    // searchPanelLayout includes 24 DIP of native chrome in its titlebar clearance.
    const frame=searchPanelLayout(content.width||480,fullscreen.value),fitted=fitNativeDialogContent(content,{width:Math.max(1,Math.min(frame.width-(chrome.width-24),innerWidth-chrome.width-16)),maxHeight:innerHeight-frame.anchor.y-chrome.height-9})
    return {...fitted,anchor:frame.anchor}
  }
  const owner=props.ownerElement?.getBoundingClientRect(),left=Math.max(8,owner?.left??8),right=Math.min(innerWidth-8,owner?.right??innerWidth-8),top=Math.max(8,owner?.top??8),bottom=Math.min(innerHeight-8,owner?.bottom??innerHeight-8),width=Math.max(1,Math.min(content.width||480,right-left-chrome.width)),start=props.position==='top'?Math.max(top,Math.min((owner?.top??48)+8,bottom-chrome.height)):top
  const fitted=fitNativeDialogContent(content,{width,maxHeight:bottom-start-chrome.height}),x=Math.max(8,Math.min(left+(right-left-width-chrome.width)/2,innerWidth-width-chrome.width-8)),y=props.position==='top'?start:Math.max(top,top+(bottom-top-fitted.height-chrome.height)/2)
  return {...fitted,anchor:{x,y,width:1,height:1}}
}
const frameKey=(frame:ReturnType<typeof layout>)=>JSON.stringify([frame.anchor,frame.content.width,frame.height])
function closed(){if(state==='closed')return;state='closed';generation++;if(props.modelValue)emit('update:modelValue',false);emit('after-leave')}
async function synchronize(){
  const ticket=++generation
  if(!props.modelValue||!props.active||suspended.value||!ownerVisible()){const wasShown=state!=='closed';state='closed';if(props.modelValue)emit('update:modelValue',false);await native.hide();if(!disposed&&ticket===generation&&wasShown)emit('after-leave');return}
  if(!initialized.value||!available.value)return
  displayedContext=props.contextKey;state='opening'
  let shown=false
  try{const frame=layout(props.initialContent||props.content),metrics=nativeDialogMetrics(props.role),settings={placement:'bottom-start' as const,focusMode:props.focusMode,role:props.role||(props.focusMode==='input'?'editor':'transient'),radius:metrics.radius,contentInset:metrics.contentInset,scrollbarPlacement:'gutter' as const};shown=props.focusMode==='input'?await native.showFocused(frame.content,frame.anchor,settings):await native.show(frame.content,frame.anchor,settings);layoutKey=frameKey(layout())}catch{/* Failure is reported without hiding the live page behind a DOM fallback. */}
  if(disposed||ticket!==generation)return
  if(!shown){state='closed';emit('error',`${props.title}暂时无法打开，请重试。`);emit('update:modelValue',false);emit('after-leave');return}
  state='shown'
  // ready() may have yielded before useNativePanel assigned its initial tree.
  // Reconcile once with the newest presentation, without resending input values.
  const latest=layout();layoutKey=frameKey(latest);void native.update(latest.content,latest.anchor,true)
  emit('after-enter')
}
watch(()=>[props.modelValue,props.contextKey,props.active,props.focusRequest,props.focusMode,props.role,props.position,initialized.value,suspended.value],()=>void synchronize(),{immediate:true})
// Changes during show must reach the composable's pending tree too (e.g. a fast index load).
watch(()=>props.content,content=>{if(state!=='closed'&&props.modelValue&&props.active&&!suspended.value&&displayedContext===props.contextKey){const frame=layout(content);layoutKey=frameKey(frame);void native.update(frame.content,frame.anchor,true)}},{deep:true})
watch([native.open,native.pending],([open,pending])=>{if(state==='shown'&&!open&&!pending)closed()})
function resize(){if(state==='shown'){const frame=layout(),key=frameKey(frame);if(key!==layoutKey){layoutKey=key;void native.update(frame.content,frame.anchor,true)}}}
function deactivate(){generation++;state='closed';if(props.modelValue)emit('update:modelValue',false);void native.hide()}
onDeactivated(()=>{suspended.value=true;deactivate()})
onActivated(()=>{suspended.value=false})
onMounted(()=>{void native.ready().then(()=>{if(!disposed)initialized.value=true});window.addEventListener('resize',resize);ownerTimer=setInterval(()=>{if(state!=='closed'&&!ownerVisible())deactivate();else resize()},150);if(props.position!=='top'||props.role!=='search')return;let received=false;offFullscreen=window.navora?.app.onFullscreen?.(value=>{received=true;fullscreen.value=value;requestAnimationFrame(resize)});void window.navora?.app.isFullscreen?.().then(value=>{if(!received&&!disposed){fullscreen.value=value.fullscreen;resize()}}).catch(()=>{})})
onBeforeUnmount(()=>{disposed=true;state='closed';generation++;if(props.modelValue)emit('update:modelValue',false);clearInterval(ownerTimer);window.removeEventListener('resize',resize);offFullscreen?.()})
defineExpose({nativeAvailable:available})
</script>
