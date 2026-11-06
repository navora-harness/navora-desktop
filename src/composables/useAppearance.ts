import { onMounted, onUnmounted } from 'vue'
import { useTheme } from 'vuetify'
import { appearancePalette } from '@shared/appearance'
import type { AppConfig } from '@shared/config'
import { windowMaterialSurfaceColors, type WindowMaterialState } from '@shared/window-material'

/** Every app renderer, including detached workspaces, follows the saved theme. */
export function useAppearance() {
  const vuetify = useTheme()
  let unsubscribe: (() => void) | undefined
  let unsubscribeMaterial: (() => void) | undefined
  let revision = 0
  let disposed = false
  let latest: AppConfig | undefined
  let material: WindowMaterialState | undefined
  const systemTheme = matchMedia('(prefers-color-scheme: dark)')
  const forcedColors = matchMedia('(forced-colors: active)')
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')
  const systemChanged = () => { if (latest) apply(latest) }
  const applyMaterial = () => {
    const root = document.documentElement
    const palette = appearancePalette(latest?.app?.appearance_theme, latest?.app?.appearance_mode, systemTheme.matches)
    const surfaces = windowMaterialSurfaceColors(palette, material?.systemDark ?? systemTheme.matches)
    root.style.setProperty('--window-material-chrome', surfaces.chrome)
    root.style.setProperty('--window-material-sidebar', surfaces.sidebar)
    const enabled = window.navora?.app.platform === 'win32' && latest?.app.window_acrylic !== false &&
      material?.mode === 'acrylic' && material.theme === root.dataset.navoraTheme &&
      material.dark === (root.dataset.navoraColorScheme === 'dark') && !forcedColors.matches && !reducedTransparency.matches
    root.dataset.navoraWindowMaterial = enabled ? 'acrylic' : 'solid'
    if (material) root.dataset.navoraWindowRole = material.role
  }
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
      surface: theme.surface, 'on-surface': theme.ink, 'on-background': theme.ink,
      'surface-variant': theme.well, 'on-surface-variant': theme.muted,
      'on-primary': theme.onAccent, 'on-secondary': theme.onAccent,
      error: theme.danger, success: theme.success, warning: theme.warning, info: theme.accent,
      'on-error': theme.onAccent, 'on-success': theme.onAccent, 'on-warning': theme.onAccent,
    })
    vuetify.themes.value.navoraLight!.dark = theme.dark
    applyMaterial()
  }
  onMounted(async () => {
    systemTheme.addEventListener('change', systemChanged)
    forcedColors.addEventListener('change', applyMaterial)
    reducedTransparency.addEventListener('change', applyMaterial)
    // Subscribe before either read so delayed responses cannot undo a newer state.
    const app = window.navora?.app
    if (app?.platform !== 'web' && app?.onWindowMaterial && app.windowMaterial) {
      const accept = (next: WindowMaterialState) => {
        if (disposed || (material && next.revision < material.revision)) return
        material = next; applyMaterial()
      }
      unsubscribeMaterial = app.onWindowMaterial(accept)
      void app.windowMaterial().then(accept).catch(() => { applyMaterial() })
    }
    const api = window.navora?.config
    if (!api) return
    unsubscribe = api.onChanged(config => { revision++; apply(config) })
    const initialRevision = revision
    try {
      const config = await api.get()
      if (!disposed && initialRevision === revision) apply(config)
    } catch (error) { console.warn('[appearance] Could not load theme', error) }
  })
  onUnmounted(() => {
    disposed = true; unsubscribe?.(); unsubscribeMaterial?.()
    systemTheme.removeEventListener('change', systemChanged)
    forcedColors.removeEventListener('change', applyMaterial)
    reducedTransparency.removeEventListener('change', applyMaterial)
  })
}
