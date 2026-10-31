export type CreatorKind = 'plugin' | 'skill'
export type CreatorFiles = Record<string, string>
export type CreatorProject = {
  id: string; kind: CreatorKind; name: string; files: CreatorFiles; revision: number; updatedAt: number
  installedId?: string; installedRevision?: number; installedPath?: string
  installedFingerprint?: string
}
export type CreatorSummary = Omit<CreatorProject, 'files'>
export type CreatorIssue = { level: 'error' | 'warning'; file: string; message: string }
export type CreatorValidation = { ok: boolean; issues: CreatorIssue[]; checks: string[] }
export type CreatorResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }
export type CreatorApi = {
  list(kind: CreatorKind): Promise<CreatorResult<{ projects: CreatorSummary[] }>>
  create(kind: CreatorKind, template: string): Promise<CreatorResult<{ project: CreatorProject }>>
  get(id: string): Promise<CreatorResult<{ project: CreatorProject }>>
  save(id: string, revision: number, files: CreatorFiles, name: string): Promise<CreatorResult<{ project: CreatorProject }>>
  validate(id: string, revision: number): Promise<CreatorResult<{ validation: CreatorValidation }>>
  install(id: string, revision: number): Promise<CreatorResult<{ project: CreatorProject }>>
  trial(id: string, revision: number, task: string): Promise<CreatorResult<{ chatId: string; prompt: string }>>
  generate(id: string, revision: number, request: string, providerId?: string, model?: string): Promise<CreatorResult<{ files: CreatorFiles }>>
  cancelGenerate(id: string): Promise<CreatorResult>
  export(id: string, revision: number): Promise<CreatorResult<{ path?: string; canceled?: boolean }>>
}
export const CREATOR_FILE_LIMIT = 300_000
export const CREATOR_FILES: Record<CreatorKind, readonly string[]> = {
  plugin: ['plugin.json', 'main.cjs', 'README.md'], skill: ['SKILL.md'],
}
export function creatorTemplate(kind: CreatorKind, template = 'basic'): CreatorFiles {
  if (kind === 'skill') {
    const steps = template === 'research'
      ? '1. 确定问题范围与信息时效。\n2. 搜集并交叉核对来源，记录链接。\n3. 区分已确认事实与推断。\n4. 给出简洁结论和必要来源。'
      : '1. 确认用户目标与所需输入。\n2. 分步完成任务；缺少必要信息时先询问。\n3. 检查结果是否满足目标。\n4. 简洁交付，说明尚未完成的部分。'
    return { 'SKILL.md': `---\nname: ${template === 'research' ? 'research-helper' : 'my-skill'}\ndescription: ${template === 'research' ? '需要研究问题并核对来源时使用' : '描述本技能适用的任务与触发条件'}\nversion: 1.0.0\ndisable-model-invocation: true\n---\n\n# 工作流程\n\n${steps}\n\n# 输出要求\n\n直接回答问题，保留必要的证据和来源。\n` }
  }
  return {
    'plugin.json': JSON.stringify({ id: 'my-plugin', name: '我的插件', description: '一个本地文本工具', version: '1.0.0', main: 'main.cjs', defaultEnabled: true }, null, 2),
    'main.cjs': `module.exports = {
  tools: [{ type: 'function', function: {
    name: 'my_plugin_text', description: '处理用户提供的文本',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '输入文本' } }, required: ['text'], additionalProperties: false }
  } }],
  planPermissions() { return { capabilities: ['compute.local'] }; },
  async execute(toolName, args, api) {
    if (api.signal.aborted) throw new Error('aborted');
    if (toolName !== 'my_plugin_text') throw new Error('unknown_tool');
    const text = String(args.text || '');
    return { ok: true, text${template === 'text' ? ': text.trim(), characters: [...text].length' : ''} };
  }
};
`,
    'README.md': '# 我的插件\n\n在这里说明工具用途、输入和输出示例。\n\n仅进行本地计算，权限为 compute.local。\n',
  }
}
export function creatorError(error: unknown): string {
  const code = String(error instanceof Error ? error.message : error)
  if (/revision_conflict/.test(code)) return '草稿已在其他位置更新，请重新打开'
  if (/installed_target_conflict|plugin_exists/.test(code)) return '目标已被其他内容占用，请更换标识或重新打开工程'
  if (/invalid_files|file_too_large/.test(code)) return '文件不受支持或内容超过上限'
  if (/validation_failed/.test(code)) return '请先修复校验中的错误'
  if (/aborted|cancelled|AbortError/.test(code)) return '已取消生成'
  if (/timeout|TimeoutError/.test(code)) return '生成超时，原草稿已保留'
  if (/provider_not_found|model_not_found/.test(code)) return '请先配置可用模型'
  if (/auth_40[13]/.test(code)) return '模型密钥验证失败'
  if (/generation_invalid/.test(code)) return '模型未返回有效文件，原草稿已保留'
  if (/project_not_found/.test(code)) return '草稿不存在，请刷新列表'
  if (/project_busy/.test(code)) return '此草稿正在处理，请稍候'
  return '操作失败，请重试'
}
