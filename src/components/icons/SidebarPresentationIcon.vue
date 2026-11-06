<template>
  <svg class="app-icon sidebar-presentation-icon" :class="{'is-floating':floating}" :data-icon="floating?'sidebar-floating':'sidebar-docked'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="3.5" width="14" height="13" rx="3" />
    <path class="sidebar-presentation-divider" d="M8 4.25v11.5" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{floating:boolean}>()
</script>
<style scoped>
.sidebar-presentation-icon{display:inline-block;width:20px;height:20px;flex-shrink:0;vertical-align:middle}
.sidebar-presentation-divider{transform-origin:8px 10px;transition:transform 220ms cubic-bezier(.2,.8,.2,1)}
.is-floating .sidebar-presentation-divider{transform:translateX(-2.5px) scaleY(.56)}
@media(prefers-reduced-motion:reduce){.sidebar-presentation-divider{transition:none}}
</style>
