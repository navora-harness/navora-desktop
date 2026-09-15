<template>
  <div class="sidebar-panel">
    <div class="res-head">
      <button type="button" class="res-label-btn" @click="collapsed = !collapsed">
        <font-awesome-icon :icon="collapsed ? 'chevron-right' : 'chevron-down'" class="res-chevron" />
        <span class="res-label">工作区</span>
      </button>
      <span class="res-head-actions">
        <button
          type="button"
          class="icon-btn"
          title="在资源管理器中打开"
          :disabled="!chatId || busy"
          @click="revealRoot"
        >
          <font-awesome-icon icon="folder-open" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="刷新"
          :disabled="!chatId || busy"
          @click="reload()"
        >
          <font-awesome-icon icon="arrow-rotate-right" />
        </button>
      </span>
    </div>
    <div v-if="!collapsed" class="res-body" @contextmenu="onRootMenu">
      <div v-if="rootLabel" class="ws-root" :title="absoluteRoot">{{ rootLabel }}</div>
      <div v-if="!chatId" class="res-empty">先选择一个 Chat</div>
      <div v-else-if="loadError" class="res-empty">{{ loadError }}</div>
      <div v-else-if="!rootEntries.length" class="res-empty">空工作区</div>
      <div v-else class="res-tree">
        <WorkspaceTreeNode
          :entries="rootEntries"
          :depth="0"
          :expanded="expanded"
          :children="childrenByPath"
          :loading="loadingDirs"
          :selected="selectedPath"
          @toggle="toggleDir"
          @open="openFile"
          @select="selectEntry"
          @menu="onEntryMenu"
        />
        <div v-if="truncated" class="res-empty">已达列出上限</div>
      </div>
    </div>

    <SidebarContextMenu ref="menu">
      <template v-if="menuEntry">
        <button type="button" class="sidebar-more-item" role="menuitem" @click="openEntry">
          <font-awesome-icon :icon="menuEntry.type === 'dir' ? 'folder-open' : 'arrow-up-right-from-square'" />
          <span>{{ menuEntry.type === 'dir' ? '展开 / 折叠' : '打开' }}</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="revealEntry">
          <font-awesome-icon icon="folder-open" />
          <span>在资源管理器中显示</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="copyPath">
          <font-awesome-icon icon="clipboard-list" />
          <span>复制相对路径</span>
        </button>
        <button type="button" class="sidebar-more-item danger" role="menuitem" @click="askDelete">
          <font-awesome-icon icon="trash" />
          <span>删除</span>
        </button>
      </template>
      <template v-else>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="revealRoot">
          <font-awesome-icon icon="folder-open" />
          <span>在资源管理器中打开</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="reload()">
          <font-awesome-icon icon="arrow-rotate-right" />
          <span>刷新</span>
        </button>
      </template>
    </SidebarContextMenu>

    <v-dialog v-model="deleteOpen" max-width="400" persistent>
      <v-card>
        <v-card-title>删除</v-card-title>
        <v-card-text>
          确定删除 <strong>{{ deleteTarget?.name }}</strong> 吗？此操作不可撤销。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="deleteOpen = false">取消</v-btn>
          <v-btn color="error" :loading="deleting" @click="confirmDelete">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SidebarContextMenu from './SidebarContextMenu.vue'
import WorkspaceTreeNode, { type WsEntry } from './WorkspaceTreeNode.vue'

const props = defineProps<{ chatId: string }>()
const emit = defineEmits<{
  notify: [text: string, color?: string]
}>()

const collapsed = ref(false)
const busy = ref(false)
const rootEntries = ref<WsEntry[]>([])
const childrenByPath = ref<Record<string, WsEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const loadingDirs = ref<Set<string>>(new Set())
const truncated = ref(false)
const loadError = ref('')
const absoluteRoot = ref('')
const menu = ref<{ show: (e: MouseEvent) => void; hide: () => void } | null>(null)
const menuEntry = ref<WsEntry | null>(null)
const deleteOpen = ref(false)
const deleteTarget = ref<WsEntry | null>(null)
const deleting = ref(false)
const selectedPath = ref('')

const rootLabel = computed(() => {
  const abs = absoluteRoot.value
  if (!abs) return ''
  const parts = abs.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return abs
  return `…/${parts.slice(-2).join('/')}`
})

function sortEntries(list: WsEntry[]): WsEntry[] {
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
}

function withLoading(path: string, on: boolean) {
  const next = new Set(loadingDirs.value)
  if (on) next.add(path)
  else next.delete(path)
  loadingDirs.value = next
}

async function listDir(rel: string): Promise<{ entries: WsEntry[]; truncated: boolean; absoluteRoot: string }> {
  const res = await window.navora!.workspace.list(props.chatId, rel || '.')
  if (!res.ok) throw new Error(res.error || 'list_failed')
  return {
    entries: sortEntries(res.entries || []),
    truncated: Boolean(res.truncated),
    absoluteRoot: res.absoluteRoot || '',
  }
}

