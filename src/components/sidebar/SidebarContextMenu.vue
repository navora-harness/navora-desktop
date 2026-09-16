<template>
  <Teleport to="body">
    <Transition name="ctx-scrim">
      <div
        v-if="open"
        class="ctx-scrim"
        @mousedown.prevent="hide"
        @contextmenu.prevent="hide"
      />
    </Transition>
    <Transition name="ctx-pop">
      <div
        v-if="open"
        ref="panelEl"
        class="sidebar-ctx-panel"
        role="menu"
        :style="{
          left: `${x}px`,
          top: `${y}px`,
          transformOrigin: origin,
        }"
        @click="hide"
        @contextmenu.prevent
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const open = ref(false)
const x = ref(0)
const y = ref(0)
const origin = ref('top left')
const panelEl = ref<HTMLElement | null>(null)
let clickX = 0
let clickY = 0

function show(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  clickX = e.clientX
  clickY = e.clientY
  x.value = e.clientX
  y.value = e.clientY
  origin.value = 'top left'
  open.value = true
  void nextTick(clamp)
}

function hide() {
  open.value = false
}

function clamp() {
  const node = panelEl.value
  if (!node) return
  const pad = 8
  const width = node.offsetWidth
  const height = node.offsetHeight
  let nx = x.value
  let ny = y.value
  let ox = 'left'
  let oy = 'top'
  if (nx + width > window.innerWidth - pad) {
    nx = Math.max(pad, clickX - width)
    ox = 'right'
  }
  if (ny + height > window.innerHeight - pad) {
    ny = Math.max(pad, clickY - height)
    oy = 'bottom'
  }
  x.value = nx
  y.value = ny
  origin.value = `${oy} ${ox}`
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

defineExpose({ show, hide, open })
</script>

<style scoped>
.ctx-scrim {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.sidebar-ctx-panel {
  position: fixed;
  z-index: 81;
  min-width: 168px;
  padding: 6px;
  background: #1c2833;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  will-change: transform, opacity;
}
.sidebar-ctx-panel :deep(.sidebar-more-item) {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(236, 240, 241, 0.92);
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
}
.sidebar-ctx-panel :deep(.sidebar-more-item:hover:not(:disabled)) {
  background: rgba(255, 255, 255, 0.08);
}
.sidebar-ctx-panel :deep(.sidebar-more-item:disabled) {
  opacity: 0.45;
  cursor: default;
}
.sidebar-ctx-panel :deep(.sidebar-more-item.danger) {
  color: #f1948a;
}
.sidebar-ctx-panel :deep(.sidebar-more-item.danger:hover:not(:disabled)) {
  background: rgba(231, 76, 60, 0.14);
}

.ctx-scrim-enter-active,
.ctx-scrim-leave-active {
  transition: opacity 0.12s ease;
}
.ctx-scrim-enter-from,
.ctx-scrim-leave-to {
  opacity: 0;
}

.ctx-pop-enter-active {
  transition:
    opacity 0.14s ease,
    transform 0.16s cubic-bezier(0.2, 0.85, 0.25, 1);
}
.ctx-pop-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.ctx-pop-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.ctx-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
