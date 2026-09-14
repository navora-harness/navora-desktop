/** Display taxonomy for Agent tool calls in chat UI / export. */

export type ToolDisplayKind =
  | 'automation'
  | 'shell'
  | 'files'
  | 'settings'
  | 'interact'
  | 'plugin'
  | 'tool'

export type ToolDisplayInfo = {
  kind: ToolDisplayKind
  /** Role label next to avatar (展开对话中的名称) */
  label: string
  /** Font Awesome icon name (solid) */
  icon: string
}

const KIND_INFO: Record<ToolDisplayKind, Omit<ToolDisplayInfo, 'kind'>> = {
  automation: { label: '自动化', icon: 'robot' },
  shell: { label: '命令行', icon: 'terminal' },
  files: { label: '文件', icon: 'folder-open' },
  settings: { label: '设置', icon: 'gear' },
  interact: { label: '询问', icon: 'circle-question' },
  plugin: { label: '插件', icon: 'puzzle-piece' },
  tool: { label: '工具', icon: 'wrench' },
}

/** collective label for collapsed run groups (logs + tool ops). */
export const TOOL_RUN_GROUP_LABEL = '工具'

export type ResolveToolDisplayOpts = {
  /** Set when the call was dispatched via a loadable plugin (still role=tool). */
  pluginId?: string | null
  fromPlugin?: boolean
}

export function resolveToolDisplay(
  toolName: string | null | undefined,
  opts?: ResolveToolDisplayOpts,
): ToolDisplayInfo {
  if (opts?.pluginId || opts?.fromPlugin) {
    return { kind: 'plugin', ...KIND_INFO.plugin }
  }
  const name = String(toolName || '').trim()
  const kind = classifyToolName(name)
  return { kind, ...KIND_INFO[kind] }
}

export function classifyToolName(toolName: string): ToolDisplayKind {
  const name = String(toolName || '').trim()
  if (!name) return 'tool'

  if (name === 'shell_exec') return 'shell'

  if (
    name.startsWith('browser_') ||
    name === 'desktop_screenshot'
  ) {
    return 'automation'
  }

  if (name.startsWith('file_') || name.startsWith('workspace_')) return 'files'

  if (name.startsWith('app_settings_') || name === 'app_models_list' || name === 'app_provider_add') {
    return 'settings'
  }
  if (
    name === 'skill_list' ||
    name === 'skill_read' ||
    name === 'skill_create' ||
    name === 'skill_update' ||
    name === 'skill_delete' ||
    name === 'skill_export'
  ) {
    return 'settings'
  }
  if (name === 'plugin_list' || name === 'plugin_read' || name === 'store_search') {
    return 'plugin'
  }

  if (name === 'agent_ask_user') return 'interact'
  if (
    name === 'agent_spawn_subchat' ||
    name === 'agent_await_subchats' ||
    name === 'agent_subchat_status'
  ) {
    return 'interact'
  }

  return 'tool'
}
