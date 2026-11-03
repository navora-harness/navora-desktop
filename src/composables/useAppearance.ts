import { onMounted, onUnmounted } from 'vue'
import { useTheme } from 'vuetify'
import { appearancePalette } from '@shared/appearance'
import type { AppConfig } from '@shared/config'

/** Every app renderer, including detached workspaces, follows the saved theme. */
export function useAppearance() {
  const vuetify = useTheme()
  let unsubscribe: (() => void) | undefined
  let revision = 0
  let disposed = false
  let latest: AppConfig | undefined
  const systemTheme = matchMedia('(prefers-color-scheme: dark)')
  const systemChanged = () => { if (latest) apply(latest) }
  const apply = (config: AppConfig) => {
    latest = config
    const theme = appearancePalette(config.app?.appearance_theme, config.app?.appearance_mode, systemTheme.matches)
    const root = document.documentElement
    root.dataset.navoraTheme = theme.id
    root.dataset.navoraColorScheme = theme.dark ? 'dark' : 'light'
    root.style.colorScheme = theme.dark ? 'dark' : 'light'
    for (const [key, value] of Object.entries(theme)) {
      if (key !== 'id' && key !== 'name' && key !== 'description' && typeof value === 'string') {
        root.style.setProperty(`--appearance-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, value)
      }
    }
    Object.assign(vuetify.themes.value.navoraLight!.colors, {
      primary: theme.accent, secondary: theme.muted, background: theme.shell,
      surface: theme.surface, 'on-surface': theme.ink,
    })
    vuetify.themes.value.navoraLight!.dark = theme.dark
  }
  onMounted(async () => {
    systemTheme.addEventListener('change', systemChanged)
    const api = window.navora?.config
    if (!api) return
    unsubscribe = api.onChanged(config => { revision++; apply(config) })
    const initialRevision = revision
    try {
      const config = await api.get()
      if (!disposed && initialRevision === revision) apply(config)
    } catch (error) { console.warn('[appearance] Could not load theme', error) }
  })
  onUnmounted(() => { disposed = true; unsubscribe?.(); systemTheme.removeEventListener('change', systemChanged) })
}
