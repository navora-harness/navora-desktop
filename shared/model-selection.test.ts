import {test} from 'node:test'
import assert from 'node:assert/strict'
import {confirmedModelSelection,validateModelSelection,assertConfirmedModelSelection} from './model-selection'
import {createDefaultConfig} from './config'
test('accepted selection rejects endpoint changes without carrying secret values',()=>{const config=createDefaultConfig(),identity=confirmedModelSelection(config,{});assert(!JSON.stringify(identity).includes('api_key'));validateModelSelection(config,identity);config.ai.providers.find(item=>item.id===identity.providerId)!.base_url='https://different.invalid';assert.throws(()=>validateModelSelection(config,identity),/model_configuration_changed/)})
test('a changed conversation selection cannot silently replace the clicked selection',()=>{const config=createDefaultConfig(),identity=confirmedModelSelection(config,{});assert.throws(()=>assertConfirmedModelSelection(identity,{...identity,executionMode:'agent'}),/model_selection_conflict/)})

test('removing an otherwise default-capability model invalidates its accepted identity',()=>{
  const config=createDefaultConfig(),provider=config.ai.providers[0]
  provider.models=['remove-me','retained'];provider.model='remove-me';provider.model_settings={}
  const identity=confirmedModelSelection(config,{model:'remove-me'})
  provider.models=['retained'];provider.model='retained'
  assert.throws(()=>validateModelSelection(config,identity),/model_configuration_changed/)
})

test('reasoning identity accepts only configured levels and never adds an unsupported one',()=>{
  const config=createDefaultConfig(),identity=confirmedModelSelection(config,{})
  assert.throws(()=>validateModelSelection(config,{...identity,reasoningLevel:'unsupported'}),/invalid_model_selection/)
})
