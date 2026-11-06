<template>
  <button type="button" class="composer-submit-button" :class="`mode-${mode}`" :disabled="disabled||busy" :aria-busy="busy" :title="hint" :aria-label="hint" @click="$emit('submit')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="{'submit-busy':busy}">
      <path v-if="busy" d="M20 12a8 8 0 1 1-8-8"/>
      <rect v-else-if="mode==='stop'" x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>
      <path v-else-if="mode==='queue'" d="M4 5h10M4 10h7M4 15h5M17 10v10m-4-4 4 4 4-4"/>
      <path v-else-if="mode==='insert'" d="M12 19V5m-5 5 5-5 5 5M4 18h4m-2-2v4"/>
      <path v-else d="M12 19V5m-5 5 5-5 5 5"/>
    </svg>
  </button>
</template>
<script setup lang="ts">
import {computed} from 'vue'
const props=withDefaults(defineProps<{mode?:'send'|'queue'|'insert'|'stop';disabled?:boolean;busy?:boolean;label?:string}>(),{mode:'send'})
defineEmits<{submit:[]}>()
const hint=computed(()=>props.busy?'正在提交消息':props.label||(props.mode==='stop'?'停止生成':props.mode==='queue'?'加入队列，当前任务结束后发送':props.mode==='insert'?'立即补充到当前任务':'发送消息'))
</script>
<style scoped>
.composer-submit-button{display:inline-grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:1px solid color-mix(in srgb,var(--navora-accent) 26%,transparent);border-radius:12px;background:color-mix(in srgb,var(--navora-accent) 16%,var(--navora-surface));color:var(--navora-accent);cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease,transform 120ms ease}.composer-submit-button svg{width:20px;height:20px}.composer-submit-button:hover:not(:disabled){background:color-mix(in srgb,var(--navora-accent) 25%,var(--navora-surface));border-color:color-mix(in srgb,var(--navora-accent) 48%,transparent)}.composer-submit-button:active:not(:disabled){transform:scale(.95)}.composer-submit-button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:3px}.composer-submit-button.mode-queue{background:color-mix(in srgb,var(--navora-accent) 9%,var(--navora-surface))}.composer-submit-button.mode-stop{background:var(--appearance-well,var(--navora-surface));border-color:var(--navora-stroke);color:var(--navora-muted)}.composer-submit-button.mode-stop:hover:not(:disabled){background:var(--control-hover);color:var(--navora-ink)}.composer-submit-button:disabled{background:var(--control-hover);color:var(--navora-muted);border-color:transparent;cursor:default;opacity:.55}.submit-busy{animation:submit-spin 900ms linear infinite}@keyframes submit-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.composer-submit-button{transition:none}.submit-busy{animation:none}}
</style>
