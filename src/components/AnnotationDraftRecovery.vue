<template>
  <details v-if="copies.length" class="draft-recovery">
    <summary>{{ copies.length }} 份冲突副本已保留</summary>
    <p>选择采用其中一份，或与输入框中的文字合并。操作后仍需保存意见。</p>
    <section v-for="(copy,index) in copies" :key="copy.id" class="draft-copy">
      <header><strong>副本 {{ index+1 }}</strong><time>{{ new Date(copy.updatedAt).toLocaleString() }}</time></header>
      <pre>{{ copy.text || '（空白草稿）' }}</pre>
      <div><button type="button" class="ui-button" :disabled="disabled" @click="$emit('resolve',copy,copy.text)">采用副本</button><button type="button" class="ui-button" :disabled="disabled || text===copy.text || merged(copy).length>4000" @click="$emit('resolve',copy,merged(copy))">合并到当前草稿</button></div>
      <small v-if="merged(copy).length>4000">合并后超过 4000 字，请先缩短输入框中的文字。</small>
    </section>
  </details>
</template>
<script setup lang="ts">
import type {BrowserDraftCopy} from '@shared/browser-workspace'
const props=defineProps<{copies:BrowserDraftCopy[];text:string;disabled:boolean}>()
defineEmits<{resolve:[copy:BrowserDraftCopy,text:string]}>()
const merged=(copy:BrowserDraftCopy)=>[props.text,copy.text].filter(Boolean).join('\n\n')
</script>
<style scoped>
.draft-recovery{clear:both;margin-top:10px;padding:10px 12px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--navora-surface);font-size:12px}
summary{cursor:pointer;font-weight:600;color:var(--navora-ink)}
summary:focus-visible{outline:2px solid var(--control-focus);outline-offset:4px;border-radius:4px}
p{margin:8px 0;color:var(--navora-muted);line-height:1.6}
.draft-copy+.draft-copy{margin-top:12px;padding-top:12px;border-top:1px solid var(--navora-stroke)}
header,.draft-copy>div{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
time{margin-left:auto;color:var(--navora-muted);font-size:11px}
pre{max-height:160px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6;color:var(--navora-ink);margin:8px 0}
small{display:block;margin-top:6px;color:var(--control-danger)}
</style>
