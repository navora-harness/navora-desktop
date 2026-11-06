<template>
  <div class="cursor-options" role="radiogroup" aria-label="虚拟光标样式" @keydown="keySelect">
    <button v-for="option in options" :key="option.id" type="button" role="radio" class="cursor-option" :data-cursor-style="option.id" :aria-checked="modelValue===option.id" :tabindex="modelValue===option.id?0:-1" @click="emit('update:modelValue',option.id)">
      <span class="cursor-option-name">{{ option.name }}<span v-if="modelValue===option.id" class="cursor-selected"><AppIcon icon="check"/>已选</span><span v-else-if="option.id==='windows-glow'" class="cursor-recommended">默认</span></span>
      <span class="cursor-option-description">{{ option.description }}</span>
      <span class="cursor-preview" aria-hidden="true">
        <span class="cursor-swatch dark"><img :src="source(option.id)" width="160" height="160" class="cursor-enlarged"><small>2× 放大</small></span>
        <span class="cursor-swatch light"><img :src="source(option.id)" width="80" height="80" class="cursor-original"><small>100%</small></span>
      </span>
    </button>
  </div>
</template>
<script setup lang="ts">
import { BROWSER_CURSOR_OPTIONS, browserCursorSvg, type BrowserCursorStyle } from '@shared/browser-cursor'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{modelValue:BrowserCursorStyle}>()
const emit=defineEmits<{'update:modelValue':[value:BrowserCursorStyle]}>()
const options=BROWSER_CURSOR_OPTIONS
const sources=new Map(options.map(option=>[option.id,'data:image/svg+xml,'+encodeURIComponent(browserCursorSvg(option.id))]))
const source=(id:BrowserCursorStyle)=>sources.get(id)
function keySelect(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return
  event.preventDefault()
  const at=options.findIndex(option=>option.id===props.modelValue)
  const index=event.key==='Home'?0:event.key==='End'?options.length-1:(at+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+options.length)%options.length
  const id=options[index]!.id;emit('update:modelValue',id)
  ;(event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-cursor-style="${id}"]`)?.focus({preventScroll:true})
}
</script>
<style scoped>
.cursor-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.cursor-option{display:flex;min-width:0;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--appearance-stroke,var(--navora-stroke));border-radius:12px;background:var(--appearance-surface,var(--navora-surface));color:var(--appearance-ink,var(--navora-ink));text-align:left;cursor:pointer}
.cursor-option:hover{border-color:var(--appearance-composer-edge,var(--navora-accent))}
.cursor-option[aria-checked=true]{border-color:var(--appearance-accent,var(--navora-accent));box-shadow:0 0 0 1px var(--appearance-accent,var(--navora-accent))}
.cursor-option:focus-visible{outline:2px solid var(--appearance-accent,var(--navora-accent));outline-offset:4px}
.cursor-option-name{display:flex;align-items:center;justify-content:space-between;gap:5px;min-height:24px;font-size:13px;font-weight:600}
.cursor-selected,.cursor-recommended{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:5px;white-space:nowrap;font-size:10px}
.cursor-selected{background:var(--appearance-accent,var(--navora-accent));color:var(--appearance-surface,#fff)}
.cursor-recommended{color:var(--appearance-muted,var(--navora-muted));font-weight:400}
.cursor-selected svg{width:11px;height:11px}
.cursor-option-description{font-size:11px;line-height:1.7;color:var(--appearance-muted,var(--navora-muted))}
.cursor-preview{display:grid;grid-template-columns:1.6fr 1fr;gap:7px;margin-top:auto}
.cursor-swatch{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;height:116px;overflow:hidden;border-radius:7px}
.cursor-swatch.dark{background:#0c1321}.cursor-swatch.light{background:#edf3fa}
.cursor-swatch img{display:block;flex:none;max-width:none;object-fit:contain;pointer-events:none}
.cursor-swatch small{position:absolute;right:7px;bottom:6px;color:#879bb7;font-size:9px}
@container(max-width:1000px){.cursor-options{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container(max-width:740px){.cursor-options{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container(max-width:420px){.cursor-options{grid-template-columns:minmax(0,1fr)}}
</style>
