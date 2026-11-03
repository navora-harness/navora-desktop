<template>
  <Teleport to="body">
    <Transition name="ctx-scrim">
      <div
        v-if="open"
        class="ctx-scrim"
        @mousedown.prevent="hide"
        @contextmenu.prevent="hide"
      />
    </Transition>
    <Transition name="ctx-pop">
      <div
        v-if="open"
        ref="panelEl"
        class="sidebar-ctx-panel"
        role="menu"
        :style="{
          left: `${x}px`,
          top: `${y}px`,
          transformOrigin: origin,
        }"
        @click="hide"
        @contextmenu.prevent
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const open = ref(false)
const x = ref(0)
const y = ref(0)
const origin = ref('top left')
const panelEl = ref<HTMLElement | null>(null)
let clickX = 0
let clickY = 0
let trigger:HTMLElement|null=null
let resizeObserver:ResizeObserver|undefined

function show(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const anchor=e.currentTarget instanceof HTMLElement?e.currentTarget:null
  trigger=anchor?.matches('button,[tabindex]')?anchor:anchor?.querySelector<HTMLElement>('button,[tabindex]')||document.activeElement as HTMLElement|null
  const bounds=(anchor||trigger)?.getBoundingClientRect(),keyboard=e.clientX===0&&e.clientY===0
  clickX = keyboard&&bounds?bounds.left:e.clientX
  clickY = keyboard&&bounds?bounds.bottom:e.clientY
  x.value = clickX
  y.value = clickY
  origin.value = 'top left'
  open.value = true
  void nextTick(()=>{clamp();panelEl.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()})
}

function hide() {
  if(!open.value)return
  open.value = false
  if(trigger?.isConnected)trigger.focus({preventScroll:true})
}

function clamp() {
  const node = panelEl.value
  if (!node) return
  const pad = 8
  const width = node.offsetWidth
  const height = node.offsetHeight
  let nx = Math.max(pad, clickX)
  let ny = Math.max(pad, clickY)
  let ox = 'left'
  let oy = 'top'
  if (nx + width > window.innerWidth - pad) {
    nx = Math.max(pad, clickX - width)
    ox = 'right'
  }
  if (ny + height > window.innerHeight - pad) {
    ny = Math.max(pad, clickY - height)
    oy = 'bottom'
  }
  x.value = Math.max(pad,Math.min(nx,window.innerWidth-pad-width))
  y.value = Math.max(pad,Math.min(ny,window.innerHeight-pad-height))
  origin.value = `${oy} ${ox}`
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();hide();return}
  if(e.key==='Tab'){hide();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return
  e.preventDefault();e.stopPropagation()
  const buttons=[...panelEl.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]]
  if(!buttons.length)return
  const at=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:at<0?(e.key==='ArrowDown'?0:buttons.length-1):(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus()
}

watch(open, async (v) => {
  if (v) {
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize',clamp)
    await nextTick()
    if(open.value&&panelEl.value){resizeObserver ||= new ResizeObserver(clamp);resizeObserver.observe(panelEl.value)}
  } else {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize',clamp)
    resizeObserver?.disconnect()
  }
})
onBeforeUnmount(() => {window.removeEventListener('keydown', onKey, true);window.removeEventListener('resize',clamp);resizeObserver?.disconnect()})

defineExpose({ show, hide, open })
</script>

<style scoped>
.ctx-scrim {
  position: fixed;
  inset: 0;
  z-index: 12000;
}
.sidebar-ctx-panel {
  position: fixed;
  z-index: 12001;
  min-width: 196px;
  padding: 6px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow: auto;
  overscroll-behavior: contain;
  background: #fff;
  border: 1px solid #dfe2e7;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(24, 32, 48, 0.16);
  will-change: transform, opacity;
}
.sidebar-ctx-panel :deep(.sidebar-more-item) {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #39414d;
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
}
.sidebar-ctx-panel :deep(.sidebar-more-item:hover:not(:disabled)) {
  background: #eef0f3;
}
.sidebar-ctx-panel :deep(.sidebar-more-item:disabled) {
  opacity: 0.45;
  cursor: default;
}
.sidebar-ctx-panel :deep(.sidebar-more-item.danger) {
  color: #b52b39;
}
.sidebar-ctx-panel :deep(.sidebar-more-item.danger:hover:not(:disabled)) {
  background: rgba(231, 76, 60, 0.14);
}
.sidebar-ctx-panel :deep(.sidebar-ctx-label) {
  padding: 6px 12px 2px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #68717d;
  user-select: none;
  pointer-events: none;
}
.sidebar-ctx-panel :deep(.sidebar-ctx-label.with-sep) {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid #e5e7eb;
}

.ctx-scrim-enter-active,
.ctx-scrim-leave-active {
  transition: opacity 0.12s ease;
}
.ctx-scrim-enter-from,
.ctx-scrim-leave-to {
  opacity: 0;
}

.ctx-pop-enter-active {
  transition:
    opacity 0.14s ease,
    transform 0.16s cubic-bezier(0.2, 0.85, 0.25, 1);
}
.ctx-pop-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.ctx-pop-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.ctx-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
@media(prefers-reduced-motion:reduce) {
  .ctx-pop-enter-active,.ctx-pop-leave-active,.ctx-scrim-enter-active,.ctx-scrim-leave-active { transition: none; }
}
</style>
