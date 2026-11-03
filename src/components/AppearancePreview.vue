<template>
  <svg class="appearance-preview" viewBox="0 0 240 116" fill="none" aria-hidden="true">
    <defs>
      <clipPath v-for="(_, index) in palettes" :id="previewId + '-' + index" :key="index">
        <rect :x="palettes.length === 2 ? index * 120 : 0" y="0" :width="palettes.length === 2 ? 120 : 240" height="116" />
      </clipPath>
    </defs>
    <g v-for="(palette, index) in palettes" :key="index" :clip-path="'url(#' + previewId + '-' + index + ')'">
      <rect width="240" height="116" rx="8" :fill="palette.shell" />
      <rect x="9" y="7" width="10" height="10" rx="3" :fill="palette.accent" opacity=".7" />
      <rect x="26" y="10" width="29" height="4" rx="2" :fill="palette.railInk" opacity=".45" />
      <circle v-for="y in [37, 52, 67]" :key="y" cx="14" :cy="y" r="2.5" :fill="palette.railInk" opacity=".7" />
      <rect x="28" y="22" width="206" height="88" rx="7" :fill="palette.surface" />
      <path d="M35 22H80V110H35C31.134 110 28 106.866 28 103V29C28 25.134 31.134 22 35 22Z" :fill="palette.sidebar" />
      <path d="M80 22H227C230.866 22 234 25.134 234 29V39H80V22Z" :fill="palette.header" />
      <rect x="35" y="33" width="30" height="4" rx="2" :fill="palette.muted" opacity=".35" />
      <rect x="33" y="45" width="41" height="12" rx="3" :fill="palette.selection" />
      <rect v-for="y in [66, 78, 90]" :key="y" x="36" :y="y" width="31" height="3" rx="1.5" :fill="palette.muted" opacity=".18" />
      <rect x="91" y="28" width="51" height="4" rx="2" :fill="palette.muted" opacity=".28" />
      <rect x="94" y="51" width="91" height="4" rx="2" :fill="palette.muted" opacity=".3" />
      <rect x="94" y="61" width="116" height="3" rx="1.5" :fill="palette.muted" opacity=".15" />
      <rect x="94" y="69" width="70" height="3" rx="1.5" :fill="palette.muted" opacity=".15" />
      <rect x="91" y="84" width="132" height="18" rx="5" :fill="palette.well" :stroke="palette.composerEdge" stroke-width=".6" />
      <rect x="99" y="91" width="51" height="3" rx="1.5" :fill="palette.muted" opacity=".25" />
      <rect x="210" y="89" width="8" height="8" rx="2.5" :fill="palette.accent" opacity=".75" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { appearancePalette, type AppearanceMode, type AppearanceThemeId } from '@shared/appearance'

const props = defineProps<{ themeId: AppearanceThemeId; mode: AppearanceMode; systemDark?: boolean; split?: boolean }>()
const previewId = useId()
const palettes = computed(() => props.split && props.mode === 'auto'
  ? [appearancePalette(props.themeId, 'light', false), appearancePalette(props.themeId, 'dark', false)]
  : [appearancePalette(props.themeId, props.mode, props.systemDark ?? false)])
</script>
