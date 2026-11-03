import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentInbox } from './agent-inbox'
import { createDefaultConfig } from '../../shared/config'
import { defaultModelCapabilities } from '../../shared/model-capabilities'
import { assertConfirmedModelSelection, confirmedModelSelection, validateModelSelection, canInsertModelSelection } from '../../shared/model-selection'
import { composerDocumentFromLegacy, type ComposerSubmitInput } from '../../shared/composer-document'
import type { ChatSession } from '../../shared/types'

function fixture() {
  const config = createDefaultConfig(), provider = config.ai.providers[0]
  provider.models = ['first', 'second']; provider.model = 'first'
  provider.model_settings = Object.fromEntries(provider.models.map(id => {
    const capabilities = defaultModelCapabilities(id); capabilities.reasoning.enabled = true
    return [id, capabilities]
  }))
  const chat: ChatSession = { id: 'chat', title: 'fixture', createdAt: 1, updatedAt: 1, messages: [], providerId: provider.id, model: 'first', reasoningLevel: 'high', executionMode: 'chat' }
  let running = true, incomingChecks = 0
  let insertInput: (input: ComposerSubmitInput) => boolean = () => false
  const starts: ComposerSubmitInput[] = []
  const inbox = new AgentInbox({
    get: id => id === chat.id ? chat : null,
    save: (_id, entries, paused) => { chat.queuedMessages = entries; chat.queuePaused = paused },
    changed: () => {}, running: () => running, maxChars: () => 10000,
    validateIncoming: (_id, input) => { incomingChecks++; if (input.modelIdentity) assertConfirmedModelSelection(input.modelIdentity, confirmedModelSelection(config, chat)) },
    prepare: async (_id, input) => {
      const modelIdentity = input.modelIdentity || confirmedModelSelection(config, chat)
      validateModelSelection(config, modelIdentity)
      return { ...input, modelIdentity }
    },
    start: async (_id, input) => { starts.push(structuredClone(input)); running = true },
    insert: (_id, input) => insertInput(input),
    accepted: (_id, id, fingerprint) => { (chat.acceptedClientMessageIds ||= []).push({ id, fingerprint, acceptedAt: Date.now() }) },
  })
  return { config, provider, chat, inbox, starts, identity: () => confirmedModelSelection(config, chat), setRunning: (value: boolean) => { running = value }, incomingChecks: () => incomingChecks, setInsert: (callback: (input: ComposerSubmitInput) => boolean) => { insertInput = callback } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('queued work keeps its accepted model, reasoning and answer mode after the chat changes', async () => {
  const f = fixture(), original = f.identity(), raw = { content: 'frozen task', modelIdentity: structuredClone(original), clientMessageId: 'accepted-once' }
  await f.inbox.submit('chat', raw, 'queue')
  raw.modelIdentity.model = 'caller mutation'
  f.chat.model = 'second'; f.chat.reasoningLevel = 'low'; f.chat.executionMode = 'agent'
  f.setRunning(false); f.inbox.finished('chat'); await tick()
  assert.equal(f.starts.length, 1)
  assert.deepEqual(f.starts[0].modelIdentity, original)
  assert.equal(f.starts[0].modelIdentity!.model, 'first')
  assert.equal(f.starts[0].modelIdentity!.reasoningLevel, 'high')
  assert.equal(f.starts[0].modelIdentity!.executionMode, 'chat')
  assert.deepEqual(f.chat.queuedMessages, [])
})

test('an endpoint change pauses accepted queue work and explicit resume can retry after restoration', async () => {
  const f = fixture(), identity = f.identity(), address = f.provider.base_url
  await f.inbox.submit('chat', { content: 'retain this task', modelIdentity: identity, clientMessageId: 'queued-model' }, 'queue')
  f.provider.base_url = 'https://different.invalid/v1'
  f.setRunning(false); f.inbox.finished('chat'); await tick()
  assert.equal(f.starts.length, 0)
  assert.equal(f.chat.queuePaused, true)
  assert.match(f.chat.queuedMessages![0].error!, /model_configuration_changed/)
  assert.deepEqual(f.chat.queuedMessages![0].modelIdentity, identity)
  f.provider.base_url = address
  await f.inbox.resume('chat')
  assert.equal(f.starts.length, 1)
  assert.deepEqual(f.starts[0].modelIdentity, identity)
})

test('acknowledgement replay remains idempotent after model changes and bypasses new-input validation', async () => {
  const f = fixture(), document = composerDocumentFromLegacy('chat', 'one accepted task', [])
  const raw: ComposerSubmitInput = { content: 'one accepted task', document, modelIdentity: f.identity(), clientMessageId: 'once' }
  assert.equal(await f.inbox.submit('chat', raw, 'queue'), true)
  f.chat.model = 'second'; f.chat.reasoningLevel = 'low'; f.chat.executionMode = 'agent'
  const checks = f.incomingChecks()
  assert.equal(await f.inbox.submit('chat', { ...raw, modelIdentity: f.identity() }, 'queue'), false)
  assert.equal(f.incomingChecks(), checks)
  f.setRunning(false); f.inbox.finished('chat'); await tick()
  f.provider.base_url = 'https://changed-again.invalid/v1'
  assert.equal(await f.inbox.submit('chat', raw, 'queue'), false)
  assert.equal(f.starts.length, 1)
  assert.equal(f.incomingChecks(), checks)
  const changedDocument = composerDocumentFromLegacy('chat', 'different content', [])
  await assert.rejects(f.inbox.submit('chat', { ...raw, document: changedDocument }, 'queue'), /client_message_id_conflict/)
})

test('a genuinely new submission cannot borrow an outdated confirmed selection', async () => {
  const f = fixture(), modelIdentity = f.identity()
  f.chat.model = 'second'
  await assert.rejects(f.inbox.submit('chat', { content: 'new task', modelIdentity, clientMessageId: 'new-id' }, 'queue'), /model_selection_conflict/)
  assert.equal(f.chat.queuedMessages?.length || 0, 0)
})

test('a running correction with a different confirmed model is queued for its own run', async () => {
  const f = fixture(), current = f.identity(), inserted: ComposerSubmitInput[] = []
  f.setInsert(input => {
    if (!canInsertModelSelection(current, input.modelIdentity)) return false
    inserted.push(input); return true
  })
  f.chat.model = 'second'; f.chat.reasoningLevel = 'low'; f.chat.executionMode = 'agent'
  const changed = f.identity()
  await f.inbox.submit('chat', { content: 'different model task', modelIdentity: changed }, 'insert')
  assert.equal(inserted.length, 0)
  assert.equal(f.chat.queuedMessages!.length, 1)
  assert.deepEqual(f.chat.queuedMessages![0].modelIdentity, changed)
  f.setRunning(false); f.inbox.finished('chat'); await tick()
  assert.deepEqual(f.starts[0].modelIdentity, changed)
  for (const patch of [{ model: 'second' }, { reasoningLevel: 'low' }, { executionMode: 'agent' as const }, { providerId: 'other' }, { configFingerprint: 'changed' }]) assert.equal(canInsertModelSelection(current, { ...current, ...patch }), false)
  assert.equal(canInsertModelSelection(current, { ...current }), true)
})
