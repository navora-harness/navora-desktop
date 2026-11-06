import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { ConfigService } from './config-service'
import { createDefaultBrowserAutomation } from '../../shared/browser-automation'
import type { AppConfigPatch } from '../../shared/config'
import { createSettingsCommit } from '../../shared/settings-commit'

function withRoot(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-config-test-'))
  try { run(root) } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root))
    if (!relative.startsWith('navora-config-test-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe test cleanup path')
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('legacy files migrate automation defaults while preserving saved false and unrelated preferences', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'config.yml'), yaml.dump({
    app: { language: 'en-US', show_run_logs: false },
    browser: { default_width: 1337, automation: { protect_input: false, smooth_pointer: false } },
  }))
  const config = new ConfigService(root).get()
  assert.equal(config.app.language, 'en-US')
  assert.equal(config.app.show_run_logs, false)
  assert.equal(config.browser.default_width, 1337)
  assert.deepEqual(config.browser.automation, { ...createDefaultBrowserAutomation(), protect_input: false, smooth_pointer: false })
}))

test('invalid loaded automation resets only its own block', () => {
  for (const automation of [null, 'enabled', { speed_multiplier: 0 }, { protect_input: 'false' }, { interval_ms: Infinity }]) withRoot(root => {
    fs.writeFileSync(path.join(root, 'config.yml'), yaml.dump({
      app: { language: 'en-US', show_run_logs: false },
      browser: { default_width: 1337, automation }, remote: { port: 49152 },
    }))
    const config = new ConfigService(root).get()
    assert.deepEqual(config.browser.automation, createDefaultBrowserAutomation())
    assert.equal(config.app.language, 'en-US')
    assert.equal(config.app.show_run_logs, false)
    assert.equal(config.browser.default_width, 1337)
    assert.equal(config.remote.port, 49152)
  })
})

test('leaf updates retain other settings and rejected patches leave memory and disk unchanged', () => withRoot(root => {
  const service = new ConfigService(root)
  service.update({ browser: { automation: { show_virtual_cursor: false, speed_multiplier: 1.25 }, default_width: 1337 } })
  service.update({ browser: { automation: { protect_input: false } }, app: { language: 'en-US' } })
  assert.equal(service.get().browser.automation.show_virtual_cursor, false)
  assert.equal(service.get().browser.automation.speed_multiplier, 1.25)
  assert.equal(service.get().browser.automation.protect_input, false)
  const previous = service.get()
  const before = structuredClone(previous)
  const disk = fs.readFileSync(service.getPath(), 'utf8')
  for (const automation of [{ speed_multiplier: 0 }, { show_virtual_cursor: 'true' }, { owner: 'user' }, null]) {
    assert.throws(() => service.update({ browser: { automation }, app: { language: 'broken' } } as unknown as AppConfigPatch))
    assert.equal(service.get(), previous)
    assert.deepEqual(service.get(), before)
    assert.equal(fs.readFileSync(service.getPath(), 'utf8'), disk)
  }
  assert.equal(new ConfigService(root).get().browser.automation.show_virtual_cursor, false)
  assert.equal(new ConfigService(root).get().browser.default_width, 1337)
}))

test('full saves validate automation before replacing the committed configuration', () => withRoot(root => {
  const service = new ConfigService(root)
  const previous = service.get()
  const invalid = structuredClone(previous)
  invalid.browser.automation.cursor_fps = 3.5
  invalid.app.language = 'broken'
  const disk = fs.readFileSync(service.getPath(), 'utf8')
  assert.throws(() => service.save(invalid))
  assert.equal(service.get(), previous)
  assert.equal(fs.readFileSync(service.getPath(), 'utf8'), disk)
}))

test('cursor style and size persist across reloads while invalid sizes leave disk unchanged', () => withRoot(root => {
  const service = new ConfigService(root)
  service.update({ browser: { automation: { cursor_style: 'diamond', cursor_scale: 1.5 } } })
  const loaded = new ConfigService(root).get().browser.automation
  assert.equal(loaded.cursor_style, 'diamond')
  assert.equal(loaded.cursor_scale, 1.5)
  assert.equal(loaded.protect_input, true)
  const disk = fs.readFileSync(service.getPath(), 'utf8')
  assert.throws(() => service.update({ browser: { automation: { cursor_scale: 2.01 } } }))
  assert.equal(fs.readFileSync(service.getPath(), 'utf8'), disk)
  assert.equal(service.get().browser.automation.cursor_scale, 1.5)
}))

