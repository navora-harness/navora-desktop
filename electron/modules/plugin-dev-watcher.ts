import fs from 'node:fs'
import path from 'node:path'
import type { PluginStore } from './plugin-store'

const DEBOUNCE_MS = 400

/**
 * When plugin dev mode is on, watch linked plugin folders (dist) and reload
 * after main.cjs / plugin.json / other files change.
 */
export class PluginDevWatcher {
  private watchers = new Map<string, fs.FSWatcher>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private enabled = false
  private reloading = false
  private skipUntil = 0

  constructor(
    private plugins: PluginStore,
    private isEnabled: () => boolean,
  ) {}

  sync(): void {
    const next = this.isEnabled()
    if (!next) {
      this.enabled = false
      this.clearTimer()
      this.closeAll()
      return
    }
    this.enabled = true
    const dirs = this.linkedDirs()
    const want = new Set(dirs)
    for (const [dir, w] of this.watchers) {
      if (!want.has(dir)) {
        this.safeClose(w)
        this.watchers.delete(dir)
      }
    }
    for (const dir of dirs) {
      if (this.watchers.has(dir)) continue
      this.startWatch(dir)
    }
  }

  stop(): void {
    this.enabled = false
    this.clearTimer()
    this.closeAll()
  }

  private linkedDirs(): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const p of this.plugins.list()) {
      if (p.kind !== 'linked') continue
      const dir = path.resolve(String(p.path || ''))
      if (!dir || seen.has(dir)) continue
      seen.add(dir)
      if (fs.existsSync(dir)) out.push(dir)
    }
    for (const dir of this.plugins.sessionLinkedDirs()) {
      const abs = path.resolve(dir)
      if (!abs || seen.has(abs)) continue
      seen.add(abs)
      out.push(abs)
    }
    return out
  }

  private startWatch(dir: string): void {
    try {
      const w = fs.watch(dir, { recursive: true, persistent: false }, (_ev, filename) => {
        if (!this.enabled) return
        const name = String(filename || '').replace(/\\/g, '/')
        if (name && !this.isRelevant(name)) return
        this.scheduleReload()
      })
      w.on('error', () => {
        this.safeClose(w)
        this.watchers.delete(dir)
      })
      this.watchers.set(dir, w)
    } catch {
      /* watch unsupported or path gone */
    }
  }

  private isRelevant(rel: string): boolean {
    const base = path.basename(rel).toLowerCase()
    if (base.endsWith('.map')) return false
    if (base === 'plugin.json' || base.endsWith('.cjs') || base.endsWith('.js')) return true
    if (base.endsWith('.md')) return true
    return !base.includes('.')
  }

  private scheduleReload(): void {
    if (!this.enabled || this.reloading) return
    if (Date.now() < this.skipUntil) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.runReload()
    }, DEBOUNCE_MS)
  }

  private runReload(): void {
    if (!this.enabled || this.reloading) return
    this.reloading = true
    this.skipUntil = Date.now() + DEBOUNCE_MS
    try {
      this.plugins.reload()
      // Also refresh session-scoped (plugin-dev) links that share watched dirs.
      for (const dir of this.plugins.sessionLinkedDirs()) {
        this.plugins.reloadSessionDir(dir)
      }
    } catch (e) {
      console.warn('[plugin-dev-watch] reload failed', e)
    } finally {
      this.reloading = false
      this.skipUntil = Date.now() + 200
      this.sync()
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private closeAll(): void {
    for (const w of this.watchers.values()) this.safeClose(w)
    this.watchers.clear()
  }

  private safeClose(w: fs.FSWatcher): void {
    try {
      w.close()
    } catch {
      /* ignore */
    }
  }
}
