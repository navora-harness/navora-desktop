import type { BrowserAutomationConfig } from './browser-automation'

export type BrowserCursorStyle = BrowserAutomationConfig['cursor_style']
export type BrowserCursorColor = readonly [number, number, number, number]
type Point = readonly [number, number]
export type BrowserCursorShape = { color: BrowserCursorColor } & (
  | { kind: 'polygon'; points: readonly Point[] }
  | { kind: 'line'; points: readonly Point[]; width: number }
  | { kind: 'ring'; x: number; y: number; radius: number; width: number }
)
export type BrowserCursorDesign = {
  size: number
  hotspot: { x: number; y: number }
  shapes: BrowserCursorShape[]
  glow: { spread: number; blur: number; opacity: number; color: BrowserCursorColor }[]
}

export const BROWSER_CURSOR_OPTIONS = [
  { id: 'windows-glow', name: 'Windows 蓝光', description: '默认指针，宽幅蓝光方便追踪。' },
  { id: 'navora-arrow', name: '棱镜箭头', description: '蓝色折面与霓虹描边。' },
  { id: 'focus-ring', name: 'HUD 准星', description: '分段仪表，中心圆点定位。' },
  { id: 'precision-cross', name: '战术十字', description: '切角准星，中心晶核定位。' },
  { id: 'ice-arrow', name: '电弧箭头', description: '冰蓝轮廓与悬空切线。' },
  { id: 'diamond', name: '晶体定位', description: '菱形晶核与四角定位框。' },
  { id: 'laser', name: '蓝色信标', description: '明亮光点与环形刻度。' },
  { id: 'windows-standard', name: 'Windows 原形', description: '经典箭头轮廓，关闭发光。' },
] as const satisfies readonly { id: BrowserCursorStyle; name: string; description: string }[]

const color = (hex: string): BrowserCursorColor => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255]
const polygon = (hex: string, points: readonly Point[]): BrowserCursorShape => ({ kind: 'polygon', color: color(hex), points })
const line = (hex: string, width: number, points: readonly Point[]): BrowserCursorShape => ({ kind: 'line', color: color(hex), width, points })
const circle = (hex: string, x: number, y: number, radius: number): BrowserCursorShape => ({ kind: 'ring', color: color(hex), x, y, radius: 0, width: radius * 2 })
const arc = (hex: string, width: number, radius: number, start: number, end: number): BrowserCursorShape => {
  const steps = Math.ceil((end - start) / 8)
  return line(hex, width, Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (start + (end - start) * i / steps) * Math.PI / 180
    return [16 + radius * Math.cos(angle), 16 + radius * Math.sin(angle)] as Point
  }))
}

