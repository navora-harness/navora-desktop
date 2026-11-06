import assert from 'node:assert/strict'
import {test} from 'node:test'
import {submitDecision,deferDecisionCancellation,isDecisionSubmitting,type DecisionSubmissionStates} from './decision-submission'

test('decision keeps its context until acknowledgement and suppresses duplicate dispatch',async()=>{
  const states:DecisionSubmissionStates={},sent:string[]=[]
  let finish!:(value:boolean)=>void,removed=false
  const first=submitDecision(states,'request-a',()=>{sent.push('a');return new Promise(resolve=>{finish=resolve})},()=>{removed=true})
  await submitDecision(states,'request-a',async()=>{sent.push('duplicate');return true},()=>{})
  assert.deepEqual(sent,['a']);assert.equal(removed,false);assert.equal(states['request-a']?.pending,true)
  assert.equal(isDecisionSubmitting('request-a'),true)
  await submitDecision({},'request-a',async()=>{sent.push('other-view');return true},()=>{})
  assert.deepEqual(sent,['a'],'Another view of the same request cannot submit it again')
  assert.equal(deferDecisionCancellation(states,'request-a'),true)
  finish(true);await first
  assert.equal(removed,true);assert.equal(states['request-a']?.pending,false);assert.equal(isDecisionSubmitting('request-a'),false)
})
test('failed decisions keep drafts actionable and an expired request cannot be resubmitted',async()=>{
  const states:DecisionSubmissionStates={};let removed=false,sent=0
  await submitDecision(states,'a',async()=>{sent++;throw Error('offline')},()=>{removed=true})
  assert.equal(removed,false);assert.equal(states.a?.expired,false);assert.match(states.a?.error||'',/重试/)
  await submitDecision(states,'a',async()=>{sent++;return false},()=>{removed=true})
  assert.equal(states.a?.expired,true)
  await submitDecision(states,'a',async()=>{sent++;return true},()=>{removed=true})
  assert.equal(sent,2);assert.equal(removed,false)
})
test('concurrent request identities remain separate and cancellation prevents unsafe retries',async()=>{
  const states:DecisionSubmissionStates={};let fail!:(error:Error)=>void
  const first=submitDecision(states,'old',()=>new Promise((_resolve,reject)=>{fail=reject}),()=>{})
  await submitDecision(states,'new',async()=>true,()=>{})
  assert.equal(states.old?.pending,true);assert.equal(states.new?.pending,false)
  deferDecisionCancellation(states,'old');fail(Error('lost response'));await first
  assert.equal(states.old?.expired,true);assert.equal(states.new?.expired,false)
})
