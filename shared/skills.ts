/** Navora Agent Skills — Cursor-compatible SKILL.md (YAML frontmatter + markdown). */

export type SkillRecord = {
  id: string
  name: string
  description: string
  /** Optional freeform version from SKILL.md frontmatter (e.g. 1.0.0). */
  version?: string
  enabled: boolean
  /** When true, only list in catalog; agent should skill_read before using. */
  disableModelInvocation: boolean
  importedAt: number
  updatedAt: number
  dirName: string
}

export type SkillDetail = SkillRecord & {
  body: string
  frontmatterRaw?: string
}

export type SkillsIndex = {
  version: 1
  skills: SkillRecord[]
}

export function emptySkillsIndex(): SkillsIndex {
  return { version: 1, skills: [] }
}

export function sanitizeSkillName(raw: string): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return s || 'skill'
}

export function allocSkillId(base: string, existing: Iterable<string>): string {
  const used = new Set(existing)
  const root = sanitizeSkillName(base)
  if (!used.has(root)) return root
  let n = 2
  while (used.has(`${root}-${n}`)) n += 1
  return `${root}-${n}`
}

export type ParsedSkillMd = {
  name: string
  description: string
  /** Stable kebab id from frontmatter.id when valid. */
  id?: string
  version?: string
  disableModelInvocation: boolean
  body: string
  meta: Record<string, unknown>
}

/** Optional skill version; empty / missing → undefined. */
export function normalizeSkillVersion(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim().slice(0, 64)
  return s || undefined
}

/**
 * Import conflict presentation when an existing skill shares the same name/id.
 * - Both sides have versions and they differ → "20240202 更新到 20250202"
 * - Missing version on either side, or same version → overwrite
 */
export type SkillImportConflictKind = 'update' | 'overwrite'

export function skillImportConflictKind(
  existing?: { version?: string } | null,
  incomingVersion?: string | null,
): SkillImportConflictKind | null {
  if (!existing) return null
  const from = normalizeSkillVersion(existing.version)
  const to = normalizeSkillVersion(incomingVersion)
  if (from && to && from !== to) return 'update'
  return 'overwrite'
}

/** Short badge/chip label for import conflict (null when no conflict). */
export function skillImportConflictBadge(
  existing?: { version?: string } | null,
  incomingVersion?: string | null,
): string | null {
  const kind = skillImportConflictKind(existing, incomingVersion)
  if (!kind) return null
  if (kind === 'update') {
    const from = normalizeSkillVersion(existing?.version)!
    const to = normalizeSkillVersion(incomingVersion)!
    return `${from} 更新到 ${to}`
  }
  return '将覆盖'
}

