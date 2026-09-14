import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  allocSkillId,
  buildSkillsSystemAppendix,
  emptySkillsIndex,
  normalizeSkillVersion,
  parseSkillMarkdown,
  sanitizeSkillName,
  serializeSkillMarkdown,
  type SkillDetail,
  type SkillImportPreview,
  type SkillRecord,
  type SkillsIndex,
  type SkillWriteInput,
} from '../../shared/skills'
import type { SkillProposal, SkillReviewDraft } from '../../shared/types'
import { ensureDir } from '../data-root'

export class SkillStore {
  private root: string
  private indexPath: string
  private proposalsPath: string
  private index: SkillsIndex = emptySkillsIndex()
  private proposals: SkillProposal[] = []
  private changeListener: (() => void) | null = null
  private changeScheduled = false

  constructor(dataRoot: string) {
    this.root = path.join(dataRoot, 'skills')
    this.indexPath = path.join(this.root, 'index.json')
    this.proposalsPath = path.join(this.root, 'proposals.json')
    ensureDir(this.root)
    this.reload()
  }

  /** Fired (coalesced) after the skills index is persisted. */
  onChanged(listener: (() => void) | null): void {
    this.changeListener = listener
  }

  getRoot(): string {
    return this.root
  }

  reload(): SkillsIndex {
    ensureDir(this.root)
    if (!fs.existsSync(this.indexPath)) {
      this.index = emptySkillsIndex()
      this.persistIndex()
    } else {
      try {
        const raw = fs.readFileSync(this.indexPath, 'utf8').replace(/^\uFEFF/, '')
        const parsed = JSON.parse(raw) as SkillsIndex
        if (!parsed || !Array.isArray(parsed.skills)) throw new Error('bad_index')
        this.index = { version: 1, skills: parsed.skills.filter((s) => s && s.id && s.dirName) }
      } catch (e) {
        console.warn('[skills] index load failed, resetting', e)
        this.index = emptySkillsIndex()
        this.persistIndex()
      }
    }
    this.reloadProposals()
    this.syncMetaFromDisk()
    return this.index
  }

  /** Refresh name/description/version/flags from each SKILL.md into the index. */
  private syncMetaFromDisk(): void {
    let dirty = false
    for (const rec of this.index.skills) {
      try {
        const mdPath = path.join(this.skillDir(rec.dirName), 'SKILL.md')
        if (!fs.existsSync(mdPath)) continue
        const parsed = parseSkillMarkdown(fs.readFileSync(mdPath, 'utf8'), (s) => yaml.load(s))
        const nextVersion = parsed.version
        if (parsed.name && parsed.name !== rec.name) {
          rec.name = parsed.name
          dirty = true
        }
        if (parsed.description && parsed.description !== rec.description) {
          rec.description = parsed.description
          dirty = true
        }
        if ((nextVersion || undefined) !== (rec.version || undefined)) {
          rec.version = nextVersion
          dirty = true
        }
        if (parsed.disableModelInvocation !== rec.disableModelInvocation) {
          rec.disableModelInvocation = parsed.disableModelInvocation
          dirty = true
        }
      } catch {
        /* skip broken skill dirs */
      }
    }
    if (dirty) this.persistIndex()
  }

  private reloadProposals(): void {
    if (!fs.existsSync(this.proposalsPath)) {
      this.proposals = []
      this.persistProposals()
      return
    }
    try {
      const raw = fs.readFileSync(this.proposalsPath, 'utf8').replace(/^\uFEFF/, '')
      const parsed = JSON.parse(raw) as { proposals?: SkillProposal[] }
      this.proposals = Array.isArray(parsed?.proposals)
        ? parsed.proposals.filter((p) => p && p.id && p.action && p.draft)
        : []
    } catch (e) {
      console.warn('[skills] proposals load failed', e)
      this.proposals = []
    }
  }

  private persistProposals(): void {
    ensureDir(this.root)
    fs.writeFileSync(
      this.proposalsPath,
      JSON.stringify({ version: 1, proposals: this.proposals }, null, 2),
      'utf8',
    )
  }

  private persistIndex(): void {
    ensureDir(this.root)
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf8')
    this.scheduleChanged()
  }

