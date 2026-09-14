<template>
  <v-menu
    v-model="open"
    :location="location"
    :close-on-content-click="false"
    content-class="browser-downloads-menu"
  >
    <template #activator="{ props: menuProps }">
      <button
        type="button"
        :class="btnClass"
        title="下载列表"
        aria-label="下载列表"
        v-bind="menuProps"
      >
        <font-awesome-icon icon="download" />
        <span v-if="activeCount > 0" class="dl-badge" aria-hidden="true">{{
          activeCount > 99 ? '99+' : activeCount
        }}</span>
      </button>
    </template>
    <div class="dl-panel" role="dialog" aria-label="触发式下载列表">
      <div class="dl-panel-head">
        <div class="dl-panel-titles">
          <strong>下载列表</strong>
          <span>浏览器触发的下载</span>
        </div>
        <button
          type="button"
          class="dl-clear"
          :disabled="!items.length"
          title="清空列表"
          @click="clearAll"
        >
          清空
        </button>
      </div>
      <div v-if="!items.length" class="dl-empty">暂无触发式下载</div>
      <ul v-else class="dl-list">
        <li v-for="item in items" :key="item.id" class="dl-item">
          <div class="dl-item-main">
            <div class="dl-name" :title="item.filename">{{ item.filename }}</div>
            <div class="dl-meta">
              <span class="dl-state" :data-state="item.state">{{ stateLabel(item.state) }}</span>
              <span v-if="sizeText(item)" class="dl-size">{{ sizeText(item) }}</span>
            </div>
            <div v-if="item.relPath" class="dl-path" :title="item.relPath">{{ item.relPath }}</div>
            <div v-if="item.error" class="dl-error">{{ item.error }}</div>
            <div
              v-if="item.state === 'started' && progressPct(item) != null"
              class="dl-bar"
              role="progressbar"
              :aria-valuenow="progressPct(item)!"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" :style="{ width: `${progressPct(item)}%` }" />
            </div>
            <div
              v-else-if="item.state === 'started'"
              class="dl-bar indeterminate"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" />
            </div>
          </div>
          <div class="dl-item-actions">
            <button
              v-if="item.state === 'completed'"
              type="button"
              class="dl-act"
              title="打开文件"
              @click="openFile(item.id)"
            >
              打开
            </button>
            <v-menu location="bottom end" :close-on-content-click="true">
              <template #activator="{ props: moreProps }">
                <button
                  type="button"
                  class="dl-act dl-more"
                  title="更多"
                  aria-label="更多"
                  v-bind="moreProps"
                >
                  <font-awesome-icon icon="ellipsis" />
                </button>
              </template>
              <div class="dl-more-panel" role="menu">
                <button
                  v-if="item.state === 'completed'"
                  type="button"
                  class="dl-more-item"
                  role="menuitem"
                  @click="revealFile(item.id)"
                >
                  在文件夹中显示
                </button>
                <button
                  type="button"
                  class="dl-more-item danger"
                  role="menuitem"
                  @click="removeItem(item.id)"
                >
                  从列表移除
                </button>
              </div>
            </v-menu>
          </div>
        </li>
      </ul>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { BrowserDownloadEntry, BrowserDownloadState } from '../../shared/types'

const props = withDefaults(
  defineProps<{
    chatId?: string | null
    /** Scope list to current chat when true. */
    onlyActiveChat?: boolean
    location?: string
    btnClass?: string
  }>(),
  {
    chatId: null,
    onlyActiveChat: false,
    location: 'top end',
    btnClass: 'sidebar-icon-btn',
  },
)

const open = ref(false)
const items = ref<BrowserDownloadEntry[]>([])
let offChanged: (() => void) | null = null

const activeCount = computed(
  () => items.value.filter((d) => d.state === 'intercepted' || d.state === 'started').length,
)

