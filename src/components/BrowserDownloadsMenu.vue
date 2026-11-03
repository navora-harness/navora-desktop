<template>
  <v-menu v-model="open" :location="location" origin="auto" :offset="6" :close-on-content-click="false" content-class="browser-downloads-menu">
    <template #activator="{ props: menuProps }">
      <button
        type="button"
        :class="btnClass"
        class="browser-downloads-trigger"
        :title="activeCount ? `下载列表，${activeCount} 项活动下载` : '下载列表'"
        :aria-label="activeCount ? `下载列表，${activeCount} 项活动下载` : '下载列表'"
        v-bind="menuProps"
      >
        <svg class="dl-progress-ring" :class="{'has-progress':progressItems.length>0,indeterminate:progressItems.length>0&&progressPercent===null,paused:!progressItems.some(item=>item.state==='started')}" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="dl-progress-track" cx="12" cy="12" r="9" />
          <circle v-if="progressItems.length" class="dl-progress-value" cx="12" cy="12" r="9" :stroke-dasharray="56.55" :stroke-dashoffset="progressPercent===null?42:56.55*(1-progressPercent/100)" />
        </svg>
        <AppIcon icon="download" />
        <span v-if="activeCount > 0 && (!progressItems.length || activeCount > 1)" class="dl-badge" aria-hidden="true">{{
          activeCount > 99 ? '99+' : activeCount
        }}</span>
      </button>
    </template>
    <div class="dl-panel" role="dialog" aria-label="下载列表">
      <div class="dl-panel-head">
        <div class="dl-panel-titles">
          <strong>下载列表</strong>
          <span>浏览器与工具下载</span>
        </div>
        <button
          type="button"
          class="dl-clear"
          :disabled="!finishedCount"
          :title="finishedCount ? '清除已结束的下载记录，保留文件' : '没有可清除的已结束项'"
          @click="clearFinished"
        >
          清除已结束记录
        </button>
      </div>
      <div v-if="!items.length" class="dl-empty">暂无下载</div>
      <ul v-else class="dl-list">
        <li v-for="item in items" :key="item.id" class="dl-item">
          <div class="dl-item-main">
            <div class="dl-name" :title="item.filename">{{ item.filename }}</div>
            <div class="dl-meta">
              <span class="dl-source">{{ item.source === 'tool' ? '工具' : '浏览器' }}</span>
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
              v-if="item.state === 'started' && item.canPause"
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
              v-if="item.source !== 'tool' && (item.state === 'intercepted' || item.state === 'started' || item.state === 'paused')"
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
            <button v-if="item.source === 'tool' && item.state === 'started'" type="button" class="dl-act danger" title="停止此下载所在的任务" @click="stopToolTask(item.chatId)">停止任务</button>
            <v-menu v-if="item.source !== 'tool' || isTerminal(item.state)" location="bottom end" origin="auto" :offset="6" content-class="browser-download-actions" :close-on-content-click="true">
              <template #activator="{ props: moreProps }">
                <button
                  type="button"
                  class="dl-act dl-more"
                  title="更多"
                  aria-label="下载更多操作"
                  v-bind="moreProps"
                >
                  <AppIcon icon="ellipsis" />
                </button>
              </template>
              <div class="dl-more-panel" role="menu" aria-label="下载更多操作">
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
import { VMenu } from 'vuetify/components'
import type { BrowserDownloadEntry, BrowserDownloadState } from '../../shared/types'

