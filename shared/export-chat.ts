import type { ChatMessage, ChatSession } from './types'
import { resolveToolDisplay } from './tool-display'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatExportTimestamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function roleHeading(role: ChatMessage['role'], meta?: ChatMessage['meta']): string {
  if (role === 'user') return '你'
  if (role === 'assistant') return 'Navora'
  if (role === 'system') return '系统'
  if (role === 'log') return '日志'
  if (role === 'tool') {
    const name = typeof meta?.toolName === 'string' && meta.toolName ? meta.toolName : 'tool'
    const { label } = resolveToolDisplay(name, {
      pluginId: typeof meta?.pluginId === 'string' ? meta.pluginId : undefined,
      fromPlugin: meta?.fromPlugin === true,
    })
    return `${label} · ${name}`
  }
  return role
}

/** Safe basename for OS save dialogs (Windows rejects <>:"/\\|?* etc.). */
export function sanitizeExportFilename(name: string, fallback = 'export'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 80) || fallback
}

export function suggestChatExportFilename(chat: ChatSession, ext: 'md' | 'json' = 'md'): string {
  const stamp = formatExportTimestamp(Date.now()).replace(/[: ]/g, '-').replace(/-+/g, '-')
  return `${sanitizeExportFilename(chat.title || '对话', '对话')}-${stamp}.${ext}`
}

export function suggestSkillExportFilename(name: string, id?: string): string {
  const base = sanitizeExportFilename(name || id || 'SKILL', 'SKILL')
  return base.toLowerCase().endsWith('.md') ? base : `${base}.md`
}

function stringifyMetaValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatChatAsMarkdown(chat: ChatSession): string {
  const lines: string[] = []
  lines.push(`# ${chat.title || '未命名对话'}`)
  lines.push('')
  lines.push(`- 导出时间：${formatExportTimestamp(Date.now())}`)
  lines.push(`- 创建时间：${formatExportTimestamp(chat.createdAt)}`)
  lines.push(`- 更新时间：${formatExportTimestamp(chat.updatedAt)}`)
  if (chat.providerId || chat.model) {
    lines.push(`- 模型：${[chat.providerId, chat.model].filter(Boolean).join(' / ')}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const m of chat.messages || []) {
    lines.push(`### ${roleHeading(m.role, m.meta)} · ${formatExportTimestamp(m.createdAt)}`)
    lines.push('')
    const content = (m.content || '').trimEnd()
    if (content) {
      lines.push(content)
      lines.push('')
    }
    if (m.role === 'assistant' && typeof m.meta?.reasoning === 'string' && m.meta.reasoning.trim()) {
      lines.push('<details>')
      lines.push('<summary>思考</summary>')
      lines.push('')
      lines.push(m.meta.reasoning.trim())
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }
    if (m.role === 'tool' && m.meta) {
      if (m.meta.args != null) {
        lines.push('**参数**')
        lines.push('')
        lines.push('```json')
        lines.push(stringifyMetaValue(m.meta.args))
        lines.push('```')
        lines.push('')
      }
      if (m.meta.result != null) {
        lines.push('**结果**')
        lines.push('')
        lines.push('```')
        lines.push(stringifyMetaValue(m.meta.result))
        lines.push('```')
        lines.push('')
      }
    }
    lines.push('---')
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export function formatChatAsJson(chat: ChatSession): string {
  return `${JSON.stringify(
    {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      providerId: chat.providerId,
      model: chat.model,
      exportedAt: Date.now(),
      messages: chat.messages,
    },
    null,
    2,
  )}\n`
}

export function formatChatExportContent(chat: ChatSession, format: 'md' | 'json'): string {
  return format === 'json' ? formatChatAsJson(chat) : formatChatAsMarkdown(chat)
}
