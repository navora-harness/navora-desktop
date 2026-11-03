/** HTTP request policy; intentionally separate from browser navigation's about/data rules. */
export function networkUrlAllowed(raw: string, rules: readonly string[] = []): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\x00-\x20\x7f]/.test(raw)) return false
  const list = rules.map(r => r.trim()).filter(Boolean)
  if (!list.length) return true
  return list.some(rule => {
    if (/^https?:\/\//i.test(rule)) {
      try {
        const r = new URL(rule)
        if (r.origin !== url.origin || r.username || r.password || r.search || r.hash) return false
        if (/%(?:2f|5c)/i.test(url.pathname)) return false
        const prefix = r.pathname.replace(/\/+$/, '')
        return !prefix || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
      } catch { return false }
    }
    const wildcard = rule.startsWith('*.')
    try {
      const r = new URL(`http://${wildcard ? rule.slice(2) : rule}`)
      if (r.pathname !== '/' || r.username || r.password || r.search || r.hash) return false
      const explicitPort = /:(\d+)$/.exec(rule)?.[1]
      if (explicitPort && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== Number(explicitPort)) return false
      return url.hostname === r.hostname || (wildcard && url.hostname.endsWith(`.${r.hostname}`))
    } catch { return false }
  })
}
