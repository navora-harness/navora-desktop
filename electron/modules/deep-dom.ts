/**
 * unofficial Electron DOM helpers (querySelectorDeep / pierce closed shadow roots).
 * Pierces closed author shadow roots without debugger.attach().
 */
import type { WebContents } from 'electron'
import { withBrowserPointerInput } from './browser-automation-controller'
import { NATIVE_TARGET_KEYS } from '../../shared/browser-native-target'

export type DeepDomInfo = {
  backendNodeId: number
  tagName: string
  x: number
  y: number
  width: number
  height: number
  target?: Electron.AgentTarget
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
  clickElement?: (
    options: {
      selector: string
      button?: string
      clickCount?: number
      modifiers?: number
      pierce?: boolean
      scrollIntoView?: boolean
    },
  ) => Promise<Electron.AgentDispatchResult>
}

export function hasQuerySelectorDeep(wc: WebContents): boolean {
  return typeof (wc as WcDeep).querySelectorDeep === 'function'
}

export function hasQuerySelectorAcrossDocuments(wc: WebContents): boolean {
  return typeof wc.querySelectorAcrossDocuments === 'function'
}

export async function querySelectorAcrossDocuments(
  wc: WebContents,
  selector: string,
  opts?: { pierce?: boolean; scrollIntoView?: boolean },
): Promise<DeepDomInfo | null> {
  if (!hasQuerySelectorAcrossDocuments(wc)) return null
  const info = await wc.querySelectorAcrossDocuments(selector, {
    pierce: opts?.pierce !== false,
    scrollIntoView: Boolean(opts?.scrollIntoView),
  })
  if (!info) return null
  return {backendNodeId:info.backendNodeId,tagName:info.tagName,x:info.x,y:info.y,width:info.width,height:info.height,...(info.target?{target:{...info.target}}:{})}
}

/** Preserve the former agentInfo mode's first cross-document match and coverage. */
export async function queryAcrossDocumentsAgentSnapshot(
  wc: WebContents, selector: string, opts?: {pierce?: boolean; scrollIntoView?: boolean},
): Promise<Electron.AgentSnapshot> {
  const info = await querySelectorAcrossDocuments(wc, selector, opts)
  // A frame-hop selector is not a CSS selector within an individual document.
  const snapshot = await wc.getAgentSnapshot({pierce:opts?.pierce !== false,maxNodes:5000,maxFrames:1000,timeoutMs:5000})
  const elements = info?.target ? snapshot.elements.filter(element =>
    NATIVE_TARGET_KEYS.every(key => element.target[key] === info.target![key])).slice(0,1) : []
  return {...snapshot,elements}
}

export function hasClickElement(wc: WebContents): boolean {
  return typeof (wc as WcDeep).clickElement === 'function'
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

/** Keep the native receipt: a partial click must never become success or a fallback. */
export async function clickElementBySelector(
  wc: WebContents,
  selector: string,
  opts?: {
    button?: 'left' | 'middle' | 'right' | 'back' | 'forward'
    clickCount?: number
    modifiers?: number
    pierce?: boolean
    scrollIntoView?: boolean
  },
): Promise<Electron.AgentDispatchResult | null> {
  const api = wc as WcDeep
  if (typeof api.clickElement !== 'function') return null
  return withBrowserPointerInput(wc, () => api.clickElement!({
    selector,
    button: opts?.button || 'left',
    clickCount: opts?.clickCount ?? 1,
    ...(opts?.modifiers === undefined ? {} : {modifiers:opts.modifiers}),
    pierce: opts?.pierce !== false,
    scrollIntoView: opts?.scrollIntoView !== false,
  }), result => result.status === 'dispatched' && !result.deliveryWarning)
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
