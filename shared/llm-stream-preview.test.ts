import assert from 'node:assert/strict'
import { test } from 'node:test'
import { llmStreamPreview } from './llm-stream-preview'

test('local-model think text stays in reasoning before its closing tag arrives', () => {
  const preview = (content: string) => llmStreamPreview({ content, finish_reason: null })
  assert.equal(preview('<thi').content, '')
  assert.deepEqual(preview('<think>思考中'), { content: '', reasoning: '思考中' })
  assert.deepEqual(preview('<think>思考中</think>回答'), { content: '\n回答', reasoning: '思考中' })
  assert.equal(preview('<tool_call>{"name":').content, '')
  assert.equal(preview('{"name":').content, '')
})
