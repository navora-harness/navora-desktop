import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsPermissionConfirmation} from './settings-permission-confirm'

test('opening the card waits for an explicit choice',async()=>{
  let id='',settled=false;const confirmation=createSettingsPermissionConfirmation(value=>id=value),answer=confirmation.ask()
  void answer.then(()=>{settled=true});await Promise.resolve();assert.equal(settled,false)
  confirmation.decide(id,true);assert.equal(await answer,true);assert.equal(id,'')
})
test('reentry shares one pending choice and cancel preserves the current setting',async()=>{
  let opens=0;const confirmation=createSettingsPermissionConfirmation(id=>{if(id)opens++}),first=confirmation.ask(),second=confirmation.ask()
  assert.equal(first,second);assert.equal(opens,1);confirmation.cancel();assert.equal(await first,false);assert.equal(await second,false)
})
test('a dismissed or superseded card cannot confirm a later request',async()=>{
  let id='';const confirmation=createSettingsPermissionConfirmation(value=>id=value),first=confirmation.ask(),oldId=id
  confirmation.cancel();assert.equal(await first,false)
  const next=confirmation.ask();assert.notEqual(id,oldId);assert.equal(confirmation.decide(oldId,true),false)
  confirmation.decide(id,false);assert.equal(await next,false)
})
test('closing or unmounting an unanswered card always cancels',async()=>{
  const confirmation=createSettingsPermissionConfirmation(()=>{}),answer=confirmation.ask()
  confirmation.cancel();confirmation.cancel();assert.equal(await answer,false)
})
