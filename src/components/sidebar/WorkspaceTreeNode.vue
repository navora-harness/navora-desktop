<template>
  <div class="ws-nodes">
    <div v-for="ent in entries" :key="ent.path">
      <button
        type="button"
        class="tree-row"
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
export type WsEntry = {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

defineOptions({ name: 'WorkspaceTreeNode' })

defineProps<{
  entries: WsEntry[]
  depth: number
  expanded: Set<string>
  children: Record<string, WsEntry[]>
  loading: Set<string>
  selected: string
}>()

const emit = defineEmits<{
  toggle: [ent: WsEntry]
  open: [ent: WsEntry]
  select: [ent: WsEntry]
  menu: [e: MouseEvent, ent: WsEntry]
}>()

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
