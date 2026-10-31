import { computed, onUnmounted, ref, watch } from 'vue'

type Panel = 'chats' | 'workspace' | 'browser'
type Divider = 'width' | 'chats' | 'resources'
const defaults = { width: 310, workspace: 155, browser: 155, chats: true, showWorkspace: true, showBrowser: true }

export function useSidebarLayout() {
  const layout = ref({ ...defaults })
  try {
    const saved = JSON.parse(localStorage.getItem('navora.sidebar') || '{}')
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      if (typeof saved[key] === typeof defaults[key]) (layout.value as Record<string, unknown>)[key] = saved[key]
    }
  } catch { /* Use defaults when storage is unavailable. */ }
  const clamp = (v: number, min: number, max: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min
  function normalize() {
    layout.value.width = clamp(layout.value.width, 250, innerWidth > 1024 ? Math.min(560, innerWidth * .5) : 560)
    const max = Math.max(64, (innerHeight - 220) / 2)
    layout.value.workspace = clamp(layout.value.workspace, 64, max)
    layout.value.browser = clamp(layout.value.browser, 64, max)
  }
  normalize()
  const visible = computed(() => ({ chats: layout.value.chats, workspace: layout.value.showWorkspace, browser: layout.value.showBrowser }))
  const style = computed(() => ({ '--sidebar-width': `${layout.value.width}px`, '--workspace-height': `${layout.value.workspace}px`, '--browser-height': `${layout.value.browser}px` }))
  function toggle(panel: Panel) {
    const key = panel === 'workspace' ? 'showWorkspace' : panel === 'browser' ? 'showBrowser' : 'chats'
    layout.value[key] = !layout.value[key]
  }
  function adjust(divider: Divider, delta: number) {
    if (divider === 'width') layout.value.width += delta
    else if (divider === 'chats') layout.value.workspace -= delta
    else {
      const max = Math.max(64, (innerHeight - 220) / 2)
      const amount = clamp(delta, Math.max(64 - layout.value.workspace, layout.value.browser - max), Math.min(max - layout.value.workspace, layout.value.browser - 64))
      layout.value.workspace += amount
      layout.value.browser -= amount
    }
    normalize()
  }
  let endDrag: (() => void) | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function persist() {
    clearTimeout(saveTimer)
    try { localStorage.setItem('navora.sidebar', JSON.stringify(layout.value)) } catch { /* optional persistence */ }
  }
  function beginResize(event: PointerEvent, divider: Divider) {
    if (event.button !== 0) return
    event.preventDefault()
    endDrag?.()
    const target = event.currentTarget as HTMLElement
    let previous = divider === 'width' ? event.clientX : event.clientY
    const move = (e: PointerEvent) => {
      const current = divider === 'width' ? e.clientX : e.clientY
      adjust(divider, current - previous)
      previous = current
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      target.removeEventListener('lostpointercapture', end)
      target.classList.remove('resizing')
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
      endDrag = undefined
      persist()
    }
    target.setPointerCapture(event.pointerId)
    target.classList.add('resizing')
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
    target.addEventListener('lostpointercapture', end)
    endDrag = end
  }
  function resizeKey(event: KeyboardEvent, divider: Divider) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') layout.value = { ...defaults }
    else adjust(divider, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -12 : 12)
  }
  watch(layout, () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 150) }, { deep: true })
  window.addEventListener('resize', normalize)
  onUnmounted(() => { endDrag?.(); persist(); window.removeEventListener('resize', normalize) })
  return { layout, visible, style, toggle, beginResize, resizeKey }
}
