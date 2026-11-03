<template>
  <div class="sidebar-panel workspace-panel" :class="{ 'is-collapsed': collapsed }">
    <Teleport :to="headerTarget || 'body'" :disabled="!headerTarget" defer>
    <div v-show="headerVisible !== false && !navigationOnly" class="res-head" :class="{ 'docked-head': headerTarget }">
      <button type="button" v-if="!headerTarget && !embedded" class="res-label-btn" :aria-expanded="!collapsed" aria-label="折叠或展开工作区" @click="collapsed = !collapsed">
        <AppIcon icon="chevron-down" class="res-chevron" />
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
          <AppIcon icon="folder-open" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="刷新"
          :disabled="!chatId || busy"
          @click="reload()"
        >
          <AppIcon icon="arrow-rotate-right" />
        </button>
      </span>
    </div>
    </Teleport>
    <Transition name="resource-body">
    <div v-show="!collapsed" class="res-body" data-ctx-menu="workspace" @contextmenu="onRootMenu">
      <div v-if="rootLabel && !navigationOnly" class="ws-root" :title="absoluteRoot">{{ rootLabel }}</div>
      <div v-if="!chatId" class="res-empty">选择对话后查看文件</div>
      <div v-else-if="loadError" class="res-empty res-error">{{ loadError }}</div>
      <div v-else-if="!visibleRootEntries.length" class="res-empty">暂无文件</div>
      <div v-else class="res-tree">
        <WorkspaceTreeNode
          :entries="visibleRootEntries"
          :depth="0"
          :expanded="expanded"
          :children="visibleChildren"
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
    </Transition>

    <SidebarContextMenu ref="menu">
      <template v-if="menuEntry">
        <button v-if="canOpen(menuEntry)" type="button" class="sidebar-more-item" role="menuitem" @click="openEntry">
          <AppIcon :icon="menuEntry.type === 'dir' ? 'folder-open' : 'arrow-up-right-from-square'" />
          <span>{{ menuEntry.type === 'dir' ? '展开 / 折叠' : '打开' }}</span>
        </button>
        <button v-if="menuDownload?.canPause" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('pause')"><AppIcon icon="pause-circle" /><span>暂停下载</span></button>
        <button v-if="menuDownload?.canResume" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('resume')"><AppIcon icon="arrow-right" /><span>继续下载</span></button>
        <button v-if="menuDownload?.canCancel" type="button" class="sidebar-more-item" role="menuitem" @click="downloadAction('cancel')"><AppIcon icon="xmark" /><span>取消下载</span></button>
        <button v-if="menuDownload?.source==='tool' && activeDownload(menuDownload)" type="button" class="sidebar-more-item" role="menuitem" title="停止所属对话的当前任务，包括正在运行的其他工具" @click="stopDownloadTask"><AppIcon icon="stop" /><span>停止当前任务</span></button>
        <button v-if="menuDownload && !activeDownload(menuDownload)" type="button" class="sidebar-more-item" role="menuitem" title="仅移除下载状态，保留已保存文件" @click="downloadAction('remove')"><AppIcon icon="xmark" /><span>移除下载状态</span></button>
        <button v-if="!menuEntry.virtual" type="button" class="sidebar-more-item" role="menuitem" @click="revealEntry">
          <AppIcon icon="folder-open" />
          <span>在资源管理器中显示</span>
        </button>
        <button v-if="!menuEntry.path.startsWith(':download/')" type="button" class="sidebar-more-item" role="menuitem" @click="copyPath">
          <AppIcon icon="copy" />
          <span>复制相对路径</span>
        </button>
        <button v-if="!menuEntry.virtual && (!menuDownload || !activeDownload(menuDownload))" type="button" class="sidebar-more-item danger" role="menuitem" @click="askDelete">
          <AppIcon icon="trash" />
          <span>删除</span>
        </button>
      </template>
      <template v-else>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="revealRoot">
          <AppIcon icon="folder-open" />
          <span>在资源管理器中打开</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="reload()">
          <AppIcon icon="arrow-rotate-right" />
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
import type { BrowserDownloadEntry } from '@shared/types'
import { activeDownload, downloadRelativePath, mergeWorkspaceDownloads } from '@shared/workspace-downloads'

