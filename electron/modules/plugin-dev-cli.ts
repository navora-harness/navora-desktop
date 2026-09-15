import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isPathInsideOrEqual } from './workspace-files'

export type PluginDevCliAction = 'build' | 'check'

export type PluginDevCliResult =
  | {
      ok: true
      action: PluginDevCliAction
      code: number
      stdout: string
      stderr: string
      cli: string
      args: string[]
      cwd: string
      timedOut: boolean
    }
  | {
      ok: false
      error: string
      hint?: string
      stdout?: string
      stderr?: string
      code?: number | null
      timedOut?: boolean
    }

/** Locate navora-plugin-sdk CLI (monorepo sibling, node_modules, or NAVORA_PLUGIN_SDK). */
export function resolveNavoraPluginCli(): string | null {
  const candidates: string[] = []
  const envSdk = process.env.NAVORA_PLUGIN_SDK?.trim()
  if (envSdk) {
    candidates.push(path.join(path.resolve(envSdk), 'bin', 'navora-plugin.mjs'))
  }
  try {
    const req = createRequire(path.join(process.cwd(), 'package.json'))
    const pkgJson = req.resolve('navora-plugin-sdk/package.json')
    candidates.push(path.join(path.dirname(pkgJson), 'bin', 'navora-plugin.mjs'))
  } catch {
    /* not installed under cwd */
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    // electron/modules → ../../.. = navora-desktop; dist-electron/modules → same
    candidates.push(path.resolve(here, '../../../navora-plugin-sdk/bin/navora-plugin.mjs'))
    candidates.push(path.resolve(here, '../../../../navora-plugin-sdk/bin/navora-plugin.mjs'))
  } catch {
    /* no import.meta.url */
  }
  candidates.push(path.resolve(process.cwd(), '../navora-plugin-sdk/bin/navora-plugin.mjs'))
  candidates.push(path.resolve(process.cwd(), 'node_modules/navora-plugin-sdk/bin/navora-plugin.mjs'))

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * Run sibling/installed `navora-plugin` CLI for build/check.
 * plugin_pack is in-process (see plugin-pack.ts) and does not use this.
 * - Directory with plugin.json → single-plugin mode (cwd=that dir, no --root).
 * - Otherwise treat as plugins monorepo root (--root=that dir).
 */
export function runPluginDevCli(opts: {
  action: PluginDevCliAction
  workspaceRoot: string
  id?: string
  entry?: string
  root?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<PluginDevCliResult> {
  const cli = resolveNavoraPluginCli()
  if (!cli) {
    return Promise.resolve({
      ok: false,
      error: 'navora_plugin_cli_not_found',
      hint:
        '未找到 navora-plugin-sdk CLI。请确认 monorepo 旁有 navora-plugin-sdk，或设置环境变量 NAVORA_PLUGIN_SDK，或在 navora-desktop 下 npm i navora-plugin-sdk。',
    })
  }

  const workspaceRoot = path.resolve(opts.workspaceRoot)
  let target = workspaceRoot
  if (opts.root?.trim()) {
    target = path.resolve(workspaceRoot, opts.root.trim())
    if (!isPathInsideOrEqual(workspaceRoot, target)) {
      return Promise.resolve({
        ok: false,
        error: 'root_outside_workspace',
        hint: 'root 必须位于当前 Chat 工作区内。',
      })
    }
  }

  const isSinglePlugin = fs.existsSync(path.join(target, 'plugin.json'))
  const cwd = target
  const rootFlag = isSinglePlugin ? undefined : target

  let resolvedId = opts.id?.trim() || ''
  if (!resolvedId && isSinglePlugin) {
    try {
      const man = JSON.parse(fs.readFileSync(path.join(target, 'plugin.json'), 'utf8')) as {
        id?: string
      }
      resolvedId = String(man.id || '').trim() || path.basename(target)
    } catch {
      resolvedId = path.basename(target)
    }
  }
  const args: string[] = [cli, opts.action]
  if (resolvedId) args.push(resolvedId)
  if (rootFlag) args.push('--root', rootFlag)
  if (opts.entry?.trim()) args.push('--entry', opts.entry.trim())

  const timeoutMs = Math.min(Math.max(opts.timeoutMs || 120_000, 5_000), 600_000)

  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ ok: false, error: 'aborted' })
      return
    }

    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''
    const maxOut = 200_000

    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node'
    const child = spawn(nodeCmd, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env },
      shell: false,
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.()
    }, timeoutMs)

    const onAbort = () => child.kill('SIGTERM')
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (result: PluginDevCliResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.stdout?.on('data', (buf: Buffer) => {
      if (stdout.length < maxOut) stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf: Buffer) => {
      if (stderr.length < maxOut) stderr += buf.toString('utf8')
    })
    child.on('error', (e) => {
      finish({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint:
          e instanceof Error && /ENOENT/i.test(e.message)
            ? '找不到 node。请确认本机已安装 Node.js 并在 PATH 中。'
            : undefined,
        stdout,
        stderr,
      })
    })
    child.on('close', (code) => {
      if (opts.signal?.aborted) {
        finish({ ok: false, error: 'aborted', stdout, stderr })
        return
      }
      const exit = code ?? (timedOut ? 1 : 0)
      if (timedOut) {
        finish({
          ok: false,
          error: 'timeout',
          code: exit,
          stdout,
          stderr,
          timedOut: true,
        })
        return
      }
      if (exit !== 0) {
        finish({
          ok: false,
          error: 'cli_failed',
          code: exit,
          stdout,
          stderr,
          hint: stderr.trim() || stdout.trim() || undefined,
        })
        return
      }
      finish({
        ok: true,
        action: opts.action,
        code: exit,
        stdout,
        stderr,
        cli,
        args: args.slice(1),
        cwd,
        timedOut: false,
      })
    })
  })
}
