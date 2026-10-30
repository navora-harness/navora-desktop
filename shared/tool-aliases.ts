/**
 * Remap hallucinated / alternate tool names from weak local models
 * (OpenClaw-style computer_use, placeholder "tool", etc.).
 */

export type RemappedTool = {
  name: string
  args: Record<string, unknown>
  from?: string
}

const SIMPLE_ALIASES: Record<string, string> = {
  calc_evaluate: 'calc_eval',
  calc_convert: 'calc_eval',
  browser_clear_cookies: 'browser_session_clear',
  browser_clear_cookie: 'browser_session_clear',
  browser_cookies_clear: 'browser_session_clear',
  cookies_clear: 'browser_session_clear',
  clear_cookies: 'browser_session_clear',
}

const COMPUTER_USE_ACTION_MAP: Record<string, string> = {
  browser_open: 'browser_open',
  open: 'browser_open',
  open_url: 'browser_open',
  open_page: 'browser_open',
  browse: 'browser_open',
  browser_navigate: 'browser_navigate',
  navigate: 'browser_navigate',
  goto: 'browser_navigate',
  go: 'browser_navigate',
  browser_get: 'browser_get',
  get: 'browser_get',
  get_page: 'browser_get',
  read: 'browser_get',
  page_text: 'browser_get',
  browser_click: 'browser_click',
  click: 'browser_click',
  browser_find: 'browser_find',
  find: 'browser_find',
  search: 'browser_find',
  browser_type: 'browser_type',
  type: 'browser_type',
  browser_wait: 'browser_wait',
  wait: 'browser_wait',
  list_resources: 'browser_list_resources',
  browser_list_resources: 'browser_list_resources',
}

function stripMetaKeys(args: Record<string, unknown>): Record<string, unknown> {
  const {
    action: _a,
    command: _c,
    do: _d,
    tool: _t,
    name: _n,
    function: _f,
    arguments: _arg,
    parameters: _p,
    ...rest
  } = args
  return rest
}

function remapComputerUse(args: Record<string, unknown>): RemappedTool | null {
  const action = String(args.action || args.command || args.do || '').trim()
  if (action) {
    const mapped =
      COMPUTER_USE_ACTION_MAP[action] ||
      (action.startsWith('browser_') || action.startsWith('file_') || action.startsWith('agent_')
        ? action
        : '')
    if (!mapped) return null
    const rest = stripMetaKeys(args)
    // computer_use sometimes nests real args
    const nested =
      args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
        ? (args.arguments as Record<string, unknown>)
        : null
    return { name: mapped, args: { ...rest, ...(nested || {}) }, from: 'computer_use' }
  }
  if (args.url) {
    return { name: 'browser_open', args: stripMetaKeys(args), from: 'computer_use' }
  }
  return null
}

/**
 * Resolve a tool name + args to a real Navora tool when the model used an alias.
 * Returns null when no remapping is needed (caller keeps original name/args).
 */
export function remapAgentToolCall(
  name: string,
  rawArgs: Record<string, unknown>,
): RemappedTool | null {
  let n = String(name || '').trim()
  let args = { ...(rawArgs || {}) }

  if (n === 'tool' || n === 'function' || n === 'functions') {
    const nestedName =
      (typeof args.tool === 'string' && args.tool) ||
      (typeof args.name === 'string' && args.name) ||
      ''
    if (nestedName && nestedName !== n) {
      n = nestedName
      const inner =
        args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
          ? (args.arguments as Record<string, unknown>)
          : args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
            ? (args.parameters as Record<string, unknown>)
            : null
      args = inner ? { ...inner } : stripMetaKeys(args)
    }
  }

  if (n === 'computer_use' || n === 'computer' || n === 'computer-use' || n === 'openclaw') {
    return remapComputerUse(args)
  }

  // {"name":"computer_use"} already remapped to another alias path above
  if (SIMPLE_ALIASES[n]) {
    return { name: SIMPLE_ALIASES[n], args, from: n }
  }

  if (n !== name) {
    if (SIMPLE_ALIASES[n]) return { name: SIMPLE_ALIASES[n], args, from: name }
    return { name: n, args, from: name }
  }

  return null
}
