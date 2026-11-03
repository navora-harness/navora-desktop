import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../../shared/config'
import {previewTextLimit,previewImageLimit,previewImageMimes,previewBinaryExtensions,type WorkspacePreview} from '../../shared/workspace-preview'
import {resourceKind,type WorkspaceResourceSnapshot} from '../../shared/workspace-resources'

/** True if `child` is `parent` or a path under it (sep-safe). */
export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  )
}

/** Check existing ancestors as well as the lexical path, including junctions on Windows. */
function assertRealPathInside(root: string, full: string): void {
  if (!isPathInsideOrEqual(root, full)) throw new Error('path_outside_workspace')
  const realRoot = fs.realpathSync.native(root)
  let existing = full
  for (;;) {
    try {
      // lstat distinguishes a missing path from a dangling link, which must fail closed.
      fs.lstatSync(existing)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
  if (!isPathInsideOrEqual(realRoot, fs.realpathSync.native(existing))) {
    throw new Error('path_outside_workspace')
  }
}

/** Sandboxed file workspace under dataRoot/workspace/<chatId> or custom roots. */
export class WorkspaceFiles {
  private dataRoot: string
  private getConfig: () => AppConfig
  private getChatWorkspaceRoot?: (chatId: string) => string | undefined
  /** Extra roots allowed after user pickDirectory (or grandfathered chat overrides). */
  private allowedExtraRoots = new Set<string>()
  private onChanged?: (chatId: string) => void

  constructor(
    dataRoot: string,
    getConfig: () => AppConfig,
    getChatWorkspaceRoot?: (chatId: string) => string | undefined,
  ) {
    this.dataRoot = dataRoot
    this.getConfig = getConfig
    this.getChatWorkspaceRoot = getChatWorkspaceRoot
  }

  setOnChanged(cb: ((chatId: string) => void) | undefined): void {
    this.onChanged = cb
  }

  emitChanged(chatId: string): void {
    if (!chatId) return
    this.onChanged?.(chatId)
  }

  /** Remember a user-picked (or legacy) absolute workspace root. */
  allowExtraRoot(absPath: string): string {
    const root = path.resolve(String(absPath || '').trim())
    this.allowedExtraRoots.add(root)
    return root
  }

  /** Whether absPath may be used as a chat workspace root (null/empty = clear, always ok). */
  isAllowedWorkspaceRoot(absPath: string | null | undefined): boolean {
    const trimmed = absPath?.trim() || ''
    if (!trimmed) return true
    const resolved = path.resolve(trimmed)
    if (isPathInsideOrEqual(this.dataRoot, resolved)) return true
    const custom = this.getConfig().files.custom_root?.trim()
    if (custom && isPathInsideOrEqual(path.resolve(custom), resolved)) return true
    if (this.allowedExtraRoots.has(resolved)) return true
    return false
  }

  assertAllowedWorkspaceRoot(absPath: string | null | undefined): void {
    if (!this.isAllowedWorkspaceRoot(absPath)) {
      throw new Error('workspace_root_not_allowed')
    }
  }

  /** Absolute workspace root for a chat. */
  chatRoot(chatId: string): string {
    const perChat = this.getChatWorkspaceRoot?.(chatId)?.trim()
    if (perChat) {
      const root = path.resolve(perChat)
      if (this.isAllowedWorkspaceRoot(root)) {
        fs.mkdirSync(root, { recursive: true })
        return root
      }
      // Invalid / revoked override → fall through to builtin/custom
    }
    const custom = this.getConfig().files.custom_root?.trim()
    if (custom) {
      const root = path.resolve(custom, sanitizeSeg(chatId))
      fs.mkdirSync(root, { recursive: true })
      assertRealPathInside(path.resolve(custom), root)
      return root
    }
    const dirName = this.getConfig().files.root_dirname || 'workspace'
    const parent = path.resolve(this.dataRoot, dirName)
    const root = path.resolve(parent, sanitizeSeg(chatId))
    fs.mkdirSync(root, { recursive: true })
    assertRealPathInside(parent, root)
    return root
  }

  rootInfo(chatId: string) {
    const abs = this.chatRoot(chatId)
    const perChatRaw = this.getChatWorkspaceRoot?.(chatId)?.trim() || ''
    const perChat =
      Boolean(perChatRaw) && this.isAllowedWorkspaceRoot(path.resolve(perChatRaw))
    const customParent = this.getConfig().files.custom_root?.trim() || ''
    return {
      ok: true as const,
      chatId,
      absolutePath: abs,
      source: perChat ? ('chat_override' as const) : customParent ? ('custom_root' as const) : ('builtin' as const),
      customRoot: customParent || null,
      builtinRelative: this.getConfig().files.root_dirname || 'workspace',
    }
  }

  private async existingRoot(chatId:string):Promise<string|null> {
    const override=this.getChatWorkspaceRoot?.(chatId)?.trim()
    const custom=this.getConfig().files.custom_root?.trim()
    const candidate=override&&this.isAllowedWorkspaceRoot(override)?path.resolve(override)
      :path.resolve(custom||path.resolve(this.dataRoot,this.getConfig().files.root_dirname||'workspace'),sanitizeSeg(chatId))
    try{await fsp.access(candidate)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
    return this.resolveExisting(chatId,'.')
  }

  /** Index existing workspaces without creating empty directories or following links. */
  async containsFiles(chatId:string):Promise<boolean> {
    const root=await this.existingRoot(chatId)
    if(!root)return false
    const pending=[root]
    while(pending.length){
      const current=await this.resolveExisting(chatId,path.relative(root,pending.pop()!)||'.')
      const entries=await fsp.readdir(current,{withFileTypes:true})
      for(const entry of entries){
        if(entry.isSymbolicLink())continue
        if(entry.isFile())return true
        if(entry.isDirectory())pending.push(path.join(current,entry.name))
      }
    }
    return false
  }

  /** Bounded metadata only: every visited directory stays inside the owner's workspace. */
  async resources(chatId:string):Promise<WorkspaceResourceSnapshot> {
    const root=await this.existingRoot(chatId)
    const result:WorkspaceResourceSnapshot={ok:true,entries:[],truncated:false,unavailable:0}
    if(!root)return result
    const realRoot=await fsp.realpath(root)
    const limit=Math.max(1,Math.min(2000,this.getConfig().files.max_list_entries||500))
    const budget=Math.max(128,limit*4),pending=['.']
    let visited=0
    for(let index=0;index<pending.length;index++){
      if(visited>=budget||result.entries.length>=limit){result.truncated=true;break}
      const relative=pending[index]!
      try{
        const directory=await this.resolveExisting(chatId,relative)
        const stream=await fsp.opendir(directory)
        for await(const entry of stream){
          if(visited++>=budget||result.entries.length>=limit){result.truncated=true;break}
          if(entry.isSymbolicLink())continue
          const child=relative==='.'?entry.name:`${relative}/${entry.name}`
          // Recovery records are internal editing state, not generated deliverables.
          if(child==='browser-annotations/drafts')continue
          if(entry.isDirectory()){pending.push(child);continue}
          if(!entry.isFile())continue
          try{
            const absolute=path.resolve(root,child)
            if(!isPathInsideOrEqual(root,absolute))throw Error('path_outside_workspace')
            const real=await fsp.realpath(absolute)
            if(!isPathInsideOrEqual(realRoot,real))throw Error('path_outside_workspace')
            const stat=await fsp.lstat(absolute)
            if(!stat.isFile()||stat.isSymbolicLink())continue
            result.entries.push({id:JSON.stringify([chatId,child]),ownerChatId:chatId,path:child,name:entry.name,kind:resourceKind(child),size:stat.size,mtimeMs:stat.mtimeMs,revision:`${stat.mtimeMs}:${stat.size}`})
          }catch(error){if(!/ENOENT/.test(String(error)))result.unavailable++}
        }
      }catch(error){
        if(relative==='.')throw error
        if(!/ENOENT/.test(String(error)))result.unavailable++
      }
    }
    result.entries.sort((a,b)=>b.mtimeMs-a.mtimeMs||a.path.localeCompare(b.path))
    return result
  }

  /** Resolve a relative workspace path; throws if escapes sandbox. */
  resolve(chatId: string, relPath: string): string {
    const root = this.chatRoot(chatId)
    const cleaned = String(relPath || '.')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    const full = path.resolve(root, cleaned || '.')
    assertRealPathInside(root, full)
    return full
  }

  /**
   * Resolve a path that must exist for open/reveal.
   * If the agent passes the workspace folder's own basename as a child
   * (e.g. workspace is .../calculator and path is "calculator"), fall back to `.`.
   */
  async resolveExisting(chatId: string, relPath: string): Promise<string> {
    const root = this.chatRoot(chatId)
    const raw = String(relPath ?? '').trim()
    const abs = this.resolve(chatId, raw || '.')
    try {
      await fsp.access(abs)
      return abs
    } catch {
      // e.g. workspace=.../calculator and path is "calculator" or "./calculator"
      const nestedSameName =
        path.basename(abs).toLowerCase() === path.basename(root).toLowerCase() &&
        path.resolve(path.dirname(abs)) === path.resolve(root)
      if (nestedSameName) {
        await fsp.access(root)
        return root
      }
      throw new Error(
        `ENOENT: no such file or directory, access '${abs}'` +
          ` (hint: paths are relative to current workspace root; use "." for the root itself)`,
      )
    }
  }

  toRel(chatId: string, absPath: string): string {
    const root = this.chatRoot(chatId)
    return path.relative(root, absPath).replace(/\\/g, '/') || '.'
  }

  async list(chatId: string, relDir = '.', recursive = false) {
    const dir = this.resolve(chatId, relDir)
    const max = this.getConfig().files.max_list_entries || 500
    const out: Array<{
      path: string
      name: string
      type: 'file' | 'dir'
      size?: number
      mtimeMs?: number
    }> = []

    const walk = async (abs: string, prefix: string) => {
      if (out.length >= max) return
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        if (out.length >= max) break
        const name = ent.name
        const childAbs = path.join(abs, name)
        const childRel = prefix ? `${prefix}/${name}` : name
        if (ent.isDirectory()) {
          out.push({ path: childRel, name, type: 'dir' })
          if (recursive) await walk(childAbs, childRel)
        } else if (ent.isFile()) {
          const st = await fsp.stat(childAbs).catch(() => null)
          out.push({
            path: childRel,
            name,
            type: 'file',
            size: st?.size,
            mtimeMs: st?.mtimeMs,
          })
        }
      }
    }

    const st = await fsp.stat(dir)
    if (!st.isDirectory()) throw new Error('not_a_directory')
    await walk(dir, relDir === '.' || relDir === '' ? '' : relDir.replace(/\\/g, '/').replace(/\/+$/, ''))
    return {
      ok: true as const,
      root: this.toRel(chatId, this.chatRoot(chatId)),
      absoluteRoot: this.chatRoot(chatId),
      entries: out,
      truncated: out.length >= max,
    }
  }

  async stat(chatId: string, relPath: string) {
    const abs = this.resolve(chatId, relPath)
    const st = await fsp.stat(abs)
    return {
      ok: true as const,
      path: this.toRel(chatId, abs),
      type: st.isDirectory() ? ('dir' as const) : ('file' as const),
      size: st.size,
      mtimeMs: st.mtimeMs,
      ctimeMs: st.ctimeMs,
    }
  }

  /** Bounded UI reads; never executes HTML or exposes files outside the workspace. */
  async preview(chatId: string, relPath: string): Promise<WorkspacePreview> {
    const abs = await this.resolveExisting(chatId, relPath)
    const handle = await fsp.open(abs, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('not_a_file')
      const ext = path.extname(abs).toLowerCase()
      const imageMime = mimeFromImageExt(ext)
      const limit = imageMime ? previewImageLimit : previewTextLimit
      const result = { ok: true, path: this.toRel(chatId, abs), size: stat.size }
      if(previewBinaryExtensions.has(ext))return {...result,kind:'unsupported',reason:'file_type'}
      if (imageMime && stat.size > limit) return { ...result, kind: 'unsupported',reason:'image_too_large' }
      const buf = Buffer.alloc(Math.min(stat.size, limit))
      let offset = 0
      while (offset < buf.length) {
        const { bytesRead } = await handle.read(buf, offset, buf.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      const bytes = buf.subarray(0, offset)
      if (imageMime) return { ...result, kind: 'image', mime: imageMime, base64: bytes.toString('base64') }
      // Binary files remain available through the existing system-open action.
      const utf16LE=bytes[0]===0xff&&bytes[1]===0xfe,utf16BE=bytes[0]===0xfe&&bytes[1]===0xff
      if (!utf16LE&&!utf16BE&&bytes.includes(0)) return { ...result, kind: 'unsupported',reason:'binary' }
      let content:string
      try{content=new TextDecoder(utf16LE?'utf-16le':utf16BE?'utf-16be':'utf-8',{fatal:true}).decode(utf16LE||utf16BE?bytes.subarray(2):bytes,{stream:stat.size>limit}).replace(/^\uFEFF/,'')}
      catch{return {...result,kind:'unsupported',reason:'encoding'}}
      return { ...result, kind: /\.(md|markdown|mdown)$/i.test(ext) ? 'markdown' : 'text', content, truncated: stat.size > limit }
    } finally { await handle.close() }
  }

  async readText(chatId: string, relPath: string, opts?: { offset?: number; maxChars?: number }) {
    const abs = this.resolve(chatId, relPath)
    const max = opts?.maxChars ?? this.getConfig().files.max_read_chars ?? 200000
    const buf = await fsp.readFile(abs)
    let text = buf.toString('utf8')
    const offset = Math.max(0, opts?.offset || 0)
    if (offset > 0) text = text.slice(offset)
    const truncated = text.length > max
    if (truncated) text = text.slice(0, max)
    return {
      ok: true as const,
      path: this.toRel(chatId, abs),
      encoding: 'utf8' as const,
      size: buf.length,
      content: text,
      truncated,
      offset,
    }
  }

  async writeText(
    chatId: string,
    relPath: string,
    content: string,
    opts?: { append?: boolean },
  ) {
    const abs = this.resolve(chatId, relPath)
    const maxBytes = this.getConfig().files.max_write_bytes || 52_428_800
    const data = Buffer.from(content ?? '', 'utf8')
    if (data.length > maxBytes) throw new Error('write_too_large')
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    if (opts?.append) await fsp.appendFile(abs, data)
    else await fsp.writeFile(abs, data)
    const st = await fsp.stat(abs)
    this.emitChanged(chatId)
    return { ok: true as const, path: this.toRel(chatId, abs), size: st.size, append: Boolean(opts?.append) }
  }

  async writeBytes(chatId: string, relPath: string, data: Buffer) {
    const abs = this.resolve(chatId, relPath)
    const maxBytes = this.getConfig().files.max_write_bytes || 52_428_800
    if (data.length > maxBytes) throw new Error('write_too_large')
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, data)
    const st = await fsp.stat(abs)
    this.emitChanged(chatId)
    return { ok: true as const, path: this.toRel(chatId, abs), size: st.size }
  }

  /** Read an image under the chat workspace for UI display (base64). */
  async readMedia(
    chatId: string,
    relPath: string,
    opts?: { maxBytes?: number },
  ): Promise<{
    ok: true
    path: string
    mime: string
    base64: string
    size: number
    width?: number
    height?: number
  }> {
    const abs = await this.resolveExisting(chatId, relPath)
    const ext = path.extname(abs).toLowerCase()
    const mime = mimeFromImageExt(ext)
    if (!mime) throw new Error('not_an_image')
    const st = await fsp.stat(abs)
    if (!st.isFile()) throw new Error('not_a_file')
    const maxBytes = opts?.maxBytes ?? 12_582_912
    if (st.size > maxBytes) throw new Error('media_too_large')
    const buf = await fsp.readFile(abs)
    return {
      ok: true as const,
      path: this.toRel(chatId, abs),
      mime,
      base64: buf.toString('base64'),
      size: st.size,
    }
  }

  async mkdir(chatId: string, relPath: string) {
    const abs = this.resolve(chatId, relPath)
    await fsp.mkdir(abs, { recursive: true })
    this.emitChanged(chatId)
    return { ok: true as const, path: this.toRel(chatId, abs) }
  }

  async remove(chatId: string, relPath: string) {
    const abs = this.resolve(chatId, relPath)
    const root = this.chatRoot(chatId)
    if (abs === root) throw new Error('cannot_delete_workspace_root')
    await fsp.rm(abs, { recursive: true, force: true })
    this.emitChanged(chatId)
    return { ok: true as const, path: this.toRel(chatId, abs) }
  }

  async move(chatId: string, from: string, to: string) {
    const src = this.resolve(chatId, from)
    const dest = this.resolve(chatId, to)
    const root = this.chatRoot(chatId)
    if (src === root) throw new Error('cannot_move_workspace_root')
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.rename(src, dest)
    this.emitChanged(chatId)
    return { ok: true as const, from: this.toRel(chatId, src), to: this.toRel(chatId, dest) }
  }

  async copy(chatId: string, from: string, to: string) {
    const src = this.resolve(chatId, from)
    const dest = this.resolve(chatId, to)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.cp(src, dest, { recursive: true, force: true })
    this.emitChanged(chatId)
    return { ok: true as const, from: this.toRel(chatId, src), to: this.toRel(chatId, dest) }
  }

  async concat(
    chatId: string,
    sources: string[],
    dest: string,
  ): Promise<{ ok: true; path: string; bytes: number; parts: number }> {
    if (!sources?.length) throw new Error('sources_required')
    const destAbs = this.resolve(chatId, dest)
    await fsp.mkdir(path.dirname(destAbs), { recursive: true })
    const sourcePaths = sources.map((source) => this.resolve(chatId, source))
    const maxBytes = this.getConfig().files.max_write_bytes || 52_428_800
    // Write beside the destination and replace only after every input succeeds.
    // This also supports the destination being one of the input files.
    const tempPath = path.join(path.dirname(destAbs), `.navora-concat-${randomUUID()}.tmp`)
    let bytes = 0
    const fh = await fsp.open(tempPath, 'wx')
    try {
      for (const abs of sourcePaths) {
        const input = await fsp.open(abs, 'r')
        try {
          if (!(await input.stat()).isFile()) throw new Error('not_a_file')
          for await (const chunk of input.createReadStream({ autoClose: false })) {
            const data = chunk as Buffer
            bytes += data.length
            if (bytes > maxBytes) throw new Error('write_too_large')
            await fh.writeFile(data)
          }
        } finally {
          await input.close()
        }
      }
      await fh.close()
      await fsp.rename(tempPath, destAbs)
    } finally {
      await fh.close().catch(() => {})
      await fsp.unlink(tempPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    this.emitChanged(chatId)
    return { ok: true as const, path: this.toRel(chatId, destAbs), bytes, parts: sources.length }
  }
}

function sanitizeSeg(s: string): string {
  const segment = String(s || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  return !segment || segment === '.' || segment === '..' ? 'unknown' : segment
}

function mimeFromImageExt(ext:string):string|null{return previewImageMimes[ext]||null}
