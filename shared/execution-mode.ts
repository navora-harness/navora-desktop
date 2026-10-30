export type ExecutionMode = 'auto' | 'chat' | 'agent'

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
