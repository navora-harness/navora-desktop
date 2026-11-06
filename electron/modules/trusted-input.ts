/** Trusted pointer input. Wheel delta follows DOM/CDP; sendInputEvent reverses it. */
import type { WebContents } from 'electron'
import { invalidatePointerMotion } from './pointer-motion'
import { assertBrowserInputCurrent, commitTrustedInput, currentBrowserInputOperation } from './browser-input-context'
import { getBrowserAutomationController, withBrowserPointerInput, type BrowserAutomationOperation } from './browser-automation-controller'

export type TrustedPointerAction = 'down' | 'move' | 'up' | 'wheel'
type Button = 'left' | 'middle' | 'right'
export type TrustedPointerOpts = {
  action: TrustedPointerAction
  x: number
  y: number
  deltaY?: number
  button?: Button
  clickCount?: number
  buttons?: number
}
type Held = { owner?: BrowserAutomationOperation; documentEpoch: number; x: number; y: number; forget: () => void; release: () => Promise<void> }
const held = new WeakMap<WebContents, Map<Button, Held>>()
const bits = { left: 1, right: 2, middle: 4 }
function heldMask(wc: WebContents, exclude?: Button): number {
  let mask = 0
  for (const button of held.get(wc)?.keys() ?? []) if (button !== exclude) mask |= bits[button]
  return mask
}

function clampInt(n: number, fallback = 0): number { return Number.isFinite(n) ? Math.round(n) : fallback }

async function rawPointer(wc: WebContents, opts: TrustedPointerOpts): Promise<void> {
  if (wc.isDestroyed()) throw new Error('browser_page_destroyed')
  const x = clampInt(opts.x), y = clampInt(opts.y), button = opts.button ?? 'left'
  const api = wc as unknown as { dispatchMouseEvent?: (event: Electron.AutomationMouseEvent) => Promise<Electron.AgentDispatchResult> }
  if (typeof api.dispatchMouseEvent === 'function') {
    const type = opts.action === 'down' ? 'mousePressed' : opts.action === 'up' ? 'mouseReleased' : opts.action === 'wheel' ? 'mouseWheel' : 'mouseMoved'
    const result = await withBrowserPointerInput(wc, () => api.dispatchMouseEvent!({
      type, position: { x, y }, button: opts.action === 'down' || opts.action === 'up' ? button : 'none',
      buttons: opts.buttons ?? (opts.action === 'down' ? bits[button] : 0),
      ...(opts.action === 'down' || opts.action === 'up' ? { clickCount: opts.clickCount ?? 1 } : {}),
      ...(opts.action === 'wheel' ? { deltaX: 0, deltaY: clampInt(opts.deltaY ?? 0) } : {}),
    }), result => result.status === 'dispatched' && !result.deliveryWarning)
    currentBrowserInputOperation(wc)?.noteResult(result)
    if (result?.status !== 'dispatched') {
      throw new Error(result?.reason || 'pointer_dispatch_failed')
    }
    return
  }
  if (opts.action === 'wheel') {
    wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -clampInt(opts.deltaY ?? 0), canScroll: true } as Electron.MouseWheelInputEvent)
  } else if (opts.action === 'down' || opts.action === 'up') {
    wc.sendInputEvent({ type: opts.action === 'down' ? 'mouseDown' : 'mouseUp', x, y, button, clickCount: opts.clickCount ?? 1 })
  } else wc.sendInputEvent({ type: 'mouseMove', x, y })
}

function trackPress(wc: WebContents, opts: TrustedPointerOpts): Held {
  const button = opts.button ?? 'left'
  const buttons = held.get(wc) ?? new Map<Button, Held>()
  const documentEpoch = getBrowserAutomationController(wc).captureDocumentEpoch()
  // A replacement document cannot receive releases belonging to its predecessor.
  for (const entry of buttons.values()) if (entry.documentEpoch !== documentEpoch) entry.forget()
  if (buttons.has(button)) throw new Error('pointer_button_already_held')
  const owner = currentBrowserInputOperation(wc)
  let pending: Promise<void> | undefined
  let unregister: (() => void) | undefined
  const entry: Held = {
    owner, documentEpoch, x: opts.x, y: opts.y,
    forget: () => {
      if (buttons.get(button) === entry) buttons.delete(button)
      if (!buttons.size) held.delete(wc)
      unregister?.()
    },
    // Cleanup deliberately bypasses the cancelled operation's assertCurrent.
    release: () => pending ??= (async () => {
      if (getBrowserAutomationController(wc).captureDocumentEpoch() !== documentEpoch) {
        entry.forget()
        throw new Error('browser_document_changed_during_pointer_cleanup')
      }
      await rawPointer(wc, { ...opts, x: entry.x, y: entry.y, action: 'up', buttons: heldMask(wc, button) })
      entry.forget()
    })(),
  }
  const resetCoversInput = typeof wc.dispatchMouseEvent === 'function'
  unregister = owner?.registerCleanup(async context => {
    if(context?.nativeResetConfirmed&&resetCoversInput){entry.forget();return}
    await entry.release()
  })
  buttons.set(button, entry); held.set(wc, buttons)
  return entry
}

export async function dispatchTrustedWheelOnce(wc: WebContents, x: number, y: number, deltaY: number): Promise<void> {
  assertBrowserInputCurrent(wc)
  invalidatePointerMotion(wc)
  const dy = clampInt(deltaY)
  if (dy) await commitTrustedInput(wc, () => rawPointer(wc, { action: 'wheel', x, y, deltaY: dy }))
}

export async function dispatchTrustedPointer(wc: WebContents, opts: TrustedPointerOpts): Promise<void> {
  assertBrowserInputCurrent(wc)
  invalidatePointerMotion(wc)
  if (opts.action === 'wheel') return dispatchTrustedWheelOnce(wc, opts.x, opts.y, Number(opts.deltaY) || 120)
  if (opts.action === 'down') {
    trackPress(wc, opts)
    await commitTrustedInput(wc, () => rawPointer(wc, { ...opts, buttons: opts.buttons ?? heldMask(wc) }))
  } else if (opts.action === 'up') {
    const entry = held.get(wc)?.get(opts.button ?? 'left')
    if (entry && entry.owner !== currentBrowserInputOperation(wc)) throw new Error('pointer_button_owned_by_another_operation')
    if (entry) { entry.x = opts.x; entry.y = opts.y }
    await commitTrustedInput(wc, () => entry ? entry.release() : rawPointer(wc, opts))
  } else {
    for (const entry of held.get(wc)?.values() ?? []) if (entry.owner === currentBrowserInputOperation(wc)) { entry.x = opts.x; entry.y = opts.y }
    await commitTrustedInput(wc, () => rawPointer(wc, { ...opts, buttons: opts.buttons ?? heldMask(wc) }))
  }
}

/** Legacy fallback with a tracked release even if cancellation arrives after the press. */
export async function dispatchTrustedClick(wc: WebContents, x: number, y: number): Promise<void> {
  await dispatchTrustedPointer(wc, { action: 'move', x, y })
  assertBrowserInputCurrent(wc)
  let press: Held | undefined
  try {
    await dispatchTrustedPointer(wc, { action: 'down', x, y })
    press = held.get(wc)?.get('left')
    assertBrowserInputCurrent(wc)
    await dispatchTrustedPointer(wc, { action: 'up', x, y })
  } finally {
    press ??= held.get(wc)?.get('left')
    // Managed cleanup waits for any reset barrier and knows whether native reset
    // already released this press. Only unowned callers need this local finally.
    if (press && !press.owner) await press.release()
  }
}
