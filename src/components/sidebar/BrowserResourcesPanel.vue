<template>
  <div class="sidebar-panel">
    <div class="res-head">
      <button type="button" class="res-label-btn" @click="collapsed = !collapsed">
        <font-awesome-icon :icon="collapsed ? 'chevron-right' : 'chevron-down'" class="res-chevron" />
        <span class="res-label">浏览器资源</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!chatId || busySession"
        :class="{ loading: busySession }"
        title="新建 Session 并打开窗口"
        @click="createSession"
      >
        <font-awesome-icon icon="plus" />
      </button>
    </div>
    <div v-if="!collapsed" class="res-body">
      <div v-if="!chatId" class="res-empty">先选择一个 Chat</div>
      <div v-else-if="!tree.length" class="res-empty">暂无浏览资源，点右侧 + 创建</div>
      <div v-else class="res-tree">
        <div v-for="s in tree" :key="s.sessionId" class="tree-sess">
          <div
            class="tree-row sess"
            draggable="true"
            @dragstart="onDragStart($event, sessionRef(s))"
            @click="emit('add-ref', sessionRef(s))"
            @contextmenu="onSessionMenu($event, s)"
            title="拖到输入框或点击以引用"
          >
            <span class="tree-name">
              Session #{{ s.sessionIndex }}
              <span v-if="s.chatId !== chatId" class="tree-meta">{{ ownerLabel(s.chatId) }}</span>
              <span v-if="!s.persist" class="tree-meta">临时</span>
            </span>
            <span class="tree-actions" @click.stop>
              <button
                type="button"
                class="icon-btn"
                :disabled="busyWindow === s.sessionId"
                title="创建窗口"
                @click="createWindow(s.sessionId)"
              >
                <font-awesome-icon icon="window-maximize" />
              </button>
              <button type="button" class="icon-btn danger" title="关闭 Session" @click="emit('ask-close-session', s)">
                <font-awesome-icon icon="xmark" />
              </button>
            </span>
          </div>
          <div
            v-for="w in s.windows"
            :key="w.windowId"
            class="tree-row win"
            draggable="true"
            @dragstart="onDragStart($event, windowRef(s, w))"
            @click="emit('add-ref', windowRef(s, w))"
            @contextmenu="onWindowMenu($event, s, w)"
            title="拖到输入框或点击以引用"
          >
            <span class="tree-name" :title="w.url">
              {{ w.title || '无标题' }}
              <span v-if="w.loading" class="tree-meta">加载中</span>
              <span v-else-if="!w.visible" class="tree-meta">已隐藏</span>
            </span>
            <span class="tree-actions" @click.stop>
              <button
                type="button"
                class="icon-btn"
                :title="isRemote ? '远程查看/操控此窗口' : w.visible ? '隐藏本机窗口' : '显示本机窗口'"
                @click="toggleVisible(w)"
              >
                <font-awesome-icon :icon="isRemote ? 'window-maximize' : w.visible ? 'eye' : 'eye-slash'" />
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <SidebarContextMenu ref="sessMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', sessionRef(menuSession!))">
        <font-awesome-icon icon="plus" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="createWindow(menuSession!.sessionId)">
        <font-awesome-icon icon="window-maximize" />
        <span>新建窗口</span>
      </button>
      <button
        type="button"
        class="sidebar-more-item danger"
        role="menuitem"
        @click="emit('ask-close-session', menuSession!)"
      >
        <font-awesome-icon icon="xmark" />
        <span>关闭 Session</span>
      </button>
    </SidebarContextMenu>

    <SidebarContextMenu ref="winMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', windowRef(menuSession!, menuWindow!))">
        <font-awesome-icon icon="plus" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="toggleVisible(menuWindow!)">
        <font-awesome-icon :icon="isRemote ? 'window-maximize' : menuWindow?.visible ? 'eye-slash' : 'eye'" />
        <span>{{ isRemote ? '远程查看' : menuWindow?.visible ? '隐藏' : '显示' }}</span>
      </button>
      <button v-if="!isRemote" type="button" class="sidebar-more-item" role="menuitem" @click="focusWindow(menuWindow!)">
        <font-awesome-icon icon="window-maximize" />
        <span>前置</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="copyUrl(menuWindow!)">
        <font-awesome-icon icon="clipboard-list" />
        <span>复制网址</span>
      </button>
      <button type="button" class="sidebar-more-item danger" role="menuitem" @click="closeWindow(menuWindow!)">
        <font-awesome-icon icon="xmark" />
        <span>关闭窗口</span>
      </button>
    </SidebarContextMenu>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { BrowserContextRef, BrowserTreeSession, BrowserTreeWindow } from '@shared/types'
import SidebarContextMenu from './SidebarContextMenu.vue'

const props = defineProps<{
  chatId: string
  tree: BrowserTreeSession[]
  isRemote: boolean
  ownerLabel: (chatId: string) => string
  dndMime: string
}>()

