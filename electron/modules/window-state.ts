import fs from 'node:fs'
import path from 'node:path'
import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { ensureDir } from '../data-root'

export type MainWindowState = {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

const DEFAULT_STATE: MainWindowState = {
  width: 1280,
  height: 840,
}

function fileOf(dataRoot: string): string {
  return path.join(dataRoot, 'window-state.json')
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1100, Math.round(width)),
    height: Math.max(720, Math.round(height)),
  }
}

/** Keep restored bounds on a visible display. */
export function sanitizeWindowState(raw: Partial<MainWindowState> | null | undefined): MainWindowState {
  const size = clampSize(raw?.width ?? DEFAULT_STATE.width, raw?.height ?? DEFAULT_STATE.height)
  const maximized = raw?.maximized === true
  if (!isFiniteNumber(raw?.x) || !isFiniteNumber(raw?.y)) {
    return { ...size, maximized }
  }

  const bounds: Rectangle = {
    x: Math.round(raw!.x!),
    y: Math.round(raw!.y!),
    width: size.width,
    height: size.height,
  }
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const a = d.workArea
    const overlapW = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)
    const overlapH = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y)
    return overlapW > 80 && overlapH > 80
  })
  if (!visible) return { ...size, maximized }
  return { ...bounds, maximized }
}

export function loadWindowState(dataRoot: string): MainWindowState {
  try {
    const f = fileOf(dataRoot)
    if (!fs.existsSync(f)) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<MainWindowState>
    return sanitizeWindowState(parsed)
  } catch (e) {
    console.warn('[window-state] load failed', e)
    return { ...DEFAULT_STATE }
  }
}

export function saveWindowState(dataRoot: string, state: MainWindowState): void {
  try {
    ensureDir(dataRoot)
    const next = sanitizeWindowState(state)
    fs.writeFileSync(fileOf(dataRoot), JSON.stringify(next, null, 2), 'utf8')
  } catch (e) {
    console.warn('[window-state] save failed', e)
  }
}

export function captureWindowState(win: BrowserWindow): MainWindowState {
  const maximized = win.isMaximized()
  const bounds = maximized ? win.getNormalBounds() : win.getBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized,
  }
}

/** Persist size/position while the window is open (debounced). */
export function trackWindowState(win: BrowserWindow, dataRoot: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    saveWindowState(dataRoot, captureWindowState(win))
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 250)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })
}
