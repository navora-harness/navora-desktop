<template>
  <div class="sidebar-panel browser-panel" :class="{ 'is-collapsed': collapsed }">
    <Teleport :to="headerTarget || 'body'" :disabled="!headerTarget" defer>
    <div v-show="headerVisible !== false" class="res-head" :class="{ 'docked-head': headerTarget }">
      <button type="button" v-if="!headerTarget && !embedded" class="res-label-btn" :aria-expanded="!collapsed" aria-label="折叠或展开浏览器资源" @click="collapsed = !collapsed">
        <AppIcon icon="chevron-down" class="res-chevron" />
        <span class="res-label">浏览器资源</span>
      </button>
      <span v-if="embedded" class="embedded-browser-title">浏览器会话</span>
      <div class="res-head-actions">
      <button type="button" class="quick-browser-btn icon-btn" :disabled="!chatId || busyQuickOpen" title="打开或复用浏览器（Ctrl/⌘ Shift B）" aria-label="快速打开浏览器" @click="quickOpen"><AppIcon :icon="busyQuickOpen ? 'circle-notch' : 'arrow-up-right-from-square'" :spin="busyQuickOpen" /></button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!chatId || busySession"
        :class="{ loading: busySession }"
        title="新建浏览器会话并打开页面"
        aria-label="新建浏览器会话"
        @click="createSession"
      >
        <AppIcon icon="plus" />
      </button>
      </div>
    </div>
    </Teleport>
    <Transition name="resource-body">
    <div v-show="!collapsed" class="res-body" data-ctx-menu="browser">
      <div v-if="!chatId" class="res-empty">选择对话后使用浏览器</div>
      <div v-else-if="!tree.length" class="res-empty">暂无浏览器页面</div>
      <div v-else class="res-tree">
        <button v-if="emptySessions.length" type="button" class="empty-session-group" :aria-expanded="emptySessionsExpanded" @click="emptySessionsExpanded = !emptySessionsExpanded">
          <AppIcon :icon="emptySessionsExpanded ? 'chevron-down' : 'chevron-right'" class="empty-session-chevron" />
          <AppIcon icon="layer-group" class="tree-kind-icon session-kind-icon" />
          <span>空会话</span>
          <span class="empty-session-count">{{ emptySessions.length }}</span>
        </button>
        <div v-for="s in visibleSessions" :key="s.sessionId" class="tree-sess">
          <div
            class="tree-row sess"
            :class="{'is-empty':!s.windows.length}"
            draggable="true"
            @dragstart="onDragStart($event, sessionRef(s))" @dragend="($event.currentTarget as HTMLElement).classList.remove('dragging')"
            @click="emit('add-ref', sessionRef(s))"
          @contextmenu="onSessionMenu($event, s)"
          title="拖到输入框或点击以引用"
        >
            <button type="button" class="tree-disclosure" :aria-label="`${expandedSessions.has(s.sessionId)?'折叠':'展开'}会话 ${s.sessionIndex}`" :aria-expanded="expandedSessions.has(s.sessionId)" @click.stop="toggleSession(s.sessionId)"><AppIcon :icon="expandedSessions.has(s.sessionId)?'chevron-down':'chevron-right'" /></button>
            <button type="button" class="tree-name" @click.stop="emit('add-ref', sessionRef(s))">
              <AppIcon icon="layer-group" class="tree-kind-icon session-kind-icon" />
              <span class="session-copy"><span class="session-title">会话 {{ s.sessionIndex }}</span><span v-if="!s.windows.length" class="session-empty-hint">暂无页面</span></span>
              <span v-if="s.chatId !== chatId" class="tree-meta">{{ ownerLabel(s.chatId) }}</span>
              <span v-if="s.windows.length" class="tree-meta">{{ s.windows.length }} 个页面</span>
              <span class="session-lifetime" :class="{persistent:s.persist}">{{ s.persist ? '已保留' : '临时' }}</span>
            </button>
            <span class="tree-actions" @click.stop>
              <button
                type="button"
                class="icon-btn"
                :disabled="busyWindow === s.sessionId"
                title="新建页面"
                aria-label="在此会话中新建页面"
                @click="createWindow(s.sessionId)"
              >
                <AppIcon :icon="s.windows.length?'browser':'plus'" />
              </button>
              <button type="button" class="icon-btn" title="会话更多操作" aria-label="会话更多操作" @click="onSessionMenu($event,s)"><AppIcon icon="ellipsis" /></button>
            </span>
          </div>
          <div v-show="expandedSessions.has(s.sessionId)" class="tree-children">
            <div
              v-for="w in s.windows"
              :key="w.windowId"
              class="tree-row win"
              :class="{'is-selected':w.selected}"
              draggable="true"
              @dragstart="onDragStart($event, windowRef(s, w))" @dragend="($event.currentTarget as HTMLElement).classList.remove('dragging')"
              @click="showPage(w)"
              @contextmenu="onWindowMenu($event, s, w)"
              title="点击显示页面，拖到输入框可引用"
            >
              <button type="button" class="tree-name" :title="w.url" :aria-current="w.selected?'page':undefined" @click.stop="showPage(w)">
                <span class="tree-kind-icon browser-kind-icon"><AppIcon icon="browser" /></span>
                <span class="page-title">{{ windowLabel(s,w) }}</span>
                <span v-if="w.loading" class="tree-meta">加载中</span>
              </button>
              <span class="tree-actions" @click.stop>
                <button type="button" class="icon-btn" title="引用到输入框" aria-label="引用此页面到输入框" @click="emit('add-ref',windowRef(s,w))"><AppIcon icon="paperclip" /></button>
                <button type="button" class="icon-btn" title="页面更多操作" aria-label="页面更多操作" @click="onWindowMenu($event,s,w)"><AppIcon icon="ellipsis" /></button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <SidebarContextMenu ref="sessMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', sessionRef(menuSession!))">
        <AppIcon icon="plus" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="createWindow(menuSession!.sessionId)">
        <AppIcon icon="browser" />
        <span>新建页面</span>
      </button>
      <button
        type="button"
        class="sidebar-more-item danger"
        role="menuitem"
        @click="emit('ask-close-session', menuSession!)"
      >
        <AppIcon icon="xmark" />
        <span>释放会话与登录状态</span>
      </button>
    </SidebarContextMenu>

    <SidebarContextMenu ref="winMenu">
      <button type="button" class="sidebar-more-item" role="menuitem" @click="emit('add-ref', windowRef(menuSession!, menuWindow!))">
        <AppIcon icon="plus" />
        <span>引用到输入框</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="showPage(menuWindow!)">
        <AppIcon icon="browser" />
        <span>{{ isRemote ? '远程查看' : '打开页面' }}</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="copyUrl(menuWindow!)">
        <AppIcon icon="clipboard-list" />
        <span>复制网址</span>
      </button>
      <button type="button" class="sidebar-more-item danger" role="menuitem" @click="closeWindow(menuWindow!)">
        <AppIcon icon="xmark" />
        <span>关闭页面</span>
      </button>
    </SidebarContextMenu>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import { computed, ref,watch } from 'vue'
