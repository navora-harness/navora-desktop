<template>
  <span class="browser-row-actions" :class="{'is-open':active}" @click.stop>
    <span v-if="count !== undefined" class="browser-row-count" role="img" :data-page-count="count" :aria-label="`${count} 个页面`">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.25" y="2.75" width="15.5" height="14.5" rx="2.6" /><text x="10" y="13.65" text-anchor="middle" :class="{'many-pages':count>9}">{{ count>9?'9+':count }}</text></svg>
    </span>
    <button type="button" class="browser-row-more" :aria-label="count === undefined ? label : `${label}，${count} 个页面`" :title="label" aria-haspopup="menu" :aria-expanded="!!active" @click="emit('more',$event)"><AppIcon icon="ellipsis" /></button>
  </span>
</template>
<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
defineProps<{count?:number;label:string;active?:boolean}>()
const emit=defineEmits<{more:[event:MouseEvent]}>()
</script>
<style>
.browser-row-actions{display:grid;place-items:center;position:relative;width:26px;height:28px;flex:0 0 26px;color:var(--navora-muted,#727b8a)}
.browser-row-count,.browser-row-more{grid-area:1/1;display:grid;place-items:center;width:24px;height:24px}
.browser-row-count{pointer-events:none;opacity:1;visibility:visible;transition:opacity 140ms ease,visibility 0s linear}
.browser-row-count>svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.browser-row-count text{fill:currentColor;stroke:none;font:500 10.5px 'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
.browser-row-count text.many-pages{font-size:9.5px;letter-spacing:-.1px}
.browser-row-more{padding:0;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 140ms ease,background-color 140ms ease,color 140ms ease}
.browser-row-more>.app-icon{width:14px;height:14px}
.browser-row-more:hover{background:var(--control-hover,#e7edf5);color:var(--navora-accent,#3269ac)}
.browser-row-more:focus-visible{outline:2px solid var(--navora-accent,#3269ac);outline-offset:-2px}
:is(.resource-owner-head,.tree-row):is(:hover,:focus-within)>.browser-row-actions>.browser-row-count,.browser-row-actions.is-open>.browser-row-count{opacity:0;visibility:hidden;transition-delay:0s,140ms}
:is(.resource-owner-head,.tree-row):is(:hover,:focus-within)>.browser-row-actions>.browser-row-more,.browser-row-actions.is-open>.browser-row-more{opacity:1;pointer-events:auto}
@media(hover:none){.browser-row-actions>.browser-row-count{opacity:0;visibility:hidden}.browser-row-actions>.browser-row-more{opacity:1;pointer-events:auto}}
@media(prefers-reduced-motion:reduce){.browser-row-count,.browser-row-more{transition:none}}
</style>
