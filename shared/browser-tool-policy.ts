import { remapAgentToolCall } from './tool-aliases'

/** Normalize once, before both permissions and page ownership are inspected. */
export function normalizeBrowserToolCall(name: string, args: Record<string, unknown>) {
  let call = { name, args: { ...args } }
  for (let depth = 0; depth < 4; depth++) {
    const next = remapAgentToolCall(call.name, call.args)
    if (!next) break
    call = { name: next.name, args: next.args }
  }
  return call
}

const READ_TOOLS = new Set([
  'browser_list_resources', 'browser_get', 'browser_screenshot', 'browser_wait',
  'browser_network_rule_list', 'browser_network_log', 'browser_cookies_get',
])

export function isBrowserWriteTool(name: string): boolean {
  return name.startsWith('browser_') && !READ_TOOLS.has(name)
}

export function isBrowserObservation(name: string, args: Record<string, unknown>): boolean {
  return name === 'browser_screenshot' || name === 'browser_wait' || (name === 'browser_get' &&
    ['snapshot', 'agent_snapshot', 'agent_find', 'text', 'dom_summary', 'html'].includes(String(args.what || 'snapshot')))
}

/** Administrative changes remain possible after navigation; input needs fresh evidence. */
export function requiresBrowserObservation(name: string): boolean {
  return new Set([
    'browser_click', 'browser_hover', 'browser_mouse', 'browser_touch', 'browser_type',
    'browser_press', 'browser_scroll', 'browser_select', 'browser_evaluate', 'browser_upload',
    'browser_flow',
  ]).has(name)
}

export function isBrowserPageInput(name: string): boolean {
  return new Set([
    'browser_click', 'browser_hover', 'browser_mouse', 'browser_touch', 'browser_type',
    'browser_press', 'browser_scroll', 'browser_select', 'browser_evaluate', 'browser_upload',
    'browser_flow', 'browser_dialog', 'browser_find', 'browser_query_deep',
  ]).has(name)
}

export function browserActionLabel(name: string, args: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    browser_click: '正在点击页面', browser_hover: '正在移动光标', browser_type: '正在输入内容',
    browser_press: '正在发送按键', browser_scroll: '正在滚动页面', browser_select: '正在选择选项',
    browser_flow: '正在执行页面步骤', browser_navigate: '正在打开页面', browser_reload: '正在重新加载页面',
    browser_back: '正在返回上一页', browser_forward: '正在前往下一页', browser_touch: '正在操作页面',
    browser_evaluate: '正在处理页面', browser_upload: '正在选择上传文件', browser_find: '正在查找页面内容',
    browser_load_url_with_response: '正在打开页面', browser_dialog: '正在处理页面对话框',
  }
  return name === 'browser_mouse' ? (args.action === 'drag' ? '正在拖动页面元素' : '正在移动光标') : labels[name] || '正在处理浏览器资源'
}