import type { BrowserContextRef, BrowserTreeSession, BrowserTreeWindow } from '@shared/types'
import SidebarContextMenu from './SidebarContextMenu.vue'

const props = withDefaults(defineProps<{
  headerTarget?: string
  headerVisible?: boolean
  embedded?: boolean
  chatId: string
  tree: BrowserTreeSession[]
  isRemote: boolean
  ownerLabel: (chatId: string) => string
  dndMime: string
}>(), {headerVisible:true})

const emit = defineEmits<{
  'add-ref': [ref: BrowserContextRef]
  'ask-close-session': [session: BrowserTreeSession]
  'remote-view': [windowId: string]
  notify: [text: string, color?: string]
}>()

const collapsed = ref(false)
const busySession = ref(false)
const busyQuickOpen = ref(false)
const busyWindow = ref<string | null>(null)
const sessMenu = ref<{ show: (e: MouseEvent) => void } | null>(null)
const winMenu = ref<{ show: (e: MouseEvent) => void } | null>(null)
const menuSession = ref<BrowserTreeSession | null>(null)
const menuWindow = ref<BrowserTreeWindow | null>(null)
const expandedSessions=ref(new Set<string>())
const emptySessionsExpanded=ref(false)
const emptySessions=computed(()=>props.tree.filter(session=>!session.windows.length))
const visibleSessions=computed(()=>[
  ...props.tree.filter(session=>session.windows.length),
  ...(emptySessionsExpanded.value?emptySessions.value:[]),
])
watch(()=>props.tree.map(session=>session.sessionId),ids=>{
  const live=new Set(ids)
  for(const id of ids)if(!expandedSessions.value.has(id))expandedSessions.value.add(id)
  for(const id of expandedSessions.value)if(!live.has(id))expandedSessions.value.delete(id)
},{immediate:true})
function toggleSession(id:string){if(expandedSessions.value.has(id))expandedSessions.value.delete(id);else expandedSessions.value.add(id)}

