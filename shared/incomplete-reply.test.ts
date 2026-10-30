import assert from 'node:assert/strict'
import { isIncompleteAgentReply } from './incomplete-reply.ts'
import { normalizeMatchPattern } from './match-pattern.ts'

assert.equal(isIncompleteAgentReply('先清空当前会话的 cookies，然后重新访问：'), true)
assert.equal(
  isIncompleteAgentReply('让我先看看当前还有哪些资源，然后清空 cookies 并重新访问。'),
  true,
)
assert.equal(isIncompleteAgentReply('（无文本回复）'), true)
assert.equal(isIncompleteAgentReply('ok', { finishReason: 'length' }), true)
assert.equal(
  isIncompleteAgentReply(
    '这次成功了。首页展示了丝巾与皮带新品，价格见上文。',
  ),
  false,
)
assert.equal(isIncompleteAgentReply('你好！有什么可以帮忙的？'), false)
assert.equal(
  isIncompleteAgentReply('页面已打开，让我获取首页内容看看有哪些新手机。'),
  true,
)
assert.equal(isIncompleteAgentReply('我来打开小米官网看看新手机信息。'), true)
assert.equal(
  isIncompleteAgentReply(
    '根据搜索结果，小米最新手机包括 Xiaomi 17 与 REDMI Note 17，起售价见上文。',
  ),
  false,
)

import {
  isEmptyAgentReply,
  promoteReasoningToContent,
} from './incomplete-reply.ts'

assert.equal(isEmptyAgentReply('（无文本回复）'), true)
assert.equal(
  promoteReasoningToContent('', '小米官网首页已打开，新机包括 Xiaomi 17 系列。'),
  '小米官网首页已打开，新机包括 Xiaomi 17 系列。',
)
assert.equal(promoteReasoningToContent('', '让我先打开官网'), '（无文本回复）')
assert.equal(promoteReasoningToContent('正式答复', 'reasoning'), '正式答复')

assert.deepEqual(normalizeMatchPattern('*qqdl.gtimg.cn*'), {
  pattern: '*://*.qqdl.gtimg.cn/*',
  normalized: true,
  original: '*qqdl.gtimg.cn*',
})
assert.equal(normalizeMatchPattern('*://*.example.com/*').normalized, false)
assert.equal(normalizeMatchPattern('cdn.example.com/path').pattern.startsWith('*://'), true)

console.log('incomplete-reply + match-pattern tests ok')
