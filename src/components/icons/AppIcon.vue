<template>
  <svg ref="element" class="app-icon" :class="{'is-spinning':spin}" :data-icon="name" :data-icon-size="asset.size" :viewBox="`0 0 ${asset.size} ${asset.size}`" :fill="asset.strokeWidth?'none':'currentColor'" :stroke="asset.strokeWidth?'currentColor':'none'" :stroke-width="asset.strokeWidth" stroke-linecap="round" stroke-linejoin="round" :role="label?'img':undefined" :aria-label="label" :aria-hidden="label?undefined:true" focusable="false">
    <title v-if="label">{{label}}</title>
    <path v-for="(path,index) in asset.paths" :key="index" :d="path.d" :fill="asset.strokeWidth?'none':path.fill" :fill-rule="path.fillRule" :clip-rule="path.clipRule" />
  </svg>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {getUiIcon,resolveUiIcon} from '@shared/ui-icons'
import {observeIconSize} from '@/composables/useIconSize'
const props=withDefaults(defineProps<{icon?:string;spin?:boolean;label?:string}>(),{icon:'circle-question',spin:false})
const name=computed(()=>resolveUiIcon(props.icon))
const element=ref<SVGSVGElement|null>(null),renderedSize=ref(20)
const asset=computed(()=>getUiIcon(name.value,renderedSize.value))
let stopObserving:(()=>void)|undefined
onMounted(()=>{if(element.value)stopObserving=observeIconSize(element.value,size=>{renderedSize.value=size})})
onBeforeUnmount(()=>stopObserving?.())
</script>
<style scoped>
.app-icon{display:inline-block;width:1em;height:1em;flex-shrink:0;vertical-align:-.125em}
.is-spinning{animation:app-icon-spin 1s linear infinite;transform-origin:center}
@keyframes app-icon-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.is-spinning:not(.status-essential-spin){animation:none}}
</style>
