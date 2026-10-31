import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCreatorGeneration } from './creator-generation'
test('creator generation tolerates reasoning and prose while preserving code strings exactly', () => {
  const files = {'main.cjs':'module.exports = { execute() { return "}"; } };\n// 中文'}
  assert.deepEqual(parseCreatorGeneration('<think>reason {not final JSON}</think>\n```json\n'+JSON.stringify({files})+'\n```'),files)
  assert.deepEqual(parseCreatorGeneration(JSON.stringify(files)),files,'Compatible providers may return the file mapping without its wrapper')
  assert.equal(parseCreatorGeneration('生成结果：'+JSON.stringify({files:{'plugin.json':{id:'example'}}}))['plugin.json'],JSON.stringify({id:'example'},null,2))
  assert.throws(() => parseCreatorGeneration('{"files":{"main.cjs":"incomplete'),/generation_invalid/)
  assert.throws(() => parseCreatorGeneration('<think>{"files":{"main.cjs":"thinking"}}</think>'),/generation_invalid/)
})
