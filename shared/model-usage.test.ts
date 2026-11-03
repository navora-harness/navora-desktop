import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModelUsage } from './model-usage'

test('provider usage normalizes exact counts and cache details without converting missing values to zero', () => {
  assert.deepEqual(normalizeModelUsage({ prompt_tokens: 18, completion_tokens: 7, total_tokens: 25, prompt_tokens_details: { cached_tokens: 10 } }), { inputTokens: 18, outputTokens: 7, totalTokens: 25, cachedInputTokens: 10 })
  assert.deepEqual(normalizeModelUsage({ inputTokens: 2, outputTokens: 0 }), { inputTokens: 2, outputTokens: 0, totalTokens: 2 })
  for (const raw of [null, {}, { total_tokens: 123 }, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: '10', completion_tokens: 2 }, { prompt_tokens: 3, completion_tokens: Infinity }, { prompt_tokens: 4, completion_tokens: 2, total_tokens: 5 }]) assert.equal(normalizeModelUsage(raw), undefined)
  assert.deepEqual(normalizeModelUsage({ prompt_tokens: 4, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 10 } }), { inputTokens: 4, outputTokens: 2, totalTokens: 6 })
})
