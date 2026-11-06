<template>
  <div class="cursor-size-setting">
    <div class="cursor-size-fields">
      <div class="cursor-size-heading"><label for="browser-cursor-size">光标大小</label><output for="browser-cursor-size">{{ percent }}%</output></div>
      <input id="browser-cursor-size" aria-label="光标大小" type="range" min="75" max="200" step="25" :value="percent" :aria-valuetext="`${percent}%`" @input="preview=Number(($event.target as HTMLInputElement).value)/100" @change="commit(Number(($event.target as HTMLInputElement).value)/100)">
      <div class="cursor-size-labels"><span>75%</span><span>200%</span></div>
      <button type="button" class="cursor-size-reset" :disabled="scale===1" @click="commit(1)">恢复 100%</button>
    </div>
    <div class="cursor-size-sample" aria-hidden="true"><img :src="source" :width="size" :height="size"><small>当前大小</small></div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { browserCursorDesign, browserCursorSvg, type BrowserCursorStyle } from '@shared/browser-cursor'
const props=defineProps<{modelValue:number;cursorStyle:BrowserCursorStyle}>()
const emit=defineEmits<{'update:modelValue':[value:number]}>()
const preview=ref<number|null>(null)
const scale=computed(()=>preview.value??props.modelValue)
const percent=computed(()=>Math.round(scale.value*100))
const size=computed(()=>browserCursorDesign(props.cursorStyle,scale.value).size)
const source=computed(()=>'data:image/svg+xml,'+encodeURIComponent(browserCursorSvg(props.cursorStyle,scale.value)))
watch(()=>props.modelValue,()=>{preview.value=null})
function commit(value:number){if(!Number.isFinite(value)||value<0.75||value>2)return;emit('update:modelValue',value);preview.value=null}
</script>
<style scoped>
.cursor-size-setting{display:flex;align-items:center;gap:24px;margin-top:16px;padding:0 0 0 16px;border:1px solid var(--appearance-stroke,var(--navora-stroke));border-radius:10px;overflow:hidden}
.cursor-size-fields{flex:1;min-width:110px}
.cursor-size-heading{display:flex;justify-content:space-between;gap:12px;color:var(--appearance-ink,var(--navora-ink));font-size:12px}
.cursor-size-heading output{font-variant-numeric:tabular-nums;color:var(--appearance-accent,var(--navora-accent));font-weight:600}
.cursor-size-fields input{display:block;width:100%;height:28px;margin:8px 0 0;accent-color:var(--appearance-accent,var(--navora-accent));cursor:pointer}
.cursor-size-fields input:focus-visible,.cursor-size-reset:focus-visible{outline:2px solid var(--appearance-accent,var(--navora-accent));outline-offset:3px}
.cursor-size-labels{display:flex;justify-content:space-between;color:var(--appearance-muted,var(--navora-muted));font-size:10px}
.cursor-size-reset{margin-top:10px;padding:4px 7px;border-radius:5px;background:var(--appearance-well,var(--navora-hover));color:var(--appearance-ink,var(--navora-ink));font-size:11px;cursor:pointer}
.cursor-size-reset:disabled{opacity:.4;cursor:default}
.cursor-size-sample{position:relative;flex:0 0 184px;height:180px;background:#0c1321}
.cursor-size-sample img{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);max-width:none;pointer-events:none}
.cursor-size-sample small{position:absolute;bottom:9px;left:12px;color:#879bb7;font-size:10px}
@container(max-width:420px){.cursor-size-setting{gap:12px;padding-left:12px}.cursor-size-sample{flex-basis:150px}}
</style>