  private scheduleChanged(): void {
    if (!this.changeListener || this.changeScheduled) return
    this.changeScheduled = true
    queueMicrotask(() => {
      this.changeScheduled = false
      try {
        this.changeListener?.()
      } catch (e) {
        console.warn('[skills] onChanged listener failed', e)
      }
    })
  }

  private skillDir(dirName: string): string {
    const safe = path.basename(String(dirName || ''))
    const full = path.resolve(this.root, safe)
    const rel = path.relative(path.resolve(this.root), full)
    if (!safe || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('invalid_skill_dir')
    }
    return full
  }

  private normalizeWrite(input: SkillWriteInput): {
    name: string
    description: string
    body: string
    version?: string
    disableModelInvocation: boolean
    enabled: boolean
    markdown: string
  } {
    const name = sanitizeSkillName(String(input.name || '').trim() || 'untitled-skill')
    const description = String(input.description || '')
      .trim()
      .slice(0, 1024)
    const body = String(input.body || '')
    const version = normalizeSkillVersion(input.version)
    const disableModelInvocation = Boolean(input.disableModelInvocation)
    const enabled = input.enabled !== false
    const markdown = serializeSkillMarkdown({
      name,
      description,
      body,
      version,
      disableModelInvocation,
    })
    return {
      name,
      description: description || '（无描述）',
      body: body.replace(/^\s+/, ''),
      version,
      disableModelInvocation,
      enabled,
      markdown,
    }
  }

  list(): SkillRecord[] {
    return this.index.skills.map((s) => ({ ...s }))
  }

  get(id: string): SkillDetail | null {
    const rec = this.index.skills.find((s) => s.id === id)
    if (!rec) return null
    const mdPath = path.join(this.skillDir(rec.dirName), 'SKILL.md')
    if (!fs.existsSync(mdPath)) {
      return { ...rec, body: '', frontmatterRaw: undefined }
    }
    const raw = fs.readFileSync(mdPath, 'utf8')
    const parsed = parseSkillMarkdown(raw, (s) => yaml.load(s))
    return {
      ...rec,
      name: parsed.name || rec.name,
      description: parsed.description || rec.description,
      version: parsed.version,
      disableModelInvocation: parsed.disableModelInvocation,
      body: parsed.body,
    }
  }

  /** Create a new skill from editor fields. */
  create(input: SkillWriteInput): SkillDetail {
    const norm = this.normalizeWrite(input)
    const id = allocSkillId(norm.name, this.index.skills.map((s) => s.id))
    const dirName = id
    const dest = this.skillDir(dirName)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    ensureDir(dest)
    fs.writeFileSync(path.join(dest, 'SKILL.md'), norm.markdown, 'utf8')
    const now = Date.now()
    const rec: SkillRecord = {
      id,
      name: norm.name,
      description: norm.description,
      version: norm.version,
      enabled: norm.enabled,
      disableModelInvocation: norm.disableModelInvocation,
      importedAt: now,
      updatedAt: now,
      dirName,
    }
    this.index.skills.push(rec)
    this.persistIndex()
    return { ...rec, body: norm.body }
  }

  /** Update an existing skill in place (id / dirName unchanged). */
  update(id: string, input: SkillWriteInput): SkillDetail {
    const rec = this.index.skills.find((s) => s.id === id)
    if (!rec) throw new Error('skill_not_found')
    const norm = this.normalizeWrite({ ...input, enabled: input.enabled ?? rec.enabled })
    const dest = this.skillDir(rec.dirName)
    ensureDir(dest)
    fs.writeFileSync(path.join(dest, 'SKILL.md'), norm.markdown, 'utf8')
    rec.name = norm.name
    rec.description = norm.description
    rec.version = norm.version
    rec.disableModelInvocation = norm.disableModelInvocation
    rec.enabled = norm.enabled
    rec.updatedAt = Date.now()
    this.persistIndex()
    return { ...rec, body: norm.body }
  }

