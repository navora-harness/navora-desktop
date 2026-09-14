const blobCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

function cacheKey(chatId: string, relPath: string): string {
  return `${chatId}::${relPath.replace(/\\/g, '/')}`
}

export function isHttpOrDataUrl(src: string): boolean {
  return /^(https?:|data:|blob:|\/\/)/i.test(src.trim())
}

export function looksLikeWorkspaceImagePath(src: string): boolean {
  const s = src.trim().replace(/^\.\//, '').replace(/\\/g, '/')
  if (!s || isHttpOrDataUrl(s) || s.startsWith('#') || s.startsWith('mailto:')) return false
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/')) return false
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(s)
}

/** Collect workspace-relative image paths from markdown or bare text. */
export function extractWorkspaceImagePathsFromText(content: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const p = raw.trim().replace(/^\.\//, '').replace(/\\/g, '/')
    if (!looksLikeWorkspaceImagePath(p) || seen.has(p)) return
    seen.add(p)
    found.push(p)
  }
  const md = /!\[[^\]]*]\(([^)\s]+)\)/g
  let m: RegExpExecArray | null
  while ((m = md.exec(content || ''))) push(m[1])
  const bare =
    /(?:^|[\s`'"(（])((?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|gif|webp|bmp|svg))(?=$|[\s`'")）])/gi
  while ((m = bare.exec(content || ''))) push(m[1])
  return found
}

export function extractImagePathFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (r.ok === false) return null
  const p = String(r.path || '').trim()
  if (!p) return null
  const format = String(r.format || '').toLowerCase()
  if (format === 'png' || format === 'jpeg' || format === 'jpg') return p.replace(/\\/g, '/')
  if (looksLikeWorkspaceImagePath(p)) return p.replace(/\\/g, '/')
  return null
}

/** Resolve a workspace-relative image to a blob: URL (cached). */
export async function resolveWorkspaceMediaUrl(
  chatId: string,
  relPath: string,
): Promise<string | null> {
  if (!chatId || !relPath || !window.navora?.workspace?.readMedia) return null
  const key = cacheKey(chatId, relPath)
  const hit = blobCache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending

  const job = (async () => {
    try {
      const res = await window.navora!.workspace.readMedia(chatId, relPath)
      if (!res.ok || !res.base64 || !res.mime) return null
      const bin = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: res.mime })
      const url = URL.createObjectURL(blob)
      const prev = blobCache.get(key)
      if (prev) URL.revokeObjectURL(prev)
      blobCache.set(key, url)
      return url
    } catch {
      return null
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, job)
  return job
}

export function revokeAllMediaUrls(): void {
  for (const url of blobCache.values()) URL.revokeObjectURL(url)
  blobCache.clear()
  inflight.clear()
}

export function revokeMediaUrlsForChat(chatId: string): void {
  const prefix = `${chatId}::`
  for (const [key, url] of [...blobCache.entries()]) {
    if (!key.startsWith(prefix)) continue
    URL.revokeObjectURL(url)
    blobCache.delete(key)
  }
}
