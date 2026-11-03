import type { AppConfig, AppConfigPatch } from './config'

/** Only edited leaves are submitted. Arrays form one compare-and-set boundary. */
export interface SettingsCommit {
  operationId: string
  patch: AppConfigPatch & { remote?: AppConfigPatch['remote'] & { password?: string } }
  expected: AppConfigPatch
  unset?: string[]
  absent?: string[]
}

const blocked = new Set(['__proto__', 'prototype', 'constructor'])
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function settingsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => settingsEqual(v, b[i]))
  if (object(a) && object(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && settingsEqual(a[key], b[key]))
  }
  return false
}
export function createSettingsCommit(base: AppConfig, draft: AppConfig, operationId: string): SettingsCommit {
  const patch: Record<string, unknown> = {}, expected: Record<string, unknown> = {}, unset: string[] = [], absent: string[] = []
  function walk(before: Record<string, unknown>, after: Record<string, unknown>, out: Record<string, unknown>, guards: Record<string, unknown>, prefix: string) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (blocked.has(key)) throw new Error('invalid_config_path')
      if (settingsEqual(before[key], after[key])) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (!Object.hasOwn(after, key)) { unset.push(path); guards[key] = before[key]; continue }
      if (object(before[key]) && object(after[key])) {
        const nested: Record<string, unknown> = {}, guard: Record<string, unknown> = {}
        walk(before[key], after[key], nested, guard, path)
        if (Object.keys(nested).length) out[key] = nested
        if (Object.keys(guard).length) guards[key] = guard
      } else { out[key] = after[key]; if (Object.hasOwn(before, key)) guards[key] = before[key]; else absent.push(path) }
    }
  }
  walk(base as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>, patch, expected, '')
  return { operationId, patch: patch as AppConfigPatch, expected: expected as AppConfigPatch, ...(unset.length ? { unset } : {}), ...(absent.length ? { absent } : {}) }
}

export function applySettingsCommit(current: AppConfig, request: SettingsCommit): AppConfig {
  if (!request || !object(request.patch) || !object(request.expected) || typeof request.operationId !== 'string') throw new Error('invalid_config_commit')
  function check(actual: unknown, expected: unknown, prefix: string) {
    if (object(expected)) {
      for (const [key, value] of Object.entries(expected)) {
        if (blocked.has(key)) throw new Error('invalid_config_path')
        check(object(actual) ? actual[key] : undefined, value, prefix ? `${prefix}.${key}` : key)
      }
    } else if (!settingsEqual(actual, expected)) throw new Error(`config_conflict:${prefix}`)
  }
  check(current, request.expected, '')
  const absent = new Set(request.absent || [])
  for (const path of absent) {
    let value: unknown = current
    for (const key of path.split('.')) {
      if (!key || blocked.has(key)) throw new Error('invalid_config_path')
      value = object(value) ? value[key] : undefined
    }
    if (value !== undefined) throw new Error(`config_conflict:${path}`)
  }
  const candidate = structuredClone(current)
  function merge(target: Record<string, unknown>, patch: Record<string, unknown>, expected: Record<string, unknown>, prefix: string) {
    for (const [key, value] of Object.entries(patch)) {
      if (blocked.has(key)) throw new Error('invalid_config_path')
      const path = prefix ? `${prefix}.${key}` : key
      // Password is converted into its hash by the trusted main-process handler.
      if (!Object.hasOwn(expected, key) && !absent.has(path) && ![...absent].some(item => item.startsWith(`${path}.`)) && path !== 'remote.passwordHash') throw new Error(`config_guard_required:${path}`)
      // An absence guard for a new descendant still requires merging through
      // its existing parent. Replacing that parent would discard siblings.
      const guardedDescendant = [...absent].some(item => item.startsWith(`${path}.`))
      if (object(value) && object(target[key]) && (object(expected[key]) || guardedDescendant)) merge(target[key], value, object(expected[key]) ? expected[key] : {}, path)
      else {
        // A descendant absence permits traversal, never replacing its parent.
        if (!Object.hasOwn(expected, key) && !absent.has(path) && path !== 'remote.passwordHash') throw new Error(`config_guard_required:${path}`)
        target[key] = structuredClone(value)
      }
    }
  }
  merge(candidate as unknown as Record<string, unknown>, request.patch as Record<string, unknown>, request.expected as Record<string, unknown>, '')
  for (const path of request.unset || []) {
    const keys = path.split('.')
    if (keys.some(key => !key || blocked.has(key))) throw new Error('invalid_config_path')
    let target = candidate as unknown as Record<string, unknown>, guard = request.expected as Record<string, unknown>
    for (const key of keys.slice(0, -1)) {
      if (!object(target[key]) || !object(guard[key])) throw new Error(`config_guard_required:${path}`)
      target = target[key]; guard = guard[key]
    }
    const key = keys[keys.length - 1]
    if (!Object.hasOwn(guard, key)) throw new Error(`config_guard_required:${path}`)
    delete target[key]
  }
  return candidate
}
