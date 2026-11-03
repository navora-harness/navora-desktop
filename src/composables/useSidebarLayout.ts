import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

type Panel = 'chats' | 'workspace' | 'browser'
type Divider = 'width' | 'chats' | 'resources'
// Width includes the fixed 52px rail; the context panel itself is 240–360px.
const defaults = { width: 312, workspace: 155, browser: 155, chats: true, showWorkspace: true, showBrowser: true }

export function useSidebarLayout() {
  const layout = ref({ ...defaults })
  const viewportWidth=ref(innerWidth)
  const maxWidth=computed(()=>Math.min(412,Math.max(292,viewportWidth.value*.35)))
  const resizing = ref(false)
  try {
    const saved = JSON.parse(localStorage.getItem('navora.sidebar') || '{}')
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      if (typeof saved[key] === typeof defaults[key]) (layout.value as Record<string, unknown>)[key] = saved[key]
    }
  } catch { /* Use defaults when storage is unavailable. */ }
  const clamp = (v: number, min: number, max: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min
  function normalize() {
    layout.value.width = clamp(layout.value.width, 292, maxWidth.value)
    const max = Math.max(64, (innerHeight - 220) / 2)
    layout.value.workspace = clamp(layout.value.workspace, 64, max)
    layout.value.browser = clamp(layout.value.browser, 64, max)
  }
  normalize()
  const visible = computed(() => ({ chats: layout.value.chats, workspace: layout.value.showWorkspace, browser: layout.value.showBrowser }))
  const style = computed(() => ({ '--sidebar-width': `${layout.value.width}px`, '--workspace-height': `${layout.value.workspace}px`, '--browser-height': `${layout.value.browser}px`, '--workspace-weight': layout.value.workspace, '--browser-weight': layout.value.browser }))
  function toggle(panel: Panel) {
    const key = panel === 'workspace' ? 'showWorkspace' : panel === 'browser' ? 'showBrowser' : 'chats'
    layout.value[key] = !layout.value[key]
  }
  function adjust(divider: Divider, delta: number) {
    if (divider === 'width') layout.value.width += delta
    else if (divider === 'chats') {
      if (layout.value.showWorkspace) layout.value.workspace -= delta
      else layout.value.browser -= delta
    }
    else {
      const max = Math.max(64, (innerHeight - 220) / 2)
      const amount = clamp(delta, Math.max(64 - layout.value.workspace, layout.value.browser - max), Math.min(max - layout.value.workspace, layout.value.browser - 64))
      layout.value.workspace += amount
      layout.value.browser -= amount
    }
    normalize()
  }
  let endDrag: (() => void) | undefined
  let dragVersion = 0
  let resizeFrame: number | undefined
  let disposed = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function persist() {
    clearTimeout(saveTimer)
    try { localStorage.setItem('navora.sidebar', JSON.stringify(layout.value)) } catch { /* optional persistence */ }
  }
  function beginResize(event: PointerEvent, divider: Divider) {
    if (event.button !== 0) return
    event.preventDefault()
    endDrag?.()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    const version = ++dragVersion
    const target = event.currentTarget as HTMLElement
    // With the chat list hidden, saved heights become proportions of the dock.
    // Convert pointer pixels back to those weights so the handle follows the hand.
    const dock = target.closest('.sidebar-dock')
    const panes = dock ? [...dock.querySelectorAll<HTMLElement>('.sidebar-workspace-pane,.sidebar-browser-pane')].filter(el => el.checkVisibility() && !el.querySelector('.is-collapsed')) : []
    const scale = divider === 'resources' && !layout.value.chats && panes.length === 2
      ? (layout.value.workspace + layout.value.browser) / panes.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      : 1
    let previous = divider === 'width' ? event.clientX : event.clientY
    const move = (e: PointerEvent) => {
      const current = divider === 'width' ? e.clientX : e.clientY
      adjust(divider, (current - previous) * scale)
      previous = current
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      target.removeEventListener('lostpointercapture', end)
      target.classList.remove('resizing')
      // Keep transitions disabled until Vue has painted the final pointer value.
      // Pointer-up can arrive in the same frame as the last move.
      void nextTick(() => {
        if (disposed) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          if (version === dragVersion) resizing.value = false
        })
      })
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
      endDrag = undefined
      persist()
    }
    target.setPointerCapture(event.pointerId)
    resizing.value = true
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
  function onResize(){viewportWidth.value=innerWidth;normalize()}
  window.addEventListener('resize', onResize)
  onUnmounted(() => {
    disposed = true
    endDrag?.()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    persist()
    window.removeEventListener('resize', onResize)
  })
  return { layout, visible, style, resizing, maxWidth, toggle, beginResize, resizeKey }
}
