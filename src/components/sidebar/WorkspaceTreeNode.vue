<template>
  <div class="ws-nodes" :role="depth === 0 ? 'tree' : 'group'" :aria-label="depth === 0 ? '工作区文件' : undefined">
    <div v-for="ent in entries" :key="ent.path">
      <button
        type="button"
        class="tree-row"
        role="treeitem"
        :tabindex="selected === ent.path || (!hasVisibleSelection && depth === 0 && entries[0]?.path === ent.path) ? 0 : -1"
        @focus="emit('select', ent)"
        :aria-level="depth + 1"
        :aria-expanded="ent.type === 'dir' ? expanded.has(ent.path) : undefined"
        :aria-selected="selected === ent.path"
        :data-depth="depth"
        @keydown="onKeydown($event, ent)"
        :class="{
          dir: ent.type === 'dir',
          open: ent.type === 'dir' && expanded.has(ent.path),
          selected: selected === ent.path,
        }"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        :title="ent.path"
        @click="emit('select', ent)"
        @dblclick="ent.type === 'dir' ? emit('toggle', ent) : emit('open', ent)"
        @contextmenu.prevent="emit('menu', $event, ent)"
      >
        <span
          v-if="ent.type === 'dir'"
          class="ws-twist"
          @click.stop="emit('toggle', ent)"
        >
          <font-awesome-icon
            :icon="expanded.has(ent.path) ? 'chevron-down' : 'chevron-right'"
          />
        </span>
        <span v-else class="ws-twist hidden" />
        <font-awesome-icon
          :icon="ent.type === 'dir' ? (expanded.has(ent.path) ? 'folder-open' : 'folder') : 'file'"
          class="ws-icon"
        />
        <span class="tree-name">{{ ent.name }}</span>
      </button>
      <div v-if="ent.type === 'dir' && expanded.has(ent.path)" class="ws-kids">
        <div v-if="loading.has(ent.path)" class="ws-hint">加载中…</div>
        <WorkspaceTreeNode
          v-else-if="(children[ent.path] || []).length"
          :entries="children[ent.path] || []"
          :depth="depth + 1"
          :expanded="expanded"
          :children="children"
          :loading="loading"
          :selected="selected"
          @toggle="emit('toggle', $event)"
          @open="emit('open', $event)"
          @select="emit('select', $event)"
          @menu="forwardMenu"
        />
        <div v-else class="ws-hint" :style="{ paddingLeft: `${24 + (depth + 1) * 12}px` }">空</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue'
export type WsEntry = {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

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
  select: [ent: WsEntry]
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
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: calc(100% - 8px);
  gap: 5px;
  margin: 0;
  border: 0;
  border-radius: 6px;
  padding: 3px 6px 3px 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.78rem;
  line-height: 1.25;
  text-align: left;
  cursor: pointer;
}
.tree-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.tree-row.selected {
  background: rgba(93, 173, 226, 0.22);
}
.tree-row.selected:hover {
  background: rgba(93, 173, 226, 0.3);
}
.ws-twist {
  display: inline-grid;
  place-items: center;
  width: 12px;
  flex-shrink: 0;
  font-size: 0.58rem;
  opacity: 0.55;
}
.ws-twist.hidden {
  visibility: hidden;
}
.ws-icon {
  opacity: 0.62;
  font-size: 0.72rem;
  width: 0.9em;
  flex-shrink: 0;
}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.ws-hint {
  font-size: 0.7rem;
  opacity: 0.4;
  padding: 2px 8px 6px;
}
</style>
