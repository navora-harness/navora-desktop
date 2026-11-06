/** A requested native material is not proof that DWM rendered the effect. */
export type WindowMaterialRole = 'main' | 'browser' | 'file'
export type WindowMaterialReason = 'requested' | 'disabled' | 'platform' | 'windows_version' | 'api_unavailable' | 'system_unknown' | 'high_contrast' | 'forced_colors' | 'reduced_transparency' | 'tone_mismatch' | 'native_error'
export interface WindowMaterialEnvironment {
  platform: string
  release: string
  systemDark?: boolean
  highContrast?: boolean
  forcedColors?: boolean
  reducedTransparency?: boolean
}
export type WindowMaterialSupport =
  | { supported: true; supportReason: 'supported' }
  | { supported: false; supportReason: 'platform' | 'windows_version' | 'api_unavailable' | 'system_unknown' }
export type WindowMaterialState = WindowMaterialSupport & {
  role: WindowMaterialRole
  requested: boolean
  mode: 'acrylic' | 'solid'
  reason: WindowMaterialReason
  /** Monotonic within this host; guards delayed renderer reads. */
  revision: number
  theme: string
  dark: boolean
  /** Actual OS preference, kept independent of the app's forced appearance. */
  systemDark?: boolean
}

/** A theme tint over the real DWM material, without changing guest media queries. */
export function windowMaterialSurfaceColors(theme: { dark: boolean; shell: string; sidebar: string }, systemDark: boolean) {
  const oppositeTone = theme.dark !== systemDark
  const alpha = (color: string, opacity: number) => `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`
  return {
    // Opposite OS/app tones need a stronger tint; the background remains live.
    chrome: alpha(theme.shell, oppositeTone ? (theme.dark ? .84 : .94) : .28),
    sidebar: alpha(theme.sidebar, theme.dark ? .91 : .94),
  }
}

/** Missing old preferences opt in; malformed persisted values stay opaque. */
export function windowAcrylicPreference(value: unknown, strict = false): boolean {
  if (value === undefined) return true
  if (typeof value === 'boolean') return value
  if (strict) throw new Error('invalid_config: app.window_acrylic must be a boolean')
  return false
}

/** Platform capability is independent of the preference and temporary fallbacks. */
export function windowMaterialSupport(hasApi: boolean, environment: Pick<WindowMaterialEnvironment, 'platform' | 'release'>): WindowMaterialSupport {
  if (!environment.platform) return { supported: false, supportReason: 'system_unknown' }
  if (environment.platform !== 'win32') return { supported: false, supportReason: 'platform' }
  // Windows 11 still reports kernel version 10.0. Unknown releases fail closed.
  const release = /^(\d+)\.(\d+)\.(\d+)(?:\.|$)/.exec(environment.release)
  if (!release) return { supported: false, supportReason: 'system_unknown' }
  if (Number(release[1]) !== 10 || Number(release[2]) !== 0 || Number(release[3]) < 22621) return { supported: false, supportReason: 'windows_version' }
  if (!hasApi) return { supported: false, supportReason: 'api_unavailable' }
  return { supported: true, supportReason: 'supported' }
}

export function windowMaterialDecision(requested: boolean, _appDark: boolean, hasApi: boolean, environment: WindowMaterialEnvironment): Pick<WindowMaterialState, 'mode' | 'reason'> {
  const solid = (reason: WindowMaterialReason) => ({ mode: 'solid' as const, reason })
  if (!requested) return solid('disabled')
  const support = windowMaterialSupport(hasApi, environment)
  if (!support.supported) return solid(support.supportReason)
  if ([environment.systemDark, environment.highContrast, environment.forcedColors, environment.reducedTransparency].some(value => typeof value !== 'boolean')) return solid('system_unknown')
  if (environment.highContrast) return solid('high_contrast')
  if (environment.forcedColors) return solid('forced_colors')
  if (environment.reducedTransparency) return solid('reduced_transparency')
  // App/OS tone differences are covered by host tints. Never change the global
  // nativeTheme.themeSource: that would also change real webpage media queries.
  return { mode: 'acrylic', reason: 'requested' }
}
