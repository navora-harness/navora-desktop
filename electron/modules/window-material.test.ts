import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents } from 'electron'
import { createDefaultConfig } from '../../shared/config'
import type { WindowMaterialEnvironment } from '../../shared/window-material'
import { WindowMaterialManager } from './window-material'

function fixture() {
  let config = createDefaultConfig()
  let environment: WindowMaterialEnvironment = { platform: 'win32', release: '10.0.26100', systemDark: false, highContrast: false, forcedColors: false, reducedTransparency: false }
  const manager = new WindowMaterialManager({ getConfig: () => config, environment: () => environment })
  function host(id: number) {
    const events = new EventEmitter(), contents = new EventEmitter(), calls: unknown[][] = [], states: unknown[] = []
    let destroyed = false, fail = false
    const wc = Object.assign(contents, { mainFrame: {}, isDestroyed: () => destroyed, send: (_name: string, state: unknown) => states.push(state) }) as unknown as WebContents
    const win = Object.assign(events, { id, webContents: wc, isDestroyed: () => destroyed,
      setBackgroundMaterial: (value: string) => { calls.push(['material', value]); if (fail && value === 'acrylic') throw Error('observable failure') },
      setBackgroundColor: (value: string) => calls.push(['background', value]),
      setTitleBarOverlay: (value: unknown) => calls.push(['caption', value]),
    }) as unknown as BrowserWindow
    return { win, wc, calls, states, fail: () => { fail = true }, close: () => { destroyed = true; events.emit('closed') } }
  }
  return { manager, host, get config() { return config }, set config(value) { config = value }, get environment() { return environment }, set environment(value) { environment = value } }
}
test('three registered host types share material updates; unknown hosts and subframes are rejected', () => {
  const f = fixture()
  for (const [id, role] of (['main', 'browser', 'file'] as const).map((role, i) => [i, role] as const)) {
    const h = f.host(id); f.manager.register(h.win, role)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).mode, 'acrylic')
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).role, role)
    assert.throws(() => f.manager.stateFor(h.wc, {} as typeof h.wc.mainFrame), /host_only/)
    const length = h.calls.length; f.manager.apply(h.win); assert.equal(h.calls.length, length)
    h.wc.emit('did-finish-load'); assert.ok(h.states.length >= 2)
    h.close(); assert.throws(() => f.manager.stateFor(h.wc, h.wc.mainFrame), /host_only/)
  }
  const unknown = f.host(100); f.manager.apply(unknown.win); assert.deepEqual(unknown.calls, [])
  assert.throws(() => f.manager.stateFor(unknown.wc, unknown.wc.mainFrame), /host_only/)
})
test('turning off restores the current dark background after none writes its own white fallback', () => {
  const f = fixture(), h = f.host(1); f.manager.register(h.win, 'main')
  f.config.app.appearance_mode = 'dark'; f.config.app.window_acrylic = false; h.calls.length = 0
  f.manager.apply(h.win)
  assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).reason, 'disabled')
  assert.deepEqual(h.calls[0], ['material', 'none'])
  assert.equal(h.calls[1]?.[0], 'background'); assert.notEqual(h.calls[1]?.[1], '#ffffff')
  assert.equal(h.calls[2]?.[0], 'caption')
})
test('only first show reasserts the same material once without focus changes or toggles', () => {
  const f = fixture(), h = f.host(1); f.manager.register(h.win, 'main')
  h.win.emit('ready-to-show'); h.win.emit('show'); h.win.emit('focus'); h.win.emit('focus'); h.win.emit('show'); h.win.emit('ready-to-show')
  assert.deepEqual(h.calls.filter(call => call[0] === 'material'), [['material', 'acrylic'], ['material', 'acrylic']])
  const count = h.calls.length; f.manager.apply(h.win); assert.equal(h.calls.length, count)
  assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).mode, 'acrylic')
})
test('observable native error revokes transparent styling and high contrast revokes already requested material', () => {
  const f = fixture(), h = f.host(1); h.fail(); f.manager.register(h.win, 'file')
  assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).reason, 'native_error')
  assert.deepEqual(h.calls.slice(0, 2), [['material', 'acrylic'], ['material', 'none']])
  f.environment = { ...f.environment, highContrast: true }; h.calls.length = 0; f.manager.apply(h.win)
  assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).reason, 'high_contrast')
  assert.deepEqual(h.calls[0], ['material', 'none'])
  f.environment = { ...f.environment, highContrast: false, reducedTransparency: undefined }; f.manager.apply(h.win)
  assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).reason, 'system_unknown')
})
test('host IPC advertises capability even when off or temporarily solid, but not on unsupported systems',()=>{
  const f=fixture(),h=f.host(1)
  f.config.app.window_acrylic=false;f.manager.register(h.win,'main')
  assert.equal(f.manager.stateFor(h.wc,h.wc.mainFrame).supported,true)
  assert.equal(f.manager.stateFor(h.wc,h.wc.mainFrame).mode,'solid')
  f.config.app.window_acrylic=true;f.environment={...f.environment,highContrast:true};f.manager.apply(h.win)
  assert.equal(f.manager.stateFor(h.wc,h.wc.mainFrame).supported,true)
  assert.equal(f.manager.stateFor(h.wc,h.wc.mainFrame).reason,'high_contrast')
  f.environment={...f.environment,release:'10.0.19045'};f.manager.apply(h.win)
  const state=f.manager.stateFor(h.wc,h.wc.mainFrame)
  assert.equal(state.supported,false);assert.equal(state.supportReason,'windows_version');assert.equal(state.requested,true)
})

test('forced app tone keeps material enabled and publishes OS tone separately across all hosts', () => {
  const f = fixture()
  for (const role of ['main', 'browser', 'file'] as const) {
    const h = f.host({ main: 1, browser: 2, file: 3 }[role])
    f.config.app.appearance_mode = 'dark'; f.manager.register(h.win, role)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).mode, 'acrylic')
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).dark, true)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).systemDark, false)
    f.environment = { ...f.environment, systemDark: true }; f.config.app.appearance_mode = 'light'; f.manager.apply(h.win)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).mode, 'acrylic')
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).dark, false)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).systemDark, true)
    f.config.app.appearance_mode = 'auto'; f.manager.apply(h.win)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).dark, true)
    f.environment = { ...f.environment, systemDark: false }; f.manager.apply(h.win)
    assert.equal(f.manager.stateFor(h.wc, h.wc.mainFrame).dark, false)
    assert.ok(h.calls.filter(call => call[0] === 'material').every(call => call[1] === 'acrylic'))
  }
})
