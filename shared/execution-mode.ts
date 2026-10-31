export type ExecutionMode = 'auto' | 'chat' | 'agent'

export function isLocalWeatherQuery(text: string): boolean {
  return /^(?:请|帮我|麻烦)?\s*(?:查询一下|查一下|查查|查询|查看|看看|看下|告诉我)?\s*(?:今天|今日|现在|当前|本地|这里|附近)?[的\s]*(?:天气|气温)(?:怎么样|情况|预报|多少)?[？?！!。.\s]*$/u.test(text.trim())
}

/** Only today's simple weather can be rendered directly from validated data. */
export function directWeatherRequest(text: string): { location?: string } | null {
  if (!isSimpleWeatherQuery(text)) return null
  if (isLocalWeatherQuery(text)) return {}
  const clean = text.trim().replace(/^(?:请|帮我|麻烦)?\s*(?:查询一下|查一下|查查|查询|查看|看看|看下|告诉我)?\s*/u, '').replace(/[？?！!。.\s]+$/u, '')
  // Explicit city + today, or today + city. Other horizons stay with the Agent.
  const match = clean.match(/^([\p{L} ·,，-]{2,30}?)(?:今天|今日)的?天气(?:怎么样|情况|预报)?$/u) ||
    clean.match(/^(?:今天|今日)([\p{L} ·,，-]{2,30}?)的?天气(?:怎么样|情况|预报)?$/u)
  const location = match?.[1]?.trim()
  return location && !/明天|后天|附近|这里|本地|我的|你的|我们/u.test(location) ? { location } : null
}

/** Narrow opt-in: compound requests, named websites, plugins and references keep the full harness. */
export function isSimpleWeatherQuery(text: string): boolean {
  const ask = text.trim()
  return ask.length <= 60 && /天气|气温|下雨/u.test(ask) &&
    !/https?:|网站|网页|浏览器|插件|文件|截图|下载|写|代码|原理|是什么|为什么|如何|新闻|并且|然后|同时|以及|和|历史|去年|趋势|统计|气候|导出|保存|发送|生成|报告|个月|一年|明年|\d{4}年/u.test(ask)
}

/** Conservative shortcut: ambiguous or external-state tasks keep all plugin/tools. */
export function needsAgentTools(mode: ExecutionMode | undefined, text: string, hasRefs = false): boolean {
  if (mode === 'chat') return false
  if (mode === 'agent' || hasRefs) return true
  const ask = text.trim()
  if (/https?:|今天|今日|最新|实时|现在|当前|天气|新闻|搜索|查找|查一下|打开|浏览|网页|网站|文件|工作区|截图|下载|上传|插件|会话|窗口|执行|运行|安装|设置|帮我查/u.test(ask)) return true
  if (/^(你好[呀啊！!。\s]*|您好[！!。\s]*|hello[!.\s]*|hi[!.\s]*|谢谢[！!。\s]*)$/iu.test(ask)) return false
  if (/^(请|帮我)?(翻译|改写|润色|解释|讲解|写一首|写一段|写一个故事|写个笑话|计算|算一下)/u.test(ask)) return false
  if (/什么是|是什么|为什么|如何理解|怎么理解|有什么区别|举个例子|你是谁|介绍一下自己/u.test(ask)) return false
  if (/^[\d\s+\-*/×÷().=？?等于多少几请只输出数字，。]+$/u.test(ask) && /\d/.test(ask)) return false
  return true
}
