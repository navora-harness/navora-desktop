<template>
  <SidebarContextMenu ref="menu">
    <template v-if="state?.kind === 'edit'">
      <template v-if="state.selected && !state.password">
        <div class="sidebar-ctx-label" role="presentation">文本</div>
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="state.readonly"
          @click="onCut"
        >
          <AppIcon icon="scissors" />
          <span>剪切</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="onCopy">
          <AppIcon icon="copy" />
          <span>复制</span>
        </button>
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="state.readonly"
          @click="onDelete"
        >
          <AppIcon icon="xmark" />
          <span>删除</span>
        </button>
      </template>
      <div
        class="sidebar-ctx-label"
        :class="{ 'with-sep': !!(state.selected && !state.password) }"
        role="presentation"
      >
        输入框
      </div>
      <button
        type="button"
        class="sidebar-more-item"
        role="menuitem"
        :disabled="state.readonly"
        @click="onPaste"
      >
        <AppIcon icon="paste" />
        <span>粘贴</span>
      </button>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="onSelectAll">
        <AppIcon icon="check" />
        <span>全选</span>
      </button>
    </template>
    <template v-else-if="state?.kind === 'selection'">
      <div class="sidebar-ctx-label" role="presentation">文本</div>
      <button type="button" class="sidebar-more-item" role="menuitem" @click="onCopy">
        <AppIcon icon="copy" />
        <span>复制</span>
      </button>
    </template>
  </SidebarContextMenu>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SidebarContextMenu from '@/components/sidebar/SidebarContextMenu.vue'
import {
  copyTextToClipboard,
  editableCut,
  editableDeleteSelection,
  editablePaste,
  editableSelectAll,
  editableSelection,
  findEditable,
  isOwnedContextRegion,
  windowTextSelection,
  type EditableTarget,
} from '@/utils/editable-context'

type MenuState =
  | {
      kind: 'edit'
      target: EditableTarget
      selected: string
      start: number
      end: number
      readonly: boolean
      password: boolean
      text: string
      range?: Range
    }
  | { kind: 'selection'; selected: string }

const menu = ref<{ show: (e: MouseEvent) => void; hide: () => void } | null>(null)
const state = ref<MenuState | null>(null)

function onContextMenu(e: MouseEvent) {
  if (e.button !== 2) return
  const target = e.target
  // Structured editors own their document selection, link commands and undo.
  // Native title inputs inside a source block still use the ordinary menu.
  if(target instanceof Element&&target.closest('[data-composer-editor]')&&!target.closest('input,textarea'))return

  const editable = findEditable(target)
  if (editable) {
    // Editable fields always use the shared edit menu, even inside owned regions
    // (e.g. rename title input on a chat row).
    e.preventDefault()
    e.stopPropagation()
    const sel = editableSelection(editable)
    const password =
      editable.kind === 'input' && editable.el.type.toLowerCase() === 'password'
    const readonly =
      editable.kind === 'contenteditable'
        ? false
        : Boolean((editable.el as HTMLInputElement | HTMLTextAreaElement).readOnly)
    state.value = {
      kind: 'edit',
      target: editable,
      selected: sel.selected,
      start: sel.start,
      end: sel.end,
      readonly,
      password,
      text:editable.kind==='contenteditable'?editable.el.textContent||'':editable.el.value,
      ...(editable.kind==='contenteditable'&&window.getSelection()?.rangeCount?{range:window.getSelection()!.getRangeAt(0).cloneRange()}:{}),
    }
    menu.value?.show(e)
    return
  }

  // Non-editable: leave specialized menus alone.
  if (isOwnedContextRegion(target)) return

  const selected = windowTextSelection()
  if (!selected) return
  const selNode = window.getSelection()?.anchorNode
  const selEl = selNode instanceof Element ? selNode : selNode?.parentElement
  if (selEl?.closest?.('[data-ctx-menu]')) return

  e.preventDefault()
  e.stopPropagation()
  state.value = { kind: 'selection', selected }
  menu.value?.show(e)
}

async function onCopy() {
  const s = state.value
  if (!s?.selected) return
  if (s.kind === 'edit' && s.password) return
  await copyTextToClipboard(s.selected)
}

function onCut() {
  const s = state.value
  if (!s || s.kind !== 'edit' || !s.selected || s.readonly || s.password||!restoreEditable(s)) return
  editableCut(s.target, s.start, s.end, s.selected)
}

async function onPaste() {
  const s = state.value
  if (!s || s.kind !== 'edit' || s.readonly||!restoreEditable(s)) return
  await editablePaste(s.target, s.start, s.end)
}

function onDelete() {
  const s = state.value
  if (!s || s.kind !== 'edit' || !s.selected || s.readonly || s.password||!restoreEditable(s)) return
  editableDeleteSelection(s.target, s.start, s.end)
}

function onSelectAll() {
  const s = state.value
  if (!s || s.kind !== 'edit'||!s.target.el.isConnected) return
  editableSelectAll(s.target)
}

// A native popup may return after a reactive field has changed or disappeared.
// Restore the original contenteditable range only while its document is current.
function restoreEditable(s:Extract<MenuState,{kind:'edit'}>){
  if(!s.target.el.isConnected)return false
  const text=s.target.kind==='contenteditable'?s.target.el.textContent||'':s.target.el.value
  if(text!==s.text)return false
  s.target.el.focus({preventScroll:true})
  if(s.range){if(!s.range.startContainer.isConnected||!s.range.endContainer.isConnected||!s.target.el.contains(s.range.commonAncestorContainer))return false;const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(s.range)}
  return true
}

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', onContextMenu, true)
})
</script>
