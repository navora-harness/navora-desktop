import { nextTick } from 'vue'

const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
let finishing: Promise<void> | undefined

/** Called after the initial conversation and preferences have loaded. */
export function finishWindowStartup(): Promise<void> {
  if (document.documentElement.dataset.navoraStartup !== 'loading') return Promise.resolve()
  return finishing ||= (async () => {
    const startup = window.navora?.app.startup
    if (!startup?.active) return
    await nextTick()
    if (!await startup.ready()) return
    document.documentElement.dataset.navoraStartup = 'complete'
    document.body.inert = false
    // Commit a normal main-window frame before allowing restored windows to show.
    await paint()
    await startup.complete()
    sessionStorage.setItem('navora-startup-complete', '1')
    document.getElementById('navora-startup')?.remove()
  })()
}
