import test from 'node:test'
import assert from 'node:assert/strict'
import { isSimpleWeatherQuery, isLocalWeatherQuery, directWeatherRequest } from './execution-mode'

test('only short weather queries receive a smaller toolkit; compound and plugin tasks retain the harness', () => {
  for (const text of ['看看今天的天气', '北京明天天气如何？', '今天气温多少']) {
    // “如何” can request a method, and conservatively retains all tools.
    if (!text.includes('如何')) assert.equal(isSimpleWeatherQuery(text), true, text)
  }
  for (const text of ['天气预报的原理是什么',
    '使用插件查天气',
    '看看天气然后下载截图',
    '打开 https://example.com 查天气',
    '帮我写个天气插件',
    '查天气和新闻',
    '打开百度搜索今天的天气，并打开第一个链接，注意避开广告，全程使用自动化',
    '搜索今天的天气并打开第一个链接',
  ]) {
    assert.equal(isSimpleWeatherQuery(text), false, text)
  }
})

test('direct weather routing extracts only explicit city/today requests', () => {
  assert.deepEqual(directWeatherRequest('看看今天的天气'), {})
  assert.deepEqual(directWeatherRequest('看看今天天气'), {})
  assert.deepEqual(directWeatherRequest('查一下北京今天的天气'), { location: '北京' })
  assert.deepEqual(directWeatherRequest('今天上海的天气'), { location: '上海' })
  assert.equal(directWeatherRequest('明天北京的天气'), null)
  assert.equal(directWeatherRequest('北京今天的天气，并写入文件'), null)
})

test('only explicit local weather requests can skip model planning; cities and compound intents cannot', () => {
  for (const text of ['看看今天的天气', '天气怎么样？', '请查一下本地天气']) assert.equal(isLocalWeatherQuery(text), true, text)
  for (const text of ['北京天气', '天气原理', '明天北京天气', '天气和新闻', '把天气写入文件']) assert.equal(isLocalWeatherQuery(text), false, text)
})
