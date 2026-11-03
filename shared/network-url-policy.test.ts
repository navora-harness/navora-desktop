import test from 'node:test'
import assert from 'node:assert/strict'
import { networkUrlAllowed as allowed } from './network-url-policy'
test('network URLs enforce origins, path segments, ports and schemes', () => {
  assert.equal(allowed('https://example.com/api/x', ['https://example.com/api']), true)
  for (const url of ['http://example.com/api', 'https://example.com:444/api', 'https://example.com/apix', 'https://example.com/other']) assert.equal(allowed(url, ['https://example.com/api']), false)
  assert.equal(allowed('https://example.com/api/%2f../secret', ['https://example.com/api']), false)
  assert.equal(allowed('https://example.com/', ['example.com:80']), false)
  assert.equal(allowed('http://example.com/', ['example.com:80']), true)
  assert.equal(allowed('https://a.example.com/', ['*.example.com']), true)
  assert.equal(allowed('https://notexample.com/', ['*.example.com']), false)
  for (const url of ['file:///a', 'about:blank', 'data:a', 'https://u:p@example.com', 'https://example.com/\n']) assert.equal(allowed(url), false)
})
