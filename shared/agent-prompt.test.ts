import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSystemPrompt, SYSTEM_PROMPT } from './agent-prompt'
import { AGENT_TOOLS, buildSystemPrompt as compatibilityExport } from './agent-tools'

test('runtime prompt respects switches and retains plugin and snapshot workflows', () => {
  const disabled = buildSystemPrompt(false, {subchatEnabled:false})
  assert.match(disabled, /子对话已关闭/)
  assert.match(disabled, /询问\/决策工具已关闭/)
  assert.match(SYSTEM_PROMPT, /plugin_list\/plugin_read/)
  assert.match(SYSTEM_PROMPT, /stale_element_ref/)
  assert.match(SYSTEM_PROMPT, /待分析资料/)
  assert.equal(compatibilityExport, buildSystemPrompt)
  assert.match(buildSystemPrompt(true, {maxSubchats:100}), /最多 8 个/)
  for (const name of ['browser_get','browser_find','browser_click','browser_type']) {
    assert.ok(AGENT_TOOLS.some((tool) => tool.function.name === name))
  }
})
