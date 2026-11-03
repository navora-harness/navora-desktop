import type {BrowserAutomationConfig} from './browser-automation'

export type BrowserCursorStyle = BrowserAutomationConfig['cursor_style']
export type BrowserCursorColor = readonly [number, number, number, number]
export type BrowserCursorShape = { color: BrowserCursorColor } & (
  | { kind: 'polygon'; points: readonly (readonly [number, number])[] }
  | { kind: 'ring'; x: number; y: number; radius: number; width: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
)
const ink: BrowserCursorColor = [25, 45, 64, 255], white: BrowserCursorColor = [255, 255, 255, 255], blue: BrowserCursorColor = [38, 130, 191, 255]
const polygon = (color: BrowserCursorColor, points: readonly (readonly [number, number])[]): BrowserCursorShape => ({ kind: 'polygon', color, points })
const ring = (color: BrowserCursorColor, x: number, y: number, radius: number, width: number): BrowserCursorShape => ({ kind: 'ring', color, x, y, radius, width })
const rect = (color: BrowserCursorColor, x: number, y: number, width: number, height: number): BrowserCursorShape => ({ kind: 'rect', color, x, y, width, height })

/** One logical geometry supplies both SVG source and antialiased native pixels. */
export function browserCursorDesign(style: BrowserCursorStyle): { size: number; hotspot: {x:number;y:number}; shapes: BrowserCursorShape[] } {
  if (style === 'focus-ring') return { size: 24, hotspot: { x: 12, y: 12 }, shapes: [
    ring(ink, 12, 12, 8, 4), ring(white, 12, 12, 8, 2.8), ring(blue, 12, 12, 8, 1.5),
    ring(ink, 12, 12, 0, 5), ring(white, 12, 12, 0, 3.5), ring(blue, 12, 12, 0, 2),
  ] }
  if (style === 'precision-cross') return { size: 28, hotspot: { x: 14, y: 14 }, shapes: [
    ...[[12, 2, 4, 8], [12, 18, 4, 8], [2, 12, 8, 4], [18, 12, 8, 4]].map(([x, y, width, height]) => rect(ink, x!, y!, width!, height!)),
    ...[[13, 3, 2, 6], [13, 19, 2, 6], [3, 13, 6, 2], [19, 13, 6, 2]].map(([x, y, width, height]) => rect(white, x!, y!, width!, height!)),
    rect(blue, 13.6, 3, .8, 6), rect(blue, 13.6, 19, .8, 6), rect(blue, 3, 13.6, 6, .8), rect(blue, 19, 13.6, 6, .8),
    ring(ink, 14, 14, 0, 3.5), ring(white, 14, 14, 0, 2.5), ring(blue, 14, 14, 0, 1.5),
  ] }
  return { size: 32, hotspot: { x: 4, y: 3 }, shapes: [
    polygon(ink, [[3, 1.5], [27, 16], [16.5, 18.5], [21.5, 28], [15.5, 31], [10.5, 21.5], [3, 29]]),
    polygon(white, [[4, 3], [24.5, 15.5], [14.5, 17.3], [19.6, 27.4], [16.1, 29], [11, 19], [4, 25.7]]),
    polygon(blue, [[5, 5], [21.5, 15], [12.8, 16.5], [18.2, 26.8], [16.7, 27.5], [11.4, 17], [5, 23.2]]),
  ] }
}


export function browserCursorSvg(style: BrowserCursorStyle): string {
  const { size, shapes } = browserCursorDesign(style)
  const markup = shapes.map(shape => {
    const color = `rgb(${shape.color.slice(0, 3).join(',')})`
    if (shape.kind === 'polygon') return `<polygon fill="${color}" points="${shape.points.map(point => point.join(',')).join(' ')}"/>`
    if (shape.kind === 'rect') return `<rect fill="${color}" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`
    return shape.radius === 0 ? `<circle fill="${color}" cx="${shape.x}" cy="${shape.y}" r="${shape.width / 2}"/>`
      : `<circle fill="none" stroke="${color}" stroke-width="${shape.width}" cx="${shape.x}" cy="${shape.y}" r="${shape.radius}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${markup}</svg>`
}

