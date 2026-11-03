<template><button type="button" class="subchat-link" :data-subchat-id="chatId" :disabled="disabled" :title="title||'打开子对话'" @click="emit('open',chatId)"><img :src="subchatGlyphUrl(chatId)" alt="" aria-hidden="true"/><span class="subchat-link-title">{{title||'子对话'}}</span><span v-if="status||pending" class="subchat-link-status">{{pending?'需要处理':status?subchatStatusLabels[status]:''}}</span></button></template>
<script setup lang="ts">
import type {SubChatRunStatus} from '@shared/types'
import {subchatGlyphUrl,subchatStatusLabels} from '@shared/subchat-presentation'
defineProps<{chatId:string;title?:string;status?:SubChatRunStatus;pending?:boolean;disabled?:boolean}>()
const emit=defineEmits<{open:[chatId:string]}>()
</script>
<style scoped>.subchat-link{display:inline-flex;align-items:center;gap:7px;min-width:0;max-width:100%;padding:3px 5px;border-radius:6px;vertical-align:middle;color:var(--navora-ink);text-align:left}.subchat-link:hover:not(:disabled){background:var(--control-hover)}.subchat-link img{width:22px;height:22px;flex:none}.subchat-link-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subchat-link-status{flex:none;color:var(--navora-muted);font-size:.85em}.subchat-link:disabled{opacity:.55}</style>
