import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { appearancePalette } from '../../shared/appearance'
import type { AppConfig } from '../../shared/config'
import { windowAcrylicPreference, windowMaterialDecision, windowMaterialSupport, type WindowMaterialEnvironment, type WindowMaterialRole, type WindowMaterialState } from '../../shared/window-material'

export const WINDOW_MATERIAL_CHANGED = 'navora:app.window.material.changed'
type Options = { getConfig: () => AppConfig; environment: () => WindowMaterialEnvironment }
type Entry = { window: BrowserWindow; role: WindowMaterialRole; state?: WindowMaterialState; fingerprint?: string }

/** Explicitly registered application hosts only; never guest views or native panels. */
export class WindowMaterialManager {
  private readonly entries = new Map<number, Entry>()
  constructor(private readonly options: Options) {}

  register(window: BrowserWindow, role: WindowMaterialRole): void {
    if (this.entries.has(window.id) || window.isDestroyed()) return
    const entry: Entry = { window, role }
    this.entries.set(window.id, entry)
    window.once('closed', () => this.entries.delete(window.id))
    // The hidden construction-time HWND can precede its first compositor frame.
    // Reassert the same request once on first show after hidden construction.
    // No focus changes, none/acrylic toggles, navigation or retry timer.
    window.once('show', () => this.apply(window, undefined, true))
    window.webContents.on('did-finish-load', () => {
      this.apply(window)
      this.publish(entry)
    })
    this.apply(window)
  }

  stateFor(sender: WebContents, frame: WebFrameMain | null): WindowMaterialState {
    const entry = [...this.entries.values()].find(value => !value.window.isDestroyed() && value.window.webContents === sender)
    if (!entry || frame !== sender.mainFrame || !entry.state) throw new Error('window_material_host_only')
    return { ...entry.state }
  }

  apply(window: BrowserWindow, config = this.options.getConfig(), firstPresentation = false): void {
    const entry = this.entries.get(window.id)
    if (!entry || window.isDestroyed()) return
    const environment = this.options.environment()
    const theme = appearancePalette(config.app.appearance_theme, config.app.appearance_mode, environment.systemDark === true)
    const requested = windowAcrylicPreference(config.app.window_acrylic)
    const support = windowMaterialSupport(typeof window.setBackgroundMaterial === 'function', environment)
    const decision = windowMaterialDecision(requested, theme.dark, typeof window.setBackgroundMaterial === 'function', environment)
    const fingerprint = JSON.stringify([requested, support, decision, environment, theme.id, theme.dark, theme.shell, theme.ink])
    if (entry.fingerprint === fingerprint && !(firstPresentation && decision.mode === 'acrylic')) return
    entry.fingerprint = fingerprint
    let effective = decision
    const solid = () => {
      // .7 writes white when removing a material. Restore the theme afterwards.
      try { if (environment.platform === 'win32' && typeof window.setBackgroundMaterial === 'function') window.setBackgroundMaterial('none') } catch { /* DOM and clear color still become opaque. */ }
      try { window.setBackgroundColor(theme.shell) } catch { /* Destroying native window. */ }
      try { if (environment.platform === 'win32') window.setTitleBarOverlay({ color: theme.shell, symbolColor: theme.ink }) } catch { /* Keep the opaque renderer fallback. */ }
    }
    if (decision.mode === 'acrylic') {
      try {
        window.setBackgroundMaterial('acrylic')
        window.setBackgroundColor('#00000000')
        window.setTitleBarOverlay({ color: '#00000000', symbolColor: theme.ink })
      } catch {
        effective = { mode: 'solid', reason: 'native_error' }
        solid()
      }
    } else solid()
    entry.state = { ...support, ...effective, requested, role: entry.role, theme: theme.id, dark: theme.dark, systemDark: environment.systemDark, revision: (entry.state?.revision || 0) + 1 }
    this.publish(entry)
  }

  private publish(entry: Entry): void {
    if (!entry.state || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return
    try { entry.window.webContents.send(WINDOW_MATERIAL_CHANGED, { ...entry.state }) } catch { /* The renderer is closing. */ }
  }
}

let manager: WindowMaterialManager | undefined
export function configureWindowMaterials(options: Options): WindowMaterialManager {
  manager = new WindowMaterialManager(options)
  return manager
}
export function registerWindowMaterial(window: BrowserWindow, role: WindowMaterialRole): void { manager?.register(window, role) }
export function updateWindowMaterial(window: BrowserWindow, config: AppConfig): void { manager?.apply(window, config) }
export function windowMaterialState(sender: WebContents, frame: WebFrameMain | null): WindowMaterialState {
  if (!manager) throw new Error('window_material_unavailable')
  return manager.stateFor(sender, frame)
}