  /** Full SKILL.md text for export. */
  exportMarkdown(id: string): string {
    const detail = this.get(id)
    if (!detail) throw new Error('skill_not_found')
    const mdPath = path.join(this.skillDir(detail.dirName), 'SKILL.md')
    if (fs.existsSync(mdPath)) {
      return fs.readFileSync(mdPath, 'utf8')
    }
    return serializeSkillMarkdown({
      name: detail.name,
      description: detail.description,
      body: detail.body,
      version: detail.version,
      disableModelInvocation: detail.disableModelInvocation,
    })
  }

  setEnabled(id: string, enabled: boolean): SkillRecord | null {
    const rec = this.index.skills.find((s) => s.id === id)
    if (!rec) return null
    rec.enabled = Boolean(enabled)
    rec.updatedAt = Date.now()
    this.persistIndex()
    return { ...rec }
  }

  remove(id: string): boolean {
    const idx = this.index.skills.findIndex((s) => s.id === id)
    if (idx < 0) return false
    const [rec] = this.index.skills.splice(idx, 1)
    this.persistIndex()
    try {
      const dir = this.skillDir(rec.dirName)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      console.warn('[skills] remove dir failed', e)
    }
    return true
  }

  /** Remove multiple skills; returns removed/failed ids. */
  removeMany(ids: string[]): { removed: string[]; failed: string[] } {
    const removed: string[] = []
    const failed: string[] = []
    const seen = new Set<string>()
    for (const raw of ids) {
      const id = String(raw || '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      if (this.remove(id)) removed.push(id)
      else failed.push(id)
    }
    return { removed, failed }
  }

  /**
   * Import a SKILL.md file or a skill folder (must contain SKILL.md).
   * Copies into dataRoot/skills/<id>/.
   * When the sanitized name matches an existing skill and overwrite is false, throws skill_exists.
   */
  async importFromPath(
    absPath: string,
    opts?: { overwrite?: boolean },
  ): Promise<SkillDetail> {
    const src = path.resolve(String(absPath || ''))
    if (!fs.existsSync(src)) throw new Error('path_not_found')

    const st = fs.statSync(src)
    let skillMdPath = ''
    let copyFromDir: string | null = null
    let singleFile = false

    if (st.isDirectory()) {
      const candidate = path.join(src, 'SKILL.md')
      if (!fs.existsSync(candidate)) throw new Error('skill_md_missing')
      skillMdPath = candidate
      copyFromDir = src
    } else if (st.isFile()) {
      const base = path.basename(src)
      if (!/\.md$/i.test(base)) throw new Error('not_markdown')
      skillMdPath = src
      singleFile = true
    } else {
      throw new Error('unsupported_path')
    }

    const raw = await fsp.readFile(skillMdPath, 'utf8')
    return this.importParsedMarkdown(raw, opts, { copyFromDir, singleFileSource: singleFile ? skillMdPath : null })
  }

  /** Import from SKILL.md text (e.g. drag-drop when path is unavailable). */
  async importFromMarkdown(markdown: string, opts?: { overwrite?: boolean }): Promise<SkillDetail> {
    return this.importParsedMarkdown(String(markdown || ''), opts, {
      copyFromDir: null,
      singleFileSource: null,
    })
  }

  private findConflict(desiredId: string): SkillRecord | undefined {
    return this.index.skills.find(
      (s) => s.id === desiredId || sanitizeSkillName(s.name) === desiredId,
    )
  }

  private async importParsedMarkdown(
    raw: string,
    opts: { overwrite?: boolean } | undefined,
    io: { copyFromDir: string | null; singleFileSource: string | null },
  ): Promise<SkillDetail> {
    const parsed = parseSkillMarkdown(raw, (s) => yaml.load(s))
    const desiredId = parsed.id || sanitizeSkillName(parsed.name)
    const existing = this.findConflict(desiredId)
    const overwrite = opts?.overwrite === true

    if (existing && !overwrite) {
      const err = new Error('skill_exists') as Error & {
        existing: SkillRecord
        incoming: { name: string; description: string }
      }
      err.existing = { ...existing }
      err.incoming = { name: parsed.name, description: parsed.description }
      throw err
    }

    const id =
      existing && overwrite
        ? existing.id
        : parsed.id && !this.index.skills.some((s) => s.id === parsed.id)
          ? parsed.id
          : allocSkillId(parsed.id || parsed.name, this.index.skills.map((s) => s.id))
    const dirName = existing && overwrite ? existing.dirName : id
    const dest = this.skillDir(dirName)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    ensureDir(dest)

    if (io.copyFromDir) {
      await fsp.cp(io.copyFromDir, dest, { recursive: true })
      const destMd = path.join(dest, 'SKILL.md')
      if (!fs.existsSync(destMd)) {
        await fsp.writeFile(destMd, raw, 'utf8')
      }
    } else {
      await fsp.writeFile(path.join(dest, 'SKILL.md'), raw, 'utf8')
    }

    const now = Date.now()
    const existingIdx = this.index.skills.findIndex((s) => s.id === id)
    const rec: SkillRecord = {
      id,
      name: parsed.name || sanitizeSkillName(id),
      description: parsed.description,
      version: parsed.version,
      enabled: existing && overwrite ? existing.enabled : true,
      disableModelInvocation: parsed.disableModelInvocation,
      importedAt: existing && overwrite ? existing.importedAt : now,
      updatedAt: now,
      dirName,
    }
    if (existingIdx >= 0) this.index.skills[existingIdx] = rec
    else this.index.skills.push(rec)
    this.persistIndex()

    return { ...rec, body: parsed.body }
  }

  /** Parse path without writing — for import preview dialogs. */
  async parseFromPath(absPath: string): Promise<SkillImportPreview> {
    const src = path.resolve(String(absPath || ''))
    if (!fs.existsSync(src)) throw new Error('path_not_found')
    const st = fs.statSync(src)
    let skillMdPath = ''
    if (st.isDirectory()) {
      const candidate = path.join(src, 'SKILL.md')
      if (!fs.existsSync(candidate)) throw new Error('skill_md_missing')
      skillMdPath = candidate
    } else if (st.isFile()) {
      if (!/\.md$/i.test(path.basename(src))) throw new Error('not_markdown')
      skillMdPath = src
    } else {
      throw new Error('unsupported_path')
    }
    const raw = await fsp.readFile(skillMdPath, 'utf8')
    return this.buildImportPreview(raw, src)
  }

  /**
   * Discover one or more skills under a path for batch import preview.
   * - File: that markdown skill
   * - Dir with SKILL.md: that skill
   * - Dir whose immediate children contain SKILL.md: each child (and root if present)
   */
  async discoverFromPath(absPath: string): Promise<SkillImportPreview[]> {
    const src = path.resolve(String(absPath || ''))
    if (!fs.existsSync(src)) throw new Error('path_not_found')
    const st = fs.statSync(src)

    if (st.isFile()) {
      return [await this.parseFromPath(src)]
    }
    if (!st.isDirectory()) throw new Error('unsupported_path')

    const skillDirs: string[] = []
    const rootMd = path.join(src, 'SKILL.md')
    if (fs.existsSync(rootMd)) skillDirs.push(src)

    let entries: string[] = []
    try {
      entries = fs.readdirSync(src)
    } catch {
      entries = []
    }
    for (const name of entries) {
      if (name === '.' || name === '..' || name.startsWith('.')) continue
      const child = path.join(src, name)
      let childSt: fs.Stats
      try {
        childSt = fs.statSync(child)
      } catch {
        continue
      }
      if (!childSt.isDirectory()) continue
      if (fs.existsSync(path.join(child, 'SKILL.md'))) skillDirs.push(child)
    }

    if (!skillDirs.length) throw new Error('skill_md_missing')

    const previews: SkillImportPreview[] = []
    const errors: string[] = []
    for (const dir of skillDirs) {
      try {
        previews.push(await this.parseFromPath(dir))
      } catch (e) {
        errors.push(`${path.basename(dir)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (!previews.length) {
      throw new Error(errors[0] || 'skill_md_missing')
    }
    return previews
  }

  /** Parse markdown without writing. */
  parseFromMarkdown(markdown: string, sourceLabel?: string): SkillImportPreview {
    return this.buildImportPreview(String(markdown || ''), undefined, sourceLabel)
  }

  private buildImportPreview(
    raw: string,
    sourcePath?: string,
    sourceLabel?: string,
  ): SkillImportPreview {
    const parsed = parseSkillMarkdown(raw, (s) => yaml.load(s))
    const desiredId = parsed.id || sanitizeSkillName(parsed.name)
    const existing = this.findConflict(desiredId)
    const markdown = serializeSkillMarkdown({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      version: parsed.version,
      disableModelInvocation: parsed.disableModelInvocation,
    })
    return {
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      version: parsed.version,
      disableModelInvocation: parsed.disableModelInvocation,
      markdown,
      existing: existing ? { ...existing } : undefined,
      sourcePath,
      sourceLabel: sourceLabel || (sourcePath ? path.basename(sourcePath) : undefined),
    }
  }

  /** System-prompt appendix for currently enabled skills. */
  buildPromptAppendix(): string {
    const details: SkillDetail[] = []
    for (const rec of this.index.skills) {
      if (!rec.enabled) continue
      const d = this.get(rec.id)
      if (d) details.push(d)
    }
    return buildSkillsSystemAppendix(details)
  }

  listProposals(): SkillProposal[] {
    return this.proposals.map((p) => ({ ...p, draft: { ...p.draft } }))
  }

  getProposal(id: string): SkillProposal | null {
    const p = this.proposals.find((x) => x.id === id)
    return p ? { ...p, draft: { ...p.draft } } : null
  }

  upsertProposal(
    input: Omit<SkillProposal, 'createdAt' | 'updatedAt'> & {
      createdAt?: number
      updatedAt?: number
    },
  ): SkillProposal {
    const now = Date.now()
    const existingIdx = this.proposals.findIndex((p) => p.id === input.id)
    const prev = existingIdx >= 0 ? this.proposals[existingIdx] : null
    const rec: SkillProposal = {
      id: input.id,
      createdAt: prev?.createdAt || input.createdAt || now,
      updatedAt: now,
      chatId: input.chatId,
      action: input.action,
      skillId: input.skillId,
      draft: { ...input.draft },
      markdown: input.markdown,
      existing: input.existing ? { ...input.existing } : undefined,
    }
    if (existingIdx >= 0) this.proposals[existingIdx] = rec
    else this.proposals.unshift(rec)
    this.persistProposals()
    return { ...rec, draft: { ...rec.draft } }
  }

  removeProposal(id: string): boolean {
    const idx = this.proposals.findIndex((p) => p.id === id)
    if (idx < 0) return false
    this.proposals.splice(idx, 1)
    this.persistProposals()
    return true
  }

  /** Apply a pending proposal (optionally with edited draft). */
  applyProposal(
    id: string,
    draftOverride?: SkillReviewDraft,
  ): { ok: true; skill?: SkillDetail; removedId?: string } | { ok: false; error: string } {
    const p = this.proposals.find((x) => x.id === id)
    if (!p) return { ok: false, error: 'proposal_not_found' }
    const draft = draftOverride || p.draft

    try {
      if (p.action === 'create') {
        const skill = this.create({
          name: draft.name,
          description: draft.description,
          body: draft.body,
          version: draft.version,
          disableModelInvocation: Boolean(draft.disableModelInvocation),
          enabled: draft.enabled !== false,
        })
        this.removeProposal(id)
        return { ok: true, skill }
      }
      if (p.action === 'update') {
        const skillId = p.skillId
        if (!skillId) return { ok: false, error: 'skill_id_required' }
        const skill = this.update(skillId, {
          name: draft.name,
          description: draft.description,
          body: draft.body,
          version: draft.version,
          disableModelInvocation: Boolean(draft.disableModelInvocation),
          enabled: draft.enabled !== false,
        })
        this.removeProposal(id)
        return { ok: true, skill }
      }
      if (p.action === 'delete') {
        const skillId = p.skillId
        if (!skillId) return { ok: false, error: 'skill_id_required' }
        const ok = this.remove(skillId)
        if (!ok) return { ok: false, error: 'skill_not_found' }
        this.removeProposal(id)
        return { ok: true, removedId: skillId }
      }
      // export: nothing to apply in store
      this.removeProposal(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
