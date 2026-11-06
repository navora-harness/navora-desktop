import type { WebContents } from 'electron'
import { getBrowserAutomationController, withBrowserPointerInput, type BrowserAutomationOperation } from './browser-automation-controller'
import { assertBrowserInputCurrent, commitTrustedInput, currentBrowserInputOperation } from './browser-input-context'

type Press = { target: Electron.AgentTarget; offset?: Electron.Point; unregister: () => void }
const mousePresses = new WeakMap<BrowserAutomationOperation, Map<string, Press>>()
const touches = new WeakMap<BrowserAutomationOperation, () => void>()
const targetKey = (target: Electron.AgentTarget, button: string) => `${target.processId}:${target.routingId}:${target.documentId}:${target.backendNodeId}:${button}`

/** Legacy target events still have an owned release at the action boundary. */
export async function dispatchOwnedTargetMouse(wc: WebContents, event: Electron.AutomationMouseEvent & { target: Electron.AgentTarget }) {
  assertBrowserInputCurrent(wc)
  const operation = currentBrowserInputOperation(wc)
  const presses = operation ? mousePresses.get(operation) ?? new Map<string, Press>() : undefined
  const key = targetKey(event.target, String(event.button || 'left'))
  if (event.type === 'mousePressed' && operation && presses) {
    if (presses.has(key)) throw new Error('pointer_button_already_held')
    const documentEpoch = operation.documentEpoch
    const press: Press = { target: { ...event.target }, offset: event.offset ? {...event.offset} : undefined, unregister: () => {} }
    press.unregister = operation.registerCleanup(async context => {
      if(context?.nativeResetConfirmed){press.unregister();presses.delete(key);return}
      if (getBrowserAutomationController(wc).captureDocumentEpoch() !== documentEpoch) throw new Error('browser_document_changed_during_pointer_cleanup')
      const result = await wc.dispatchMouseEvent({ ...event, target: press.target, type: 'mouseReleased', offset: press.offset, buttons: 0 })
      operation.noteResult(result)
      if (result.status !== 'dispatched') throw new Error(result.reason || 'pointer_release_failed')
      presses.delete(key)
    })
    presses.set(key, press); mousePresses.set(operation, presses)
  }
  if (event.type === 'mouseMoved') for (const press of presses?.values() ?? []) {
    if (targetKey(press.target, '') === targetKey(event.target, '')) press.offset = event.offset ? {...event.offset} : undefined
  }
  const result = await commitTrustedInput(wc, () => withBrowserPointerInput(wc, () => wc.dispatchMouseEvent(event), result => result.status === 'dispatched' && !result.deliveryWarning))
  if (event.type === 'mouseReleased' && result.status === 'dispatched') { presses?.get(key)?.unregister(); presses?.delete(key) }
  return result
}

export async function dispatchOwnedTargetTouch(wc: WebContents, event: Electron.AutomationTouchEvent & { target: Electron.AgentTarget }) {
  assertBrowserInputCurrent(wc)
  const operation = currentBrowserInputOperation(wc)
  if (event.type === 'touchStart' && operation && !touches.has(operation)) {
    const documentEpoch = operation.documentEpoch
    const unregister = operation.registerCleanup(async context => {
      if(context?.nativeResetConfirmed){touches.get(operation)?.();touches.delete(operation);return}
      if (getBrowserAutomationController(wc).captureDocumentEpoch() !== documentEpoch) throw new Error('browser_document_changed_during_touch_cleanup')
      const result = await wc.dispatchTouchEvent({ target: event.target, type: 'touchCancel', touchPoints: [] })
      operation.noteResult(result)
      if (result.status !== 'dispatched') throw new Error(result.reason || 'touch_release_failed')
      touches.delete(operation)
    })
    touches.set(operation, unregister)
  }
  const result = await commitTrustedInput(wc, () => wc.dispatchTouchEvent(event))
  if ((event.type === 'touchEnd' || event.type === 'touchCancel') && result.status === 'dispatched' && operation) {
    touches.get(operation)?.(); touches.delete(operation)
  }
  return result
}
