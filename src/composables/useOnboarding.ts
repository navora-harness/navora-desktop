import { computed, ref } from 'vue'

const open = ref(false)
/** True when opened from Settings (vs auto first-run). */
const manual = ref(false)

export function useOnboarding() {
  function show(opts?: { manual?: boolean }) {
    manual.value = opts?.manual === true
    open.value = true
  }

  function hide() {
    open.value = false
  }

  return {
    open,
    manual: computed(() => manual.value),
    show,
    hide,
  }
}
