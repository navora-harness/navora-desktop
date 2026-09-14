/**
 * Trusted pointer input (CDP-aligned). Prefer dispatchMouseEvent when available.
 * Wheel: positive deltaY = scroll down (DOM/CDP); Electron sendInputEvent inverts.
 */
import type { WebContents } from 'electron'

export type TrustedPointerAction = 'down' | 'move' | 'up' | 'wheel'

export type TrustedPointerOpts = {
  action: TrustedPointerAction
  x: number
  y: number
  deltaY?: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
  buttons?: number
}

type WcWithDispatch = WebContents & {
  dispatchMouseEvent: (e: Electron.MouseEvent) => Promise<void>
}

function hasDispatchMouse(wc: WebContents): boolean {
  return typeof (wc as WcWithDispatch).dispatchMouseEvent === 'function'
}

function clampInt(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

export async function dispatchTrustedWheelOnce(
  wc: WebContents,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  const dy = clampInt(deltaY)
  if (dy === 0) return
  if (hasDispatchMouse(wc)) {
    await (wc as WcWithDispatch).dispatchMouseEvent({
      type: 'mouseWheel',
      x: clampInt(x),
      y: clampInt(y),
      deltaX: 0,
      deltaY: dy,
    })
    return
  }
  wc.sendInputEvent({
    type: 'mouseWheel',
    x: clampInt(x),
    y: clampInt(y),
    deltaX: 0,
    deltaY: -dy,
    canScroll: true,
  } as Electron.MouseWheelInputEvent)
}

export async function dispatchTrustedPointer(
  wc: WebContents,
  opts: TrustedPointerOpts,
): Promise<void> {
  const x = clampInt(opts.x)
  const y = clampInt(opts.y)
  const button = opts.button || 'left'
  const clickCount = opts.clickCount ?? 1
  const action = opts.action

  if (action === 'wheel') {
    await dispatchTrustedWheelOnce(wc, x, y, Number(opts.deltaY) || 120)
    return
  }

  if (hasDispatchMouse(wc)) {
    const dispatch = (wc as WcWithDispatch).dispatchMouseEvent.bind(wc)
    if (action === 'down') {
      await dispatch({
        type: 'mousePressed',
        x,
        y,
        button,
        clickCount,
        buttons: opts.buttons ?? 1,
      })
      return
    }
    if (action === 'up') {
      await dispatch({
        type: 'mouseReleased',
        x,
        y,
        button,
        clickCount,
        buttons: opts.buttons ?? 0,
      })
      return
    }
    await dispatch({
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: opts.buttons ?? 0,
    })
    return
  }

  if (action === 'down') {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount })
  } else if (action === 'up') {
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount })
  } else {
    wc.sendInputEvent({ type: 'mouseMove', x, y })
  }
}
