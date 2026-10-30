import assert from 'node:assert/strict'
import { extractHttpUrls, linkifyBareUrlsInMarkdown } from './url-text.ts'
import { makeSnippet, looksLikeCodeOrJson } from './answer-sources.ts'

assert.equal(extractHttpUrls('https://a.com/x看看还有')[0], 'https://a.com/x')
assert.equal(
  extractHttpUrls('见 https://economist.com/weeklyedition、还有')[0],
  'https://economist.com/weeklyedition',
)
assert.equal(extractHttpUrls('www.example.com/path。')[0], 'https://www.example.com/path')
assert.equal(extractHttpUrls('打开(https://foo.com/a)吧')[0], 'https://foo.com/a')
assert.match(linkifyBareUrlsInMarkdown('访问 https://a.com/x看看'), /\[https:\/\/a\.com\/x\]/)
assert.match(linkifyBareUrlsInMarkdown('去 www.bbc.com/news 看'), /https:\/\/www\.bbc\.com\/news/)

const dom = {
  title: 'World This Week',
  headings: [{ text: 'Leaders' }, { text: 'Business' }],
  links: [{ text: 'Subscribe', href: '/s' }],
}
const snip = makeSnippet(dom)
assert.match(snip, /World This Week/)
assert.match(snip, /Leaders/)
assert.equal(makeSnippet('function foo(){ return 1 }'), '')
assert.equal(looksLikeCodeOrJson('{"a":1}'), true)
assert.match(makeSnippet('经济学人本周封面讲述人工智能监管。'), /经济学人/)

console.log('url-text + answer-sources ok')
