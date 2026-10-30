/**
 * Detect assistant turns that narrate the next step but never call tools /
 * never deliver a real answer — a common local-model failure mode that used
 * to end the agent loop early ("说着说着就断了").
 */

export function isEmptyAgentReply(text: string): boolean {
  const t = String(text || '')
    .replace(/\u00a0/g, ' ')
    .trim()
  return !t || t === '（无文本回复）'
}

/** Looks like a plan / promise of next action, not a finished answer. */
export function looksLikeActionPlan(text: string): boolean {
  const t = String(text || '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (!t) return false
  // Explicit "I'll …" / "let me …" intent, including mid-sentence.
  if (
    /让我|我来|我先|我再|接下来|稍等|请稍等|正在(打开|获取|读取|查看|访问)/u.test(t)
  ) {
    return true
  }
  if (
    /(页面已打开|已打开页面|官网已打开).{0,40}(获取|读取|查看|看看)/u.test(t)
  ) {
    return true
  }
  if (
    /(获取|读取|查看|看看).{0,24}(内容|首页|页面|文本|配置|详情)/u.test(t) &&
    t.length <= 160 &&
    !/(如下|结果|结论|汇总|总结|包括|配置为|售价|处理器)/u.test(t)
  ) {
    return true
  }
  return false
}

export function isIncompleteAgentReply(
  text: string,
  opts?: { finishReason?: string | null },
): boolean {
  const reason = String(opts?.finishReason || '').toLowerCase()
  if (reason === 'length' || reason === 'max_tokens') return true

  const t = String(text || '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (isEmptyAgentReply(t)) return true

  // Trailing colon / ellipsis → clearly more coming.
  if (/[：:]$/.test(t)) return true
  if (/…\s*$/.test(t) || /\.\.\.\s*$/.test(t)) return true

  if (looksLikeActionPlan(t) && t.length <= 200) return true

  // Short "I'll do X" narration without a conclusion.
  if (t.length <= 140) {
    if (
      /^(好的[，,\s]*)?(让我|我来|我先|先|接下来|正在|稍等|请稍等|重新|清空|打开|获取|查看|试试|再试)/u.test(
        t,
      )
    ) {
      return true
    }
    if (
      /(然后|接着).{0,12}(访问|打开|查看|获取|清空|读取)/u.test(t) &&
      !/[。！？]$/u.test(t)
    ) {
      return true
    }
    if (
      /(清空|cookie|重新访问|打开页面|获取页面|看看资源)/i.test(t) &&
      !/(如下|结果|结论|汇总|总结|已经完成|已完成)/u.test(t)
    ) {
      return true
    }
  }

  return false
}

/**
 * Some local servers put the whole answer in reasoning_content and leave content empty.
 * Promote only when it looks like a real answer, not another "让我…" plan.
 */
export function promoteReasoningToContent(
  content: string | null | undefined,
  reasoning: string | null | undefined,
): string {
  const c = String(content ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (c && !isEmptyAgentReply(c)) return c
  const r = String(reasoning ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (!r) return c || '（无文本回复）'
  if (isIncompleteAgentReply(r)) return '（无文本回复）'
  if (r.length < 12) return '（无文本回复）'
  return r
}

export const INCOMPLETE_REPLY_NUDGE =
  '你上一轮只口述了下一步、没有发起 function call，任务因此中断。' +
  '不要再铺垫。请立刻调用工具完成用户请求' +
  '（例如 browser_list_resources / browser_session_clear / browser_window_create / browser_navigate / browser_get / file_open）。' +
  '若信息已经足够，则直接给出最终中文结论，不要再说「让我/先/接下来」。'

/** After tools already ran but the model returned an empty final turn. */
export const EMPTY_AFTER_TOOLS_NUDGE =
  '上一轮工具已执行，但你没有输出对用户的中文结论，也没有继续调用工具。' +
  '请立刻调用 browser_get（what=text 或 dom_summary；需要时再 browser_find / browser_navigate），' +
  '或基于已有工具结果用中文给出最终答复。禁止再说「页面已打开，让我获取…」这类空话。'
