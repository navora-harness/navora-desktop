import assert from 'node:assert/strict'
import test from 'node:test'
import { windowAcrylicPreference, windowMaterialDecision, windowMaterialSupport, windowMaterialSurfaceColors, type WindowMaterialEnvironment } from './window-material'
import { APPEARANCE_THEMES, appearancePalette } from './appearance'

const supported: WindowMaterialEnvironment = { platform: 'win32', release: '10.0.26100', systemDark: false, highContrast: false, forcedColors: false, reducedTransparency: false }
test('material policy checks actual Windows build and observable accessibility conditions', () => {
  assert.deepEqual(windowMaterialDecision(true, false, true, supported), { mode: 'acrylic', reason: 'requested' })
  for (const [release, expected] of [['10.0.22621', 'acrylic'], ['10.0.22000', 'solid'], ['10.0.19045', 'solid'], ['11.0.1', 'solid'], ['unknown', 'solid']] as const) assert.equal(windowMaterialDecision(true, false, true, { ...supported, release }).mode, expected)
  for (const flag of ['highContrast', 'forcedColors', 'reducedTransparency'] as const) {
    assert.equal(windowMaterialDecision(true, false, true, { ...supported, [flag]: true }).mode, 'solid')
    assert.equal(windowMaterialDecision(true, false, true, { ...supported, [flag]: undefined }).reason, 'system_unknown')
  }
  assert.equal(windowMaterialDecision(true, false, true, { ...supported, platform: 'darwin' }).reason, 'platform')
  assert.equal(windowMaterialDecision(true, false, false, supported).reason, 'api_unavailable')
  assert.equal(windowMaterialDecision(false, false, true, supported).reason, 'disabled')
  assert.equal(windowMaterialDecision(true, true, true, supported).mode, 'acrylic')
  assert.equal(windowMaterialDecision(true, false, true, { ...supported, systemDark: true }).mode, 'acrylic')
  assert.equal(windowMaterialDecision(true, true, true, { ...supported, systemDark: true }).mode, 'acrylic')
})

test('opposite app/system tones use a readable translucent theme tint instead of disabling the real material', () => {
  const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0)
  const channels = (hex: string) => hex.slice(1, 7).match(/../g)!.map(v => parseInt(v, 16))
  for (const entry of APPEARANCE_THEMES) for (const dark of [false, true]) {
    const theme = appearancePalette(entry.id, dark ? 'dark' : 'light', !dark)
    const tint = windowMaterialSurfaceColors(theme, !dark)
    for (const surface of [tint.chrome, tint.sidebar]) {
      const alpha = parseInt(surface.slice(7), 16) / 255
      assert.ok(alpha > .5 && alpha < 1, entry.id + ' keeps a translucent surface')
      for (const backdrop of [0, 255]) {
        const bg = luminance(channels(surface).map(c => c * alpha + backdrop * (1 - alpha)))
        const fg = luminance(channels(theme.ink))
        assert.ok((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) >= 4.5, entry.id + ' readable chrome on opposite OS tone')
      }
    }
    assert.notEqual(tint.chrome, windowMaterialSurfaceColors(theme, dark).chrome)
  }
})
test('old preferences default on while malformed persisted preferences remain opaque', () => {
  assert.equal(windowAcrylicPreference(undefined), true)
  assert.equal(windowAcrylicPreference(false), false)
  assert.equal(windowAcrylicPreference('false'), false)
  assert.throws(() => windowAcrylicPreference('true', true), /must be a boolean/)
})
test('platform capability remains independent of preference and temporary material fallbacks',()=>{
  assert.deepEqual(windowMaterialSupport(true,supported),{supported:true,supportReason:'supported'})
  for(const patch of [{systemDark:true},{highContrast:true},{forcedColors:true},{reducedTransparency:true},{highContrast:undefined}]){
    const environment={...supported,...patch}
    assert.equal(windowMaterialSupport(true,environment).supported,true)
    assert.equal(windowMaterialDecision(false,false,true,environment).reason,'disabled')
  }
  for(const [hasApi,environment,reason] of [[true,{...supported,platform:'linux'},'platform'],[true,{...supported,release:'10.0.19045'},'windows_version'],[false,supported,'api_unavailable'],[true,{...supported,release:'unknown'},'system_unknown']] as const){
    assert.deepEqual(windowMaterialSupport(hasApi,environment),{supported:false,supportReason:reason})
  }
})
