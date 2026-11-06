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
.status-running { color: var(--navora-accent); }
.status-error { color: var(--navora-danger); }
.status-ask { color: var(--control-warning,var(--navora-accent)); }
.status-perm,.status-key { color: var(--navora-accent); }
.status-stopped { color: var(--navora-muted); }
.status-success { color: var(--control-success,var(--navora-accent)); }
.status-thought,.status-log { color:var(--navora-muted); }

</style>
