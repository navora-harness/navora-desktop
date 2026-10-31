import test from 'node:test'
import assert from 'node:assert/strict'
import { localChatTitle, canRefreshAutoTitle } from './chat-title'

test('immediate titles remove polite wrappers, keep the subject and use the first task line', () => {
  assert.equal(localChatTitle('请帮我看看未来几天天气。'), '未来几天天气')
  assert.equal(localChatTitle('帮我查询 CPU 9950X 的价格\n请核对金额'), 'CPU 9950X 的价格')
  assert.equal(localChatTitle('  '), null)
})
test('titles do not expose URL credentials, query secrets or API keys', () => {
  const title = localChatTitle('请访问 https://user:password@example.com/path?token=secret')!
  assert.equal(title, '访问 example.com')
  assert.ok(!localChatTitle('配置 API Key sk-0123456789abcdef')!.includes('0123456789'))
  assert.equal(localChatTitle('配置 token=secret'), '配置 凭据配置')
})
test('auto titles follow explicit subjects and ignore short contextual follow-ups', () => {
  for (const ask of ['查询 CPU 9950X 的价格','看看未来几天天气','帮我优化对话排版']) assert.equal(canRefreshAutoTitle(ask), true, ask)
  for (const ask of ['二手呢？','继续','谢谢','你好','这个呢','我在哪']) assert.equal(canRefreshAutoTitle(ask), false, ask)
  assert.ok(Array.from(localChatTitle('对话内容'.repeat(20))!).length <= 32)
  assert.ok(localChatTitle('A detailed comparison of browser automation frameworks and their compatibility constraints')!.length <= 64)
})