const props = withDefaults(defineProps<{ chatId: string; headerTarget?: string; headerVisible?: boolean; embedded?: boolean; navigationOnly?:boolean; downloads?:BrowserDownloadEntry[] }>(), {headerVisible:true})
const emit = defineEmits<{
  notify: [text: string, color?: string]
  preview: [entry: WsEntry]
  browse: [path:string]
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
const downloads = ref<BrowserDownloadEntry[]>([])
const awaitingDisk = ref(new Set<string>())
const seenDownloads = new Set<string>()
const visibleRootEntries = computed(() => mergeWorkspaceDownloads(rootEntries.value, '', props.chatId, downloads.value, awaitingDisk.value))
const visibleChildren = computed(() => {
  const paths = new Set(Object.keys(childrenByPath.value))
  for (const item of downloads.value) {
    const parts = downloadRelativePath(item)?.split('/') || []
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'))
  }
  return Object.fromEntries([...paths].map(path => [path, mergeWorkspaceDownloads(childrenByPath.value[path] || [], path, props.chatId, downloads.value, awaitingDisk.value)]))
})
const menuDownload = computed(() => downloads.value.find(item => item.id === menuEntry.value?.download?.id))

function virtualDirectory(path:string):boolean {
  const parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):''
  return Boolean((parent ? visibleChildren.value[parent] : visibleRootEntries.value)?.find(entry=>entry.path===path)?.virtual)
}

function updateDownloads(items:BrowserDownloadEntry[]) {
  const next = items.filter(item => item.chatId === props.chatId)
  const before = downloads.value
  const changed = next.map(item=>`${item.id}:${item.state}:${item.relPath || ''}`).sort().join('|') !== before.map(item=>`${item.id}:${item.state}:${item.relPath || ''}`).sort().join('|')
  const pending = new Set([...awaitingDisk.value].filter(id=>next.some(item=>item.id===id)))
  const folders = new Set(expanded.value)
  for (const item of next) {
    const previous=before.find(old=>old.id===item.id)
    if (item.state==='completed' && (!previous || previous.state!=='completed' || previous.relPath!==item.relPath)) pending.add(item.id)
    const key=`${item.id}:${item.relPath || ''}`
    if (!seenDownloads.has(key) && activeDownload(item)) {
      const parts=downloadRelativePath(item)?.split('/') || []
      for (let i=1;i<parts.length;i++) folders.add(parts.slice(0,i).join('/'))
    }
    seenDownloads.add(key)
  }
  awaitingDisk.value=pending
  expanded.value=folders
  downloads.value=next
  if(changed)scheduleReload()
}

const rootLabel = computed(() => {
  const abs = absoluteRoot.value
  if (!abs) return ''
  const parts = abs.replace(/\\/g, '/').split('/').filter(Boolean)
  if (/^chat_[a-z0-9]+$/i.test(parts.at(-1) || '')) return '对话文件夹'
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
  const chatId=props.chatId
  withLoading(rel, true)
  try {
    const got = await listDir(rel)
    if(disposed || props.chatId!==chatId)return
    if (rel) {
      childrenByPath.value = { ...childrenByPath.value, [rel]: got.entries }
    } else {
      rootEntries.value = got.entries
      truncated.value = got.truncated
      absoluteRoot.value = got.absoluteRoot
    }
  } finally {
    if(props.chatId===chatId)withLoading(rel, false)
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let disposed=false, reloadAgain=false, downloadRevision=0
function scheduleReload() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void reload()
  }, 150)
}

