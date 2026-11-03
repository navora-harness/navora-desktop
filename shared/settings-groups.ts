import { SUBCHAT_MAX_PARALLEL_MAX, SUBCHAT_MAX_PARALLEL_MIN, type AppConfig } from './config'
import { settingsEqual } from './settings-commit'

export const SETTINGS_GROUPS = {
  composer: { label: '更新字数上限', paths: ['app.max_composer_chars'], scope: '当前窗口立即使用' },
  models: { label: '保存连接与模型', paths: ['ai.providers', 'ai.default_provider'], scope: '下次任务使用；未修改的现有对话保持原模型' },
  rounds: { label: '更新推理限制', paths: ['ai.max_tool_rounds', 'ai.continue_tool_rounds'], scope: '下次任务或续跑使用' },
  movement: { label: '更新移动参数', paths: ['browser.automation.interval_ms'], scope: '下一次页面操作使用' },
  waits: { label: '更新等待时间', paths: ['browser.navigation_timeout_ms', 'browser.action_timeout_ms', 'browser.wait.network_idle_ms'], scope: '下一次导航或操作使用' },
  identity: { label: '保存网站标识', paths: ['browser.default_ua_preset', 'browser.custom_ua', 'browser.accept_language'], scope: '新会话使用，不自动刷新现有页面' },
  access: { label: '保存访问规则', paths: ['browser.url_allowlist'], scope: '下一次导航使用；留空表示不限制' },
  workspace: { label: '更新路径', paths: ['files.root_dirname', 'files.custom_root'], scope: '不迁移旧文件；对话的独立覆盖路径保持不变' },
  remote: { label: '保存远程连接', paths: ['remote.host', 'remote.port', 'remote.username'], scope: '已启用时重新监听，现有远程连接可能断开' },
  timeout: { label: '更新等待时限', paths: ['fork_decision.ask_timeout_ms'], scope: '下次询问使用' },
  subchat: { label: '更新并行上限', paths: ['subchat.max_parallel'], scope: '后续创建使用，不终止已运行的子任务' },
} as const
export type SettingsGroup = keyof typeof SETTINGS_GROUPS

export function settingsPath(config: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, config)
}
export function setSettingsPath(config: AppConfig, path: string, value: unknown) {
  const keys = path.split('.')
  let object = config as unknown as Record<string, unknown>
  for (const key of keys.slice(0, -1)) {
    if (!object[key] || typeof object[key] !== 'object') object[key] = {}
    object = object[key] as Record<string, unknown>
  }
  if (value === undefined) delete object[keys[keys.length - 1]]
  else object[keys[keys.length - 1]] = JSON.parse(JSON.stringify(value))
}
export function projectSettingsGroup(base: AppConfig, draft: AppConfig, group: SettingsGroup): AppConfig {
  const next = structuredClone(base)
  for (const path of SETTINGS_GROUPS[group].paths) setSettingsPath(next, path, settingsPath(draft, path))
  return next
}
export function settingsGroupDirty(base: AppConfig, draft: AppConfig, group: SettingsGroup): boolean {
  return SETTINGS_GROUPS[group].paths.some(path => !settingsEqual(settingsPath(base, path), settingsPath(draft, path)))
}

