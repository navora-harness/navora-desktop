import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Script } from 'node:vm'
import yaml from 'js-yaml'
import { CREATOR_FILES, CREATOR_FILE_LIMIT, creatorTemplate, type CreatorFiles, type CreatorKind, type CreatorProject, type CreatorSummary, type CreatorValidation } from '../../shared/creators'
import { parseSkillMarkdown } from '../../shared/skills'
import { isPathInsideOrEqual } from './workspace-files'

export function assertCreatorFiles(kind: CreatorKind, files: unknown): asserts files is CreatorFiles {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('invalid_files')
  const entries = Object.entries(files)
  if (entries.length > CREATOR_FILES[kind].length) throw new Error('invalid_files')
  for (const [name, value] of entries) {
    if (!CREATOR_FILES[kind].includes(name) || typeof value !== 'string') throw new Error('invalid_files')
    if (Buffer.byteLength(value) > CREATOR_FILE_LIMIT) throw new Error('file_too_large')
  }
}
export function validateCreator(kind: CreatorKind, files: CreatorFiles): CreatorValidation {
  const issues: CreatorValidation['issues'] = [], checks: string[] = []
  const error = (file: string, message: string) => issues.push({ level: 'error', file, message })
  try { assertCreatorFiles(kind, files); checks.push('文件路径与大小') } catch { error('', '文件不受支持或内容超过 300 KB'); return { ok: false, issues, checks } }
  if (kind === 'skill') {
    try {
      const text = files['SKILL.md'] || ''
      const skill = parseSkillMarkdown(text, value => yaml.load(value))
      if (!/^---\r?\n/.test(text)) error('SKILL.md', '需要 YAML frontmatter')
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(skill.meta.name || ''))) error('SKILL.md', 'name 应使用小写字母、数字、连字符或下划线')
      if (typeof skill.meta.description !== 'string' || !skill.meta.description.trim()) error('SKILL.md', '填写 description，说明何时使用')
      if (!skill.body.trim()) error('SKILL.md', '填写技能正文')
      if (!issues.length) checks.push('技能元信息', '技能正文')
      if (skill.body.length > 16000) issues.push({ level: 'warning', file: 'SKILL.md', message: '正文较长，可把参考资料拆为单独资源后导入' })
    } catch { error('SKILL.md', '无法解析 YAML 或技能内容') }
  } else {
    try {
      const manifest = JSON.parse(files['plugin.json'] || '')
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manifest.id || '')) error('plugin.json', 'id 应使用小写字母、数字、连字符或下划线')
      for (const key of ['name', 'description', 'version']) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) error('plugin.json', `填写 ${key}`)
      if (manifest.main && manifest.main !== 'main.cjs') error('plugin.json', '创建器入口固定为 main.cjs')
      if (manifest.bundled) error('plugin.json', '用户插件不能声明 bundled')
      if (manifest.suite) error('plugin.json', '创建器使用独立插件，请移除 suite 后通过标准导入器管理套件')
      checks.push('插件清单')
    } catch { error('plugin.json', '清单不是有效 JSON') }
    const code = files['main.cjs'] || ''
    try { new Script(`(function(exports,require,module,__filename,__dirname){\n${code}\n})`, { filename: 'main.cjs' }); checks.push('JavaScript 语法') }
    catch (err) { error('main.cjs', `语法错误：${err instanceof Error ? err.message : '无法编译'}`) }
    for (const contract of ['tools', 'planPermissions', 'execute']) if (!new RegExp(`\\b${contract}\\b`).test(code)) error('main.cjs', `缺少 ${contract} 接口声明`)
    if (!issues.some(issue => issue.file === 'main.cjs')) checks.push('工具与权限接口声明')
  }
  return { ok: !issues.some(issue => issue.level === 'error'), issues, checks }
}

