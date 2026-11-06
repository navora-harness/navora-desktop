<template><!-- Comment input is hosted exclusively by NativePanel. --></template>
<script setup lang="ts">
import {computed,nextTick,onActivated,onBeforeUnmount,onDeactivated,onMounted,ref,watch} from 'vue'
import {annotationEditorPlacement,type AnnotationBox} from '@shared/browser-annotation-position'
import {ANNOTATION_DRAFT_LIMIT} from '@shared/browser-annotation-limits'
import {ANNOTATION_EDITOR_ID,ANNOTATION_EDITOR_FONT,annotationCommentProblem,annotationPanelLayout,browserAnnotationPanel} from '@shared/browser-annotation-panel'
import type {NativePanelAction} from '@shared/native-ui'
import {useNativePanel} from '@/composables/useNativeUi'

const props=withDefaults(defineProps<{modelValue:string;anchor:AnnotationBox;bounds:AnnotationBox;saved?:boolean;stale?:boolean;busy?:boolean;pending?:boolean;error?:string;sourcePageId?:string;contextKey?:string;active?:boolean}>(),{active:true})
const emit=defineEmits<{'update:modelValue':[text:string];save:[];keep:[settled?:(closed:boolean)=>void];discard:[];recover:[];unavailable:[message:string];error:[message:string]}>()
const identity=crypto.randomUUID(),draft=ref(props.modelValue),overflow=ref(false),localError=ref(''),fontRevision=ref(0)
let disposed=false,suspended=false,generation=0,state:'closed'|'opening'|'shown'='closed',submitted=false,closing=false,nativeLost=false,lastEmitted:string|undefined
let canvas:CanvasRenderingContext2D|null=null,resizeObserver:ResizeObserver|undefined,refreshFrame:number|undefined
const context=computed(()=>JSON.stringify([props.sourcePageId||'',props.contextKey||identity]))
const status=computed(()=>localError.value||props.error||annotationCommentProblem(draft.value)||(props.stale?'页面已变化，意见仍关联原位置。':''))
function measure(text:string){
  if(!canvas)canvas=document.createElement('canvas').getContext('2d')
  if(!canvas)throw Error('annotation_text_measure_unavailable')
  canvas.font=`${ANNOTATION_EDITOR_FONT.size}px "${ANNOTATION_EDITOR_FONT.family}"`
  return canvas.measureText(text).width
}
function lineHeight(){measure('');const metrics=canvas!.measureText('国Ag🙂');return Math.max(20,Math.ceil(metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent+6))}
const layout=computed(()=>{void fontRevision.value;return annotationPanelLayout({text:draft.value,bounds:props.bounds,measure,lineHeight:lineHeight(),status:status.value})})
const placement=computed(()=>annotationEditorPlacement(props.anchor,props.bounds,layout.value))
function anchor(){return{x:placement.value.x,y:placement.value.y-5,width:1,height:1}}
function content(includeValue=false){return browserAnnotationPanel({text:draft.value,layout:layout.value,includeValue,saved:props.saved,busy:props.busy||submitted,pending:props.pending,error:localError.value||props.error,stale:props.stale,overflow:overflow.value})}
const native=useNativePanel({key:'annotation-editor',role:'editor',sourcePageId:()=>props.sourcePageId,contextKey:()=>context.value,onAction:action,onDismissed:()=>close('keep',true),onClosed:()=>{nativeLost=true;close('keep')},onInputOverflow:details=>{
  if(details.controlId!==ANNOTATION_EDITOR_ID||state==='closed')return
  overflow.value=true;submitted=false
  localError.value='内容过长，当前输入尚未完整保留；请缩短后继续。'
  emit('error',localError.value)
  queueRefresh()
}})
function updateText(text:string){
  const previousError=localError.value
  draft.value=text
  if(text.length<=ANNOTATION_DRAFT_LIMIT){overflow.value=false;localError.value=''}
  else{overflow.value=true;localError.value=annotationCommentProblem(text)}
  if(!overflow.value&&text!==lastEmitted){lastEmitted=text;emit('update:modelValue',text)}
  if(previousError&&!localError.value&&props.error===previousError)emit('error','')
}
async function confirm(text?:string){
  if(state!=='shown'||!props.active||suspended||disposed||props.busy||submitted||overflow.value)return
  if(text!==undefined)updateText(text)
  if(overflow.value||!draft.value.trim()||annotationCommentProblem(draft.value)||props.error||localError.value)return
  submitted=true
  await nextTick()
  if(disposed||state!=='shown'||!props.active||suspended){submitted=false;return}
  emit('save')
  await nextTick()
  if(!props.busy)submitted=false
}
function action(event:NativePanelAction){
  if(state!=='shown'||!props.active||suspended||disposed)return
  if(event.id===ANNOTATION_EDITOR_ID&&typeof event.value==='string'){
    if(event.type==='change'){if(!props.busy&&!submitted)updateText(event.value)}
    else if(event.type==='submit')void confirm(event.value)
    return
  }
  if(event.type!=='click'||props.busy||submitted)return
  if(event.id==='annotation-save')void confirm()
  else if(event.id==='annotation-keep')close('keep')
  else if(event.id==='annotation-discard')emit('discard')
  else if(event.id==='annotation-recover'&&!overflow.value)emit('recover')
}
function close(kind:'keep',restoreOverflow=false){
  if(state==='closed'||closing||disposed)return
  if(overflow.value){
    emit('error',localError.value||'当前输入尚未完整保留，请返回原输入缩短内容。')
    if(restoreOverflow&&props.active&&!suspended&&!nativeLost){state='closed';generation++;void show(false)}
    else if(native.open.value){state='shown';void refresh()}
    else{state='closed';generation++;if(nativeLost)emit('unavailable','原生编辑器已关闭，超长输入未完整保留。')}
    return
  }
  state='closed';generation++
  closing=true
  const ticket=generation
  emit(kind,closed=>{if(disposed||ticket!==generation||closed)return;closing=false;void show(nativeLost)})
}
async function refresh(){
  if(state==='closed'||!props.active||suspended||disposed)return
  try{await native.update(content(),anchor(),true)}catch{emit('error','批注面板暂时无法更新，草稿仍保留。')}
}
function queueRefresh(){if(refreshFrame===undefined)refreshFrame=requestAnimationFrame(()=>{refreshFrame=undefined;void refresh()})}
async function show(includeValue=true){
  const ticket=++generation
  if(!props.active||suspended||disposed)return
  try{
    await native.ready()
    if(disposed||ticket!==generation||!props.active||suspended)return
    if(!native.supported.value||!native.textareaSupported.value){state='closed';emit('unavailable','当前运行环境无法打开原生批注编辑器。');return}
    state='opening';closing=false
    const shown=await native.show(content(includeValue),anchor(),{focusMode:'input',role:'editor',radius:14,contentInset:12,scrollbarPlacement:'gutter',placement:'bottom-start',dismissOnEscape:true,dismissOnOutsideClick:true})
    if(disposed||ticket!==generation||!props.active||suspended)return
    if(!shown){state='closed';emit('unavailable','批注编辑器暂时无法打开，请重试。');return}
    state='shown';nativeLost=false;void refresh()
  }catch{if(!disposed&&ticket===generation){state='closed';emit('unavailable','批注编辑器暂时无法打开，请重试。')}}
}
watch(()=>props.modelValue,text=>{
  if(text===draft.value||text===lastEmitted)return
  draft.value=text;lastEmitted=undefined;overflow.value=false;localError.value=''
  if(state==='shown')void native.update(content(true),anchor())
})
watch(()=>[props.busy,props.error],()=>{if(!props.busy)submitted=false})
watch(()=>[props.pending,props.busy,props.error,props.stale,draft.value,overflow.value,fontRevision.value,props.anchor,props.bounds],queueRefresh,{deep:true})
watch(()=>[props.active,context.value],()=>{
  generation++
  if(!props.active){close('keep');void native.hide()}
  else{state='closed';submitted=false;void native.destroy().then(()=>show())}
})
watch([native.open,native.pending],([open,pending])=>{if(state==='shown'&&!open&&!pending)close('keep')})
function resize(){fontRevision.value++;queueRefresh()}
onMounted(()=>{window.addEventListener('resize',resize);resizeObserver=new ResizeObserver(resize);resizeObserver.observe(document.documentElement);void document.fonts?.ready.then(()=>{if(!disposed)resize()});void show()})
onDeactivated(()=>{suspended=true;close('keep');void native.hide()})
onActivated(()=>{if(suspended){suspended=false;void show()}})
onBeforeUnmount(()=>{disposed=true;state='closed';generation++;window.removeEventListener('resize',resize);resizeObserver?.disconnect();if(refreshFrame!==undefined)cancelAnimationFrame(refreshFrame)})
</script>
