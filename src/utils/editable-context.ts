/** Helpers for app-wide text / input context menus. */

const EDITABLE_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  '',
])

export type EditableTarget =
  | { kind: 'input'; el: HTMLInputElement }
  | { kind: 'textarea'; el: HTMLTextAreaElement }
  | { kind: 'contenteditable'; el: HTMLElement }

export function isEditableTarget(target: EventTarget | null): boolean {
  return !!findEditable(target)
}

export function findEditable(target: EventTarget | null): EditableTarget | null {
  const node = target instanceof Element ? target : null
  if (!node) return null
  const el = node.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') as
    | HTMLElement
    | null
  if (!el) return null
  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled) return null
    return { kind: 'textarea', el }
  }
  if (el instanceof HTMLInputElement) {
    if (el.disabled) return null
    const type = (el.type || 'text').toLowerCase()
    if (!EDITABLE_INPUT_TYPES.has(type)) return null
    return { kind: 'input', el }
  }
  if (el.isContentEditable) return { kind: 'contenteditable', el }
  return null
}

export function editableSelection(target: EditableTarget): {
  selected: string
  start: number
  end: number
  readonly: boolean
} {
  if (target.kind === 'input' || target.kind === 'textarea') {
    const el = target.el
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const selected = end > start ? el.value.slice(start, end) : ''
    return {
      selected,
      start,
      end,
      readonly: el.readOnly,
    }
  }
  const sel = window.getSelection()
  const selected = String(sel?.toString() || '')
  return { selected, start: 0, end: selected.length, readonly: false }
}

export function windowTextSelection(): string {
  return String(window.getSelection?.()?.toString() || '').trim()
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = String(text || '')
  if (!t) return false
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function replaceInputRange(
  el: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  insert: string,
): void {
  const value = el.value
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc?.set) desc.set.call(el, next)
  else el.value = next
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = Math.min(start + insert.length, next.length)
  el.focus()
  try {
    el.setSelectionRange(pos, pos)
  } catch {
    /* number/date inputs may not support setSelectionRange */
  }
}

export function editableCut(target: EditableTarget, start: number, end: number, selected: string): void {
  if (!selected || end <= start) return
  void copyTextToClipboard(selected)
  if (target.kind === 'input' || target.kind === 'textarea') {
    if (target.el.readOnly) return
    replaceInputRange(target.el, start, end, '')
    return
  }
  target.el.focus()
  document.execCommand('cut')
}

export async function editablePaste(
  target: EditableTarget,
  start: number,
  end: number,
  canApply?:()=>boolean,
): Promise<boolean> {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    return false
  }
  if(canApply&&!canApply())return false
  if (target.kind === 'input' || target.kind === 'textarea') {
    if (target.el.readOnly) return false
    replaceInputRange(target.el, start, end, text)
    return true
  }
  target.el.focus()
  return document.execCommand('insertText', false, text)
}

export function editableSelectAll(target: EditableTarget): void {
  if (target.kind === 'input' || target.kind === 'textarea') {
    target.el.focus()
    try {
      target.el.select()
    } catch {
      target.el.setSelectionRange(0, target.el.value.length)
    }
    return
  }
  target.el.focus()
  const range = document.createRange()
  range.selectNodeContents(target.el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function editableDeleteSelection(
  target: EditableTarget,
  start: number,
  end: number,
): void {
  if (end <= start) return
  if (target.kind === 'input' || target.kind === 'textarea') {
    if (target.el.readOnly) return
    replaceInputRange(target.el, start, end, '')
    return
  }
  target.el.focus()
  document.execCommand('delete')
}

/** Regions that own a specialized context menu (chat item / messages / resource panels). */
export function isOwnedContextRegion(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  return !!el?.closest?.('[data-ctx-menu]')
}
