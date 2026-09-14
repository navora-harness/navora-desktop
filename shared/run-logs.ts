/** Friendly run-log copy for chat UI and model-facing user-op notes. */

const CAP_LABELS: Record<string, string> = {
  'session.create': '创建 Session',
  'session.persist': '持久化 Session',
  'session.close': '关闭 Session',
  'session.clear': '清空 Session',
  'session.set_proxy': '设置代理',
  'session.set_ua': '设置 UA',
  'session.cookies_read': '读取 Cookies',
  'session.cookies_write': '写入 Cookies',
  'session.fetch': 'Session 请求',
  'window.create': '创建窗口',
  'window.close': '关闭窗口',
  'window.set_visible': '显隐窗口',
  navigate: '页面导航',
  wait: '等待页面',
  click: '点击',
  type: '输入',
  get_page: '读取页面',
  evaluate: '执行脚本',
  screenshot: '页面截图',
  'desktop.screenshot': '桌面截图',
  'network.observe': '观察网络',
  'network.modify': '修改网络',
  'network.block': '拦截网络',
  'file.read': '读文件',
  'file.write': '写文件',
  'file.download': '主动文件下载',
  'file.download.passive': '被动文件下载',
  'shell.open': '打开文件',
  'shell.exec': '执行命令',
  'settings.read': '查看设置',
  'settings.write': '修改设置',
  'skills.write': '添加/编辑技能',
  'browser.geolocation': '获取位置',
  'compute.local': '本地计算',
}

export type RunLogEntry = {
  /** One-line preview shown when collapsed. */
  summary: string
  /** Extra full text shown only when expanded (must differ from summary). */
  detail?: string
  /** Stored message content / model-facing text. */
  content: string
}

export function capabilityLabel(capability: string): string {
  return CAP_LABELS[capability] || capability
}

export function shortUrl(url: string, max = 48): string {
  const u = String(url || '').trim()
  if (!u || u === 'about:blank') return '空白页'
  try {
    const parsed = new URL(u)
    const path = `${parsed.pathname || ''}${parsed.search || ''}`
    const host = parsed.hostname.replace(/^www\./i, '')
    const compact = path && path !== '/' ? `${host}${path}` : host
    return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
  } catch {
    return u.length > max ? `${u.slice(0, max - 1)}…` : u
  }
}

export function formatPageUrl(url: string): string {
  const full = String(url || '').trim()
  if (!full || full === 'about:blank') return '空白页'
  try {
    const u = new URL(full)
    u.hash = ''
    if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4)
    return u.toString()
  } catch {
    return full
  }
}

export function makeRunLog(summary: string, detail?: string): RunLogEntry {
  const s = String(summary || '').trim() || '（空）'
  const d = String(detail || '').trim()
  if (!d || d === s) return { summary: s, content: s }
  return { summary: s, detail: d, content: `${s}\n${d}` }
}

export function logWindowOpened(url: string): RunLogEntry {
  const full = String(url || '').trim() || 'about:blank'
  return makeRunLog(
    '新窗口已打开',
    full === 'about:blank' ? '地址：空白页' : `地址：${formatPageUrl(full)}`,
  )
}

export function logWindowClosed(windowId?: string): RunLogEntry {
  return makeRunLog(
    '你关闭了一个浏览器窗口',
    windowId ? `窗口 ID：${windowId}` : undefined,
  )
}

export function logBrowserDownloadIntercepted(
  filename: string,
  url: string,
  relPath: string,
): RunLogEntry {
  return makeRunLog(
    `已拦截浏览器下载：${filename}`,
    `默认另存为已屏蔽。待确认后保存到：${relPath}\n来源：${formatPageUrl(url)}`,
  )
}

export function logBrowserDownloadStarted(filename: string, relPath: string, url: string): RunLogEntry {
  return makeRunLog(
    `浏览器下载开始：${filename}`,
    `保存到：${relPath}\n来源：${formatPageUrl(url)}`,
  )
}

