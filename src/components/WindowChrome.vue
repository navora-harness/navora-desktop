<template>
  <div class="win-chrome" role="toolbar" aria-label="窗口控制">
    <button
      type="button"
      class="win-chrome-btn"
      title="最小化"
      aria-label="最小化"
      @mousedown.prevent.stop
      @click.prevent.stop="minimize"
    >
      <font-awesome-icon icon="window-minimize" />
    </button>
    <button
      type="button"
      class="win-chrome-btn"
      :title="maximized ? '向下还原' : '最大化'"
      :aria-label="maximized ? '向下还原' : '最大化'"
      @mousedown.prevent.stop
      @click.prevent.stop="toggleMaximize"
    >
      <font-awesome-icon :icon="maximized ? 'window-restore' : 'window-maximize'" />
    </button>
    <button
      type="button"
      class="win-chrome-btn close"
      title="关闭"
      aria-label="关闭"
      @mousedown.prevent.stop
      @click.prevent.stop="closeWin"
    >
      <font-awesome-icon icon="xmark" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const maximized = ref(false)
let offMax: (() => void) | null = null

async function refresh() {
  const res = await window.navora?.app.isMaximized?.()
  maximized.value = Boolean(res?.maximized)
}

function minimize() {
  void window.navora?.app.minimize?.()
}

function toggleMaximize() {
  void window.navora?.app.toggleMaximize?.()
}

function closeWin() {
  void window.navora?.app.close?.()
}

onMounted(() => {
  void refresh()
  offMax =
    window.navora?.app.onMaximized?.((v) => {
      maximized.value = v
    }) || null
})

onUnmounted(() => {
  offMax?.()
  offMax = null
})
</script>

<style scoped>
.win-chrome {
  display: flex;
  align-items: stretch;
  height: 36px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.win-chrome-btn {
  width: 46px;
  height: 36px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #6b7c8d;
  cursor: default;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  -webkit-app-region: no-drag;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.win-chrome-btn:hover {
  background: rgba(21, 32, 43, 0.08);
  color: #15202b;
}
.win-chrome-btn:active {
  background: rgba(21, 32, 43, 0.14);
}
.win-chrome-btn.close:hover {
  background: #e74c3c;
  color: #fff;
}
.win-chrome-btn.close:active {
  background: #c0392b;
}
</style>
