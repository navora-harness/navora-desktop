<template>
  <Teleport to="body">
    <div class="annotation-floating-mark" aria-hidden="true" :style="markStyle" />
    <section ref="panel" class="annotation-floating-editor" data-browser-chrome-overlay role="dialog" aria-label="编辑网页批注" :style="panelStyle" @keydown="shortcut">
      <header><strong><AppIcon icon="comments" />{{ saved?'编辑批注':'添加批注' }}</strong><button type="button" class="ui-icon-button" aria-label="收起并保留批注草稿" title="收起并保留草稿" :disabled="busy" @click="emit('keep')"><AppIcon icon="xmark" /></button></header>
      <p class="annotation-preview-label">创建时静态预览<span v-if="stale"> · 当前网页已变化</span></p>
      <div class="annotation-floating-body"><textarea ref="input" :value="modelValue" aria-label="悬浮批注意见" placeholder="写下对此位置的意见…" maxlength="4000" :readonly="busy" @input="emit('update:modelValue',($event.target as HTMLTextAreaElement).value)" /><p v-if="error" class="annotation-floating-error" role="alert">{{ error }}<button type="button" class="ui-button" @click="emit('recover')">查看保留的草稿</button></p></div>
      <footer><span role="status" aria-live="polite">{{ pending?'正在保留草稿…':error?'草稿需要处理':modelValue?'草稿已保留':'点击或拖动选择位置' }}</span><div><button v-if="!saved" type="button" class="ui-button" :disabled="busy" @click="emit('discard')">放弃目标</button><button type="button" class="ui-button primary" :disabled="busy || pending || !modelValue.trim() || !!error" @click="emit('save')">{{ busy?'保存中…':'保存批注' }}</button></div><small>Ctrl / ⌘ + Enter 保存，Enter 换行</small></footer>
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './icons/AppIcon.vue'
import {annotationEditorPlacement,type AnnotationBox} from '@shared/browser-annotation-position'
const props=defineProps<{modelValue:string;anchor:AnnotationBox;bounds:AnnotationBox;saved?:boolean;stale?:boolean;busy?:boolean;pending?:boolean;error?:string}>()
const emit=defineEmits<{'update:modelValue':[text:string];save:[];keep:[];discard:[];recover:[]}>()
const panel=ref<HTMLElement>(),input=ref<HTMLTextAreaElement>(),height=ref(240)
let observer:ResizeObserver|undefined
const placement=computed(()=>annotationEditorPlacement(props.anchor,props.bounds,{width:344,height:height.value}))
const panelStyle=computed(()=>({left:placement.value.x+'px',top:placement.value.y+'px',width:placement.value.width+'px',maxHeight:placement.value.maxHeight+'px'}))
const markStyle=computed(()=>{const a=props.anchor,b=props.bounds,left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),width=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-left),height=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-top);return {left:left+'px',top:top+'px',width:width+'px',height:height+'px',display:width&&height?'':'none'}})
function shortcut(e:KeyboardEvent){if(e.isComposing||e.keyCode===229||e.repeat)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!props.busy)emit('keep')}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.altKey){e.preventDefault();e.stopPropagation();if(!props.busy&&!props.pending&&!props.error&&props.modelValue.trim())emit('save')}}
onMounted(()=>{observer=new ResizeObserver(()=>{if(panel.value)height.value=panel.value.getBoundingClientRect().height});if(panel.value)observer.observe(panel.value);void nextTick(()=>input.value?.focus({preventScroll:true}))})
watch(()=>props.saved,()=>void nextTick(()=>input.value?.focus({preventScroll:true})))
onBeforeUnmount(()=>observer?.disconnect())
</script>
<style scoped>
.annotation-floating-mark{position:fixed;box-sizing:border-box;border:2px solid #397dd0;background:#397dd014;pointer-events:none;z-index:2200;border-radius:3px}
.annotation-floating-editor{position:fixed;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;z-index:2201;border:1px solid var(--navora-stroke,#d5dfeb);border-radius:15px;background:var(--navora-surface,#fff);color:var(--navora-ink,#23384e);box-shadow:0 12px 40px #10283f24;text-align:left;font-size:13px}
.annotation-floating-editor header{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding:9px 10px 0 14px;gap:8px}.annotation-floating-editor strong{display:flex;align-items:center;gap:8px;font-size:14px}.annotation-floating-editor .app-icon{width:16px;height:16px}
.annotation-preview-label{margin:3px 14px 8px;color:var(--navora-muted,#6b7b8c);font-size:11px}.annotation-floating-body{padding:0 12px;min-height:36px;overflow:auto;overscroll-behavior:contain}.annotation-floating-body textarea{width:100%;min-height:72px;max-height:160px;resize:vertical;border:1px solid var(--navora-stroke,#d5dfeb);border-radius:9px;padding:10px;color:inherit;background:var(--navora-background,#f7f9fc);font:inherit;line-height:1.6;box-sizing:border-box}.annotation-floating-body textarea:focus-visible{outline:2px solid var(--navora-accent,#397dd0);outline-offset:1px}
.annotation-floating-editor footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;padding:9px 12px 11px}.annotation-floating-editor footer>div{display:flex;gap:6px;flex-wrap:wrap}.annotation-floating-editor footer>span,.annotation-floating-editor small{font-size:11px;color:var(--navora-muted,#6b7b8c)}.annotation-floating-editor small{width:100%}.annotation-floating-error{color:var(--navora-danger,#b42338);font-size:12px;line-height:1.5;margin:6px 0}.annotation-floating-error button{margin-top:5px}.annotation-floating-editor .ui-button{min-height:31px;font-size:12px;padding:4px 10px}
@media(prefers-reduced-motion:reduce){.annotation-floating-editor{scroll-behavior:auto}}
</style>
