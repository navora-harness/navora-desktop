<template>
  <svg class="rail-composite-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <g v-for="(member, index) in glyphs" :key="member.id">
      <!-- Clear the overlap in a pair without adding another button frame. -->
      <rect v-if="members.length === 2 && index === 1" x="10" y="10" width="14" height="14" rx="2" class="member-clearance" />
      <g :transform="member.transform"><path v-for="(path, part) in member.paths" :key="part" :d="path" /></g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import {findIconDefinition, type IconName} from '@fortawesome/fontawesome-svg-core'
import type {SidebarPanelDefinition} from '@/composables/useSidebarDock'

const props = defineProps<{members: SidebarPanelDefinition[]}>()
const size = computed(() => props.members.length === 2 ? 13 : 11)
// Draw only the registered paths in our coordinate system. Nested icon SVGs
// inherit application icon sizing, which can overflow these small slots.
const glyphs = computed(() => props.members.slice(0, 4).map((member, index) => {
  const [width, height, , , paths] = findIconDefinition({prefix: 'fas', iconName: member.icon as IconName})?.icon
    || [24, 24, [], '', 'M4 4h16v16H4z']
  const scale = Math.min(size.value / width, size.value / height)
  const {x, y} = position(index)
  return {id: member.id, paths: typeof paths === 'string' ? [paths] : paths,
    transform: `translate(${x + (size.value - width * scale) / 2} ${y + (size.value - height * scale) / 2}) scale(${scale})`}
}))
function position(index: number) {
  if (props.members.length === 2) return {x: index * 11, y: index * 11}
  if (props.members.length === 3) return {x: index === 2 ? 6.5 : .5 + index * 12, y: index === 2 ? 13 : 1}
  return {x: .5 + index % 2 * 12, y: .5 + Math.floor(index / 2) * 12}
}
</script>

<style scoped>
.member-clearance { fill: var(--rail-icon-surface, #f7f7f8); transition: fill 150ms ease; }
@media (prefers-reduced-motion: reduce) { .member-clearance { transition: none; } }
</style>
