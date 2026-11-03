<template>
  <div class="ws-nodes" :role="depth === 0 ? 'tree' : 'group'" :aria-label="depth === 0 ? '工作区文件' : undefined">
    <div v-for="ent in entries" :key="ent.path" class="ws-item" :style="{'--tree-level':depth}">
      <button
        type="button"
        class="tree-row"
        role="treeitem"
        :tabindex="selected === ent.path || (!hasVisibleSelection && depth === 0 && entries[0]?.path === ent.path) ? 0 : -1"
        @focus="emit('select', ent, false)"
        :aria-level="depth + 1"
        :aria-expanded="ent.type === 'dir' ? expanded.has(ent.path) : undefined"
        :aria-selected="selected === ent.path"
        :data-depth="depth"
        :data-path="ent.path"
        :data-download-state="ent.download?.state"
        @keydown="onKeydown($event, ent)"
        :class="{
          dir: ent.type === 'dir',
          open: ent.type === 'dir' && expanded.has(ent.path),
          selected: selected === ent.path,
          nested: depth > 0,
        }"
        :style="{ '--tree-indent': `${8 + depth * 16}px`, paddingLeft: `${8 + depth * 16}px` }"
        :title="ent.download ? `${ent.name}\n${downloadDetail(ent.download)}${ent.virtual ? '' : `\n${ent.path}`}` : ent.path"
        @click="emit('select', ent, true)"
        @dblclick="ent.type === 'dir' ? emit('toggle', ent) : emit('open', ent)"
        @contextmenu.prevent="emit('menu', $event, ent)"
      >
        <span
          v-if="ent.type === 'dir'"
          class="ws-twist"
          @click.stop="emit('toggle', ent)"
        >
          <AppIcon icon="chevron-right" />
        </span>
        <span v-else class="ws-twist hidden" />
        <AppIcon
          :icon="ent.type === 'dir' ? (expanded.has(ent.path) ? 'folder-open' : 'folder') : 'file'"
          class="ws-icon"
        />
        <span class="tree-name">{{ ent.name }}</span>
        <FileDownloadIndicator v-if="ent.download" :download="ent.download" />
        <span v-if="ent.activeDownloads" class="file-download-status started" :title="`${ent.activeDownloads} 个文件正在下载`"><AppIcon icon="download" />{{ ent.activeDownloads }}</span>
      </button>
      <div v-if="ent.type === 'dir' && expanded.has(ent.path)" class="ws-kids">
        <div v-if="loading.has(ent.path) && !(children[ent.path] || []).length" class="ws-hint">加载中…</div>
        <WorkspaceTreeNode
          v-if="(children[ent.path] || []).length"
          :entries="children[ent.path] || []"
          :depth="depth + 1"
          :expanded="expanded"
          :children="children"
          :loading="loading"
          :selected="selected"
          @toggle="emit('toggle', $event)"
          @open="emit('open', $event)"
          @select="(entry,activate) => emit('select', entry, activate)"
          @menu="forwardMenu"
        />
        <div v-else-if="!loading.has(ent.path)" class="ws-hint" :style="{ paddingLeft: `${28 + (depth + 1) * 16}px` }">空</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { downloadDetail, type WorkspaceTreeEntry } from '@shared/workspace-downloads'
import FileDownloadIndicator from '../FileDownloadIndicator.vue'
export type WsEntry = WorkspaceTreeEntry

defineOptions({ name: 'WorkspaceTreeNode' })

const props = defineProps<{
  entries: WsEntry[]
  depth: number
  expanded: Set<string>
  children: Record<string, WsEntry[]>
  loading: Set<string>
  selected: string
}>()

const hasVisibleSelection = computed(() => {
  const visit = (entries:WsEntry[]):boolean => entries.some(ent => ent.path === props.selected || (props.expanded.has(ent.path) && visit(props.children[ent.path] || [])))
  return visit(props.entries)
})
const emit = defineEmits<{
  toggle: [ent: WsEntry]
  open: [ent: WsEntry]
  select: [ent: WsEntry, activate?:boolean]
  menu: [e: MouseEvent, ent: WsEntry]
}>()

async function onKeydown(event: KeyboardEvent, ent: WsEntry) {
  const row = event.currentTarget as HTMLElement
  const tree = row.closest('[role="tree"]')
  const rows = [...(tree?.querySelectorAll<HTMLElement>('.tree-row') || [])].filter(el => el.checkVisibility())
  const current = rows.indexOf(row)
  let target: HTMLElement | undefined
  if (event.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, current + 1)]
  else if (event.key === 'ArrowUp') target = rows[Math.max(0, current - 1)]
  else if (event.key === 'Home') target = rows[0]
  else if (event.key === 'End') target = rows.at(-1)
  else if (event.key === 'ArrowRight' && ent.type === 'dir') {
    if (!props.expanded.has(ent.path)) emit('toggle', ent)
    else target = rows[current + 1]
  } else if (event.key === 'ArrowLeft') {
    if (ent.type === 'dir' && props.expanded.has(ent.path)) emit('toggle', ent)
    else target = rows.slice(0, current).reverse().find(el => Number(el.dataset.depth) < props.depth)
  } else if (event.key === 'Enter') {
    ent.type === 'dir' ? emit('toggle', ent) : emit('open', ent)
  } else return
  event.preventDefault()
  if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
  await nextTick()
}
function forwardMenu(e: MouseEvent, ent: WsEntry) {
  emit('menu', e, ent)
}
</script>

<style scoped>
.ws-nodes {
  min-width: 0;
}
.tree-row {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  min-height: 28px;
  gap: 6px;
  margin: 0;
  border: 0;
  border-radius: 6px;
  padding: 3px 6px 3px 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.ws-nodes > .ws-item > .tree-row:hover {
  background: var(--control-hover,rgba(30,43,66,.05));
}
.ws-nodes > .ws-item > .tree-row.selected {
  background: var(--control-selected,rgba(50,105,172,.1));
  box-shadow: inset 2px 0 rgba(83,127,179,.6);
}
.tree-row.selected .tree-name { color:#34577a; }
.ws-kids { position:relative; }
.ws-kids::before { content:'';position:absolute;left:calc(15px + var(--tree-level)*16px);top:0;bottom:14px;width:1px;background:#dce3eb;pointer-events:none; }
.tree-row.nested::before { content:'';position:absolute;left:calc(var(--tree-indent) - 9px);top:50%;width:6px;height:1px;background:#dce3eb;pointer-events:none; }
.tree-row { transition:background-color 140ms ease; }
.ws-twist svg { width:10px;height:10px;transition:transform 140ms ease; }
.tree-row.open > .ws-twist svg { transform:rotate(90deg); }
@media(prefers-reduced-motion:reduce) {
  .tree-row,.ws-twist svg { transition:none; }
}
.ws-twist {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 22px;
  flex-shrink: 0;
  font-size: 0.58rem;
  color:#8290a2;
}
.ws-twist.hidden {
  visibility: hidden;
}
.ws-icon {
  color:#8290a2;
  width:13px;
  height:13px;
  flex-shrink: 0;
}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.file-download-status{display:inline-flex;align-items:center;gap:3px;flex-shrink:0;font-size:10px;color:var(--navora-muted,#7c8999);white-space:nowrap}
.file-download-status svg{width:11px;height:11px}
.file-download-status.started{color:var(--navora-accent,#4f78a3)}
.file-download-status.completed{color:#548477}
.file-download-status.failed{color:#b46957}
.ws-hint {
  font-size: 0.7rem;
  opacity: 0.4;
  padding: 2px 8px 6px;
}
</style>
