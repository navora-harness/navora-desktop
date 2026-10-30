import assert from 'node:assert/strict'
import {
  buildLocalPageSummaryFromToolJson,
  digestPageTextForModel,
  extractPageHeadlines,
  isLlmContentRejected,
  prepareToolResultForModel,
  serializeToolResultForModel,
} from './page-digest.ts'

assert.equal(
  isLlmContentRejected('The request was rejected because it was considered high risk'),
  true,
)
assert.equal(isLlmContentRejected('正常的中文分析回复'), false)

const sample = `Subscribe
The Economist Pro
Log in
Menu
Asia
Our latest coverage of Asian affairs
To keep out “infiltrators”, India is trapping its own citizens
A buffer zone has become a miserable limbo
4 min read
China would face a “hellscape” in a war over Taiwan
Drones and artificial intelligence may give America an edge
7 min read
`

const heads = extractPageHeadlines(sample, 10)
assert.ok(heads.some((h) => /India|Taiwan|China/i.test(h)))

const digest = digestPageTextForModel(sample.repeat(20), { maxChars: 3000, safe: true })
assert.match(digest, /页面安全摘要|标题列表/)
assert.ok(!isLlmContentRejected(digest))

const prepared = prepareToolResultForModel(
  { ok: true, url: 'https://www.economist.com/asia/', value: sample.repeat(30) },
  8000,
  false,
) as Record<string, unknown>
assert.equal(prepared.digested, true)
assert.equal(typeof prepared.value, 'string')
assert.ok(String(prepared.value).length < sample.repeat(30).length)

const local = buildLocalPageSummaryFromToolJson([
  JSON.stringify({
    ok: true,
    title: 'Asia',
    url: 'https://www.economist.com/asia/',
    value: sample,
  }),
])
assert.match(local, /内容安全策略|标题/)

console.log('page-digest ok')

const structured = {
  title: 'Shop', url: 'https://example.com/', headings: [{ text: 'Shop' }],
  links: [{ text: 'Product', url: 'https://example.com/product?id=1', selector: '#product' }],
  inputs: [{ text: 'Search', selector: '#search', ref: 'd1e2' }],
}
const normal = prepareToolResultForModel({ ok: true, value: structured }, 8000) as { value: typeof structured }
assert.equal(normal.value.links[0]?.url, structured.links[0]?.url)
assert.equal(normal.value.inputs[0]?.ref, 'd1e2')
const huge = serializeToolResultForModel({ ok: true, value: { ...structured, links: Array(300).fill(structured.links[0]) } }, 4000)
assert.ok(huge.length <= 4000)
const parsedHuge = JSON.parse(huge)
assert.equal(parsedHuge.ok, true)
assert.ok(parsedHuge.value.inputs.length)
assert.ok(parsedHuge.value.links.length)
assert.doesNotThrow(() => JSON.parse(serializeToolResultForModel({ ok: false, error: 'failed', content: 'x'.repeat(100000) }, 2000)))
