import type { NativeImage, Point } from 'electron'
import {browserCursorDesign,type BrowserCursorStyle as Style,type BrowserCursorColor as Color,type BrowserCursorShape as Shape} from '../../shared/browser-cursor'
export {browserCursorDesign,browserCursorSvg} from '../../shared/browser-cursor'


function contains(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'rect') return x >= shape.x && x < shape.x + shape.width && y >= shape.y && y < shape.y + shape.height
  if (shape.kind === 'ring') return Math.abs(Math.hypot(x - shape.x, y - shape.y) - shape.radius) <= shape.width / 2
  let inside = false
  const points = shape.points
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Electron's bitmap representation is premultiplied BGRA on Windows/Linux. */
export function rasterizeBrowserCursor(style: Style, scaleFactor = 1, visible = true) {
  if (![1, 1.25, 1.5, 2, 3].includes(scaleFactor)) throw new RangeError('Unsupported cursor image scale')
  const design = browserCursorDesign(style), width = Math.round(design.size * scaleFactor)
  const bitmap = Buffer.alloc(width * width * 4)
  if (visible) for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const channels = [0, 0, 0, 0]
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / scaleFactor, py = (y + (sy + .5) / 4) / scaleFactor
      let color: Color | undefined
      for (const shape of design.shapes) if (contains(shape, px, py)) color = shape.color
      if (color) { channels[0]! += color[2]; channels[1]! += color[1]; channels[2]! += color[0]; channels[3]! += color[3] }
    }
    const offset = (y * width + x) * 4
    for (let channel = 0; channel < 4; channel++) bitmap[offset + channel] = Math.round(channels[channel]! / 16)
  }
  return { bitmap, width, height: width, scaleFactor, hotspot: design.hotspot }
}


const images = new Map<string, { image: NativeImage; hotspot: Point }>()
export async function createBrowserCursorImage(style: Style, visible: boolean): Promise<{ image: NativeImage; hotspot: Point }> {
  const key = `${style}:${visible}`
  const cached = images.get(key)
  if (cached) return cached
  const { nativeImage } = await import('electron')
  const variants = [1, 1.25, 1.5, 2, 3].map(scale => rasterizeBrowserCursor(style, scale, visible))
  const primary = variants[0]!
  const image = nativeImage.createFromBitmap(primary.bitmap, { width: primary.width, height: primary.height, scaleFactor: 1 })
  for (const variant of variants.slice(1)) {
    const representation = nativeImage.createFromBitmap(variant.bitmap, { width: variant.width, height: variant.height, scaleFactor: variant.scaleFactor })
    image.addRepresentation({ scaleFactor: variant.scaleFactor, buffer: representation.toPNG({ scaleFactor: variant.scaleFactor }) })
  }
  const result = { image, hotspot: primary.hotspot }
  images.set(key, result)
  return result
}
