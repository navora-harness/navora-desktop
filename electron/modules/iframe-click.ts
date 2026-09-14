/**
 * Generic in-iframe / host-iframe clicks.
 * Supports pierce-locate of an iframe on the host page, then either:
 * - trusted-click at offset inside the iframe box (closed-shadow / cross-origin safe), or
 * - resolve an inner selector via the child WebFrameMain and click its center.
 *
 * All renderer / frame evals are hard-timed out so sticky pages cannot hang the Agent.
 */
import type { WebContents, WebFrameMain } from 'electron'
import { hasQuerySelectorDeep, querySelectorDeep } from './deep-dom'
import { dispatchTrustedPointer } from './trusted-input'

export type IframeClickOpts = {
  /** Host-page iframe CSS selector (pierces closed shadow when possible). */
  iframeSelector: string
  /** Optional alternate host-page iframe selectors to try (first hit wins). */
  iframeSelectors?: string[]
  /** Optional selector inside the iframe document. */
  innerSelector?: string
  /** Pixel offset from iframe top-left (used when innerSelector missing or unresolved). */
  offsetX?: number
  offsetY?: number
  /** 0–1 fraction of iframe size; used when offset* not set. Default checkbox-ish left-center. */
  offsetRatioX?: number
  offsetRatioY?: number
  /**
   * When true (default if any offset/ratio is set): click offset first.
   * Closed-shadow widgets often hang frame.executeJavaScript; offset is more reliable.
   */
  preferOffset?: boolean
  /** Max ms to locate iframe box (default 600). */
  locateBudgetMs?: number
}

export type IframeClickResult = {
  ok: boolean
  method?: string
  iframeSelector?: string
  innerSelector?: string
  x?: number
  y?: number
  iframe?: { x: number; y: number; width: number; height: number }
  error?: string
  detail?: string
}

