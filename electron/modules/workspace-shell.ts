import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type { AppConfig } from '../../shared/config'
import { DEFAULT_SHELL_ALLOWLIST } from '../../shared/config'
import type { WorkspaceFiles } from './workspace-files'

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'ComSpec',
  'COMSPEC',
  'USERNAME',
  'USER',
  'LOGNAME',
  'NumberOfProcessors',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'TERM',
  'COLORTERM',
])

/** Windows cmd.exe builtins (no .exe). Spawn via ComSpec /c so `dir` etc. work. */
const WINDOWS_CMD_BUILTINS = new Set(['dir', 'echo', 'type', 'cd', 'md', 'mkdir', 'rd', 'rmdir'])

/**
 * Windows shims that are `.cmd`/`.bat` (not PE executables). Direct spawn() → ENOENT;
 * run through ComSpec /c like builtins. Keep allowlist check on the logical name.
 */
const WINDOWS_CMD_SCRIPTS = new Set([
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'navora-plugin',
  'where',
])

/**
 * Safe OS helpers scoped to the chat workspace (+ gated shell exec).
 */
export class WorkspaceShell {
  private files: WorkspaceFiles
  private getConfig: () => AppConfig

  constructor(files: WorkspaceFiles, getConfig: () => AppConfig) {
    this.files = files
    this.getConfig = getConfig
  }

  /** Reveal path in system file manager (Explorer / Finder). */
  async reveal(chatId: string, relPath: string) {
    const abs = await this.files.resolveExisting(chatId, relPath || '.')
    shell.showItemInFolder(abs)
    return { ok: true as const, path: this.files.toRel(chatId, abs), action: 'reveal' as const }
  }

  /** Open file/folder with the OS default application. */
  async open(chatId: string, relPath: string) {
    const abs = await this.files.resolveExisting(chatId, relPath || '.')
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
    return { ok: true as const, path: this.files.toRel(chatId, abs), action: 'open' as const }
  }

  /**
   * Run a process with cwd inside the workspace.
   * Prefer file_reveal / file_open for Explorer; use this only when a real command is needed.
   */
  async exec(
    chatId: string,
    opts: {
      command: string
      args?: string[]
      cwd?: string
      shell?: boolean
      timeoutMs?: number
      signal?: AbortSignal
    },
  ) {
    const command = String(opts.command || '').trim()
    if (!command) throw new Error('command_required')
    const args = Array.isArray(opts.args) ? opts.args.map(String) : []
    const normalized = normalizeShellCommand(command)
    const cfg = this.getConfig()
    const allowlist = Array.isArray(cfg.files.shell_allowlist)
      ? cfg.files.shell_allowlist
      : [...DEFAULT_SHELL_ALLOWLIST]
    if (!isCommandAllowed(normalized, allowlist)) {
      throw new Error(`shell_command_not_allowed:${normalized}`)
    }
    for (const a of args) {
      if (a.includes('\0')) throw new Error('shell_arg_invalid')
    }

    const useShell = Boolean(opts.shell) && cfg.files.shell_allow_shell_flag === true
    if (Boolean(opts.shell) && !useShell) {
      throw new Error('shell_flag_disabled')
    }

    const cwd = this.files.resolve(chatId, opts.cwd || '.')
    const st = await fsp.stat(cwd)
    if (!st.isDirectory()) throw new Error('cwd_not_directory')

    const timeoutMs = Math.min(
      Math.max(opts.timeoutMs || cfg.files.shell_timeout_ms || 30000, 1000),
      cfg.files.shell_timeout_ms_max || 120000,
    )
    const maxOut = cfg.files.shell_max_output_chars || 80000
    const env = sanitizeShellEnv(process.env)

    const spawnPlan = resolveSpawnPlan(normalized, args, useShell)

    return new Promise<{
      ok: true
      code: number | null
      signal: NodeJS.Signals | null
      stdout: string
      stderr: string
      timedOut: boolean
    }>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new Error('aborted'))
        return
      }
      let settled = false
      let timedOut = false
      let stdout = ''
      let stderr = ''

      const child = spawn(spawnPlan.command, spawnPlan.args, {
        cwd,
        shell: spawnPlan.shell,
        windowsHide: true,
        env,
      })

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref?.()
      }, timeoutMs)

      const onAbort = () => {
        child.kill('SIGTERM')
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      const finish = (
        err?: Error,
        result?: {
          code: number | null
          signal: NodeJS.Signals | null
          stdout: string
          stderr: string
          timedOut: boolean
        },
      ) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else if (result) resolve({ ok: true, ...result })
      }

      child.stdout?.on('data', (buf: Buffer) => {
        if (stdout.length < maxOut) stdout += buf.toString('utf8')
      })
      child.stderr?.on('data', (buf: Buffer) => {
        if (stderr.length < maxOut) stderr += buf.toString('utf8')
      })
      child.on('error', (e) => finish(e))
      child.on('close', (code, sig) => {
        if (opts.signal?.aborted) {
          finish(new Error('aborted'))
          return
        }
        finish(undefined, {
          code,
          signal: sig,
          stdout: truncate(stdout, maxOut),
          stderr: truncate(stderr, maxOut),
          timedOut,
        })
      })
    })
  }
}

function normalizeShellCommand(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) return ''
  // Reject path-like commands (only basenames allowed).
  if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
    throw new Error('shell_command_path_forbidden')
  }
  let base = path.basename(trimmed)
  base = base.replace(/\.(exe|cmd|bat|ps1)$/i, '')
  return base
}

function isCommandAllowed(command: string, allowlist: string[]): boolean {
  if (!command || !allowlist.length) return false
  const lower = command.toLowerCase()
  return allowlist.some((item) => String(item || '').trim().toLowerCase() === lower)
}

/**
 * On Windows, cmd builtins and .cmd shims (npm/npx/…) are not PE executables —
 * spawn via ComSpec /c. Keep allowlist check on the logical command, not on cmd.exe.
 */
function resolveSpawnPlan(
  command: string,
  args: string[],
  useShell: boolean,
): { command: string; args: string[]; shell: boolean } {
  if (useShell) {
    return { command, args, shell: true }
  }
  const lower = command.toLowerCase()
  if (
    process.platform === 'win32' &&
    (WINDOWS_CMD_BUILTINS.has(lower) || WINDOWS_CMD_SCRIPTS.has(lower))
  ) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    return {
      command: comspec,
      args: ['/d', '/s', '/c', command, ...args],
      shell: false,
    }
  }
  return { command, args, shell: false }
}

function sanitizeShellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(env)) {
    if (SAFE_ENV_KEYS.has(key)) out[key] = env[key]
  }
  // Ensure PATH exists on Windows even if only Path was copied.
  if (!out.PATH && out.Path) out.PATH = out.Path
  return out
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`
}
