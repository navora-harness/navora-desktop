/** URL allowlist for navigate / session.fetch. Empty list = unrestricted. */

export function isUrlAllowed(url: string, allowlist: string[] | undefined | null): boolean {
  const list = (allowlist || []).map((s) => s.trim()).filter(Boolean)
  if (!list.length) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'about:' || parsed.protocol === 'data:') return true
  const host = parsed.hostname.toLowerCase()
  const origin = parsed.origin.toLowerCase()
  for (const raw of list) {
    const rule = raw.trim().toLowerCase()
    if (!rule) continue
    if (rule.startsWith('http://') || rule.startsWith('https://')) {
      try {
        const r = new URL(rule)
        if (origin === r.origin.toLowerCase()) return true
        if (host === r.hostname.toLowerCase() && parsed.pathname.startsWith(r.pathname)) return true
      } catch {
        /* ignore */
      }
      continue
    }
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1) // .example.com
      if (host === rule.slice(2) || host.endsWith(suffix)) return true
      continue
    }
    if (host === rule) return true
  }
  return false
}
