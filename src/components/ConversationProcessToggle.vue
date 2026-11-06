<template>
  <button type="button" class="conversation-process-toggle" :class="{'is-open':open,'has-warning':group.warning}" :aria-expanded="open" :aria-label="`${open?'收起':'展开'}处理过程${group.summary?'，'+group.summary:''}`" @click="$emit('toggle')">
    <AppIcon icon="chevron-right" class="process-chevron"/>
    <span class="process-label">处理过程</span>
    <span v-if="group.summary" class="process-summary">{{group.summary}}</span>
  </button>
  <p v-if="group.outcome" class="conversation-process-outcome" :class="{'is-error':group.outcome.error}" role="note">
    <AppIcon icon="circle-exclamation"/>
    <span><strong>{{group.outcome.label}}</strong><span class="process-outcome-detail">{{group.outcome.detail}}</span></span>
  </p>
</template>
<script setup lang="ts">
import type {ConversationProcessGroup} from '@shared/conversation-output'
import AppIcon from './icons/AppIcon.vue'
defineProps<{group:ConversationProcessGroup;open:boolean}>()
defineEmits<{toggle:[]}>()
</script>
<style scoped>
.conversation-process-outcome{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;align-self:center;width:min(860px,100%);margin:0;padding:8px 0 10px;color:var(--navora-muted);font-size:13px;line-height:1.6}.conversation-process-outcome>.app-icon{width:16px;height:16px;margin-top:2px;flex:none}.conversation-process-outcome strong{font-weight:600;color:var(--navora-ink)}.process-outcome-detail{display:block;margin-top:2px;font-size:12px}.conversation-process-outcome.is-error strong{color:var(--navora-danger,#b05246)}
.conversation-process-toggle{display:flex;align-items:center;gap:7px;min-width:0;max-width:100%;min-height:30px;margin:2px 0;padding:4px 0;border:0;border-radius:6px;background:transparent;color:var(--navora-muted);font:inherit;font-size:12px;line-height:1.5;text-align:left;cursor:pointer}.process-chevron{width:11px;height:11px;flex:none;transition:transform 120ms ease}.is-open .process-chevron{transform:rotate(90deg)}.process-label{flex:none}.process-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.8}.conversation-process-toggle:hover .process-label{color:var(--navora-ink);text-decoration:underline;text-underline-offset:3px}.conversation-process-toggle:focus-visible{outline:2px solid var(--navora-accent);outline-offset:3px}.has-warning .process-summary{opacity:1}@media(max-width:600px){.process-summary{font-size:10px}}@media(prefers-reduced-motion:reduce){.process-chevron{transition:none}}
</style>
