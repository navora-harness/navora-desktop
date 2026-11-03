<template>
  <svg class="browser-tab-audio-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M7.5 3 4.4 5.5H2.5v5h1.9L7.5 13V3Z" />
    <path v-if="muted" d="m10.25 6 3.5 4m0-4-3.5 4" />
    <template v-else-if="audible!==false"><path d="M10 5.5a4 4 0 0 1 0 5M12 3.5a6.5 6.5 0 0 1 0 9" /></template>
  </svg>
</template>
<script setup lang="ts">
defineProps<{muted?:boolean;audible?:boolean}>()
</script>
<style scoped>.browser-tab-audio-icon{display:block;width:16px;height:16px;flex:0 0 16px}</style>
