<template>
  <AppIcon class="status-glyph" :class="[`status-${kind}`,{'status-essential-spin':spinAlways}]" :icon="kind==='running' && spin===false ? 'clock' : statusIcons[kind] || 'circle-check'" :spin="spin ?? kind==='running'" :label="label" />
</template>
<script setup lang="ts">
import AppIcon from './icons/AppIcon.vue'
defineProps<{ kind: string; label?: string; spin?: boolean; spinAlways?: boolean }>()
const statusIcons:Record<string,string>={running:'circle-notch',thought:'lightbulb',log:'file-lines',error:'triangle-exclamation',ask:'circle-question',perm:'shield-halved',key:'key',stopped:'pause-circle'}
</script>
<style scoped>
svg.status-glyph { width: 18px; height: 18px; display: inline-block; vertical-align: middle; flex: 0 0 auto; }
.status-running { color: #3269ac; }
.status-error { color: #b52b39; }
.status-ask { color: #94600b; }
.status-perm,.status-key { color: #6750a4; }
.status-stopped { color: #626b78; }
.status-success { color: #26744e; }
.status-thought,.status-log { color:#7b8798; }

</style>