async function reload() {
  if(disposed)return
  if(busy.value){reloadAgain=true;return}
  if (!props.chatId || !window.navora?.workspace.list) {
    rootEntries.value = []
    childrenByPath.value = {}
    absoluteRoot.value = ''
    return
  }
  busy.value = true
  const chatId=props.chatId, verified=new Set(awaitingDisk.value)
  loadError.value = ''
  try {
    await loadDir('')
    if(disposed || props.chatId!==chatId)return
    const still = new Set<string>(), checked=new Set(expanded.value)
    for (const p of checked) {
      if (!p) continue
      try {
        await loadDir(p)
        if(expanded.value.has(p))still.add(p)
      } catch {
        if(virtualDirectory(p)&&expanded.value.has(p))still.add(p)
      }
    }
    if(props.chatId!==chatId || disposed)return
    expanded.value = new Set([...still,...[...expanded.value].filter(path=>!checked.has(path))])
    awaitingDisk.value=new Set([...awaitingDisk.value].filter(id=>!verified.has(id)))
  } catch (e) {
    if(props.chatId===chatId&&!disposed){loadError.value = e instanceof Error ? e.message : String(e);rootEntries.value = []}
  } finally {
    busy.value = false
    if(reloadAgain&&!disposed){reloadAgain=false;void reload()}
  }
}

function toggleDir(ent: WsEntry) {
  if (props.navigationOnly) emit('browse',ent.path)
  const next = new Set(expanded.value)
  if (next.has(ent.path)) {
    next.delete(ent.path)
    expanded.value = next
    return
  }
  next.add(ent.path)
  expanded.value = next
  if (!ent.virtual && !childrenByPath.value[ent.path]) void loadDir(ent.path).catch(()=>emit('notify','无法读取此文件夹'))
}

function canOpen(ent:WsEntry):boolean {
  const download=downloads.value.find(item=>item.id===ent.download?.id)||ent.download
  return ent.type==='dir'||(!ent.virtual&&(!download||download.state==='completed'))
}

function selectEntry(ent: WsEntry, activate=true) {
  selectedPath.value = ent.path
  if(!activate)return
  if (ent.type === 'file' && canOpen(ent)) emit('preview', ent)
  else if(ent.type==='dir'&&props.navigationOnly) emit('browse',ent.path)
}

function openFile(ent: WsEntry) {
  selectedPath.value = ent.path
  if(canOpen(ent))emit('preview', ent)
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
  else if(canOpen(ent))emit('preview', ent)
}

async function downloadAction(action:'pause'|'resume'|'cancel'|'remove') {
  const item=menuDownload.value
  if(!item||!window.navora?.downloads)return
  try {
    const result=await window.navora.downloads[action](item.id)
    if(result && !result.ok)emit('notify',('error' in result && String(result.error)) || '下载操作失败')
    updateDownloads(await window.navora.downloads.list(props.chatId))
  } catch(error){emit('notify',error instanceof Error?error.message:'下载操作失败')}
}

async function stopDownloadTask(){
  const item=menuDownload.value
  if(item?.source!=='tool'||!activeDownload(item))return
  try{await window.navora?.agent.stop(item.chatId)}catch{emit('notify','停止任务失败')}
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
  void openPath('.', 'open')
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
    downloadRevision++
    expanded.value = new Set()
    loadingDirs.value = new Set()
    rootEntries.value=[]
    childrenByPath.value = {}
    selectedPath.value = ''
    seenDownloads.clear()
    awaitingDisk.value=new Set()
    updateDownloads(props.downloads||[])
    if(props.downloads===undefined)void fetchDownloads()
    void reload()
  },
)
watch(()=>props.downloads,items=>{if(items)updateDownloads(items)},{immediate:true})

async function fetchDownloads(){
  const revision=downloadRevision,chatId=props.chatId
  try{const items=await window.navora?.downloads.list(chatId);if(items&&!disposed&&revision===downloadRevision&&chatId===props.chatId)updateDownloads(items)}catch{ /* File listing remains available if downloads cannot be read. */ }
}

onMounted(() => {
  void reload()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  unsubChanged = window.navora?.workspace.onChanged?.((payload) => {
    if (payload.chatId === props.chatId) scheduleReload()
  })
  if(props.downloads===undefined){
    void fetchDownloads()
    unsubDownloads = window.navora?.downloads.onChanged?.((payload) => {
      downloadRevision++
      updateDownloads(payload.downloads)
    })
  }
})

onBeforeUnmount(() => {
  disposed=true
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
  background: #e8edf4;
  color: #34465c;
}
.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
