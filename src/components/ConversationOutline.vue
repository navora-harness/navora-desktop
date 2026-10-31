<template>
  <nav v-if="items.length > 1" class="conversation-outline" aria-label="对话位置">
    <div class="outline-list" @keydown="onKeydown">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        class="outline-step"
        :class="{ current: activeId === item.id }"
        :data-message-id="item.id"
        :aria-label="`第 ${index + 1} 轮：${item.text}`"
        :aria-current="activeId === item.id ? 'location' : undefined"
        @mouseenter="showPreview($event, item, index)"
        @mouseleave="preview = null"
        @focus="showPreview($event, item, index)"
        @blur="preview = null"
        @click="jump(item.id)"
      ><svg viewBox="0 0 24 12" width="24" height="12" fill="none" aria-hidden="true"><path d="M5 6h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button>
    </div>
    <Teleport to="body">
      <div v-if="preview" class="outline-preview" role="tooltip" :style="preview.style">
        <span class="outline-preview-index">第 {{ preview.index + 1 }} 轮</span>
        <div>{{ preview.text }}</div>
      </div>
    </Teleport>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { ChatMessage } from '@shared/types'

const props = defineProps<{ messages: ChatMessage[]; scrollContainer: HTMLElement | null }>()
const emit = defineEmits<{ jump: [messageId: string] }>()
const items = computed(() => props.messages.filter(m => m.role === 'user').map(m => ({ id: m.id, text: m.content.trim().replace(/\s+/g, ' ') || '附带资源的提问' })))
const activeId = ref('')
const preview = ref<{ text: string; index: number; style: Record<string, string> } | null>(null)
let frame = 0
let detach = () => {}

function updatePosition() {
  frame = 0
  const container = props.scrollContainer
  if (!container || !items.value.length) return
  if (container.scrollHeight - container.clientHeight - container.scrollTop < 6) {
    activeId.value = items.value.at(-1)!.id
    return
  }
  const boundary = container.getBoundingClientRect().top + 44
  let low = 0, high = items.value.length - 1, current = 0
  // Binary search keeps a long conversation's scroll handler small.
  while (low <= high) {
    const middle = (low + high) >>> 1
    const element = container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(items.value[middle]!.id)}"]`)
    if (element && element.getBoundingClientRect().top <= boundary) { current = middle; low = middle + 1 }
    else high = middle - 1
  }
  activeId.value = items.value[current]!.id
}
function schedulePosition() { if (!frame) frame = requestAnimationFrame(updatePosition) }
function onViewportResize() { preview.value = null; schedulePosition() }
window.addEventListener('resize', onViewportResize)
watch(() => props.scrollContainer, container => {
  detach()
  preview.value = null
  if (!container) return
  container.addEventListener('scroll', schedulePosition, { passive: true })
  const resize = new ResizeObserver(schedulePosition)
  const content = new MutationObserver(schedulePosition)
  resize.observe(container)
  content.observe(container, { childList: true, subtree: true, characterData: true })
  detach = () => { container.removeEventListener('scroll', schedulePosition); resize.disconnect(); content.disconnect() }
  schedulePosition()
}, { immediate: true, flush: 'post' })
watch(() => items.value.map(item => item.id).join(','), () => { preview.value = null; void nextTick(schedulePosition) })

function showPreview(event: Event, item: { text: string }, index: number) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  preview.value = { text: item.text, index, style: {
    left: `${Math.max(12, rect.left - 272)}px`,
    top: `${Math.max(12, Math.min(innerHeight - 118, rect.top - 30))}px`,
  } }
}
function jump(id: string) { activeId.value = id; preview.value = null; emit('jump', id) }
function onKeydown(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Escape') { preview.value = null; return }
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
  buttons[index]?.focus({ preventScroll: true })
  buttons[index]?.scrollIntoView({ block: 'nearest' })
}
onUnmounted(() => { detach(); cancelAnimationFrame(frame); window.removeEventListener('resize', onViewportResize) })
</script>

<style scoped>
.conversation-outline { position: absolute; right: 6px; top: 16px; bottom: 16px; width: 32px; display: flex; align-items: center; z-index: 3; }
.outline-list { width: 100%; max-height: 65%; overflow-y: auto; scrollbar-width: none; padding: 4px; }
.outline-step { display: grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; background: transparent; color: #8793a3; border-radius: 5px; cursor: pointer; transition: color 140ms ease, background-color 140ms ease; }
.outline-step svg { transform: scaleX(.7); transition: transform 140ms ease; }
.outline-step.current { color: #5d708b; }
.outline-step.current svg, .outline-step:hover svg { transform: scaleX(1); }
.outline-step:hover, .outline-step:focus-visible { background: #edf0f5; color: #526782; }
.outline-step:focus-visible { outline: 2px solid #537ab9; outline-offset: -1px; }
.outline-preview { position: fixed; z-index: 2400; width: 252px; padding: 11px 13px; border: 1px solid #dfe4ec; border-radius: 10px; background: #fff; color: #39475a; box-shadow: 0 6px 24px #1f2c4314; font: 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif; pointer-events: none; animation: outline-preview-in 140ms ease-out; }
.outline-preview-index { display: block; margin-bottom: 4px; color: #8390a1; font-size: 10px; }
.outline-preview > div { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
@keyframes outline-preview-in { from { opacity: 0; transform: translateX(4px); } to { opacity: 1; transform: translateX(0); } }
@media(max-width:1100px) { .conversation-outline { display: none; } }
@media(prefers-reduced-motion:reduce) { .outline-preview { animation: none; } .outline-step, .outline-step svg { transition: none; } }
</style>
