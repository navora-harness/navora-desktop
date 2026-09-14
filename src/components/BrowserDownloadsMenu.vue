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
          :disabled="!finishedCount"
          :title="finishedCount ? '清除已结束的下载' : '没有可清除的已结束项'"
          @click="clearFinished"
        >
          清空已结束
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
            <div v-if="item.error && isTerminal(item.state)" class="dl-error">{{ item.error }}</div>
            <div
              v-if="showProgress(item) && progressPct(item) != null"
              class="dl-bar"
              role="progressbar"
              :aria-valuenow="progressPct(item)!"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" :style="{ width: `${progressPct(item)}%` }" />
            </div>
            <div
              v-else-if="showProgress(item)"
              class="dl-bar indeterminate"
              :class="{ paused: item.state === 'paused' }"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="dl-bar-fill" />
            </div>
          </div>
          <div class="dl-item-actions">
            <button
              v-if="item.state === 'started'"
              type="button"
              class="dl-act"
              :disabled="!item.canPause"
              title="暂停下载"
              @click="pauseItem(item.id)"
            >
              暂停
            </button>
            <button
              v-if="item.state === 'paused'"
              type="button"
              class="dl-act"
              :disabled="!item.canResume"
              :title="item.canResume ? '继续下载' : '当前无法恢复'"
              @click="resumeItem(item.id)"
            >
              继续
            </button>
            <button
              v-if="item.state === 'intercepted' || item.state === 'started' || item.state === 'paused'"
              type="button"
              class="dl-act danger"
              :disabled="item.canCancel === false"
              :title="cancelTitle(item)"
              @click="cancelItem(item.id)"
            >
              取消
            </button>
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
                  :title="removeTitle(item)"
                  @click="removeItem(item.id)"
                >
                  {{ removeLabel(item) }}
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
  () =>
    items.value.filter(
      (d) => d.state === 'intercepted' || d.state === 'started' || d.state === 'paused',
    ).length,
)

const finishedCount = computed(
  () => items.value.filter((d) => isTerminal(d.state)).length,
)

function isTerminal(state: BrowserDownloadState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

function showProgress(item: BrowserDownloadEntry): boolean {
  return item.state === 'started' || item.state === 'paused'
}

function stateLabel(state: BrowserDownloadState): string {
  switch (state) {
    case 'intercepted':
      return '待确认'
    case 'started':
      return '下载中'
    case 'paused':
      return '已暂停'
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

function cancelTitle(item: BrowserDownloadEntry): string {
  if (item.state === 'intercepted') return '拒绝并取消此次下载'
  if (item.canCancel === false) return '当前无法取消'
  return '取消下载'
}

function removeLabel(item: BrowserDownloadEntry): string {
  if (item.state === 'intercepted' || item.state === 'started' || item.state === 'paused') {
    return '取消并移除'
  }
  return '从列表移除'
}

function removeTitle(item: BrowserDownloadEntry): string {
  if (item.state === 'intercepted' || item.state === 'started' || item.state === 'paused') {
    return '取消下载并从列表移除'
  }
  return '仅从列表移除（不删除已保存文件）'
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
    if (
      typeof recv === 'number' &&
      recv >= 0 &&
      (item.state === 'started' || item.state === 'paused')
    ) {
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

async function clearFinished() {
  if (!window.navora?.downloads?.clear || !finishedCount.value) return
  const chatId = props.onlyActiveChat ? props.chatId || undefined : undefined
  await window.navora.downloads.clear(chatId || undefined)
  await refresh()
}

async function removeItem(id: string) {
  await window.navora?.downloads?.remove(id)
  await refresh()
}

async function pauseItem(id: string) {
  const res = await window.navora?.downloads?.pause?.(id)
  if (res && !res.ok) console.warn('[downloads] pause failed', res.error)
  await refresh()
}

async function resumeItem(id: string) {
  const res = await window.navora?.downloads?.resume?.(id)
  if (res && !res.ok) console.warn('[downloads] resume failed', res.error)
  await refresh()
}

async function cancelItem(id: string) {
  const res = await window.navora?.downloads?.cancel?.(id)
  if (res && !res.ok) console.warn('[downloads] cancel failed', res.error)
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
  width: min(380px, 92vw);
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
  white-space: nowrap;
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
.dl-state[data-state='paused'] {
  color: #b9770e;
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
.dl-bar.indeterminate.paused .dl-bar-fill {
  animation-play-state: paused;
  background: #b9770e;
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
.dl-act:hover:not(:disabled) {
  background: #e8eef3;
}
.dl-act:disabled {
  opacity: 0.4;
  cursor: default;
}
.dl-act.danger {
  color: #c0392b;
}
.dl-act.danger:hover:not(:disabled) {
  background: #fdecea;
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
