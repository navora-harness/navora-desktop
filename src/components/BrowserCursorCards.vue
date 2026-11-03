<template>
  <div class="cursor-options" role="radiogroup" aria-label="虚拟光标样式" @keydown="keySelect">
    <button v-for="option in options" :key="option.id" type="button" role="radio" class="cursor-option" :data-cursor-style="option.id" :aria-checked="modelValue===option.id" :tabindex="modelValue===option.id?0:-1" @click="emit('update:modelValue',option.id)">
      <span class="cursor-preview" aria-hidden="true"><span class="cursor-preview-lines"><i/><i/><i/></span><span class="cursor-preview-target"/><img :src="source(option.id)" :width="browserCursorDesign(option.id).size" :height="browserCursorDesign(option.id).size" class="cursor-original"><img :src="source(option.id)" :style="{width:browserCursorDesign(option.id).size*2+'px',height:browserCursorDesign(option.id).size*2+'px'}" class="cursor-enlarged"><small>原尺寸 · 2× 预览</small></span>
      <span class="cursor-option-name">{{ option.name }}<span v-if="modelValue===option.id" class="cursor-selected"><AppIcon icon="check"/>已选</span></span>
      <span class="cursor-option-description">{{ option.description }}</span>
    </button>
  </div>
</template>
<script setup lang="ts">
import {browserCursorDesign,browserCursorSvg,type BrowserCursorStyle} from '@shared/browser-cursor'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{modelValue:BrowserCursorStyle}>()
const emit=defineEmits<{'update:modelValue':[value:BrowserCursorStyle]}>()
const options=[{id:'navora-arrow',name:'领航箭头',description:'清楚指示点击方向与目标。'},{id:'focus-ring',name:'环形瞄点',description:'用中心圆点标明实际落点。'},{id:'precision-cross',name:'精密十字',description:'适合对齐与较小的目标。'}] as const
const sources=new Map(options.map(option=>[option.id,'data:image/svg+xml,'+encodeURIComponent(browserCursorSvg(option.id))]))
const source=(id:BrowserCursorStyle)=>sources.get(id)
function keySelect(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return
  event.preventDefault();const at=options.findIndex(option=>option.id===props.modelValue),index=event.key==='Home'?0:event.key==='End'?2:(at+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+options.length)%options.length
  const id=options[index]!.id;emit('update:modelValue',id);(event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-cursor-style="${id}"]`)?.focus({preventScroll:true})
}
</script>
<style scoped>
.cursor-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:12px}.cursor-option{display:flex;min-width:0;flex-direction:column;gap:9px;padding:12px;border:1px solid var(--appearance-stroke,var(--navora-stroke));border-radius:12px;background:var(--appearance-surface,var(--navora-surface));color:var(--appearance-ink,var(--navora-ink));text-align:left;cursor:pointer}.cursor-option:hover{border-color:var(--appearance-composer-edge,var(--navora-accent))}.cursor-option[aria-checked=true]{background:var(--appearance-selection,var(--control-selected));border-color:var(--appearance-accent,var(--navora-accent));box-shadow:0 0 0 1px var(--appearance-accent,var(--navora-accent))}.cursor-option:focus-visible{outline:2px solid var(--appearance-accent,var(--navora-accent));outline-offset:4px}.cursor-preview{position:relative;display:block;height:112px;border:1px solid var(--appearance-stroke,var(--navora-stroke));border-radius:7px;background:var(--appearance-well,var(--navora-hover));overflow:hidden}.cursor-preview-lines{position:absolute;inset:20px 15px}.cursor-preview-lines i{display:block;width:66%;height:4px;margin:9px 0;border-radius:2px;background:var(--appearance-stroke,var(--navora-stroke))}.cursor-preview-lines i:nth-child(2){width:48%}.cursor-preview-target{position:absolute;left:38%;top:43px;width:28px;height:18px;border:1px dashed var(--appearance-muted,var(--navora-muted));border-radius:4px}.cursor-original{position:absolute;left:35%;top:40px}.cursor-enlarged{position:absolute;right:10px;top:15px;width:64px;height:64px;object-fit:contain}.cursor-preview small{position:absolute;bottom:8px;left:12px;color:var(--appearance-muted,var(--navora-muted));font-size:10px}.cursor-option-name{display:flex;align-items:center;justify-content:space-between;gap:5px;min-height:24px;font-size:13px;font-weight:600}.cursor-selected{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:6px;background:var(--appearance-accent,var(--navora-accent));color:var(--appearance-surface,#fff);white-space:nowrap;font-size:10px}.cursor-selected svg{width:11px;height:11px}.cursor-option-description{font-size:12px;line-height:1.7;color:var(--appearance-muted,var(--navora-muted))}@container(max-width:680px){.cursor-options{grid-template-columns:repeat(2,minmax(0,1fr))}}@container(max-width:420px){.cursor-options{grid-template-columns:minmax(0,1fr)}}
</style>
