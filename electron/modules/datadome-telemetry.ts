/**
 * DataDome / captcha-delivery URL helpers + JSONL file sink.
 * Network hooks live in BrowserNetworkManager (single webRequest owner).
 */
import fs from 'node:fs'
import path from 'node:path'

export const DATADOME_URL_PATTERNS = [
  '*://*.datadome.co/*',
  '*://*.datadome.net/*',
  '*://*.captcha-delivery.com/*',
  '*://datadome.co/*',
  '*://captcha-delivery.com/*',
] as const

const HOST_RE =
  /(^|\.)((datadome\.(co|net))|(captcha-delivery\.com))$/i

export function isDatadomeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return HOST_RE.test(host)
  } catch {
    return /datadome|captcha-delivery/i.test(url)
  }
}

export function datadomeLogPath(logDir: string): string {
  return path.join(logDir, 'datadome-telemetry.jsonl')
}

export function appendDatadomeTelemetry(
  logDir: string,
  row: Record<string, unknown>,
): void {
  try {
    const file = datadomeLogPath(logDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
  } catch (e) {
    console.warn('[datadome-telemetry] write failed', e)
  }
}

export type UploadChunk = { bytes?: Buffer; file?: string }

const MAX_BODY_CHARS = 32_000

export function bodyFromUploadData(uploadData: UploadChunk[] | undefined): {
  bodyText?: string
  bodyBase64?: string
  bodyBytes?: number
  truncated?: boolean
} {
  if (!uploadData?.length) return {}
  const parts: Buffer[] = []
  for (const chunk of uploadData) {
    if (chunk.bytes && Buffer.isBuffer(chunk.bytes)) parts.push(chunk.bytes)
    else if (typeof chunk.file === 'string' && chunk.file)
      parts.push(Buffer.from(`[file:${chunk.file}]`))
  }
  if (!parts.length) return {}
  const buf = Buffer.concat(parts)
  const truncated = buf.length > MAX_BODY_CHARS
  const slice = truncated ? buf.subarray(0, MAX_BODY_CHARS) : buf
  const asText = slice.toString('utf8')
  const nonPrintable = asText.replace(/[\t\r\n\x20-\x7e]/g, '').length
  const printable = nonPrintable < asText.length * 0.05
  if (printable) {
    return { bodyText: asText, bodyBytes: buf.length, truncated: truncated || undefined }
  }
  return {
    bodyBase64: slice.toString('base64'),
    bodyBytes: buf.length,
    truncated: truncated || undefined,
  }
}
