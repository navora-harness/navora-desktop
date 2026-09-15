import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './config'
import { resolvePluginDevMode } from './config'

/** Short fallback if plugin-dev-prompt.md cannot be read (bundled main). */
const PLUGIN_DEV_PROMPT_FALLBACK = `## 插件开发模式（SDK 契约）

当前已开启插件开发模式。把 Chat 工作区指到插件工程根；优先用 plugin_build（默认外链到本会话及子对话）/ plugin_check / plugin_pack（宿主内置打 zip，安装包可用）/ plugin_link；会话外链不进全局插件列表。
外链必须指向 \`dist/<packageId>\`（含 plugin.json + main.cjs），不要指工程根。
模块必须导出 \`tools\` / \`planPermissions\`（非空 capabilities）/ \`execute\`；只走 \`api.registry\` / \`api.runTool\` / \`api.getConfig\` / \`api.helpers\`。
查已装插件用 plugin_list / plugin_read。`

function promptCandidates(): string[] {
  const out: string[] = []
  try {
    // Bundled main.js lives in dist-electron/; build copies the md next to it.
    const here = path.dirname(fileURLToPath(import.meta.url))
    out.push(path.join(here, 'plugin-dev-prompt.md'))
    out.push(path.join(here, 'shared', 'plugin-dev-prompt.md'))
  } catch {
    /* bundled without import.meta.url */
  }
  out.push(path.join(process.cwd(), 'shared', 'plugin-dev-prompt.md'))
  out.push(path.join(process.cwd(), 'dist-electron', 'plugin-dev-prompt.md'))
  return out
}

let cached: string | null = null

function loadPromptBody(): string {
  if (cached) return cached
  for (const file of promptCandidates()) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
        if (text) {
          cached = text
          return cached
        }
      }
    } catch {
      /* try next */
    }
  }
  cached = PLUGIN_DEV_PROMPT_FALLBACK
  return cached
}

/** Plugin SDK appendix for Agent system prompt. Empty when dev_mode is off. */
export function buildPluginDevPromptAppendix(cfg?: AppConfig | null): string {
  if (!resolvePluginDevMode(cfg)) return ''
  const body = loadPromptBody()
  if (body.startsWith('## ')) return `\n${body}\n`
  return `\n## 插件开发模式（SDK 契约）\n\n${body}\n`
}