/** Parse SKILL.md with optional YAML frontmatter. `loadYaml` from js-yaml. */
export function parseSkillMarkdown(
  raw: string,
  loadYaml: (s: string) => unknown,
): ParsedSkillMd {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  let meta: Record<string, unknown> = {}
  let body = text
  if (m) {
    try {
      const parsed = loadYaml(m[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>
      }
    } catch {
      meta = {}
    }
    body = m[2] || ''
  }

  const name = sanitizeSkillName(String(meta.name || '').trim() || 'untitled-skill')
  const description = String(meta.description || '')
    .trim()
    .slice(0, 1024)
  const version = normalizeSkillVersion(meta.version)
  const idRaw = String(meta.id || '')
    .trim()
    .toLowerCase()
  const id = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(idRaw) && idRaw.length <= 64 ? idRaw : undefined
  const disableModelInvocation =
    meta['disable-model-invocation'] === true ||
    meta.disableModelInvocation === true ||
    meta['disable_model_invocation'] === true

  return {
    name,
    description: description || '（无描述）',
    ...(id ? { id } : {}),
    version,
    disableModelInvocation,
    body: body.replace(/^\s+/, ''),
    meta,
  }
}

export type SkillWriteInput = {
  name: string
  description: string
  body: string
  version?: string
  disableModelInvocation?: boolean
  enabled?: boolean
}

/** Parsed skill ready for import preview (no write yet). */
export type SkillImportPreview = {
  name: string
  description: string
  body: string
  version?: string
  disableModelInvocation: boolean
  markdown: string
  existing?: SkillRecord
  sourcePath?: string
  sourceLabel?: string
}

/** Serialize to Cursor-compatible SKILL.md. */
export function serializeSkillMarkdown(input: {
  name: string
  description: string
  body: string
  version?: string
  disableModelInvocation?: boolean
}): string {
  const name = sanitizeSkillName(String(input.name || '').trim() || 'untitled-skill')
  const description = String(input.description || '')
    .trim()
    .slice(0, 1024)
  const version = normalizeSkillVersion(input.version)
  const body = String(input.body || '').replace(/^\s+/, '')
  const lines = ['---', `name: ${yamlScalar(name)}`, `description: ${yamlScalar(description || '（无描述）')}`]
  if (version) {
    lines.push(`version: ${yamlScalar(version)}`)
  }
  if (input.disableModelInvocation) {
    lines.push('disable-model-invocation: true')
  }
  lines.push('---', '', body.replace(/\s+$/, ''), '')
  return lines.join('\n')
}

function yamlScalar(value: string): string {
  const s = String(value || '')
  if (!s) return '""'
  if (/[:#{}[\],&*!|>'"%@`]|^\s|\s$|\n/.test(s) || /^(true|false|null|~|\d+)/i.test(s)) {
    return JSON.stringify(s)
  }
  return s
}

const PER_SKILL_BODY_MAX = 12000
const TOTAL_SKILLS_BODY_MAX = 40000

export function buildSkillsSystemAppendix(
  skills: Array<
    Pick<SkillDetail, 'id' | 'name' | 'description' | 'version' | 'disableModelInvocation' | 'body' | 'enabled'>
  >,
): string {
  const enabled = skills.filter((s) => s.enabled)
  if (!enabled.length) return ''

  const lines: string[] = [
    '15. 自定义技能（Skills）：以下为用户已启用技能（Markdown 流程），与插件（Plugins）不同。',
    '   - 任务匹配时优先按技能步骤执行（调用已有工具）。可随时 skill_list / skill_read 查询技能。',
    '   - 问「插件」能力、加解密/验证码工具：用 plugin_list / plugin_read，勿 skill_read(插件 id)。',
    '   - 标记为需读取的技能：先 skill_read(id) 再执行。',
    '   - 禁止主动 skill_create / skill_update / skill_delete / skill_export：须用户明确要求增删改/导出。禁止因列表为空或任务失败就新建技能。',
    '   - 技能只描述怎么用现有工具，不会新增工具名；不要调用技能正文以外的虚构工具。',
    '',
    '### 技能目录',
  ]

  for (const s of enabled) {
    const flag = s.disableModelInvocation ? '（需 skill_read）' : ''
    const ver = s.version ? ` v${s.version}` : ''
    lines.push(`- \`${s.id}\`${ver} ${s.name}${flag}：${s.description}`)
  }

  let budget = TOTAL_SKILLS_BODY_MAX
  const full = enabled.filter((s) => !s.disableModelInvocation)
  if (full.length) {
    lines.push('', '### 技能正文')
    for (const s of full) {
      if (budget <= 0) {
        lines.push(`- \`${s.id}\` 正文过长已省略，请用 skill_read("${s.id}") 读取。`)
        continue
      }
      let body = String(s.body || '').trim()
      if (!body) continue
      if (body.length > PER_SKILL_BODY_MAX) {
        body = `${body.slice(0, PER_SKILL_BODY_MAX)}\n…[truncated]`
      }
      if (body.length > budget) {
        body = `${body.slice(0, Math.max(0, budget - 20))}\n…[truncated]`
      }
      budget -= body.length
      lines.push('', `#### skill:${s.id} — ${s.name}`, body)
    }
  }

  return lines.join('\n')
}

/** Prefill skill editor fields from a chat (user confirms before create). */
export function draftSkillFromChat(chat: {
  title?: string
  messages?: Array<{ role: string; content: string }>
}): SkillWriteInput {
  const title = String(chat.title || '').trim() || 'conversation-skill'
  const name = sanitizeSkillName(title)
  const messages = (chat.messages || []).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  const lines: string[] = [
    '## 何时使用',
    `从对话「${title}」整理。遇到同类任务时优先遵循下列要点。`,
    '',
    '## 对话要点',
  ]
  const take = messages.slice(-40)
  if (!take.length) {
    lines.push('（对话暂无用户/助手正文，请手工补充步骤。）', '')
  } else {
    for (const m of take) {
      const role = m.role === 'user' ? '用户' : '助手'
      const content = String(m.content || '')
        .trim()
        .slice(0, 2000)
      if (!content) continue
      lines.push(`### ${role}`, content, '')
    }
  }
  lines.push(
    '## 执行说明',
    '- 将上文中已确认有效的步骤提炼为可复用流程，删去试错与无关闲聊。',
    '- 优先使用 Navora 已有工具；写清判定条件与失败时的下一步。',
  )
  return {
    name,
    description: `从对话「${title}」整理的技能。请确认正文后再启用。`,
    body: lines.join('\n').trim() + '\n',
    disableModelInvocation: false,
    enabled: true,
  }
}