const emit = defineEmits<{
  'add-ref': [ref: BrowserContextRef]
  'ask-close-session': [session: BrowserTreeSession]
  'remote-view': [windowId: string]
  notify: [text: string, color?: string]
}>()

const collapsed = ref(false)
const busySession = ref(false)
const busyWindow = ref<string | null>(null)
const sessMenu = ref<{ show: (e: MouseEvent) => void } | null>(null)
const winMenu = ref<{ show: (e: MouseEvent) => void } | null>(null)
const menuSession = ref<BrowserTreeSession | null>(null)
const menuWindow = ref<BrowserTreeWindow | null>(null)

function sessionRef(s: BrowserTreeSession): BrowserContextRef {
  return {
    kind: 'session',
    sessionId: s.sessionId,
    sessionIndex: s.sessionIndex,
    label: `#${s.sessionIndex}`,
  }
}

function windowRef(s: BrowserTreeSession, w: BrowserTreeWindow): BrowserContextRef {
  return {
    kind: 'window',
    sessionId: s.sessionId,
    windowId: w.windowId,
    sessionIndex: s.sessionIndex,
    label: w.title || w.windowId,
    url: w.url,
  }
}

function onDragStart(e: DragEvent, ref: BrowserContextRef) {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(props.dndMime, JSON.stringify(ref))
  e.dataTransfer.setData('text/plain', ref.kind === 'window' ? `@窗口 ${ref.label}` : `@Session ${ref.label}`)
}

function onSessionMenu(e: MouseEvent, s: BrowserTreeSession) {
  menuSession.value = s
  sessMenu.value?.show(e)
}

function onWindowMenu(e: MouseEvent, s: BrowserTreeSession, w: BrowserTreeWindow) {
  menuSession.value = s
  menuWindow.value = w
  winMenu.value?.show(e)
}

async function createSession() {
  if (!window.navora || !props.chatId) return
  busySession.value = true
  try {
    const sess = await window.navora.browser.createSession(props.chatId, { persist: true })
    await window.navora.browser.createWindow(sess.sessionId)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '创建浏览失败')
  } finally {
    busySession.value = false
  }
}

async function createWindow(sessionId: string) {
  if (!window.navora) return
  busyWindow.value = sessionId
  try {
    await window.navora.browser.createWindow(sessionId)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '创建窗口失败')
  } finally {
    busyWindow.value = null
  }
}

async function toggleVisible(w: BrowserTreeWindow) {
  if (!window.navora) return
  if (props.isRemote) {
    emit('remote-view', w.windowId)
    return
  }
  try {
    await window.navora.browser.setVisible(w.windowId, !w.visible)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '切换窗口显示失败')
  }
}

async function focusWindow(w: BrowserTreeWindow) {
  if (!window.navora) return
  try {
    await window.navora.browser.setVisible(w.windowId, true)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '前置窗口失败')
  }
}

async function closeWindow(w: BrowserTreeWindow) {
  if (!window.navora) return
  try {
    await window.navora.browser.closeWindow(w.windowId)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '关闭窗口失败')
  }
}

async function copyUrl(w: BrowserTreeWindow) {
  const url = String(w.url || '').trim()
  if (!url) {
    emit('notify', '没有网址')
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    emit('notify', '已复制网址', 'primary')
  } catch {
    emit('notify', '复制失败')
  }
}
</script>

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 8px;
  padding: 0 12px 0 2px;
}
.res-label-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  line-height: 1;
}
.res-chevron {
  width: 0.7em;
  font-size: 0.62rem;
  opacity: 0.55;
  flex-shrink: 0;
}
.res-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.65;
}
.res-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 1 auto;
}
.res-empty {
  font-size: 0.75rem;
  opacity: 0.5;
  padding: 4px 12px 8px 2px;
}
.res-tree {
  overflow: auto;
  min-height: 0;
  max-height: min(22vh, 200px);
  padding-bottom: 4px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}
.tree-sess + .tree-sess {
  margin-top: 4px;
}
.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  box-sizing: border-box;
  border-radius: 6px;
  padding: 4px 6px;
  margin-right: 8px;
  cursor: grab;
  font-size: 0.78rem;
  line-height: 1.25;
}
.tree-row:active {
  cursor: grabbing;
}
.tree-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.tree-row.win {
  padding-left: 18px;
  opacity: 0.92;
}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tree-meta {
  margin-left: 4px;
  font-size: 0.65rem;
  opacity: 0.55;
  font-weight: 400;
}
.tree-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.icon-btn {
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 0.72rem;
  line-height: 1;
  cursor: pointer;
}
.res-head > .icon-btn {
  background: transparent;
  color: rgba(236, 240, 241, 0.55);
  border-radius: 5px;
  width: 22px;
  height: 22px;
  font-size: 0.7rem;
}
.res-head > .icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(236, 240, 241, 0.92);
}
.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}
.icon-btn.danger:hover:not(:disabled) {
  background: rgba(231, 76, 60, 0.35);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon-btn.loading {
  opacity: 0.45;
  pointer-events: none;
}
</style>