export function logBrowserDownloadCompleted(
  filename: string,
  relPath: string,
  receivedBytes?: number,
): RunLogEntry {
  const size =
    typeof receivedBytes === 'number' && Number.isFinite(receivedBytes)
      ? `\n大小：${formatBytesShort(receivedBytes)}`
      : ''
  return makeRunLog(`浏览器下载完成：${filename}`, `工作区路径：${relPath}${size}`)
}

export function logBrowserDownloadFailed(
  filename: string,
  reason: string,
  relPath?: string,
): RunLogEntry {
  return makeRunLog(
    `浏览器下载失败：${filename}`,
    [reason ? `原因：${reason}` : '', relPath ? `路径：${relPath}` : ''].filter(Boolean).join('\n') ||
      undefined,
  )
}

function formatBytesShort(n: number): string {
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function logUserNavigated(
  url: string,
  statusCode?: number | null,
  statusText?: string | null,
): RunLogEntry {
  const display = formatPageUrl(url)
  const code =
    typeof statusCode === 'number' && Number.isFinite(statusCode) ? Math.trunc(statusCode) : null
  const text = String(statusText || '')
    .replace(/\s+/g, ' ')
    .trim()
  let statusLabel: string
  if (code == null) {
    statusLabel = text || '未知'
  } else if (text && text !== String(code)) {
    statusLabel = `${code} ${text}`
  } else {
    statusLabel = String(code)
  }
  return makeRunLog(`访问了 ${display} · ${statusLabel}`)
}

export function logPermissionAutoAllow(capability: string, detail?: string): RunLogEntry {
  const label = capabilityLabel(capability)
  const tip = String(detail || '')
    .replace(/\s+/g, ' ')
    .trim()
  return makeRunLog(
    `已自动允许「${label}」`,
    tip ? `详情：${tip}` : `能力标识：${capability}`,
  )
}

export function logContinueRounds(continueBy: number, budget: number): RunLogEntry {
  return makeRunLog(
    `已追加 ${continueBy} 轮推理`,
    `当前总预算 ${budget} 轮，将继续执行未完成的任务。`,
  )
}

export function logRoundLimit(rounds: number): RunLogEntry {
  return makeRunLog(
    `已达推理上限（${rounds} 轮）`,
    '本轮已停止。如需继续，可再发一条消息让我接着做。',
  )
}

export function logAgentStopped(): RunLogEntry {
  return makeRunLog('用户终止', '当前任务已中止，已创建的浏览器资源仍会保留。')
}

export function logAgentError(message: string): RunLogEntry {
  let msg = String(message || '').trim() || '未知错误'
  // Strip machine codes like `api_key_missing:…` for human-readable logs.
  const idx = msg.indexOf(':')
  if (idx > 0 && /^[a-z][a-z0-9_]*$/i.test(msg.slice(0, idx))) {
    msg = msg.slice(idx + 1).trim() || msg
  }
  return makeRunLog('Agent 出错', msg)
}

/** Soft recovery when the model emits malformed tool-call JSON (common with small models / PEM). */
export function logToolArgsRetry(attempt: number, maxAttempts: number, detail?: string): RunLogEntry {
  return makeRunLog(
    `工具参数格式有误，正在重试（${attempt}/${maxAttempts}）`,
    detail
      ? `未中断任务。原因：${detail}`
      : '模型返回的工具参数不是合法 JSON（常见于多行密钥未转义）。将提示模型改正后继续，不会强制结束会话。',
  )
}

export function logUserChoice(answer: string): RunLogEntry {
  const a = String(answer || '').trim() || '（空）'
  return makeRunLog(`你选择了：${a.length > 36 ? `${a.slice(0, 35)}…` : a}`, a.length > 36 ? a : undefined)
}

export type LogKindTone = 'op' | 'system' | 'choice' | 'perm' | 'error' | 'info'

export function logKindFromMeta(kind: unknown): LogKindTone {
  switch (String(kind || '')) {
    case 'user_op':
      return 'op'
    case 'user_choice':
    case 'continue_rounds':
      return 'choice'
    case 'permission_notify':
      return 'perm'
    case 'agent_error':
      return 'error'
    case 'tool_args_retry':
      return 'system'
    case 'agent_stop':
    case 'round_limit':
      return 'system'
    default:
      return 'info'
  }
}

export function logKindLabel(tone: LogKindTone): string {
  switch (tone) {
    case 'op':
      return '操作'
    case 'choice':
      return '选择'
    case 'perm':
      return '权限'
    case 'error':
      return '错误'
    case 'system':
      return '系统'
    default:
      return '日志'
  }
}

export function resolveRunLogView(input: {
  content?: string
  summary?: unknown
  detail?: unknown
}): { summary: string; detail: string; expandable: boolean } {
  const metaSummary = String(input.summary || '').trim()
  const metaDetail = String(input.detail || '').trim()
  if (metaSummary) {
    const detail = metaDetail && metaDetail !== metaSummary ? metaDetail : ''
    return { summary: metaSummary, detail, expandable: Boolean(detail) }
  }

  const raw = String(input.content || '').trim() || '（空）'
  const entry = humanizeLogEntry(raw)
  const detail = entry.detail && entry.detail !== entry.summary ? entry.detail : ''
  return { summary: entry.summary, detail, expandable: Boolean(detail) }
}

/** Soft-upgrade older technical / flat log lines into summary + detail. */
export function humanizeLogEntry(content: string): RunLogEntry {
  const s = String(content || '').trim()
  if (!s) return makeRunLog('（空）')

  let m: RegExpMatchArray | null
  if (/^\[system\]\s*browser_window_closed/i.test(s)) {
    const id = s.match(/windowId=(\S+)/i)?.[1]
    return logWindowClosed(id)
  }
  if ((m = s.match(/^\[system\]\s*browser_window_opened\s+windowId=\S+\s+url=(.+)$/i))) {
    return logWindowOpened(m[1].trim())
  }
  if ((m = s.match(/^\[user\]\s*navigated\s*[→\->]+\s*(.+?)\s*\(window=/i))) {
    return logUserNavigated(m[1].trim())
  }
  if (
    (m = s.match(
      /^(?:你导航到了|访问了)\s+(.+?)\s*[·•]\s*(-?\d+)(?:\s+(.+))?$/,
    ))
  ) {
    return logUserNavigated(m[1].trim(), Number(m[2]), m[3]?.trim())
  }
  if ((m = s.match(/^(?:你导航到了|访问了)\s+(.+)$/))) return logUserNavigated(m[1].trim())
  if ((m = s.match(/^自动允许：\s*([^\s—\-]+)(?:\s*[—\-]+\s*(.*))?$/))) {
    return logPermissionAutoAllow(m[1], m[2])
  }
  if (
    s === '已停止全部 Agent 工作。' ||
    s === '已停止 Agent' ||
    s === '用户终止'
  ) {
    return logAgentStopped()
  }
  if ((m = s.match(/^(?:Agent 错误：|出错了：)\s*(.+)$/))) return logAgentError(m[1])
  if ((m = s.match(/^已达(?:最大工具循环次数|推理上限)（(\d+) 轮）/))) {
    return logRoundLimit(Number(m[1]))
  }
  if ((m = s.match(/^(?:用户选择继续推理，追加|已追加)\s*(\d+)\s*轮/))) {
    const budget = s.match(/预算\s*(\d+)/)?.[1]
    return logContinueRounds(Number(m[1]), budget ? Number(budget) : Number(m[1]))
  }
  if ((m = s.match(/^你选择了：\s*(.+)$/)) || (m = s.match(/^你的选择：\s*(.+)$/))) {
    return logUserChoice(m[1])
  }
  if ((m = s.match(/^新窗口已打开：\s*(.+)$/))) return logWindowOpened(m[1])
  if (s.includes('\n')) {
    const [first, ...rest] = s.split('\n')
    return makeRunLog(first.trim(), rest.join('\n').trim())
  }
  return makeRunLog(s)
}

/** @deprecated use resolveRunLogView / humanizeLogEntry */
export function humanizeLogContent(content: string): string {
  return humanizeLogEntry(content).summary
}
