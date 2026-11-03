<template>
  <svg class="app-icon" :class="{'is-spinning':spin}" :data-icon="name" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" :role="label?'img':undefined" :aria-label="label" :aria-hidden="label?undefined:true" focusable="false">
    <title v-if="label">{{label}}</title>
    <path v-for="(d,index) in uiIconPaths[name]" :key="index" :d="d" />
  </svg>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {resolveUiIcon,uiIconPaths} from '@shared/ui-icons'
const props=withDefaults(defineProps<{icon?:string;spin?:boolean;label?:string}>(),{icon:'circle-question',spin:false})
const name=computed(()=>resolveUiIcon(props.icon))
</script>
<style scoped>
.app-icon{display:inline-block;width:1em;height:1em;fill:none;flex-shrink:0;vertical-align:-.125em}
.is-spinning{animation:app-icon-spin 1s linear infinite;transform-origin:center}
@keyframes app-icon-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.is-spinning:not(.status-essential-spin){animation:none}}
</style>