async function withBudget<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout:${label}`)), Math.max(1, ms))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function collectFrames(root: WebFrameMain): WebFrameMain[] {
  const out: WebFrameMain[] = []
  const walk = (f: WebFrameMain | null | undefined) => {
    if (!f) return
    try {
      out.push(f)
      const kids =
        (typeof f.framesInSubtree !== 'undefined' ? f.framesInSubtree : null) ||
        (f as WebFrameMain & { frames?: WebFrameMain[] }).frames ||
        []
      for (const c of kids) walk(c)
    } catch {
      /* disposed */
    }
  }
  walk(root)
  return out
}

async function resolveIframeBox(
  wc: WebContents,
  selector: string,
  opts?: { scrollIntoView?: boolean; budgetMs?: number },
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const budget = Math.max(80, Math.min(2500, opts?.budgetMs ?? 400))
  const wantScroll = opts?.scrollIntoView === true
  if (hasQuerySelectorDeep(wc)) {
    try {
      const info = await withBudget(
        querySelectorDeep(wc, selector, {
          pierce: true,
          // Avoid scrolling on every miss during rapid poll — only when clicking.
          scrollIntoView: wantScroll,
        }),
        budget,
        'iframe_deep',
      )
      if (info && info.width >= 4 && info.height >= 4) {
        return { x: info.x, y: info.y, width: info.width, height: info.height }
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const box = (await withBudget(
      wc.executeJavaScript(
        `(() => {
        const pierce = (root, sel) => {
          try {
            const d = root.querySelector?.(sel)
            if (d) return d
          } catch {}
          const all = root.querySelectorAll ? root.querySelectorAll('*') : []
          for (const el of all) {
            try {
              if (el.shadowRoot) {
                const hit = pierce(el.shadowRoot, sel)
                if (hit) return hit
              }
            } catch {}
          }
          return null
        }
        const el = pierce(document, ${JSON.stringify(selector)})
        if (!el) return null
        if (${wantScroll ? 'true' : 'false'}) {
          el.scrollIntoView({ block: 'center', inline: 'center' })
        }
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return null
        return { x: r.left, y: r.top, width: r.width, height: r.height }
      })()`,
      ),
      budget,
      'iframe_box_js',
    )) as { x: number; y: number; width: number; height: number } | null
    return box
  } catch {
    return null
  }
}

async function trustedClickAt(wc: WebContents, x: number, y: number): Promise<void> {
  await withBudget(
    (async () => {
      await dispatchTrustedPointer(wc, { action: 'move', x, y, button: 'left' })
      await dispatchTrustedPointer(wc, { action: 'down', x, y, button: 'left', clickCount: 1 })
      await dispatchTrustedPointer(wc, { action: 'up', x, y, button: 'left', clickCount: 1 })
    })(),
    3000,
    'iframe_pointer',
  )
}

function clickPointFromBox(
  box: { x: number; y: number; width: number; height: number },
  opts: IframeClickOpts,
): { x: number; y: number; ratioX: number; ratioY: number } {
  const ratioX =
    typeof opts.offsetRatioX === 'number' && Number.isFinite(opts.offsetRatioX)
      ? opts.offsetRatioX
      : typeof opts.offsetX === 'number'
        ? null
        : 0.12
  const ratioY =
    typeof opts.offsetRatioY === 'number' && Number.isFinite(opts.offsetRatioY)
      ? opts.offsetRatioY
      : typeof opts.offsetY === 'number'
        ? null
        : 0.5
  const ox =
    typeof opts.offsetX === 'number' && Number.isFinite(opts.offsetX)
      ? opts.offsetX
      : box.width * (ratioX ?? 0.12)
  const oy =
    typeof opts.offsetY === 'number' && Number.isFinite(opts.offsetY)
      ? opts.offsetY
      : box.height * (ratioY ?? 0.5)
  return {
    x: box.x + ox,
    y: box.y + oy,
    ratioX: ratioX ?? ox / Math.max(box.width, 1),
    ratioY: ratioY ?? oy / Math.max(box.height, 1),
  }
}

async function probeInnerInMatchingFrames(
  wc: WebContents,
  iframeSrcHint: string | undefined,
  innerSelector: string,
): Promise<{ x: number; y: number } | null> {
  let main: WebFrameMain | null = null
  try {
    main = wc.mainFrame
  } catch {
    return null
  }
  if (!main) return null
  const frames = collectFrames(main)
  const hint = String(iframeSrcHint || '').toLowerCase()
  const candidates = frames.filter((f) => {
    try {
      const u = String(f.url || '').toLowerCase()
      if (!u || u === 'about:blank') return false
      if (!hint) return true
      const m = hint.match(/src\*="([^"]+)"/i) || hint.match(/src\*='([^']+)'/i)
      const needle = (m?.[1] || hint).toLowerCase()
      return needle.length < 3 ? true : u.includes(needle.replace(/\*/g, ''))
    } catch {
      return false
    }
  })
  // Cap frames probed — deep trees can be large; hanging evals must not block forever.
  const list = (candidates.length ? candidates : frames).slice(0, 4)
  const script = `(() => {
    const sel = ${JSON.stringify(innerSelector)}
    const want = (el) => {
      if (!el || el.nodeType !== 1) return false
      try { if (el.matches?.(sel)) return true } catch {}
      return false
    }
    const walk = (root) => {
      if (!root) return null
      try {
        const direct = root.querySelector?.(sel)
        if (direct) return direct
      } catch {}
      const nodes = root.querySelectorAll ? root.querySelectorAll('*') : []
      for (const el of nodes) {
        if (want(el)) return el
        try {
          if (el.shadowRoot) {
            const hit = walk(el.shadowRoot)
            if (hit) return hit
          }
        } catch {}
      }
      return null
    }
    const el = walk(document)
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`
  for (const frame of list) {
    try {
      const inner = (await withBudget(
        frame.executeJavaScript(script, true),
        800,
        'iframe_inner',
      )) as { x: number; y: number } | null
      if (inner && Number.isFinite(inner.x) && Number.isFinite(inner.y)) return inner
    } catch {
      /* timeout / cross-origin / closed shadow */
    }
  }
  return null
}

/**
 * Click inside an iframe: prefer offset when ratios given (closed shadow safe);
 * otherwise try innerSelector briefly, then default offset.
 */
export async function clickInIframe(
  wc: WebContents,
  opts: IframeClickOpts,
): Promise<IframeClickResult> {
  const iframeSelector = String(opts.iframeSelector || '').trim()
  if (!iframeSelector) {
    return { ok: false, error: 'iframe_selector_required' }
  }
  const box = await resolveIframeBox(wc, iframeSelector, {
    scrollIntoView: true,
    budgetMs: opts.locateBudgetMs ?? 600,
  })
  if (!box) {
    return {
      ok: false,
      error: 'iframe_not_found',
      iframeSelector,
      detail: 'Host page iframe not found (try pierce selector / wait until iframe appears).',
    }
  }

  const innerSelector = opts.innerSelector ? String(opts.innerSelector).trim() : ''
  const hasExplicitOffset =
    typeof opts.offsetX === 'number' ||
    typeof opts.offsetY === 'number' ||
    typeof opts.offsetRatioX === 'number' ||
    typeof opts.offsetRatioY === 'number'
  const preferOffset = opts.preferOffset !== undefined ? opts.preferOffset : hasExplicitOffset

  const doOffset = async (method: string, detail?: string): Promise<IframeClickResult> => {
    const pt = clickPointFromBox(box, opts)
    await trustedClickAt(wc, pt.x, pt.y)
    return {
      ok: true,
      method,
      iframeSelector,
      innerSelector: innerSelector || undefined,
      x: pt.x,
      y: pt.y,
      iframe: box,
      detail,
    }
  }

  if (preferOffset) {
    return doOffset(
      'iframe-offset',
      innerSelector
        ? 'preferOffset: skipped inner probe (closed shadow / offset-safe).'
        : undefined,
    )
  }

  if (innerSelector) {
    const probed = await probeInnerInMatchingFrames(wc, iframeSelector, innerSelector)
    if (probed) {
      const x = box.x + probed.x
      const y = box.y + probed.y
      await trustedClickAt(wc, x, y)
      return {
        ok: true,
        method: 'iframe-inner-selector',
        iframeSelector,
        innerSelector,
        x,
        y,
        iframe: box,
      }
    }
  }

  return doOffset(
    innerSelector ? 'iframe-offset-fallback' : 'iframe-offset',
    innerSelector
      ? 'innerSelector unresolved (likely closed shadow / cross-origin); clicked iframe offset instead.'
      : undefined,
  )
}

export type ClickWhenReadyOpts = {
  timeoutMs: number
  signal: AbortSignal
  /** After iframe is ready (size + optional stable), settle before click (default 40). */
  settleMs?: number
  pollMs?: number
  /** Ignore boxes smaller than this (avoids clicking empty/loading shells). */
  minWidth?: number
  minHeight?: number
  /**
   * Require width/height to stay within 2px for this many ms before treating as ready.
   * Default 0 (click on first qualifying box).
   */
  stableMs?: number
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function boxNearlySame(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  return Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2
}

/**
 * Poll until host iframe is locatable (and optionally sized/stable), then click.
 * Avoids a separate long browser_wait before click.
 * Tries iframeSelector plus iframeSelectors each poll (first hit wins).
 */
export async function clickInIframeWhenReady(
  wc: WebContents,
  opts: IframeClickOpts,
  when: ClickWhenReadyOpts,
): Promise<IframeClickResult & { waitedMs: number; polls: number }> {
  const timeoutMs = Math.max(200, when.timeoutMs)
  const pollMs = Math.max(30, Math.min(120, when.pollMs ?? 45))
  const settleMs = Math.max(0, Math.min(800, when.settleMs ?? 40))
  const minWidth = Math.max(0, when.minWidth ?? 0)
  const minHeight = Math.max(0, when.minHeight ?? 0)
  const stableMs = Math.max(0, Math.min(2000, when.stableMs ?? 0))
  const deadline = Date.now() + timeoutMs
  const started = Date.now()
  let polls = 0
  let stableSince = 0
  let lastStable: { width: number; height: number; sel: string } | null = null

  const selectors = [
    String(opts.iframeSelector || '').trim(),
    ...(Array.isArray(opts.iframeSelectors)
      ? opts.iframeSelectors.map((s) => String(s || '').trim())
      : []),
  ].filter(Boolean)
  const uniqueSelectors = [...new Set(selectors)]
  if (!uniqueSelectors.length) {
    return {
      ok: false,
      error: 'iframe_selector_required',
      waitedMs: 0,
      polls: 0,
    }
  }

  while (Date.now() < deadline) {
    if (when.signal.aborted) throw new Error('aborted')
    polls += 1
    let hitSel = ''
    let box: { x: number; y: number; width: number; height: number } | null = null
    for (const sel of uniqueSelectors) {
      box = await resolveIframeBox(wc, sel, {
        scrollIntoView: false,
        budgetMs: 180,
      })
      if (box && box.width >= minWidth && box.height >= minHeight) {
        hitSel = sel
        break
      }
      box = null
    }
    if (box && hitSel) {
      if (stableMs > 0) {
        if (lastStable && lastStable.sel === hitSel && boxNearlySame(lastStable, box)) {
          if (!stableSince) stableSince = Date.now()
        } else {
          lastStable = { width: box.width, height: box.height, sel: hitSel }
          stableSince = Date.now()
        }
        if (Date.now() - stableSince < stableMs) {
          const remain = deadline - Date.now()
          if (remain <= 0) break
          await sleepAbortable(Math.min(pollMs, remain), when.signal)
          continue
        }
      }
      if (settleMs > 0) {
        await sleepAbortable(settleMs, when.signal)
        // Re-resolve after settle; abort click if box vanished or shrank.
        const again = await resolveIframeBox(wc, hitSel, {
          scrollIntoView: false,
          budgetMs: 250,
        })
        if (!again || again.width < minWidth || again.height < minHeight) {
          lastStable = null
          stableSince = 0
          const remain = deadline - Date.now()
          if (remain <= 0) break
          await sleepAbortable(Math.min(pollMs, remain), when.signal)
          continue
        }
      }
      const clicked = await clickInIframe(wc, {
        ...opts,
        iframeSelector: hitSel,
        preferOffset: opts.preferOffset !== false,
        locateBudgetMs: 500,
      })
      return { ...clicked, iframeSelector: hitSel, waitedMs: Date.now() - started, polls }
    }
    lastStable = null
    stableSince = 0
    const remain = deadline - Date.now()
    if (remain <= 0) break
    await sleepAbortable(Math.min(pollMs, remain), when.signal)
  }

  return {
    ok: false,
    error: 'iframe_not_found',
    iframeSelector: uniqueSelectors[0],
    detail: `Timed out waiting for iframe (${uniqueSelectors.length} selectors tried${
      minWidth || minHeight ? `; min ${minWidth}x${minHeight}` : ''
    }${stableMs ? `; stable ${stableMs}ms` : ''}).`,
    waitedMs: Date.now() - started,
    polls,
  }
}
