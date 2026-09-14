import fs from 'node:fs'
import path from 'node:path'
import { ensureDir } from '../data-root'

/** Store API keys under dataRoot/secrets/<ref>.key (ref may contain slashes). */
export class SecretsStore {
  private root: string

  constructor(dataRoot: string) {
    this.root = path.join(dataRoot, 'secrets')
    ensureDir(this.root)
  }

  private pathOf(ref: string): string {
    const safe = String(ref || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!safe) throw new Error('invalid_secret_ref')
    const full = path.join(this.root, `${safe}.key`)
    const resolved = path.resolve(full)
    const rootResolved = path.resolve(this.root)
    const rel = path.relative(rootResolved, resolved)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('invalid_secret_ref')
    }
    ensureDir(path.dirname(resolved))
    return resolved
  }

  get(ref: string | null | undefined): string | null {
    if (!String(ref || '').trim()) return null
    const primary = String(ref)
    const direct = this.readFile(primary)
    if (direct) return direct
    // Brief window after provider-id hydrate used the wrong path for legacy default id.
    if (primary === 'secrets/openai') return this.readFile('secrets/openai_compatible')
    if (primary === 'secrets/openai_compatible') return this.readFile('secrets/openai')
    return null
  }

  private readFile(ref: string): string | null {
    try {
      const p = this.pathOf(ref)
      if (!fs.existsSync(p)) return null
      return fs.readFileSync(p, 'utf8').trim() || null
    } catch {
      return null
    }
  }

  set(ref: string, value: string): void {
    const p = this.pathOf(ref)
    fs.writeFileSync(p, value, 'utf8')
  }

  /** Remove a secret file (and known legacy alias paths for the same key). */
  clear(ref: string | null | undefined): boolean {
    const primary = String(ref || '').trim()
    if (!primary) return false
    const targets = new Set<string>([primary])
    if (primary === 'secrets/openai') targets.add('secrets/openai_compatible')
    if (primary === 'secrets/openai_compatible') targets.add('secrets/openai')
    let removed = false
    for (const r of targets) {
      try {
        const p = this.pathOf(r)
        if (fs.existsSync(p)) {
          fs.unlinkSync(p)
          removed = true
        }
      } catch {
        /* ignore invalid / missing */
      }
    }
    return removed
  }

  has(ref: string | null | undefined): boolean {
    return Boolean(this.get(ref))
  }
}
