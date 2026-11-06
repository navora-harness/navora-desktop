import test from 'node:test'
import assert from 'node:assert/strict'
import { browserCursorDesign, browserCursorSvg, rasterizeBrowserCursor } from './browser-native-cursor'
import { BROWSER_CURSOR_OPTIONS } from '../../shared/browser-cursor'

test('native cursor designs retain logical hotspots at all supported display scales', () => {
  for (const { id: style } of BROWSER_CURSOR_OPTIONS) {
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

test('user size scales the image and logical hotspot once, independently of display DPI', () => {
  for (const style of ['windows-glow', 'focus-ring'] as const) for (const scale of [0.75, 1.5, 2]) {
    const original = browserCursorDesign(style), design = browserCursorDesign(style, scale)
    const cursor = rasterizeBrowserCursor(style, 1.5, true, scale)
    assert.equal(cursor.width, Math.round(original.size * scale * 1.5))
    assert.deepEqual(cursor.hotspot, { x: Math.round(original.hotspot.x * scale), y: Math.round(original.hotspot.y * scale) })
    assert.deepEqual(cursor.hotspot, design.hotspot)
    const hidden = rasterizeBrowserCursor(style, 1.5, false, scale)
    assert.equal(hidden.width, cursor.width)
    assert.deepEqual(hidden.hotspot, cursor.hotspot)
    assert.equal(hidden.bitmap.some(Boolean), false)
    assert.match(browserCursorSvg(style, scale), new RegExp(`width="${design.size}"`))
  }
  for (const scale of [0.74, 2.01, NaN, Infinity]) assert.throws(() => rasterizeBrowserCursor('windows-glow', 1, true, scale), RangeError)
})

test('diffuse glow surrounds a sharp Windows arrow and native channels remain premultiplied', () => {
  const plain = rasterizeBrowserCursor('windows-standard'), glow = rasterizeBrowserCursor('windows-glow')
  let halo = 0, opaque = 0
  for (let offset = 0; offset < glow.bitmap.length; offset += 4) {
    const alpha = glow.bitmap[offset + 3]!
    for (let channel = 0; channel < 3; channel++) assert.ok(glow.bitmap[offset + channel]! <= alpha, 'BGRA channels must be premultiplied')
    if (plain.bitmap[offset + 3] === 255) {
      assert.deepEqual(glow.bitmap.subarray(offset, offset + 4), plain.bitmap.subarray(offset, offset + 4), 'The halo does not blur the opaque body')
      opaque++
    }
    const x = (offset / 4) % glow.width
    if (x < 24 && alpha > 2 && glow.bitmap[offset]! > glow.bitmap[offset + 2]!) halo++
  }
  assert.ok(opaque > 50)
  assert.ok(halo > 50, 'Blue light extends visibly beyond the arrow geometry')
})

test('hidden virtual cursor uses a non-empty transparent bitmap without changing its logical hotspot', () => {
  const visible = rasterizeBrowserCursor('navora-arrow', 2)
  const hidden = rasterizeBrowserCursor('navora-arrow', 2, false)
  assert.equal(hidden.width, visible.width)
  assert.deepEqual(hidden.hotspot, visible.hotspot)
  assert.equal(hidden.bitmap.some(Boolean), false)
  assert.throws(() => rasterizeBrowserCursor('navora-arrow', 4), RangeError)
})
