/**
 * Normalize Chromium webRequest match patterns.
 * Models often pass host globs like `*qqdl.gtimg.cn*` which throw
 * "Missing scheme separator".
 */

export function normalizeMatchPattern(raw: string): {
  pattern: string
  normalized: boolean
  original: string
} {
  const original = String(raw || '').trim()
  if (!original) {
    return { pattern: '*://*/*', normalized: true, original }
  }
  if (original.includes('://')) {
    return { pattern: original, normalized: false, original }
  }

  let body = original.replace(/^\*+/, '').replace(/\*+$/, '').replace(/^\.+/, '')
  if (!body) {
    return { pattern: '*://*/*', normalized: true, original }
  }

  let host = body
  let pathPart = '/*'
  const slash = body.indexOf('/')
  if (slash >= 0) {
    host = body.slice(0, slash) || '*'
    pathPart = body.slice(slash) || '/*'
    if (pathPart === '/') pathPart = '/*'
    else if (!pathPart.includes('*')) pathPart = `${pathPart}*`
  }

  host = host.replace(/^\*+/, '').replace(/^\.+/, '') || '*'
  if (host !== '*' && !host.startsWith('*.') && !host.includes('*')) {
    host = `*.${host}`
  } else if (host.startsWith('*') && !host.startsWith('*.') && host.length > 1 && host[1] !== '.') {
    host = `*.${host.replace(/^\*+/, '')}`
  }

  const pattern = `*://${host}${pathPart.startsWith('/') ? pathPart : `/${pathPart}`}`
  return { pattern, normalized: pattern !== original, original }
}
