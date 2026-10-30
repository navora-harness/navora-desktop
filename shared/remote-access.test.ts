import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertRemoteAccessConfig, createDefaultConfig } from './config'
import { hashPassword } from './crypto-util'

test('remote access must replace the shipped password before it can be enabled', () => {
  const remote = createDefaultConfig().remote
  assert.doesNotThrow(() => assertRemoteAccessConfig(remote))
  remote.enabled = true
  assert.throws(() => assertRemoteAccessConfig(remote), /remote_default_password/)
  remote.passwordHash = ''
  assert.throws(() => assertRemoteAccessConfig(remote), /remote_no_password/)
  remote.passwordHash = hashPassword('private-test-password')
  assert.doesNotThrow(() => assertRemoteAccessConfig(remote))
})
