import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  createDefaultConfig,
  migrateAcceptLanguage,
  migrateShellAllowlist,
  migrateOnboardingFromParsed,
  migrateShowMainOnStartFromParsed,
  normalizeAppStartupPrefs,
  ensurePermissionModes,
  resolveSubchat,
  resolveBrowserLinkOpenMode,
  type AppConfig,
  type AppConfigPatch,
} from '../../shared/config'
import { createDefaultBrowserAutomation, mergeBrowserAutomation, normalizeBrowserAutomation } from '../../shared/browser-automation'
import {
  defaultProviderList,
  ensureDefaultProvider,
  hydrateProviderList,
  mergeProviderList,
} from '../../shared/model-providers'
import { resolveAppearanceTheme, resolveAppearanceMode } from '../../shared/appearance'
import {resolveAppShortcuts} from '../../shared/app-shortcuts'
import { windowAcrylicPreference } from '../../shared/window-material'
import {resolveSubchatGlyphStyle} from '../../shared/subchat-glyph'
import { applySettingsCommit, type SettingsCommit } from '../../shared/settings-commit'
import { SETTINGS_GROUPS, settingsGroupDirty, validateSettingsGroup, type SettingsGroup } from '../../shared/settings-groups'

function deepMerge<T extends Record<string, unknown>>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const prev = out[k]
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

export class ConfigService {
  private root: string
  private filePath: string
  private cfg: AppConfig
  private committedOperations = new Map<string, string>()

  constructor(dataRoot: string) {
    this.root = dataRoot
    this.filePath = path.join(dataRoot, 'config.yml')
    this.cfg = createDefaultConfig()
    this.load()
  }

  getRoot(): string {
    return this.root
  }

  getPath(): string {
    return this.filePath
  }

  get(): AppConfig {
    return this.cfg
  }

  load(): AppConfig {
    fs.mkdirSync(this.root, { recursive: true })
    if (!fs.existsSync(this.filePath)) {
      this.save(this.cfg)
      return this.cfg
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = yaml.load(raw)
      this.cfg = deepMerge(
        createDefaultConfig() as unknown as Record<string, unknown>,
        parsed,
      ) as unknown as AppConfig
      try {
        this.cfg.browser.automation = normalizeBrowserAutomation(this.cfg.browser.automation)
      } catch (error) {
        // A malformed automation preference must not discard unrelated browser/session settings.
        console.warn('[config] invalid browser automation settings, using local defaults', error)
        this.cfg.browser.automation = createDefaultBrowserAutomation()
      }
      migrateShowMainOnStartFromParsed(this.cfg, parsed)
      migrateOnboardingFromParsed(this.cfg, parsed)
      this.cfg.ai.providers = hydrateProviderList(this.cfg.ai.providers, [
        ...createDefaultConfig().ai.providers,
        ...defaultProviderList(),
      ])
    } catch (e) {
      console.error('[config] load failed, using defaults', e)
      this.cfg = createDefaultConfig()
    }
    ensureDefaultProvider(this.cfg.ai)
    ensurePermissionModes(this.cfg)
    normalizeAppStartupPrefs(this.cfg)
    this.cfg.app.appearance_theme = resolveAppearanceTheme(this.cfg.app.appearance_theme).id
    this.cfg.app.appearance_mode = resolveAppearanceMode(this.cfg.app.appearance_mode)
    this.cfg.app.subchat_glyph_style = resolveSubchatGlyphStyle(this.cfg.app.subchat_glyph_style)
    this.cfg.browser.link_open_mode = resolveBrowserLinkOpenMode(this.cfg.browser.link_open_mode)
    this.cfg.app.window_acrylic = windowAcrylicPreference(this.cfg.app.window_acrylic)
    this.cfg.app.shortcuts = resolveAppShortcuts(this.cfg.app.shortcuts)
    migrateAcceptLanguage(this.cfg)
    migrateShellAllowlist(this.cfg)
    this.cfg.subchat = resolveSubchat(this.cfg)
    return this.cfg
  }

