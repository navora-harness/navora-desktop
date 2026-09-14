/**
 * unofficial Electron DOM helpers (querySelectorDeep / pierce closed shadow roots).
 * Pierces closed author shadow roots without debugger.attach().
 */
import type { WebContents } from 'electron'

export type DeepDomInfo = {
  backendNodeId: number
  tagName: string
  x: number
  y: number
  width: number
  height: number
}

type WcDeep = WebContents & {
  querySelectorDeep?: (
    selector: string,
    options?: { pierce?: boolean; scrollIntoView?: boolean },
  ) => Promise<DeepDomInfo | null>
  getNodeBoxModel?: (
    backendNodeId: number,
    options?: { scrollIntoView?: boolean },
  ) => Promise<{ backendNodeId: number; x: number; y: number; width: number; height: number } | null>
  clickSelector?: (
    selector: string,
    options?: {
      button?: string
      clickCount?: number
      modifiers?: number
      pierce?: boolean
      scrollIntoView?: boolean
    },
  ) => Promise<void>
}

export function hasQuerySelectorDeep(wc: WebContents): boolean {
  return typeof (wc as WcDeep).querySelectorDeep === 'function'
}

export function hasClickSelector(wc: WebContents): boolean {
  return typeof (wc as WcDeep).clickSelector === 'function'
}

export function hasGetNodeBoxModel(wc: WebContents): boolean {
  return typeof (wc as WcDeep).getNodeBoxModel === 'function'
}

/** Find element (pierces closed shadow by default). */
export async function querySelectorDeep(
  wc: WebContents,
  selector: string,
  opts?: { pierce?: boolean; scrollIntoView?: boolean },
): Promise<DeepDomInfo | null> {
  const api = wc as WcDeep
  if (typeof api.querySelectorDeep !== 'function') return null
  const info = await api.querySelectorDeep(selector, {
    pierce: opts?.pierce !== false,
    scrollIntoView: Boolean(opts?.scrollIntoView),
  })
  if (!info) return null
  return {
    backendNodeId: Number(info.backendNodeId),
    tagName: String(info.tagName || ''),
    x: Number(info.x),
    y: Number(info.y),
    width: Number(info.width),
    height: Number(info.height),
  }
}

export async function getNodeBoxModel(
  wc: WebContents,
  backendNodeId: number,
  opts?: { scrollIntoView?: boolean },
): Promise<{ x: number; y: number; width: number; height: number; backendNodeId: number } | null> {
  const api = wc as WcDeep
  if (typeof api.getNodeBoxModel !== 'function') return null
  const box = await api.getNodeBoxModel(backendNodeId, {
    scrollIntoView: Boolean(opts?.scrollIntoView),
  })
  if (!box) return null
  return {
    backendNodeId: Number(box.backendNodeId),
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
  }
}

/** Trusted click via Blink (pierces closed shadow). Returns false if API missing. */
export async function clickSelector(
  wc: WebContents,
  selector: string,
  opts?: {
    button?: 'left' | 'middle' | 'right' | 'back' | 'forward'
    clickCount?: number
    modifiers?: number
    pierce?: boolean
    scrollIntoView?: boolean
  },
): Promise<boolean> {
  const api = wc as WcDeep
  if (typeof api.clickSelector !== 'function') return false
  await api.clickSelector(selector, {
    button: opts?.button || 'left',
    clickCount: opts?.clickCount ?? 1,
    modifiers: opts?.modifiers ?? 0,
    pierce: opts?.pierce !== false,
    scrollIntoView: opts?.scrollIntoView !== false,
  })
  return true
}

export function centerOf(info: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
} {
  return {
    x: info.x + Math.max(info.width, 1) / 2,
    y: info.y + Math.max(info.height, 1) / 2,
  }
}
