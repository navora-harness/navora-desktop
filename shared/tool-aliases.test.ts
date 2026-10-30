import assert from 'node:assert/strict'
import { remapAgentToolCall } from './tool-aliases.ts'

const cu = remapAgentToolCall('computer_use', {
  action: 'browser_open',
  url: 'https://www.mi.com',
})
assert.equal(cu?.name, 'browser_open')
assert.equal(cu?.args.url, 'https://www.mi.com')

const get = remapAgentToolCall('computer_use', {
  action: 'get',
  windowId: 'win_1',
  what: 'text',
})
assert.equal(get?.name, 'browser_get')
assert.equal(get?.args.windowId, 'win_1')

const nested = remapAgentToolCall('tool', {
  name: 'browser_open',
  arguments: { url: 'https://www.mi.com' },
})
assert.equal(nested?.name, 'browser_open')

assert.equal(remapAgentToolCall('browser_open', { url: 'https://a.test' }), null)
assert.equal(remapAgentToolCall('calc_evaluate', { expr: '1+1' })?.name, 'calc_eval')

console.log('tool-aliases tests ok')