const props = withDefaults(
  defineProps<{
    chatId?: string | null
    /** Scope list to current chat when true. */
    onlyActiveChat?: boolean
    location?: InstanceType<typeof VMenu>['$props']['location']
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
const emit=defineEmits<{open:[value:boolean]}>()
watch(open,value=>{emit('open',value);if(value)void refresh()})
const items = ref<BrowserDownloadEntry[]>([])
let offChanged: (() => void) | null = null

const activeCount = computed(
  () =>
    items.value.filter(
      (d) => d.state === 'intercepted' || d.state === 'started' || d.state === 'paused',
    ).length,
)
const progressItems=computed(()=>items.value.filter(item=>item.state==='started'||item.state==='paused'))
const progressPercent=computed(()=>{
  if(!progressItems.value.length||progressItems.value.some(item=>progressPct(item)===null))return null
  const total=progressItems.value.reduce((sum,item)=>sum+Number(item.totalBytes||0),0)
  const received=progressItems.value.reduce((sum,item)=>sum+Number(item.receivedBytes||0),0)
  return total>0?Math.max(0,Math.min(100,Math.round(received/total*100))):null
})

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

async function stopToolTask(chatId: string) { await window.navora?.agent.stop(chatId); await refresh() }

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
.browser-downloads-trigger{position:relative;flex-shrink:0;color:#65717e;transition:background-color 140ms ease,color 140ms ease}
.browser-downloads-trigger:hover:not(:disabled){color:#3d4957}
.browser-downloads-trigger>.dl-progress-ring:not(.has-progress){display:none}
.browser-downloads-trigger>.dl-progress-ring{position:absolute;inset:6px;width:20px;height:20px;overflow:visible;pointer-events:none}
.dl-progress-ring circle{fill:none;stroke-width:2}
.dl-progress-ring .dl-progress-track{stroke:#e2e5e9}
.dl-progress-ring .dl-progress-value{stroke:#737c86;stroke-linecap:round;transform:rotate(-90deg);transform-origin:12px 12px;transition:stroke-dashoffset 180ms ease}
.dl-progress-ring.indeterminate{animation:dl-ring-rotate 1.1s linear infinite}
.dl-progress-ring.indeterminate .dl-progress-value{stroke-dasharray:14 42}
.dl-progress-ring.indeterminate.paused{animation:none}
.browser-downloads-trigger>.app-icon{position:relative;z-index:1;width:16px;height:16px}
@keyframes dl-ring-rotate{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dl-progress-ring.indeterminate{animation:none}}
.dl-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--navora-accent);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  font-weight: 700;
  pointer-events: none;
}
.dl-panel {
  width: min(380px, calc(100vw - 24px));
  max-height: min(420px, calc(100dvh - 80px));
  display: flex;
  flex-direction: column;
  background: var(--navora-surface);
  color: var(--navora-ink);
  border-radius: 12px;
  border: 1px solid var(--navora-stroke);
  box-shadow: 0 4px 12px #18202b0a, 0 12px 32px #18202b12;
  overflow: hidden;
}
.dl-panel-head {
  flex-wrap: wrap;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--navora-stroke);
}
.dl-panel-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dl-panel-titles strong {
  font-size: 14px;
}
.dl-panel-titles span {
  font-size: 12px;
  color: var(--navora-muted);
}
.dl-clear {
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--navora-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
.dl-clear:hover:not(:disabled) {
  background: var(--control-hover);
  color: var(--navora-ink);
}
.dl-clear:disabled {
  opacity: 0.4;
  cursor: default;
}
.dl-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--navora-muted);
  font-size: 13px;
}
.dl-list {
  min-height: 0;
  overscroll-behavior: contain;
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
  background: var(--navora-background);
}
.dl-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dl-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-meta {
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--navora-muted);
}
.dl-state[data-state='intercepted'] {
  color: #d68910;
}
.dl-state[data-state='started'] {
  color: var(--navora-accent);
}
.dl-state[data-state='paused'] {
  color: #b9770e;
}
.dl-state[data-state='completed'] {
  color: #1e8449;
}
.dl-state[data-state='failed'] {
  color: var(--control-danger);
}
.dl-state[data-state='cancelled'] {
  color: var(--navora-muted);
}
.dl-path {
  font-size: 11px;
  color: var(--navora-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-error {
  font-size: 11px;
  color: var(--control-danger);
}
.dl-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--navora-stroke);
  overflow: hidden;
  margin-top: 2px;
}
.dl-bar-fill {
  display: block;
  height: 100%;
  background: var(--navora-accent);
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
  min-height: 28px;
  border: 0;
  background: var(--navora-surface);
  color: var(--navora-accent);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.dl-act:hover:not(:disabled) {
  background: var(--control-hover);
}
.dl-act:disabled {
  opacity: 0.4;
  cursor: default;
}
.dl-act.danger {
  color: var(--control-danger);
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
  color: var(--navora-muted);
}
.dl-more-panel {
  min-width: 148px;
  padding: 4px;
  background: var(--navora-surface);
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
  font-size: 12px;
  color: var(--navora-ink);
  cursor: pointer;
}
.dl-more-item:hover {
  background: var(--control-hover);
}
.dl-more-item.danger {
  color: var(--control-danger);
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
.dl-panel :is(button):focus-visible,.dl-more-panel button:focus-visible{outline:2px solid var(--control-focus);outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.dl-bar.indeterminate .dl-bar-fill{animation:none;width:100%;opacity:.55}}
@media(pointer:coarse){.dl-panel button,.dl-more-panel button{min-height:44px}}
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
.v-menu.v-overlay>.v-overlay__content:is(.browser-downloads-menu,.browser-download-actions){padding:0;border:0;border-radius:12px;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;overflow:visible}
.v-menu.v-overlay>.v-overlay__content.browser-downloads-menu>.dl-panel,.v-menu.v-overlay>.v-overlay__content.browser-download-actions>.dl-more-panel{background:var(--navora-surface);border:1px solid var(--navora-stroke);border-radius:12px;box-shadow:0 4px 12px #18202b0a,0 12px 32px #18202b12;backdrop-filter:none}
.browser-downloads-menu button,.browser-download-actions button{cursor:default}
.dl-more-panel {
  z-index: 2700;
}
</style>
