import { onMounted, onUnmounted, ref } from 'vue'
import { isWebRemote } from '../remote-api'

const MOBILE_WIDTH = 1024

function detectMobileLayout(): boolean {
  if (typeof window === 'undefined') return false
  if (window.innerWidth <= MOBILE_WIDTH) return true
  if (isWebRemote() && window.matchMedia('(pointer: coarse)').matches) return true
  return false
}

export function useMobileLayout() {
  const isMobileLayout = ref(detectMobileLayout())
  let mq: MediaQueryList | null = null

  function sync() {
    isMobileLayout.value = detectMobileLayout()
  }

  onMounted(() => {
    mq = window.matchMedia(`(max-width: ${MOBILE_WIDTH}px)`)
    sync()
    mq.addEventListener('change', sync)
    window.addEventListener('orientationchange', sync)
  })

  onUnmounted(() => {
    mq?.removeEventListener('change', sync)
    window.removeEventListener('orientationchange', sync)
  })

  return { isMobileLayout }
}
