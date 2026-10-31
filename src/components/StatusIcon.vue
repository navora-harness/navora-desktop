<template>
  <svg class="status-glyph" :class="`status-${kind}`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :role="label ? 'img' : undefined" :aria-label="label" :aria-hidden="label ? undefined : true">
    <title v-if="label">{{ label }}</title>
    <template v-if="kind === 'running'"><circle class="status-track" cx="12" cy="12" r="8" /><path class="status-rotor" d="M12 4a8 8 0 0 1 8 8" /></template>
    <template v-else-if="kind === 'thought'"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z" /><path d="M12 8v5" /></template>
    <template v-else-if="kind === 'log'"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6" /></template>
    <template v-else-if="kind === 'error'"><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v4m0 3v.1" /></template>
    <template v-else-if="kind === 'ask'"><path d="M5 18.5 3 21v-6a9 9 0 1 1 4 4" /><path d="M9.5 8a2.6 2.6 0 0 1 5 1c0 2-2.5 2-2.5 4m0 3v.1" /></template>
    <template v-else-if="kind === 'perm' || kind === 'key'"><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z" /><path d="M9 12h6m-3-3v6" /></template>
    <template v-else-if="kind === 'stopped'"><circle cx="12" cy="12" r="9" /><path d="M9 8v8m6-8v8" /></template>
    <template v-else><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></template>
  </svg>
</template>
<script setup lang="ts">
defineProps<{ kind: string; label?: string }>()
</script>
<style scoped>
.status-glyph { width: 18px; height: 18px; display: inline-block; vertical-align: middle; flex: 0 0 auto; }
.status-running { color: #3269ac; }
.status-error { color: #b52b39; }
.status-ask { color: #94600b; }
.status-perm,.status-key { color: #6750a4; }
.status-stopped { color: #626b78; }
.status-success { color: #26744e; }
.status-thought,.status-log { color:#7b8798; }
.status-track { opacity: .2; }
.status-rotor { transform-origin: 12px 12px; animation: status-turn 900ms linear infinite; }
@keyframes status-turn { to { transform: rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .status-rotor { animation: none; } }
</style>
