import type { NativeImage, Point } from 'electron'
import { browserCursorDesign, type BrowserCursorStyle as Style, type BrowserCursorShape as Shape } from '../../shared/browser-cursor'
export { browserCursorDesign, browserCursorSvg } from '../../shared/browser-cursor'

function contains(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'ring') return Math.abs(Math.hypot(x - shape.x, y - shape.y) - shape.radius) <= shape.width / 2
  const points = shape.points
  if (shape.kind === 'line') {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!, [bx, by] = points[i]!, dx = bx - ax, dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (shape.width / 2) ** 2) return true
    }
    return false
  }
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function bounds(shape: Shape) {
  if (shape.kind === 'ring') {
    const r = shape.radius + shape.width / 2
    return [shape.x - r, shape.y - r, shape.x + r, shape.y + r] as const
  }
  const r = shape.kind === 'line' ? shape.width / 2 : 0
  return [Math.min(...shape.points.map(p => p[0])) - r, Math.min(...shape.points.map(p => p[1])) - r,
    Math.max(...shape.points.map(p => p[0])) + r, Math.max(...shape.points.map(p => p[1])) + r] as const
}

function dilate(source: Float32Array, width: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length), out = new Float32Array(source.length)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    let value = 0
    for (let offset = -radius; offset <= radius; offset++) if (x + offset >= 0 && x + offset < width) value = Math.max(value, source[y * width + x + offset]!)
    horizontal[y * width + x] = value
  }
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    let value = 0
    for (let offset = -radius; offset <= radius; offset++) if (y + offset >= 0 && y + offset < width) value = Math.max(value, horizontal[(y + offset) * width + x]!)
    out[y * width + x] = value
  }
  return out
}

/** Three sliding box passes approximate a Gaussian without quadratic blur cost. */
function blur(source: Float32Array, width: number, sigma: number): Float32Array {
  const ideal = Math.sqrt(4 * sigma * sigma + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) lower--
  lower = Math.max(1, lower)
  const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4))
  let current = source
  for (let pass = 0; pass < 3; pass++) {
    const radius = ((pass < count ? lower : lower + 2) - 1) / 2, divisor = radius * 2 + 1
    const horizontal = new Float32Array(source.length), out = new Float32Array(source.length)
    for (let y = 0; y < width; y++) {
      let sum = 0
      for (let x = 0; x <= radius && x < width; x++) sum += current[y * width + x]!
      for (let x = 0; x < width; x++) {
        horizontal[y * width + x] = sum / divisor
        if (x - radius >= 0) sum -= current[y * width + x - radius]!
        if (x + radius + 1 < width) sum += current[y * width + x + radius + 1]!
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = 0; y <= radius && y < width; y++) sum += horizontal[y * width + x]!
      for (let y = 0; y < width; y++) {
        out[y * width + x] = sum / divisor
        if (y - radius >= 0) sum -= horizontal[(y - radius) * width + x]!
        if (y + radius + 1 < width) sum += horizontal[(y + radius + 1) * width + x]!
      }
    }
    current = out
  }
  return current
}

/** DPI scales the pixels; user size scales geometry and the logical hotspot. */
export function rasterizeBrowserCursor(style: Style, scaleFactor = 1, visible = true, cursorScale = 1) {
  if (![1, 1.25, 1.5, 2, 3].includes(scaleFactor)) throw new RangeError('Unsupported cursor image scale')
  const design = browserCursorDesign(style, cursorScale), width = Math.round(design.size * scaleFactor)
  const bitmap = Buffer.alloc(width * width * 4)
  if (!visible) return { bitmap, width, height: width, scaleFactor, hotspot: design.hotspot }
  const body = new Float32Array(bitmap.length), alpha = new Float32Array(width * width)
  const shapes = design.shapes.map(shape => ({ shape, bounds: bounds(shape) }))
  const extent = [Math.min(...shapes.map(s => s.bounds[0])), Math.min(...shapes.map(s => s.bounds[1])),
    Math.max(...shapes.map(s => s.bounds[2])), Math.max(...shapes.map(s => s.bounds[3]))]
  for (let y = Math.max(0, Math.floor(extent[1]! * scaleFactor)); y < Math.min(width, Math.ceil(extent[3]! * scaleFactor)); y++) {
    for (let x = Math.max(0, Math.floor(extent[0]! * scaleFactor)); x < Math.min(width, Math.ceil(extent[2]! * scaleFactor)); x++) {
      const channels = [0, 0, 0, 0]
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = (x + (sx + 0.5) / 4) / scaleFactor, py = (y + (sy + 0.5) / 4) / scaleFactor
        const sample = [0, 0, 0, 0]
        for (const { shape, bounds: [left, top, right, bottom] } of shapes) {
          if (px < left || px > right || py < top || py > bottom || !contains(shape, px, py)) continue
          const a = shape.color[3] / 255
          for (let channel = 0; channel < 3; channel++) sample[channel] = shape.color[2 - channel]! * a + sample[channel]! * (1 - a)
          sample[3] = shape.color[3] + sample[3]! * (1 - a)
        }
        for (let channel = 0; channel < 4; channel++) channels[channel]! += sample[channel]! / 16
      }
      const offset = (y * width + x) * 4
      body.set(channels, offset); alpha[y * width + x] = channels[3]!
    }
  }
  const composed = new Float32Array(bitmap.length)
  for (const glow of design.glow) {
    const mask = blur(dilate(alpha, width, Math.round(glow.spread * scaleFactor)), width, glow.blur * scaleFactor)
    for (let index = 0; index < mask.length; index++) {
      const a = Math.max(0, Math.min(1, mask[index]! * glow.opacity / 255)), offset = index * 4
      for (let channel = 0; channel < 3; channel++) composed[offset + channel] = glow.color[2 - channel]! * a + composed[offset + channel]! * (1 - a)
      composed[offset + 3] = a * 255 + composed[offset + 3]! * (1 - a)
    }
  }
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const remaining = 1 - body[offset + 3]! / 255
    for (let channel = 0; channel < 4; channel++) bitmap[offset + channel] = Math.round(body[offset + channel]! + composed[offset + channel]! * remaining)
  }
  return { bitmap, width, height: width, scaleFactor, hotspot: design.hotspot }
}

const images = new Map<string, { image: NativeImage; hotspot: Point }>()
export async function createBrowserCursorImage(style: Style, visible: boolean, cursorScale = 1): Promise<{ image: NativeImage; hotspot: Point }> {
  browserCursorDesign(style, cursorScale)
  const key = `${style}:${visible}:${cursorScale}`, cached = images.get(key)
  if (cached) { images.delete(key); images.set(key, cached); return cached }
  const { nativeImage } = await import('electron')
  const variants = [1, 1.25, 1.5, 2, 3].map(scale => rasterizeBrowserCursor(style, scale, visible, cursorScale))
  const primary = variants[0]!
  const image = nativeImage.createFromBitmap(primary.bitmap, { width: primary.width, height: primary.height, scaleFactor: 1 })
  for (const variant of variants.slice(1)) {
    const representation = nativeImage.createFromBitmap(variant.bitmap, { width: variant.width, height: variant.height, scaleFactor: variant.scaleFactor })
    image.addRepresentation({ scaleFactor: variant.scaleFactor, buffer: representation.toPNG({ scaleFactor: variant.scaleFactor }) })
  }
  const result = { image, hotspot: primary.hotspot }
  images.set(key, result)
  if (images.size > 16) images.delete(images.keys().next().value!)
  return result
}
