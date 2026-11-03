import test from 'node:test'
import assert from 'node:assert/strict'
import { browserCursorDesign, browserCursorSvg, rasterizeBrowserCursor } from './browser-native-cursor'

test('native cursor designs retain logical hotspots at all supported display scales', () => {
  for (const style of ['navora-arrow', 'focus-ring', 'precision-cross'] as const) {
    const design = browserCursorDesign(style)
    for (const scale of [1, 1.25, 1.5, 2, 3]) {
      const { bitmap, width, height, hotspot } = rasterizeBrowserCursor(style, scale)
      assert.equal(width, Math.round(design.size * scale))
      assert.equal(bitmap.length, width * height * 4)
      assert.deepEqual(hotspot, design.hotspot, 'A logical hotspot is not scaled twice')
      assert.ok(bitmap.some((channel, index) => index % 4 === 3 && channel > 0 && channel < 255), 'Edges are antialiased')
      assert.ok(bitmap.some((channel, index) => index % 4 === 3 && channel === 0), 'The image has a transparent surround')
      assert.ok(bitmap.some((channel, index) => index % 4 === 3 && channel === 255), 'The design remains visible')
    }
    assert.match(browserCursorSvg(style), /<svg.+viewBox=/)
  }
})

test('hidden virtual cursor uses a non-empty transparent bitmap without changing its logical hotspot', () => {
  const visible = rasterizeBrowserCursor('navora-arrow', 2)
  const hidden = rasterizeBrowserCursor('navora-arrow', 2, false)
  assert.equal(hidden.width, visible.width)
  assert.deepEqual(hidden.hotspot, visible.hotspot)
  assert.equal(hidden.bitmap.some(Boolean), false)
  assert.throws(() => rasterizeBrowserCursor('navora-arrow', 4), RangeError)
})
