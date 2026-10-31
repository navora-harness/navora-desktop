import test from 'node:test'
import assert from 'node:assert/strict'
import {formatChatAsJson,formatChatAsMarkdown} from './export-chat'
import type {ChatSession} from './types'

test('Markdown export keeps intermediate narration inside process details and preserves final sources',()=>{
  const chat={id:'chat',title:'Export',createdAt:1,updatedAt:4,messages:[
    {id:'u',role:'user',content:'Question',createdAt:1},
    {id:'p',role:'assistant',content:'Retrying the request',createdAt:2,meta:{phase:'progress',reasoning:'first thought'}},
    {id:'t',role:'tool',content:'{"ok":true,"text":"```"}',createdAt:3,meta:{toolName:'browser_get',status:'done',args:{what:'text'}}},
    {id:'a',role:'assistant',content:'Final answer',createdAt:4,meta:{phase:'final',reasoning:'aggregate thought',sources:[{url:'https://example.com/final',title:'Evidence'}]}},
  ]} as ChatSession
  const markdown=formatChatAsMarkdown(chat)
  const note=markdown.indexOf('Retrying the request'),final=markdown.indexOf('Final answer')
  assert.ok(markdown.indexOf('<summary>执行过程</summary>')<note)
  assert.ok(markdown.indexOf('</details>',note)<final)
  assert.equal(markdown.includes('first thought'),false,'Aggregate reasoning replaces duplicated round reasoning')
  assert.equal(markdown.match(/aggregate thought/g)?.length,1)
  assert.match(markdown,/````\n\{"ok":true/,'Tool data cannot terminate its own code fence')
  assert.match(markdown,/\[Evidence\]\(<https:\/\/example.com\/final>\)/)
  assert.deepEqual(JSON.parse(formatChatAsJson(chat)).messages,chat.messages,'JSON remains the complete original record')
  const manyFences='`x'.repeat(200000)
  assert.doesNotThrow(()=>formatChatAsMarkdown({...chat,messages:[{id:'large',role:'tool',content:manyFences,createdAt:1}]}),'Large tool output does not spread matches onto the call stack')
})
