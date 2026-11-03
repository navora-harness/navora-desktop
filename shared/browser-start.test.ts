import test from 'node:test'
import assert from 'node:assert/strict'
import {browserInputTarget,browserSuggestions,browserDisplayAddress} from './browser-start'

test('address input separates URLs and local servers from search text without enabling privileged schemes',()=>{
  assert.equal(browserInputTarget('example.com/path'),'https://example.com/path')
  assert.equal(browserInputTarget('localhost:5174/page'),'http://localhost:5174/page')
  assert.equal(browserInputTarget('127.0.0.1:8080'),'http://127.0.0.1:8080/')
  assert.equal(browserInputTarget(' 中文 搜索 '),'https://www.bing.com/search?q=%E4%B8%AD%E6%96%87%20%E6%90%9C%E7%B4%A2')
  assert.equal(browserInputTarget('about:blank'),'about:blank')
  assert.equal(browserInputTarget('two words.example'),'https://www.bing.com/search?q=two%20words.example')
  for(const value of ['javascript:alert(1)','file:///C:/secret','data:text/html,test','https://user:pass@example.com','ftp://example.com',''])assert.throws(()=>browserInputTarget(value))
  assert.equal(browserDisplayAddress('https://example.com/'),'example.com')
  assert.equal(browserDisplayAddress('http://localhost:3000/page?q=1#section'),'localhost:3000/page?q=1#section')
})
test('address suggestions deduplicate pinned and visited URLs, filter titles and cap the result list',()=>{
  const state={links:[{id:'one',title:'常用文档',url:'https://docs.example/'}],history:[{chatId:'chat',title:'另一个标题',url:'https://docs.example/',visitedAt:1},...Array.from({length:10},(_,i)=>({chatId:'chat',title:`最近 ${i}`,url:`https://example.com/${i}`,visitedAt:i}))]}
  assert.equal(browserSuggestions(state,'').length,6)
  assert.equal(browserSuggestions(state,'文档')[0]?.kind,'link')
  assert.equal(browserSuggestions(state,'EXAMPLE.COM/3')[0]?.title,'最近 3')
  assert.equal(browserSuggestions(state,'does-not-exist').length,0)
  assert.equal(browserSuggestions(state,'').filter(row=>row.url==='https://docs.example/').length,1)
})
