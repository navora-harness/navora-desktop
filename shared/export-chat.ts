import type { ChatMessage, ChatSession } from './types'
import {executionSummary,transcriptBlocks} from './message-presentation'
import {conversationSources} from './conversation-resources'
import {taskDeclarationsLabel} from './task-declarations'
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

  const fence=(text:string,language='')=>{
    let length=3
    for(const match of text.matchAll(/`+/g))length=Math.max(length,match[0].length+1)
    const marker='`'.repeat(length)
    return `${marker}${language}\n${text}\n${marker}`
  }
  const render=(message:ChatMessage,process=false)=>{
    const heading=process&&message.role==='assistant'?'进展':roleHeading(message.role,message.meta)
    lines.push(`${process?'####':'###'} ${heading} · ${formatExportTimestamp(message.createdAt)}`,'')
    const declarationLabel=message.role==='user'?taskDeclarationsLabel(message.meta?.taskConstraints?.declarations??message.meta?.document?.declarations):''
    if(declarationLabel)lines.push('任务声明：'+declarationLabel,'')
    const content=(message.content||'').trimEnd()
    if(content)lines.push(message.role==='tool'?fence(content):content,'')
    if(message.role==='tool'&&message.meta){
      if(message.meta.args!=null)lines.push('**参数**','',fence(stringifyMetaValue(message.meta.args),'json'),'')
      if(message.meta.result!=null){
        const result=stringifyMetaValue(message.meta.result)
        let same=false
        try{same=JSON.stringify(JSON.parse(content))===JSON.stringify(message.meta.result)}catch{/* Human-readable content may supplement structured data. */}
        if(!same)lines.push('**结果**','',fence(result),'')
      }
    }
    if(!process&&message.role==='assistant'){
      const sources=conversationSources([message]).filter(source=>!content.includes(source.url))
      if(sources.length){lines.push('**来源**','');for(const source of sources)lines.push(`- [${(source.title||source.url).replace(/[\[\]<>\r\n]/g,' ')}](<${source.url}>)`);lines.push('')}
    }
  }
  for(const block of transcriptBlocks(chat.messages||[],{collapseTools:true,collapseLogs:true,showLogs:true})){
    if(block.type==='run'){
      lines.push('<details>',`<summary>${executionSummary(block.items)}</summary>`,'')
      if(block.reasoning)lines.push('<details>','<summary>思考过程</summary>','',block.reasoning,'','</details>','')
      for(const message of block.items){if(message.content.trim()||message.role!=='assistant')render(message,true)}
      lines.push('</details>','')
    }else render(block.message)
    lines.push('---','')
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
