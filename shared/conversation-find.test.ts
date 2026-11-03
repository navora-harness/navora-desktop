import {test} from 'node:test'
import assert from 'node:assert/strict'
import {findConversationText} from './conversation-find'
test('conversation find counts occurrences and preserves original offsets',()=>{assert.deepEqual(findConversationText([{id:'a',text:'你好 Code 你好 code'}],'code').matches,[{messageId:'a',from:3,to:7},{messageId:'a',from:11,to:15}])})
test('queries are literal and case matching is optional',()=>{assert.equal(findConversationText([{id:'a',text:'a+b A+B aaaab'}],'a+b').matches.length,2);assert.equal(findConversationText([{id:'a',text:'a+b A+B'}],'a+b',true).matches.length,1);assert.equal(findConversationText([{id:'a',text:'abc'}],'  ').matches.length,0)})
test('large result sets are explicitly marked incomplete',()=>{const result=findConversationText(Array.from({length:5000},(_,id)=>({id:String(id),text:'命中'})),'命中',false,1000);assert.equal(result.matches.length,1000);assert.equal(result.truncated,true)})