  save(next?: AppConfig): void {
    // Validate and persist a separate candidate before committing any in-memory changes.
    const candidate = structuredClone(next ?? this.cfg)
    candidate.browser.automation = normalizeBrowserAutomation(candidate.browser.automation)
    candidate.app.appearance_theme = resolveAppearanceTheme(candidate.app.appearance_theme).id
    candidate.app.appearance_mode = resolveAppearanceMode(candidate.app.appearance_mode)
    candidate.app.subchat_glyph_style = resolveSubchatGlyphStyle(candidate.app.subchat_glyph_style,true)
    candidate.browser.link_open_mode = resolveBrowserLinkOpenMode(candidate.browser.link_open_mode,true)
    candidate.app.window_acrylic = windowAcrylicPreference(candidate.app.window_acrylic, true)
    candidate.app.shortcuts = resolveAppShortcuts(candidate.app.shortcuts)
    ensureDefaultProvider(candidate.ai)
    ensurePermissionModes(candidate)
    normalizeAppStartupPrefs(candidate)
    migrateShellAllowlist(candidate)
    candidate.subchat = resolveSubchat(candidate)
    fs.mkdirSync(this.root, { recursive: true })
    const text = yaml.dump(candidate, { lineWidth: 120, noRefs: true })
    const temporary = path.join(this.root, `.config-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600)
      try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      // Same-directory rename preserves the previous valid configuration if the
      // replacement fails (including a locked destination on Windows).
      fs.renameSync(temporary, this.filePath)
    } finally {
      try { fs.unlinkSync(temporary) } catch { /* renamed or never created */ }
    }
    this.cfg = candidate
  }

  commit(request: SettingsCommit): AppConfig {
    if (!request || typeof request.operationId !== 'string' || !request.operationId.trim() || request.operationId.length > 200) throw new Error('invalid_config_operation')
    const fingerprint = JSON.stringify(request)
    const previous = this.committedOperations.get(request.operationId)
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error('config_operation_reused')
      return this.cfg
    }
    const candidate = applySettingsCommit(this.cfg, request)
    for (const group of Object.keys(SETTINGS_GROUPS) as SettingsGroup[]) {
      if (!settingsGroupDirty(this.cfg, candidate, group)) continue
      const error = validateSettingsGroup(candidate, group)
      if (error) throw new Error(`invalid_config:${error}`)
    }
    if (settingsGroupDirty(this.cfg, candidate, 'workspace')) {
      const custom = candidate.files.custom_root.trim()
      if (custom && !path.isAbsolute(custom)) throw new Error('invalid_config:当前系统需要使用有效的绝对路径')
      const target = custom ? path.normalize(custom) : path.resolve(this.root, candidate.files.root_dirname.trim())
      if (!custom) {
        const relative = path.relative(path.resolve(this.root), target)
        if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('invalid_config:内置工作区必须位于数据目录的子目录')
      }
      fs.mkdirSync(target, { recursive: true })
      if (!fs.statSync(target).isDirectory()) throw new Error('invalid_config:工作区路径不是文件夹')
      const probe = path.join(target, `.navora-write-check-${process.pid}-${Math.random().toString(16).slice(2)}`)
      let created = false
      try { const fd = fs.openSync(probe, 'wx', 0o600); created = true; fs.closeSync(fd) }
      finally { if (created) fs.unlinkSync(probe) }
      candidate.files.custom_root = custom ? target : ''
      candidate.files.root_dirname = candidate.files.root_dirname.trim()
    }
    this.save(candidate)
    this.committedOperations.set(request.operationId, fingerprint)
    if (this.committedOperations.size > 256) this.committedOperations.delete(this.committedOperations.keys().next().value!)
    return this.cfg
  }

  update(patch: AppConfigPatch): AppConfig {
    const incomingProviders = Array.isArray(patch.ai?.providers)
      ? patch.ai.providers
      : undefined
    const prevProviders = this.cfg.ai.providers
    const candidate = deepMerge(
      structuredClone(this.cfg) as unknown as Record<string, unknown>,
      patch,
    ) as unknown as AppConfig
    candidate.browser.automation = patch.browser?.automation === undefined
      ? normalizeBrowserAutomation(this.cfg.browser.automation)
      : mergeBrowserAutomation(this.cfg.browser.automation, patch.browser.automation)
    if (incomingProviders) {
      candidate.ai.providers = mergeProviderList(prevProviders, incomingProviders)
    }
    this.save(candidate)
    return this.cfg
  }
}