/** One geometry supplies both the settings SVG and native premultiplied pixels. */
export function browserCursorDesign(style: BrowserCursorStyle, scale = 1): BrowserCursorDesign {
  if (!Number.isFinite(scale) || scale < 0.75 || scale > 2) throw new RangeError('Cursor size must be between 75% and 200%')
  let hotspot = { x: 16, y: 16 }
  const shapes: BrowserCursorShape[] = []
  const outline = (hex: string, width: number, points: readonly Point[]) => {
    shapes.push(line(hex, width, [...points, points[0]!]))
  }
  if (style === 'windows-glow' || style === 'windows-standard') {
    hotspot = { x: 4, y: 2 }
    const arrow: Point[] = [[4, 2], [4, 25.5], [9.6, 20.3], [14.5, 30], [18.8, 27.8], [14, 18.4], [22.5, 18.4]]
    shapes.push(polygon('ffffff', arrow))
    outline('101820', 1.1, arrow)
  } else if (style === 'navora-arrow') {
    hotspot = { x: 3, y: 2 }
    const arrow: Point[] = [[3, 2], [28, 14.5], [18.3, 18.8], [15, 30]]
    shapes.push(polygon('0b1733', arrow))
    outline('5cefff', 1.25, arrow)
    shapes.push(polygon('3576f4', [[4.4, 4.1], [13, 14.2], [15, 27.6], [5.2, 7]]), polygon('173b6b', [[4.4, 4.1], [25.2, 14.2], [13, 14.2]]),
      line('e8ffff', 1, [[3.8, 3.3], [13, 14.2], [15, 27.8]]), line('ff56cf', 1.7, [[18.4, 18.7], [15.2, 29]]))
  } else if (style === 'focus-ring') {
    shapes.push(circle('08182ad9', 16, 16, 10.7))
    for (const [start, end] of [[8, 70], [100, 160], [190, 250], [280, 340]]) shapes.push(arc('06202d', 3.2, 11.6, start!, end!), arc('45e9ff', 1.4, 11.6, start!, end!))
    shapes.push(line('65b9ff', 1.4, [[3.5, 10], [3.5, 6.5], [7, 3], [11, 3]]), line('65b9ff', 1.4, [[21, 29], [25, 29], [28.5, 25.5], [28.5, 22]]),
      line('ff61c8', 1.8, [[16, 1], [16, 5]]), line('7ceaff', 1.1, [[16, 27], [16, 31]]))
    for (const points of [[[11, 16], [13, 16]], [[19, 16], [21, 16]], [[16, 11], [16, 13]], [[16, 19], [16, 21]]] as const) shapes.push(line('8fefff', 1, points))
    shapes.push(circle('ffffff', 16, 16, 1.5))
  } else if (style === 'precision-cross') {
    const arms: Point[][] = [
      [[13, 3], [16, 0], [19, 3], [19, 10], [16, 8], [13, 10]],
      [[22, 13], [29, 13], [32, 16], [29, 19], [22, 19], [24, 16]],
      [[13, 22], [16, 24], [19, 22], [19, 29], [16, 32], [13, 29]],
      [[0, 16], [3, 13], [10, 13], [8, 16], [10, 19], [3, 19]],
    ]
    for (const arm of arms) { shapes.push(polygon('10213c', arm)); outline('57ddff', 0.9, arm) }
    shapes.push(line('f0ffff', 1.2, [[16, 2], [16, 7]]), line('edffff', 1.2, [[25, 16], [30, 16]]), line('487bff', 1.6, [[16, 25], [16, 30]]),
      line('ed65d0', 1.2, [[2, 16], [7, 16]]), polygon('b9faff', [[16, 13], [19, 16], [16, 19], [13, 16]]), circle('ffffff', 16, 16, 0.75))
  } else if (style === 'ice-arrow') {
    hotspot = { x: 4, y: 2 }
    const arrow: Point[] = [[4, 2], [27, 17], [16.3, 18.5], [21.4, 28], [16.7, 30.5], [11.5, 21], [4, 28]]
    shapes.push(polygon('0a2338', arrow)); outline('68edff', 1.1, arrow)
    shapes.push(polygon('c5f5ff', [[6, 6], [22.5, 16], [13.7, 17.2], [18.8, 27], [17.4, 27.6], [11.7, 17.5], [6, 23]]),
      line('3b8bff', 1.3, [[1, 8], [1, 19]]), line('fc59ca', 1.3, [[25, 24], [28, 27]]))
  } else if (style === 'diamond') {
    const corners: Point[][] = [[[4, 12], [4, 8], [8, 4], [12, 4]], [[20, 4], [24, 4], [28, 8], [28, 12]], [[28, 20], [28, 24], [24, 28], [20, 28]], [[12, 28], [8, 28], [4, 24], [4, 20]]]
    for (const points of corners) shapes.push(line('0d2442', 3.2, points), line('5feaff', 1.3, points))
    const diamond: Point[] = [[16, 8], [24, 16], [16, 24], [8, 16]]
    shapes.push(polygon('102744', diamond)); outline('81efff', 1.1, diamond)
    shapes.push(polygon('7fdaff', [[16, 9.3], [22.3, 16], [16, 16]]), polygon('417cf7', [[16, 16], [16, 22.3], [9.7, 16]]), line('f273d5', 1.7, [[25, 25], [28, 22]]), circle('ffffff', 16, 16, 1.1))
  } else {
    shapes.push(circle('10213bc0', 16, 16, 9.6), { kind: 'ring', color: color('267bce'), x: 16, y: 16, radius: 9.6, width: 1 },
      arc('b5fbff', 1.6, 10, 225, 315), arc('f166ce', 1.5, 10, 45, 110), circle('258ef8', 16, 16, 4.4),
      { kind: 'ring', color: color('6eeaff'), x: 16, y: 16, radius: 4.4, width: 1.1 }, circle('ffffff', 16, 16, 1.8))
    for (const points of [[[16, 1], [16, 3]], [[29, 16], [31, 16]], [[16, 29], [16, 31]], [[1, 16], [3, 16]]] as const) shapes.push(line('5be9ff', 1.2, points))
  }
  const coordinate = (value: number) => (24 + value) * scale
  return {
    size: 80 * scale, hotspot: { x: Math.round(coordinate(hotspot.x)), y: Math.round(coordinate(hotspot.y)) },
    shapes: shapes.map(shape => shape.kind === 'ring'
      ? { ...shape, x: coordinate(shape.x), y: coordinate(shape.y), radius: shape.radius * scale, width: shape.width * scale }
      : { ...shape, points: shape.points.map(([x, y]) => [coordinate(x), coordinate(y)] as Point), ...(shape.kind === 'line' ? { width: shape.width * scale } : {}) }),
    glow: style === 'windows-standard' ? [] : [
      { spread: 3 * scale, blur: 7.8 * scale, opacity: 1.35, color: color('1c72ff') },
      { spread: 2 * scale, blur: 4.2 * scale, opacity: 0.85, color: color('2889ff') },
      { spread: 0.7 * scale, blur: 1.1 * scale, opacity: 0.72, color: color('40afff') },
    ],
  }
}

export function browserCursorSvg(style: BrowserCursorStyle, scale = 1): string {
  const { size, shapes, glow } = browserCursorDesign(style, scale)
  const markup = shapes.map(shape => {
    const color = `rgb(${shape.color.slice(0, 3).join(',')})`, opacity = shape.color[3] / 255
    if (shape.kind === 'polygon') return `<polygon fill="${color}" fill-opacity="${opacity}" points="${shape.points.map(point => point.join(',')).join(' ')}"/>`
    if (shape.kind === 'line') return `<polyline fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round" points="${shape.points.map(point => point.join(',')).join(' ')}"/>`
    return shape.radius === 0 ? `<circle fill="${color}" fill-opacity="${opacity}" cx="${shape.x}" cy="${shape.y}" r="${shape.width / 2}"/>`
      : `<circle fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${shape.width}" cx="${shape.x}" cy="${shape.y}" r="${shape.radius}"/>`
  }).join('')
  const filters = glow.map((layer, i) => `<filter id="glow-${i}" filterUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${layer.spread}"/><feGaussianBlur stdDeviation="${layer.blur}"/><feComponentTransfer result="halo"><feFuncA type="linear" slope="${layer.opacity}"/></feComponentTransfer><feFlood flood-color="rgb(${layer.color.slice(0, 3).join(',')})"/><feComposite operator="in" in2="halo"/></filter>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><g id="body">${markup}</g>${filters}</defs>${glow.map((_, i) => `<use href="#body" filter="url(#glow-${i})"/>`).join('')}<use href="#body"/></svg>`
}
