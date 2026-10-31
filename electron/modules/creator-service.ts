import { CreatorStore, assertCreatorFiles, validateCreator } from './creator-store'
import { parseSkillMarkdown } from '../../shared/skills'
import type { CreatorFiles } from '../../shared/creators'
import type { PluginStore } from './plugin-store'
import type { SkillStore } from './skill-store'
import type { ChatStore } from './chat-store'
import type { AppConfig } from '../../shared/config'
import { modelCapabilities, reasoningValue } from '../../shared/model-capabilities'
import type { SecretsStore } from './secrets'
import { OpenAICompatibleClient } from './llm/openai-compatible'
import yaml from 'js-yaml'
import { createHash } from 'node:crypto'
import { parseCreatorGeneration } from '../../shared/creator-generation'
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')

export class CreatorService {
  readonly store: CreatorStore
  private busy = new Set<string>()
  private generating = new Map<string, AbortController>()
  constructor(dataRoot: string, private dependencies: { plugins: PluginStore; skills: SkillStore; chats: ChatStore; secrets: SecretsStore; getConfig: () => AppConfig }) { this.store = new CreatorStore(dataRoot) }
  private project(id: string, revision: number) {
    const project = this.store.get(id)
    if (project.revision !== revision) throw new Error('revision_conflict')
    return project
  }
  save(id: string, revision: number, files: CreatorFiles, name: string) {
    if (this.busy.has(id)) throw new Error('project_busy')
    return this.store.save(id, revision, files, name)
  }
  validate(id: string, revision: number) { const project = this.project(id, revision); return validateCreator(project.kind, project.files) }
  async install(id: string, revision: number) {
    if (this.busy.has(id)) throw new Error('project_busy')
    this.busy.add(id)
    try {
      const project = this.project(id, revision)
      if (!validateCreator(project.kind, project.files).ok) throw new Error('validation_failed')
      const { plugins, skills } = this.dependencies
      if (project.kind === 'skill') {
        const parsed = parseSkillMarkdown(project.files['SKILL.md']!, value => yaml.load(value))
        const existing = project.installedId ? skills.get(project.installedId) : null
        if (existing && project.installedFingerprint && fingerprint(skills.exportMarkdown(existing.id)) !== project.installedFingerprint) throw new Error('installed_target_conflict')
        const input = { name: parsed.name, description: parsed.description, body: parsed.body, version: parsed.version, disableModelInvocation: parsed.disableModelInvocation, enabled: existing?.enabled ?? true }
        const installed = existing ? skills.update(existing.id, input) : skills.create(input)
        return this.store.markInstalled(id, revision, installed.id, undefined, fingerprint(skills.exportMarkdown(installed.id)))
      }
      const manifest = JSON.parse(project.files['plugin.json']!), existing = plugins.get(manifest.id)
      if (project.installedId && project.installedId !== manifest.id) throw new Error('installed_target_conflict')
      if (existing && (existing.id !== project.installedId || existing.path !== project.installedPath || existing.bundled)) throw new Error('installed_target_conflict')
      const directory = this.store.snapshot(id, revision)
      const result = await plugins.importFromPath(directory, { overwrite: Boolean(existing) })
      if (!result.ok) {
        // A malformed runtime export must not replace the last working revision.
        if (existing) await plugins.importFromPath(existing.path, { overwrite: true })
        else if (plugins.get(manifest.id)) plugins.remove(manifest.id)
        throw new Error('validation_failed')
      }
      return this.store.markInstalled(id, revision, manifest.id, directory)
    } finally { this.busy.delete(id) }
  }
  trial(id: string, revision: number, task: string) {
    const project = this.project(id, revision)
    if (!validateCreator(project.kind, project.files).ok) throw new Error('validation_failed')
    const { chats, plugins } = this.dependencies
    const chat = chats.create(`试用：${project.name}`, { titleGenerated: true })
    try {
      if (project.kind === 'plugin') {
        const directory = this.store.snapshot(id, revision)
        const result = plugins.linkSessionPlugin(chat.id, directory)
        if (!result.ok || !result.plugin) throw new Error('validation_failed')
        chats.upsertDevPluginLink(chat.id, { id: result.plugin.id, path: directory })
        return { chatId: chat.id, prompt: task.trim().slice(0, 6000) || `请使用本对话插件 ${result.plugin.name} 的工具完成一次最小测试，并检查结果是否符合工具说明。执行有副作用的操作前先询问。` }
      }
      const parsed = parseSkillMarkdown(project.files['SKILL.md']!, value => yaml.load(value))
      return { chatId: chat.id, prompt: `请按以下技能完成测试任务。\n\n<skill name=${JSON.stringify(parsed.name)}>\n${parsed.body}\n</skill>\n\n测试任务：${task.trim().slice(0,6000) || '请先列出还需要我提供的输入。'}` }
    } catch (error) {
      if (project.kind === 'plugin') plugins.unloadSessionPlugin(chat.id, JSON.parse(project.files['plugin.json']!).id)
      chats.delete(chat.id)
      throw error
    }
  }
  cancelGenerate(id: string) { this.generating.get(id)?.abort(); this.generating.delete(id) }
  async generate(id: string, revision: number, request: string, providerId?: string, model?: string) {
    const project = this.project(id, revision)
    if (!request.trim() || request.length > 6000) throw new Error('generation_invalid')
    if (this.generating.has(id)) throw new Error('project_busy')
    const config = this.dependencies.getConfig()
    const provider = config.ai.providers.find(item => item.id === (providerId || config.ai.default_provider))
    if (!provider) throw new Error('provider_not_found')
    const chosenModel = model || provider.model
    if (!provider.models.includes(chosenModel)) throw new Error('model_not_found')
    const capability = modelCapabilities(provider, chosenModel)
    const controller = new AbortController()
    this.generating.set(id, controller)
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 60000)
    try {
      const client = new OpenAICompatibleClient({ baseUrl: provider.base_url, apiKey: this.dependencies.secrets.get(provider.api_key_ref) || '', model: chosenModel, timeoutMs: 60000, maxOutputTokens: Math.min(8192, capability.max_output_tokens), outputTokenParam: provider.output_token_param, reasoningEffort: reasoningValue(capability), contextWindow: capability.context_window })
      const contract = project.kind === 'plugin'
        ? '返回 plugin.json、main.cjs、README.md。plugin.json 必填 id/name/description/version/main，id 为小写短横线标识；main=main.cjs；不得 bundled 或 suite。main.cjs 导出 CommonJS 对象 {tools:ChatCompletionTool[], planPermissions(toolName,args,ctx){return {capabilities:[...]};},async execute(toolName,args,api){...}}。必须声明真实所需的非空能力；纯计算使用 compute.local。api.signal 支持取消，api.runTool(name,args) 调宿主工具并接受权限检查。禁止 require electron、child_process、fs 或自行绕过权限。无需 npm 依赖。工具名加插件前缀，未知工具抛错。不要伪造已完成外部操作。'
        : '仅返回 SKILL.md。使用 YAML frontmatter，name 为小写字母数字短横线标识，description 说明明确的使用场景，version=1.0.0，disable-model-invocation=true。Markdown 正文写清任务步骤、输入、验证标准和输出要求，简洁可复用，不包含密钥，不指示绕过权限。'
      const answer = await client.chat([{ role:'system', content:`你是 Navora ${project.kind === 'plugin' ? '插件' : '技能'}创建助手。只返回 JSON 对象 {"files":{"文件名":"完整文件内容"}}，不返回说明或代码围栏。${contract}所有内容只是可编辑草稿，不安装、不运行。` }, { role:'user', content:`需求：${request}\n\n当前草稿：\n${JSON.stringify(project.files).slice(0,60000)}` }], [], controller.signal)
      if (controller.signal.aborted) throw new Error('aborted')
      this.project(id, revision)
      let files: CreatorFiles
      try { files = parseCreatorGeneration(answer.content || ''); assertCreatorFiles(project.kind, files) }
      catch { throw new Error('generation_invalid') }
      if (!Object.keys(files).length) throw new Error('generation_invalid')
      return files
    } catch (error) {
      const code = String(error)
      throw new Error(controller.signal.aborted ? String(controller.signal.reason).includes('timeout') ? 'timeout' : 'aborted' : /revision_conflict|generation_invalid|auth_401|auth_403|timeout/.exec(code)?.[0] || 'generation_failed')
    } finally { clearTimeout(timer); if (this.generating.get(id) === controller) this.generating.delete(id) }
  }
}
