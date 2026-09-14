import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  createDefaultConfig,
  migrateOnboardingFromParsed,
  migrateShowMainOnStartFromParsed,
  normalizeAppStartupPrefs,
  ensurePermissionModes,
  resolveSubchat,
  type AppConfig,
} from '../../shared/config'
import {
  defaultProviderList,
  ensureDefaultProvider,
  hydrateProviderList,
  mergeProviderList,
} from '../../shared/model-providers'
import { ensureDir } from '../data-root'

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
    ensureDir(this.root)
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
    this.cfg.subchat = resolveSubchat(this.cfg)
    return this.cfg
  }

  save(next?: AppConfig): void {
    if (next) this.cfg = next
    ensureDefaultProvider(this.cfg.ai)
    ensurePermissionModes(this.cfg)
    normalizeAppStartupPrefs(this.cfg)
    this.cfg.subchat = resolveSubchat(this.cfg)
    ensureDir(this.root)
    const text = yaml.dump(this.cfg, { lineWidth: 120, noRefs: true })
    fs.writeFileSync(this.filePath, text, 'utf8')
  }

  update(patch: Partial<AppConfig>): AppConfig {
    const incomingProviders = Array.isArray(patch.ai?.providers)
      ? patch.ai.providers
      : undefined
    const prevProviders = this.cfg.ai.providers
    this.cfg = deepMerge(
      this.cfg as unknown as Record<string, unknown>,
      patch,
    ) as unknown as AppConfig
    if (incomingProviders) {
      this.cfg.ai.providers = mergeProviderList(prevProviders, incomingProviders)
    }
    ensureDefaultProvider(this.cfg.ai)
    ensurePermissionModes(this.cfg)
    normalizeAppStartupPrefs(this.cfg)
    this.cfg.subchat = resolveSubchat(this.cfg)
    this.save()
    return this.cfg
  }
}
