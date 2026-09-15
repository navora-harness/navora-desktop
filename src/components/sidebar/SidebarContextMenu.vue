<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="ctx-scrim"
      @mousedown.prevent="hide"
      @contextmenu.prevent="hide"
    />
    <div
      v-if="open"
      ref="panelEl"
      class="sidebar-ctx-panel"
      role="menu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @click="hide"
      @contextmenu.prevent
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const open = ref(false)
const x = ref(0)
const y = ref(0)
const panelEl = ref<HTMLElement | null>(null)

function show(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  x.value = e.clientX
  y.value = e.clientY
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
  const rect = node.getBoundingClientRect()
  let nx = x.value
  let ny = y.value
  if (nx + rect.width > window.innerWidth - pad) {
    nx = Math.max(pad, window.innerWidth - rect.width - pad)
  }
  if (ny + rect.height > window.innerHeight - pad) {
    ny = Math.max(pad, window.innerHeight - rect.height - pad)
  }
  x.value = nx
  y.value = ny
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
</style>