function sessionRef(s: BrowserTreeSession): BrowserContextRef {
  return {
    kind: 'session',
    sessionId: s.sessionId,
    sessionIndex: s.sessionIndex,
    label: `#${s.sessionIndex}`,
  }
}

function windowLabel(s:BrowserTreeSession,w:BrowserTreeWindow){
  const label=w.title||(w.url==='about:blank'?'新标签页':'无标题')
  const duplicates=s.windows.filter(item=>(item.title||(item.url==='about:blank'?'新标签页':'无标题'))===label)
  return duplicates.length>1?`${label} ${duplicates.findIndex(item=>item.windowId===w.windowId)+1}`:label
}

function windowRef(s: BrowserTreeSession, w: BrowserTreeWindow): BrowserContextRef {
  return {
    kind: 'window',
    sessionId: s.sessionId,
    windowId: w.windowId,
    sessionIndex: s.sessionIndex,
    label: windowLabel(s,w),
    url: w.url,
  }
}

function onDragStart(e: DragEvent, ref: BrowserContextRef) {
  if (!e.dataTransfer) return
  ;(e.currentTarget as HTMLElement)?.classList.add('dragging')
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

async function quickOpen() {
  if (!window.navora || !props.chatId || busyQuickOpen.value) return
  busyQuickOpen.value = true
  collapsed.value = false
  try {
    const existing = props.tree.flatMap(s => s.windows)[0]
    if (existing) { await focusWindow(existing); return }
    const session = props.tree[0] || await window.navora.browser.createSession(props.chatId, { persist: false })
    await window.navora.browser.createWindow(session.sessionId, { show: true })
  } catch (error) { emit('notify', error instanceof Error ? error.message : '打开浏览器失败') }
  finally { busyQuickOpen.value = false }
}
defineExpose({ quickOpen })

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

async function focusWindow(w: BrowserTreeWindow) {
  if (!window.navora) return
  try {
    await window.navora.browser.setVisible(w.windowId, true)
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '前置窗口失败')
  }
}
function showPage(w:BrowserTreeWindow){if(props.isRemote)emit('remote-view',w.windowId);else void focusWindow(w)}

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
.empty-session-group{display:flex;align-items:center;gap:7px;width:100%;min-height:30px;margin:2px 0 4px;padding:4px 8px;border:0;border-radius:6px;background:transparent;color:#77869a;text-align:left;font:inherit;font-size:11px;cursor:default}
.empty-session-group:hover{background:#edf1f5;color:#465a72}
.empty-session-chevron{width:9px;height:9px;flex:0 0 9px}
.empty-session-count{margin-left:auto;color:#8793a2;font-size:10px;font-variant-numeric:tabular-nums}
.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  box-sizing: border-box;
  border-radius: 6px;
  padding: 4px 6px;
  margin-right: 8px;
  cursor: auto;
  font-size: 0.78rem;
  line-height: 1.25;
}
.tree-row.dragging {cursor:grabbing}
.tree-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.tree-row.win {
  padding-left: 8px;
  opacity: 0.92;
}
.tree-children{margin:2px 0 4px 16px;padding:2px 0 2px 9px;border-left:1px solid #d7dfe8}
.tree-children .tree-row.win{position:relative}
.tree-children .tree-row.win::after{content:'';position:absolute;left:-10px;top:50%;width:9px;height:1px;background:#d7dfe8}
.tree-disclosure{display:grid;place-items:center;width:16px;height:24px;flex:0 0 16px;padding:0;border:0;border-radius:4px;background:transparent;color:#7d8998;cursor:default}
.tree-disclosure:hover{background:#e3eaf2;color:#405a77}
.tree-disclosure>.app-icon{width:10px;height:10px}
.tree-kind-icon{display:grid;place-items:center;width:15px;height:15px;flex:0 0 15px;color:#68809a}
.tree-kind-icon>.app-icon{width:14px;height:14px}
.session-kind-icon{color:#7385a0}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tree-row.sess .tree-name{gap:6px}.tree-row.sess.is-empty{min-height:48px;background:#f7f9fc;border-color:#e4eaf1}.tree-row.sess.is-empty .tree-name{min-width:0;flex:1}.session-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;overflow:hidden}.session-empty-hint{overflow:hidden;text-overflow:ellipsis;font-size:9px;color:#8a96a6;line-height:1.35;white-space:nowrap}.tree-row.sess.is-empty .tree-actions .icon-btn:first-child{color:#476c98;background:#e9f0f8}
.tree-row.win .tree-name{display:flex;align-items:center;gap:7px}
.tree-row.win .page-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
  background: #e8edf4;
  color: #34465c;
}
.icon-btn:hover:not(:disabled) {
  background: #e8edf4;
  color: #34465c;
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
.embedded-browser-title{font-size:10px;color:#7d899a;flex:1}.res-head:has(.embedded-browser-title){justify-content:space-between}.tree-row{margin-right:0;min-height:34px;padding:5px 6px;color:#4b5d74;border:1px solid transparent}.tree-row.sess{background:#f0f3f7}.tree-row:hover{background:#e8eef5;border-color:#d5dfeb}.tree-name{text-align:left;display:flex;align-items:center;gap:6px;font-size:12px}.session-title{overflow:hidden;text-overflow:ellipsis;color:#3e526c;font-weight:500;white-space:nowrap}.tree-meta{font-size:10px;margin:0;color:#7a8798;opacity:1}.session-lifetime{flex:0 0 auto;font-size:9px;color:#808b99;white-space:nowrap}.session-lifetime.persistent{color:#60806c}.tree-actions{gap:1px}.tree-actions .icon-btn{width:24px;height:24px;background:transparent;border-radius:6px;color:#6d7e94}.tree-actions .icon-btn.danger:hover{color:#b64747;background:#f8eaea}.tree-row.win .tree-meta{margin-left:5px}.res-head-actions .icon-btn{background:transparent}.icon-btn:focus-visible,.tree-name:focus-visible,.tree-disclosure:focus-visible{outline:2px solid #5d80aa;outline-offset:-2px}
.browser-panel button{cursor:pointer;pointer-events:auto}
.browser-panel .tree-row{pointer-events:auto}
</style>
<style scoped>
.tree-row.win.is-selected{position:relative;border-radius:7px;background:var(--control-selected);color:var(--navora-accent)}
.tree-row.win.is-selected::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--navora-accent)}
.tree-row.win.is-selected .tree-name{color:var(--navora-accent);font-weight:500}
.empty-session-group:focus-visible{outline:2px solid #5d80aa;outline-offset:-2px}
</style>