function stateLabel(state: BrowserDownloadState): string {
  switch (state) {
    case 'intercepted':
      return '待确认'
    case 'started':
      return '下载中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return state
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function sizeText(item: BrowserDownloadEntry): string {
  const recv = item.receivedBytes
  const total = item.totalBytes
  if (typeof total === 'number' && total > 0) {
    if (typeof recv === 'number' && recv >= 0 && item.state === 'started') {
      return `${formatBytes(recv)} / ${formatBytes(total)}`
    }
    return formatBytes(total)
  }
  if (typeof recv === 'number' && recv > 0) return formatBytes(recv)
  return ''
}

function progressPct(item: BrowserDownloadEntry): number | null {
  const total = item.totalBytes
  const recv = item.receivedBytes
  if (typeof total !== 'number' || total <= 0 || typeof recv !== 'number') return null
  return Math.max(0, Math.min(100, Math.round((recv / total) * 100)))
}

async function refresh() {
  if (!window.navora?.downloads?.list) {
    items.value = []
    return
  }
  const chatId = props.onlyActiveChat ? props.chatId || undefined : undefined
  items.value = await window.navora.downloads.list(chatId || undefined)
}

async function clearAll() {
  if (!window.navora?.downloads?.clear) return
  const chatId = props.onlyActiveChat ? props.chatId || undefined : undefined
  await window.navora.downloads.clear(chatId || undefined)
  await refresh()
}

async function removeItem(id: string) {
  await window.navora?.downloads?.remove(id)
  await refresh()
}

async function revealFile(id: string) {
  await window.navora?.downloads?.reveal(id)
}

async function openFile(id: string) {
  await window.navora?.downloads?.open(id)
}

watch(
  () => [props.chatId, props.onlyActiveChat] as const,
  () => {
    void refresh()
  },
)

onMounted(() => {
  void refresh()
  offChanged =
    window.navora?.downloads?.onChanged((payload) => {
      const chatId = props.onlyActiveChat ? String(props.chatId || '').trim() : ''
      items.value = chatId
        ? payload.downloads.filter((d) => d.chatId === chatId)
        : payload.downloads
    }) || null
})

onUnmounted(() => {
  offChanged?.()
  offChanged = null
})
</script>

<style scoped>
.dl-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: #e67e22;
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  font-weight: 700;
  pointer-events: none;
}
.dl-panel {
  width: min(360px, 92vw);
  max-height: min(420px, 70vh);
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #1b2631;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}
.dl-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid #e8edf2;
}
.dl-panel-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dl-panel-titles strong {
  font-size: 0.92rem;
}
.dl-panel-titles span {
  font-size: 0.72rem;
  color: #7f8c8d;
}
.dl-clear {
  border: 0;
  background: transparent;
  color: #5d6d7e;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.dl-clear:hover:not(:disabled) {
  background: #f0f3f6;
  color: #1b2631;
}
.dl-clear:disabled {
  opacity: 0.4;
  cursor: default;
}
.dl-empty {
  padding: 28px 16px;
  text-align: center;
  color: #95a5a6;
  font-size: 0.85rem;
}
.dl-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dl-item {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: #f7f9fb;
}
.dl-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dl-name {
  font-size: 0.84rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: #7f8c8d;
}
.dl-state[data-state='intercepted'] {
  color: #d68910;
}
.dl-state[data-state='started'] {
  color: #1b4f72;
}
.dl-state[data-state='completed'] {
  color: #1e8449;
}
.dl-state[data-state='failed'] {
  color: #c0392b;
}
.dl-state[data-state='cancelled'] {
  color: #7f8c8d;
}
.dl-path {
  font-size: 0.7rem;
  color: #95a5a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-error {
  font-size: 0.7rem;
  color: #c0392b;
}
.dl-bar {
  height: 4px;
  border-radius: 999px;
  background: #dde4ea;
  overflow: hidden;
  margin-top: 2px;
}
.dl-bar-fill {
  display: block;
  height: 100%;
  background: #1b4f72;
  border-radius: inherit;
}
.dl-bar.indeterminate .dl-bar-fill {
  width: 36%;
  animation: dl-indeterminate 1.1s ease-in-out infinite;
}
.dl-item-actions {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  flex-shrink: 0;
}
.dl-act {
  border: 0;
  background: #fff;
  color: #1b4f72;
  font-size: 0.72rem;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.dl-act:hover {
  background: #e8eef3;
}
.dl-act.dl-more {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7f8c8d;
}
.dl-more-panel {
  min-width: 148px;
  padding: 4px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
}
.dl-more-item {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  color: #1b2631;
  cursor: pointer;
}
.dl-more-item:hover {
  background: #f0f3f6;
}
.dl-more-item.danger {
  color: #c0392b;
}
.dl-more-item.danger:hover {
  background: #fdecea;
}
@keyframes dl-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}
</style>

<style>
/* Activator needs relative for badge; reuse sidebar / mobile button classes. */
.sidebar-icon-btn,
.mobile-topbar-btn {
  position: relative;
}
.browser-downloads-menu {
  z-index: 2600 !important;
}
.dl-more-panel {
  z-index: 2700;
}
</style>
