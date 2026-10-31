/** Immediate, bounded titles. The model may refine these only while idle. */
export function localChatTitle(text: string): string | null {
  let title = text.split(/\r?\n/).find(line => line.trim())?.trim() || ''
  if (!title) return null
  title = title.replace(/https?:\/\/[^\s<>\u4e00-\u9fff]+/giu, url => {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '网页' }
  })
  title = title.replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_-]{12,}/gi, '密钥')
    .replace(/(?:API[_ -]?KEY|token|password|密码)\s*[:=：]\s*\S+/gi, '凭据配置')
    .replace(/^\s*[#>*`\-]+\s*/u, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ')
  for (let i = 0; i < 2; i++) title = title.replace(/^(?:请你|请|麻烦你|麻烦|帮我|帮忙|能不能|能否)\s*/u, '')
  title = title.replace(/^(?:查询一下|查看一下|看一下|查一下|看看|查询|查看)\s*/u, '')
    .replace(/[。！？.!?：:]+$/u, '').trim()
  if (!title) return null
  const max = /[\u4e00-\u9fff]/u.test(title) ? 32 : 64
  const chars = Array.from(title)
  if (chars.length > max) {
    title = chars.slice(0, max).join('')
    // Do not leave half an English word/model identifier at the end.
    if (/[A-Za-z0-9_-]/.test(chars[max] || '')) title = title.replace(/[A-Za-z0-9_-]+$/, '').trim()
  }
  return title.replace(/[，,；;、\s]+$/u, '') || '新对话'
}

export function canRefreshAutoTitle(text: string): boolean {
  const ask = text.trim()
  if (/^(?:继续|再试|重试|再来|这个|那个|它|那|上面|刚才|二手|谢谢|好的|好[的啊呀]?|是[的啊]?|我在哪|你好|您好)/u.test(ask)) return false
  const title = localChatTitle(ask)
  return !!title && (title.length >= 8 || /天气|价格|下载|安装|代码|文件|工作区|插件|排版|翻译/u.test(title))
}
