import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from './config'
import { defaultModelCapabilities } from './model-capabilities'
import { createSettingsCommit, applySettingsCommit } from './settings-commit'
import { projectSettingsGroup, settingsGroupDirty, validateSettingsGroup } from './settings-groups'

test('independent windows merge edited leaves without copying unrelated drafts', () => {
  const base = createDefaultConfig(), first = structuredClone(base), second = structuredClone(base)
  first.app.show_main_on_start = false
  second.app.max_composer_chars = 20000
  second.remote.port = 9999 // draft from a different group must stay local
  const next = applySettingsCommit(base, createSettingsCommit(base, first, 'one'))
  const submitted = projectSettingsGroup(base, second, 'composer')
  const saved = applySettingsCommit(next, createSettingsCommit(base, submitted, 'two'))
  assert.equal(saved.app.show_main_on_start, false)
  assert.equal(saved.app.max_composer_chars, 20000)
  assert.equal(saved.remote.port, base.remote.port)
  assert.equal(settingsGroupDirty(base, second, 'remote'), true)
})

test('same-field stale writes reject rather than overwrite another window', () => {
  const base = createDefaultConfig(), first = structuredClone(base), second = structuredClone(base)
  first.remote.port = 9100; second.remote.port = 9200
  const latest = applySettingsCommit(base, createSettingsCommit(base, first, 'one'))
  assert.throws(() => applySettingsCommit(latest, createSettingsCommit(base, second, 'two')), /config_conflict:remote.port/)
  assert.equal(latest.remote.port, 9100)
})

test('provider deletion uses an atomic catalog guard and preserves no deleted rows', () => {
  const base = createDefaultConfig()
  base.ai.providers.push({ ...structuredClone(base.ai.providers[0]), id: 'second' })
  const draft = structuredClone(base)
  draft.ai.providers = draft.ai.providers.slice(0, 1)
  draft.ai.default_provider = draft.ai.providers[0].id
  const request = createSettingsCommit(base, draft, 'catalog')
  assert.deepEqual(applySettingsCommit(base, request).ai.providers, draft.ai.providers)
  const concurrent = structuredClone(base)
  concurrent.ai.providers[0].base_url = 'https://changed.example/v1'
  assert.throws(() => applySettingsCommit(concurrent, request), /config_conflict:ai.providers/)
})

test('new optional fields survive JSON transport and require absence guards', () => {
  const base = createDefaultConfig(), draft = structuredClone(base)
  delete base.ai.providers[0].model_settings
  draft.ai.providers = structuredClone(base.ai.providers)
  draft.ai.providers[0].model_settings = {}
  const request = JSON.parse(JSON.stringify(createSettingsCommit(base, draft, 'transport')))
  assert.deepEqual(applySettingsCommit(base, request).ai.providers[0].model_settings, {})
  assert.throws(() => applySettingsCommit(base, { operationId: 'unguarded', patch: { app: { language: 'xx' } }, expected: {} }), /config_guard_required/)
  const polluted = JSON.parse('{"operationId":"bad","patch":{"__proto__":{"polluted":true}},"expected":{}}')
  assert.throws(() => applySettingsCommit(base, polluted), /invalid_config_path/)
})

test('adding only an optional descendant preserves concurrent siblings without authorizing unguarded edits', () => {
  const base=createDefaultConfig()
  delete base.app.shortcuts
  const draft=structuredClone(base)
  draft.app.shortcuts={'conversation.new':false}
  const request=JSON.parse(JSON.stringify(createSettingsCommit(base,draft,'optional-only')))
  assert.deepEqual(request.expected,{})
  const concurrent=structuredClone(base)
  concurrent.app.language='en-US';concurrent.app.max_composer_chars=20000
  const saved=applySettingsCommit(concurrent,request)
  assert.deepEqual(saved,{...concurrent,app:{...concurrent.app,shortcuts:draft.app.shortcuts}})
  assert.equal(concurrent.app.shortcuts,undefined)
  const unguarded=structuredClone(request)
  unguarded.patch.app.language='xx'
  assert.throws(()=>applySettingsCommit(concurrent,unguarded),/config_guard_required:app.language/)
  for(const forged of [
    {operationId:'ancestor',patch:{app:'evil'},expected:{},absent:['app.optional']},
    {operationId:'scalar',patch:{app:{language:{fake:true}}},expected:{},absent:['app.language.fake']},
  ])assert.throws(()=>applySettingsCommit(concurrent,forged as never),/config_guard_required/)
  concurrent.app.shortcuts={'app.quit':false}
  assert.throws(()=>applySettingsCommit(concurrent,request),/config_conflict:app.shortcuts/)
})

test('group validation rejects NaN, invalid model capacity, and unsafe paths', () => {
  const config = createDefaultConfig()
  config.app.max_composer_chars = NaN
  assert.match(validateSettingsGroup(config, 'composer')!, /整数/)
  config.files.root_dirname = '../outside'
  assert.match(validateSettingsGroup(config, 'workspace')!, /相对路径/)
  config.remote.port = 65536
  assert.match(validateSettingsGroup(config, 'remote')!, /端口/)
  config.subchat.max_parallel = 9
  assert.match(validateSettingsGroup(config, 'subchat')!, /并行/)
  const provider = config.ai.providers[0], caps = defaultModelCapabilities(provider.model)
  caps.max_output_tokens = caps.context_window
  provider.model_settings = { [provider.model]: caps }
  assert.match(validateSettingsGroup(config, 'models')!, /最大输出/)
})
