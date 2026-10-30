import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertRemoteAccessChange, assertRemoteAccessConfig, createDefaultConfig } from './config'
import { modelCapabilities, reasoningValue } from './model-capabilities'
import { addProviderFromPresetId, mergeProviderList } from './model-providers'
import { needsAgentTools } from './execution-mode'
import { mainWindowChrome } from '../electron/modules/window-chrome'

test('legacy default remote password does not block onboarding, but cannot activate remote access', () => {
  const remote = { ...createDefaultConfig().remote, enabled: true }
  assert.throws(() => assertRemoteAccessConfig(remote), /remote_default_password/)
  assert.doesNotThrow(() => assertRemoteAccessChange(remote, { ...remote }))
  assert.doesNotThrow(() => assertRemoteAccessChange(remote, { ...remote, enabled: false }))
  assert.throws(() => assertRemoteAccessChange(remote, { ...remote, port: remote.port + 1 }), /remote_default_password/)
  assert.throws(() => assertRemoteAccessChange({ ...remote, enabled: false }, remote), /remote_default_password/)
})

test('screenshot catalog survives a settings merge with custom high to xhigh mapping', () => {
  const provider = addProviderFromPresetId('cloudbypass', [])!
  const updated = mergeProviderList([provider], [{ id: provider.id, timeout_ms: 310000 }])[0]!
  const model = modelCapabilities(updated, 'qwen38-turbo-q6')
  assert.equal(model.context_window, 524288)
  assert.equal(model.max_output_tokens, 81920)
  assert.deepEqual(model.input_types, ['text', 'image'])
  assert.equal(reasoningValue(model, 'off'), 'none')
  assert.equal(reasoningValue(model, 'high'), 'xhigh')
  assert.equal(reasoningValue(model), 'low')
  model.reasoning.levels[0]!.value = 'off'
  assert.equal(modelCapabilities(provider, provider.model).reasoning.levels[0]!.value, 'none', 'clones do not mutate provider catalog')
})

test('fast answers avoid tools, while actions, refs and plugins keep their tools', () => {
  for (const ask of ['你好', 'hello!', '1+1等于几？只输出数字。', '请解释什么是哈希表', '什么是机器学习？', 'Python 列表和元组有什么区别？', '翻译这句话：hello']) assert.equal(needsAgentTools('auto', ask), false, ask)
  for (const ask of ['搜索今天的新闻', '打开 https://example.com', '解释当前网页', '查一下天气', '运行插件', '文件里的内容是什么']) assert.equal(needsAgentTools('auto', ask), true, ask)
  assert.equal(needsAgentTools('auto', '你好', true), true)
  assert.equal(needsAgentTools('chat', '打开网页'), false)
  assert.equal(needsAgentTools('agent', '你好'), true)
})

test('all desktop platforms retain system window controls', () => {
  const win = mainWindowChrome('win32')
  assert.equal(win.frame, true)
  assert.equal(win.titleBarOverlay?.height, 40)
  const mac = mainWindowChrome('darwin')
  assert.equal(mac.titleBarStyle, 'hiddenInset')
  assert.ok(mac.trafficLightPosition)
  assert.deepEqual(mainWindowChrome('linux'), { frame: true })
})