/** Validate before normalization: invalid drafts must not silently become defaults. */
export function validateSettingsGroup(config: AppConfig, group: SettingsGroup): string | undefined {
  const integer = (path: string, min: number, max: number, label: string) => {
    const value = settingsPath(config, path)
    return typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max ? `${label}需为 ${min}～${max} 的整数` : undefined
  }
  switch (group) {
    case 'composer': return integer('app.max_composer_chars', 1000, 200000, '字数上限')
    case 'rounds': return integer('ai.max_tool_rounds', 4, 80, '最大推理轮数') || integer('ai.continue_tool_rounds', 4, 40, '续跑追加轮数')
    case 'waits': return integer('browser.navigation_timeout_ms', 1000, 300000, '导航等待上限') || integer('browser.action_timeout_ms', 1000, 120000, '操作等待上限') || integer('browser.wait.network_idle_ms', 100, 5000, '网络空闲时间')
    case 'movement': {
      const value = config.browser.automation.interval_ms
      return !Number.isFinite(value) || value <= 0 || value > 60000 ? '采样间隔需大于 0 且不超过 60,000 毫秒' : undefined
    }
    case 'models': {
      if (!config.ai.providers.length) return '至少保留一个服务商'
      if (new Set(config.ai.providers.map(p => p.id)).size !== config.ai.providers.length) return '服务商 ID 不能重复'
      if (!config.ai.providers.some(p => p.id === config.ai.default_provider)) return '请选择已保存的默认服务商'
      for (const provider of config.ai.providers) {
        if (!provider.label.trim()) return '请填写服务商名称'
        try { if (!['http:', 'https:'].includes(new URL(provider.base_url).protocol)) return '连接地址必须使用 HTTP 或 HTTPS' } catch { return '请填写完整的连接地址' }
        if (!Number.isInteger(provider.timeout_ms) || provider.timeout_ms < 1000 || provider.timeout_ms > 900000) return '连接超时需为 1000～900000 毫秒的整数'
        if (!provider.models.length || !provider.models.includes(provider.model)) return '默认模型必须存在于模型目录'
        if (provider.models.some(id => !id.trim()) || new Set(provider.models).size !== provider.models.length) return '模型 ID 不能为空或重复'
        for (const [id, caps] of Object.entries(provider.model_settings || {})) {
          if (!Number.isInteger(caps.context_window) || caps.context_window < 1024 || caps.context_window > 10000000) return `${id}：上下文窗口需为 1024～10000000 的整数`
          if (!Number.isInteger(caps.max_output_tokens) || caps.max_output_tokens < 1 || caps.max_output_tokens >= caps.context_window) return `${id}：最大输出需小于上下文窗口`
          if (caps.reasoning.enabled && (!caps.reasoning.levels.length || !caps.reasoning.levels.some(l => l.id === caps.reasoning.default))) return `${id}：默认推理档位不存在`
          if (caps.reasoning.levels.some(l => !l.id.trim()) || new Set(caps.reasoning.levels.map(l => l.id)).size !== caps.reasoning.levels.length) return `${id}：推理档位名称不能为空或重复`
        }
      }
      return undefined
    }
    case 'workspace': {
      if (!config.files.root_dirname.trim() || config.files.root_dirname.trim() === '.' || /[<>:"|?*]/.test(config.files.root_dirname) || config.files.root_dirname.split(/[\\/]/).some(p => p === '..') || /^[\\/]|^[a-z]:/i.test(config.files.root_dirname)) return '内置目录需为数据目录内的相对路径'
      if (config.files.custom_root.trim() && !/^(?:[a-z]:[\\/]|\\\\[^\\]+[\\]+[^\\]+|\/)/i.test(config.files.custom_root.trim())) return '自定义根目录需为绝对路径'
      return undefined
    }
    case 'remote': return !config.remote.host.trim() ? '请填写监听地址' : !config.remote.username.trim() ? '请填写用户名' : integer('remote.port', 1, 65535, '端口')
    case 'timeout': return config.fork_decision.ask_timeout_ms === 0 ? undefined : integer('fork_decision.ask_timeout_ms', 5000, 600000, '等待时限（毫秒）')
    case 'subchat': return integer('subchat.max_parallel', SUBCHAT_MAX_PARALLEL_MIN, SUBCHAT_MAX_PARALLEL_MAX, '最大并行子对话')
    case 'access': return config.browser.url_allowlist.some(rule => /\s/.test(rule) || rule.length > 2048) ? '每行填写一个域名、通配符或完整 URL，不要包含空格' : undefined
    case 'identity': return /[\r\n]/.test(config.browser.custom_ua + config.browser.accept_language) ? '网站标识与语言不能包含换行' : undefined
  }
}
