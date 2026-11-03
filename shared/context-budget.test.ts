import {test} from 'node:test'
import assert from 'node:assert/strict'
import {estimateContextBudget,estimateContextText} from './context-budget'
test('UTF8 text and output reservation share the request budget',()=>{assert.equal(estimateContextText('中文'),2);const result=estimateContextBudget([{role:'user',content:'中文'}],[],800,1000);assert.equal(result.total,result.textTokens+800);assert.equal(result.ratio,result.total/1000)})
test('images reserve tokens without counting base64 data as ordinary text',()=>{const result=estimateContextBudget([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'x'.repeat(10000)}}]}],[],100,4500);assert.equal(result.imageTokens,4096);assert(result.textTokens<100);assert.equal(result.exceeds,true)})
