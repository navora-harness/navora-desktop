<template>
  <button
    type="button"
    class="subchat-link"
    :data-subchat-id="chatId"
    :data-status="pending ? 'attention' : status"
    :disabled="disabled"
    :title="displayTitle"
    :aria-label="`打开子对话：${displayTitle}${statusLabel ? `，${statusLabel}` : ''}`"
    @click="emit('open', chatId)"
  >
    <img class="subchat-link-glyph" :src="subchatGlyphUrl(chatId)" alt="" aria-hidden="true" />
    <span class="subchat-link-title">{{ displayTitle }}</span>
    <span v-if="statusLabel" class="subchat-link-status">{{ statusLabel }}</span>
    <AppIcon v-if="!disabled" class="subchat-link-chevron" icon="chevron-right" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SubChatRunStatus } from '@shared/types'
import {subchatStatusLabels} from '@shared/subchat-presentation'
import {useSubchatGlyph} from '@/composables/useSubchatGlyph'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps<{
  chatId: string
  title?: string
  status?: SubChatRunStatus
  pending?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ open: [chatId: string] }>()
const {glyphUrl:subchatGlyphUrl}=useSubchatGlyph()
const displayTitle = computed(() => props.title?.trim() || '子对话')
const statusLabel = computed(() => props.pending ? '需要处理' : props.status ? subchatStatusLabels[props.status] : '')
</script>

<style scoped>
.subchat-link {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  min-width: 0;
  width: fit-content;
  max-width: min(100%, 640px);
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--navora-ink);
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  text-align: left;
  vertical-align: middle;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.subchat-link-glyph {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  object-fit: contain;
}

.subchat-link-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subchat-link-status {
  flex: none;
  padding-left: 9px;
  border-left: 1px solid var(--navora-stroke);
  color: var(--navora-muted);
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
}

.subchat-link[data-status='attention'] .subchat-link-status {
  color: var(--navora-ink);
  font-weight: 600;
}

.subchat-link-chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  color: var(--navora-muted);
  opacity: .35;
  transition: opacity 120ms ease;
}

@media (hover: hover) {
  .subchat-link:hover:not(:disabled) {
    background: color-mix(in srgb, var(--navora-ink) 5%, transparent);
    border-color: color-mix(in srgb, var(--navora-ink) 7%, transparent);
  }

  .subchat-link:hover .subchat-link-chevron {
    opacity: .8;
  }
}

.subchat-link:focus-visible {
  outline: 2px solid var(--control-focus, var(--navora-accent));
  outline-offset: 2px;
  background: color-mix(in srgb, var(--navora-ink) 5%, transparent);
}

.subchat-link:focus-visible .subchat-link-chevron {
  opacity: .8;
}

.subchat-link:disabled {
  opacity: .6;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .subchat-link,
  .subchat-link-chevron {
    transition: none;
  }
}
</style>
