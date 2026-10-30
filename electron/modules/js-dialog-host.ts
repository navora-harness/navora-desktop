/**
 * JS alert/confirm/prompt/beforeunload — main-process host.
 * Requires unofficial Electron `setJsDialogHandler` (no page inject, no debugger).
 * CDP fallback removed — Electron without the native API will fail install.
 */
import type { WebContents } from 'electron'

export type JsDialogBackend = 'native'

export type JsDialogPolicy = {
  confirm: boolean
  promptAccept: boolean
  promptText: string
}

export type JsDialogEvent = {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
  defaultPrompt?: string
  url?: string
  ts: number
}

const DEFAULT_POLICY: JsDialogPolicy = {
  confirm: true,
  promptAccept: true,
  promptText: '',
}

const QUEUE_MAX = 50

type NativeWebContents = WebContents & {
  setJsDialogHandler?: (
    handler:
      | ((details: {
          type: string
          message: string
          defaultPrompt?: string
          url?: string
        }) => { accept: boolean; promptText?: string } | null | undefined)
      | null,
  ) => void
  setJsDialogTimeout?: (ms: number) => void
}

type HostState = {
  windowId: string
  wc: WebContents
  policy: JsDialogPolicy
  queue: JsDialogEvent[]
  backend: JsDialogBackend
}

function mapDialogType(raw: string): JsDialogEvent['type'] {
  const t = String(raw || '').toLowerCase()
  if (t === 'confirm') return 'confirm'
  if (t === 'prompt') return 'prompt'
  if (t === 'beforeunload') return 'beforeunload'
  return 'alert'
}

export function supportsNativeJsDialog(wc: WebContents): boolean {
  return typeof (wc as NativeWebContents).setJsDialogHandler === 'function'
}

function decideResponse(
  type: JsDialogEvent['type'],
  policy: JsDialogPolicy,
  defaultPrompt?: string,
): { accept: boolean; promptText?: string } {
  if (type === 'confirm' || type === 'beforeunload') {
    return { accept: !!policy.confirm }
  }
  if (type === 'prompt') {
    const accept = !!policy.promptAccept
    return {
      accept,
      ...(accept
        ? { promptText: String(policy.promptText || defaultPrompt || '') }
        : {}),
    }
  }
  return { accept: true }
}

export class JsDialogHost {
  private byWindow = new Map<string, HostState>()

  /**
   * Bind dialog handling for a window (native only — never attaches debugger).
   */
  install(windowId: string, wc: WebContents): JsDialogBackend {
    const id = String(windowId || '').trim()
    if (!id || !wc || wc.isDestroyed()) {
      throw new Error(`js_dialog_install_failed:${windowId || 'empty'}`)
    }
    const existing = this.byWindow.get(id)
    if (existing) return existing.backend

    if (!supportsNativeJsDialog(wc)) {
      throw new Error(
        'js_dialog_native_required: Electron setJsDialogHandler missing (CDP disabled)',
      )
    }
    return this.installNative(id, wc)
  }

  backend(windowId: string): JsDialogBackend | null {
    return this.byWindow.get(String(windowId || '').trim())?.backend ?? null
  }

  uninstall(windowId: string): void {
    const id = String(windowId || '').trim()
    const st = this.byWindow.get(id)
    if (!st) return
    this.byWindow.delete(id)
    try {
      ;(st.wc as NativeWebContents).setJsDialogHandler?.(null)
    } catch {
      /* ignore */
    }
  }

  setPolicy(windowId: string, patch: Partial<JsDialogPolicy>): JsDialogPolicy {
    const st = this.ensure(windowId)
    if (patch.confirm != null) st.policy.confirm = Boolean(patch.confirm)
    if (patch.promptAccept != null) st.policy.promptAccept = Boolean(patch.promptAccept)
    if (patch.promptText != null) st.policy.promptText = String(patch.promptText)
    return { ...st.policy }
  }

  getPolicy(windowId: string): JsDialogPolicy {
    return { ...(this.byWindow.get(windowId)?.policy || DEFAULT_POLICY) }
  }

  clearQueue(windowId: string): void {
    const st = this.byWindow.get(windowId)
    if (st) st.queue = []
  }

  listQueue(windowId: string, limit = 20): JsDialogEvent[] {
    const st = this.byWindow.get(windowId)
    if (!st) return []
    const n = Math.max(1, Math.min(QUEUE_MAX, limit || 20))
    return st.queue.slice(-n).map((e) => ({ ...e }))
  }

  private ensure(windowId: string): HostState {
    const st = this.byWindow.get(windowId)
    if (!st) throw new Error(`js_dialog_not_installed:${windowId}`)
    return st
  }

  private pushEvent(st: HostState, ev: JsDialogEvent): void {
    st.queue.push(ev)
    if (st.queue.length > QUEUE_MAX) st.queue.splice(0, st.queue.length - QUEUE_MAX)
  }

  private installNative(id: string, wc: WebContents): JsDialogBackend {
    const nwc = wc as NativeWebContents
    const state: HostState = {
      windowId: id,
      wc,
      policy: { ...DEFAULT_POLICY },
      queue: [],
      backend: 'native',
    }
    this.byWindow.set(id, state)

    nwc.setJsDialogTimeout?.(5000)
    nwc.setJsDialogHandler?.((details) => {
      const st = this.byWindow.get(id)
      if (!st || st.wc.isDestroyed()) return { accept: true }

      const type = mapDialogType(String(details?.type || 'alert'))
      const message = String(details?.message ?? '')
      const defaultPrompt =
        details?.defaultPrompt != null ? String(details.defaultPrompt) : undefined
      const url = details?.url != null ? String(details.url) : undefined

      this.pushEvent(st, {
        type,
        message,
        ...(defaultPrompt != null ? { defaultPrompt } : {}),
        ...(url ? { url } : {}),
        ts: Date.now(),
      })

      return decideResponse(type, st.policy, defaultPrompt)
    })

    return 'native'
  }
}

/** Shared singleton used by BrowserRegistry + browser_dialog tool. */
export const jsDialogHost = new JsDialogHost()
