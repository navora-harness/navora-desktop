/**
 * Shared Chromium-navigation-like request headers for Session.fetch / net.fetch.
 * Relies on CloudBypass Electron `headerOrder` to preserve wire order.
 */
export const NAVIGATION_LIKE_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

/** Names in the order Chromium typically emits for a main-frame navigation. */
export const NAVIGATION_HEADER_ORDER = [
  'Upgrade-Insecure-Requests',
  'User-Agent',
  'Accept',
  'Sec-Fetch-Site',
  'Sec-Fetch-Mode',
  'Sec-Fetch-User',
  'Sec-Fetch-Dest',
  'Referer',
  'Origin',
  'Accept-Language',
] as const

export type NavigationFetchInit = {
  method?: string
  /** Merged over defaults; caller wins on conflicts. */
  headers?: Record<string, string>
  body?: string
  redirect?: 'follow' | 'error'
  userAgent?: string
  acceptLanguage?: string
  referer?: string
  /**
   * When true (default), fill missing navigation-like headers and set headerOrder.
   * Pass false to send only caller headers (still with headerOrder of provided keys).
   */
  navigationLike?: boolean
}

function headerValue(h: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === want) return v
  }
  return undefined
}

function deleteHeader(h: Record<string, string>, name: string): void {
  const want = name.toLowerCase()
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === want) delete h[k]
  }
}

/**
 * Build headers with navigation-like defaults + stable insertion order.
 */
export function buildNavigationLikeHeaders(opts: {
  base?: Record<string, string>
  userAgent?: string
  acceptLanguage?: string
  referer?: string
  /** Sec-Fetch-Site; default none when no referer. */
  secFetchSite?: string
}): { headers: Record<string, string>; headerOrder: string[] } {
  const out: Record<string, string> = {}
  const base = { ...(opts.base || {}) }

  const ua = headerValue(base, 'User-Agent') || opts.userAgent || ''
  const accept = headerValue(base, 'Accept') || NAVIGATION_LIKE_ACCEPT
  const al = headerValue(base, 'Accept-Language') || opts.acceptLanguage || 'en-US,en;q=0.9'
  const referer = opts.referer || headerValue(base, 'Referer')
  const site =
    headerValue(base, 'Sec-Fetch-Site') ||
    opts.secFetchSite ||
    (referer ? 'cross-site' : 'none')

  const ordered: Array<[string, string | undefined]> = [
    ['Upgrade-Insecure-Requests', headerValue(base, 'Upgrade-Insecure-Requests') || '1'],
    ['User-Agent', ua || undefined],
    ['Accept', accept],
    ['Sec-Fetch-Site', site],
    ['Sec-Fetch-Mode', headerValue(base, 'Sec-Fetch-Mode') || 'navigate'],
    ['Sec-Fetch-User', headerValue(base, 'Sec-Fetch-User') || '?1'],
    ['Sec-Fetch-Dest', headerValue(base, 'Sec-Fetch-Dest') || 'document'],
    ['Referer', referer],
    ['Origin', headerValue(base, 'Origin')],
    ['Accept-Language', al],
  ]

  for (const [name, value] of ordered) {
    if (value == null || value === '') continue
    out[name] = value
    deleteHeader(base, name)
  }

  // Preserve any remaining caller headers (Cookie, Authorization, …).
  for (const [k, v] of Object.entries(base)) {
    if (v == null || v === '') continue
    out[k] = v
  }

  const headerOrder = [
    ...NAVIGATION_HEADER_ORDER.filter((n) => headerValue(out, n) != null),
    ...Object.keys(out).filter(
      (k) => !NAVIGATION_HEADER_ORDER.some((n) => n.toLowerCase() === k.toLowerCase()),
    ),
  ]

  return { headers: out, headerOrder }
}
