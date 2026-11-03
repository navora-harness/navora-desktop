<template>
  <span v-if="download.state==='started' || download.state==='paused'" class="file-transfer-progress" :class="{indeterminate:percent===null,paused:download.state==='paused'}" role="progressbar" :aria-label="`${download.filename} 下载进度`" :aria-valuenow="percent ?? undefined" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="detail">
    <span :style="{width:`${percent ?? 28}%`}" />
  </span>
  <span class="file-transfer-state" :class="download.state" role="img" :aria-label="detail" :title="detail">
    <span v-if="download.state==='started' && percent!==null">{{ percent }}%</span>
    <AppIcon v-else :icon="stateIcon" />
  </span>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import type {BrowserDownloadEntry} from '@shared/types'
import {downloadDetail,downloadProgress} from '@shared/workspace-downloads'
import AppIcon from './icons/AppIcon.vue'
const props=defineProps<{download:BrowserDownloadEntry}>()
const percent=computed(()=>downloadProgress(props.download))
const detail=computed(()=>downloadDetail(props.download))
const stateIcon=computed(()=>({completed:'check',paused:'pause-circle',failed:'circle-exclamation',cancelled:'xmark',intercepted:'download',started:'download'}[props.download.state]))
</script>

<style scoped>
/* The containing file row owns positioning and clipping; this layer uses no layout space. */
.file-transfer-progress{position:absolute;inset:0;z-index:-1;overflow:hidden;border-radius:inherit;pointer-events:none}
.file-transfer-progress>span{display:block;height:100%;background:rgba(83,127,179,.075);border-bottom:2px solid rgba(83,127,179,.38);transition:width 180ms ease}
.file-transfer-progress.paused>span{background:rgba(128,139,156,.07);border-bottom-color:rgba(128,139,156,.35)}
.file-transfer-progress.indeterminate:not(.paused)>span{animation:file-transfer 2s ease-in-out infinite}
.file-transfer-state{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:14px;height:16px;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--navora-muted,#7b8797);white-space:nowrap}
.file-transfer-state.started{color:#537da7}.file-transfer-state.completed{color:#548477}.file-transfer-state.failed{color:#b46957}
.file-transfer-state svg{width:12px;height:12px}
@keyframes file-transfer{0%,100%{transform:translateX(0)}50%{transform:translateX(250%)}}
@media(prefers-reduced-motion:reduce){.file-transfer-progress>span{transition:none}.file-transfer-progress.indeterminate:not(.paused)>span{animation:none}}
</style>