export class CreatorStore {
  readonly root: string
  constructor(dataRoot: string) { this.root = path.join(dataRoot, 'creators'); fs.mkdirSync(this.root, { recursive: true }) }
  private directory(id: string) {
    if (!/^creator_[a-f0-9]{24}$/.test(id)) throw new Error('project_not_found')
    const dir = path.join(this.root, id)
    if (!isPathInsideOrEqual(fs.realpathSync(this.root), fs.realpathSync(dir))) throw new Error('project_not_found')
    return dir
  }
  list(kind?: CreatorKind): CreatorSummary[] {
    return fs.readdirSync(this.root).flatMap(id => {
      try { const { files: _, ...summary } = this.get(id); return !kind || summary.kind === kind ? [summary] : [] } catch { return [] }
    }).sort((a,b) => b.updatedAt - a.updatedAt)
  }
  get(id: string): CreatorProject {
    const directory = this.directory(id), file = path.join(directory, 'project.json')
    if (!isPathInsideOrEqual(fs.realpathSync(directory), fs.realpathSync(file))) throw new Error('project_not_found')
    const project = JSON.parse(fs.readFileSync(file, 'utf8')) as CreatorProject
    if (project.id !== id || !['plugin', 'skill'].includes(project.kind) || !Number.isInteger(project.revision) || project.revision < 1) throw new Error('project_not_found')
    assertCreatorFiles(project.kind, project.files)
    return project
  }
  private write(project: CreatorProject) {
    const dir = this.directory(project.id), target = path.join(dir, 'project.json'), temporary = path.join(dir, `.${randomUUID()}.tmp`)
    try { fs.writeFileSync(temporary, JSON.stringify(project, null, 2)); fs.renameSync(temporary, target) }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    return project
  }
  create(kind: CreatorKind, template: string): CreatorProject {
    if (kind !== 'plugin' && kind !== 'skill') throw new Error('invalid_kind')
    const id = `creator_${randomUUID().replaceAll('-', '').slice(0,24)}`
    fs.mkdirSync(path.join(this.root, id))
    const files = creatorTemplate(kind, template)
    if (kind === 'plugin') {
      files['plugin.json'] = files['plugin.json']!.replace('"my-plugin"', `"my-plugin-${id.slice(-6)}"`)
      files['main.cjs'] = files['main.cjs']!.replaceAll('my_plugin_text', `my_plugin_${id.slice(-6)}_text`)
    }
    return this.write({ id, kind, name: kind === 'plugin' ? '新插件' : '新技能', files, revision: 1, updatedAt: Date.now() })
  }
  save(id: string, revision: number, files: CreatorFiles, name: string) {
    const current = this.get(id)
    if (current.revision !== revision) throw new Error('revision_conflict')
    assertCreatorFiles(current.kind, files)
    return this.write({ ...current, name: String(name || current.name).trim().slice(0,80), files, revision: revision + 1, updatedAt: Date.now() })
  }
  markInstalled(id: string, revision: number, installedId: string, installedPath?: string, installedFingerprint?: string) {
    const project = this.get(id)
    if (revision !== project.revision) throw new Error('revision_conflict')
    return this.write({ ...project, installedId, installedRevision: revision, installedPath, installedFingerprint })
  }
  snapshot(id: string, revision: number): string {
    const project = this.get(id)
    if (project.revision !== revision) throw new Error('revision_conflict')
    if (!validateCreator(project.kind, project.files).ok) throw new Error('validation_failed')
    const releases = path.join(this.directory(id), 'releases')
    fs.mkdirSync(releases, { recursive: true })
    if (!isPathInsideOrEqual(fs.realpathSync(this.directory(id)), fs.realpathSync(releases))) throw new Error('invalid_files')
    const directory = path.join(releases, `revision-${revision}`)
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory)
      for (const [name, content] of Object.entries(project.files)) fs.writeFileSync(path.join(directory, name), content, { flag: 'wx' })
    }
    if (!isPathInsideOrEqual(fs.realpathSync(releases), fs.realpathSync(directory))) throw new Error('invalid_files')
    return directory
  }
}
