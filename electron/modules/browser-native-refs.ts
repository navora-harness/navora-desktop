import type { WebContents } from 'electron'
import { getBrowserAutomationController } from './browser-automation-controller'

type RefState = { epoch: number; documentEpoch: number; targets: Map<string, Electron.AgentTarget> }
const references = new WeakMap<WebContents, RefState>()
let generation = 0

/** Host-owned refs never let an LLM invent or alter native routing identifiers. */
export function attachBrowserNativeRefs(wc: WebContents, snapshot: Electron.AgentSnapshot) {
  const controller = getBrowserAutomationController(wc)
  const state: RefState = { epoch: controller.captureEpoch(), documentEpoch: controller.captureDocumentEpoch(), targets: new Map() }
  const prefix = `n${++generation}e`
  const elements = snapshot.elements.map((element, index) => {
    const ref = `${prefix}${index + 1}`
    state.targets.set(ref, { ...element.target })
    return { ...element, ref }
  })
  references.set(wc, state)
  return { ...snapshot, elements }
}

/** undefined means legacy ref; null means a stale/unknown native ref. */
export function resolveBrowserNativeRef(wc: WebContents, ref: string): Electron.AgentTarget | null | undefined {
  if (!/^n\d+e\d+$/.test(ref)) return undefined
  const state = references.get(wc)
  const controller = getBrowserAutomationController(wc)
  if (!state || state.epoch !== controller.captureEpoch() || state.documentEpoch !== controller.captureDocumentEpoch()) return null
  const target = state.targets.get(ref)
  return target ? { ...target } : null
}