test('a failed configuration write does not commit a valid candidate to memory', () => withRoot(root => {
  const service = new ConfigService(root)
  const previous = service.get()
  fs.renameSync(service.getPath(), path.join(root, 'saved-config.yml'))
  fs.mkdirSync(service.getPath())
  assert.throws(() => service.update({ browser: { automation: { cursor_scale: 1.5 } } }))
  assert.equal(service.get(), previous)
  assert.equal(service.get().browser.automation.cursor_scale, 1)
}))

test('window material preference migrates safely and invalid saves preserve the committed preference', () => withRoot(root => {
  const service = new ConfigService(root)
  assert.equal(service.get().app.window_acrylic, true)
  service.update({ app: { window_acrylic: false } })
  assert.equal(new ConfigService(root).get().app.window_acrylic, false)
  const previous = service.get(), disk = fs.readFileSync(service.getPath(), 'utf8')
  assert.throws(() => service.update({ app: { window_acrylic: 'true' } } as unknown as AppConfigPatch), /window_acrylic/)
  assert.equal(service.get(), previous)
  assert.equal(fs.readFileSync(service.getPath(), 'utf8'), disk)
  fs.writeFileSync(service.getPath(), 'app:\n  window_acrylic: invalid\n  language: en-US\n')
  const migrated = new ConfigService(root).get()
  assert.equal(migrated.app.window_acrylic, false)
  assert.equal(migrated.app.language, 'en-US')
}))

test('a failed material preference write keeps the saved choice for every host', () => withRoot(root => {
  const service = new ConfigService(root)
  service.update({ app: { window_acrylic: false } })
  const previous = service.get()
  fs.renameSync(service.getPath(), path.join(root, 'saved-material-config.yml'))
  fs.mkdirSync(service.getPath())
  assert.throws(() => service.update({ app: { window_acrylic: true } }))
  assert.equal(service.get(), previous)
  assert.equal(service.get().app.window_acrylic, false)
}))

test('guarded commits reject stale edits and invalid values before replacing disk', () => withRoot(root => {
  const service = new ConfigService(root)
  const base = structuredClone(service.get()), first = structuredClone(base), second = structuredClone(base)
  first.app.max_composer_chars = 22000; second.app.max_composer_chars = 33000
  service.commit(createSettingsCommit(base, first, 'first'))
  const disk = fs.readFileSync(service.getPath(), 'utf8')
  assert.throws(() => service.commit(createSettingsCommit(base, second, 'stale')), /config_conflict/)
  const invalid = structuredClone(service.get()); invalid.remote.port = 99999
  assert.throws(() => service.commit(createSettingsCommit(service.get(), invalid, 'invalid')), /invalid_config/)
  assert.equal(fs.readFileSync(service.getPath(), 'utf8'), disk)
  assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.tmp')), [])
  assert.equal(new ConfigService(root).get().app.max_composer_chars, 22000)
}))

test('a repeated operation acknowledgement does not overwrite later changes', () => withRoot(root => {
  const service = new ConfigService(root), base = structuredClone(service.get()), first = structuredClone(base)
  first.app.max_composer_chars = 20000
  const request = createSettingsCommit(base, first, 'idempotent')
  service.commit(request)
  service.update({ app: { show_main_on_start: false } })
  assert.equal(service.commit(request).app.show_main_on_start, false)
  assert.equal(service.get().app.max_composer_chars, 20000)
  assert.throws(() => service.commit({ ...request, patch: { app: { max_composer_chars: 22000 } } }), /operation_reused/)
}))

test('workspace commits validate and prepare the destination without migrating old files', () => withRoot(root => {
  const service = new ConfigService(root)
  const old = path.join(root, service.get().files.root_dirname)
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'keep.txt'), 'existing')
  const draft = structuredClone(service.get()); draft.files.root_dirname = 'next-workspace'
  service.commit(createSettingsCommit(service.get(), draft, 'path'))
  assert.equal(fs.statSync(path.join(root, 'next-workspace')).isDirectory(), true)
  assert.equal(fs.readFileSync(path.join(old, 'keep.txt'), 'utf8'), 'existing')
  assert.deepEqual(fs.readdirSync(path.join(root, 'next-workspace')), [])
  const invalid = structuredClone(service.get()); invalid.files.custom_root = path.join(old, 'keep.txt')
  assert.throws(() => service.commit(createSettingsCommit(service.get(), invalid, 'file')))
  assert.equal(service.get().files.root_dirname, 'next-workspace')
}))