async function loadDir(rel: string) {
  withLoading(rel, true)
  try {
    const got = await listDir(rel)
    if (rel) {
      childrenByPath.value = { ...childrenByPath.value, [rel]: got.entries }
    } else {
      rootEntries.value = got.entries
      truncated.value = got.truncated
      absoluteRoot.value = got.absoluteRoot
    }
  } finally {
    withLoading(rel, false)
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReload() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void reload()
  }, 150)
}

async function reload() {
  if (!props.chatId || !window.navora?.workspace.list) {
    rootEntries.value = []
    childrenByPath.value = {}
    absoluteRoot.value = ''
    return
  }
  busy.value = true
  loadError.value = ''
  try {
    await loadDir('')
    const still = new Set<string>()
    for (const p of expanded.value) {
      if (!p) continue
      try {
        await loadDir(p)
        still.add(p)
      } catch {
        /* dropped */
      }
    }
    expanded.value = still
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    rootEntries.value = []
  } finally {
    busy.value = false
  }
}

function toggleDir(ent: WsEntry) {
  const next = new Set(expanded.value)
  if (next.has(ent.path)) {
    next.delete(ent.path)
    expanded.value = next
    return
  }
  next.add(ent.path)
  expanded.value = next
  if (!childrenByPath.value[ent.path]) void loadDir(ent.path)
}

function selectEntry(ent: WsEntry) {
  selectedPath.value = ent.path
}

function openFile(ent: WsEntry) {
  selectedPath.value = ent.path
  void openPath(ent.path, 'open')
}

function onEntryMenu(e: MouseEvent, ent: WsEntry) {
  selectedPath.value = ent.path
  menuEntry.value = ent
  menu.value?.show(e)
}

function onRootMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t?.closest('.tree-row')) return
  e.preventDefault()
  menuEntry.value = null
  menu.value?.show(e)
}

async function openPath(rel: string, kind: 'open' | 'reveal') {
  if (!props.chatId || !window.navora?.workspace) return
  try {
    const res =
      kind === 'reveal'
        ? await window.navora.workspace.reveal(props.chatId, rel)
        : await window.navora.workspace.open(props.chatId, rel)
    if (!res?.ok) emit('notify', res?.error || '打开失败')
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '打开失败')
  }
}

function openEntry() {
  const ent = menuEntry.value
  if (!ent) return
  selectedPath.value = ent.path
  if (ent.type === 'dir') toggleDir(ent)
  else void openPath(ent.path, 'open')
}

function revealEntry() {
  const ent = menuEntry.value
  if (!ent) return
  void openPath(ent.path, 'reveal')
}

async function copyPath() {
  const ent = menuEntry.value
  if (!ent) return
  try {
    await navigator.clipboard.writeText(ent.path)
    emit('notify', '已复制路径', 'primary')
  } catch {
    emit('notify', '复制失败')
  }
}

function askDelete() {
  deleteTarget.value = menuEntry.value
  deleteOpen.value = Boolean(deleteTarget.value)
}

async function confirmDelete() {
  if (!props.chatId || !deleteTarget.value || !window.navora?.workspace.delete) return
  deleting.value = true
  try {
    const res = await window.navora.workspace.delete(props.chatId, deleteTarget.value.path)
    if (!res.ok) {
      emit('notify', res.error || '删除失败')
      return
    }
    deleteOpen.value = false
    deleteTarget.value = null
    await reload()
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '删除失败')
  } finally {
    deleting.value = false
  }
}

function revealRoot() {
  if (!props.chatId) return
  void openPath('.', 'reveal')
}

function onFocus() {
  scheduleReload()
}

function onVisibility() {
  if (document.visibilityState === 'visible') scheduleReload()
}

let unsubChanged: (() => void) | undefined
let unsubDownloads: (() => void) | undefined

watch(
  () => props.chatId,
  () => {
    expanded.value = new Set()
    childrenByPath.value = {}
    selectedPath.value = ''
    void reload()
  },
)

onMounted(() => {
  void reload()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  unsubChanged = window.navora?.workspace.onChanged?.((payload) => {
    if (payload.chatId === props.chatId) scheduleReload()
  })
  unsubDownloads = window.navora?.downloads.onChanged?.((payload) => {
    if (!props.chatId) return
    if (payload.downloads.some((d) => d.chatId === props.chatId)) scheduleReload()
  })
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibility)
  unsubChanged?.()
  unsubDownloads?.()
})
</script>

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
}
.res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 6px;
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
.res-head-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.res-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 1 auto;
}
.ws-root {
  flex-shrink: 0;
  font-size: 0.68rem;
  opacity: 0.45;
  padding: 0 12px 4px 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.res-empty {
  font-size: 0.75rem;
  opacity: 0.5;
  padding: 4px 12px 8px 2px;
}
.res-tree {
  overflow: auto;
  min-height: 0;
  max-height: min(28vh, 240px);
  padding-bottom: 4px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}
.icon-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(236, 240, 241, 0.55);
  border-radius: 5px;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(236, 240, 241, 0.92);
}
.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
