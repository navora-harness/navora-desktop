/**
 * Navigate with a custom main-document body.
 * - native: unofficial Electron loadURLWithResponse (per-WC; no protocol.handle)
 * - protocol: one-shot session.protocol.handle + loadURL (empirically more reliable for Turnstile)
 */
import { net, type Session, type WebContents } from 'electron'

export type DocumentInjectResponse = {
  statusCode?: number
  headers?: Record<string, string>
  body: string | Buffer
}

export type LoadDocumentMode = 'native' | 'protocol'

export type LoadDocumentOptions = {
  /**
   * native = loadURLWithResponse when available (default; per-WC isolation).
   * protocol = session.protocol.handle + loadURL (prefer for Turnstile harness).
   */
  prefer?: LoadDocumentMode
}

function hasLoadURLWithResponse(wc: WebContents): boolean {
  return typeof (wc as WebContents & { loadURLWithResponse?: unknown }).loadURLWithResponse === 'function'
}

/** Strip hash; keep origin+path+search for one-shot match. */
function navKey(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    return u.href
  } catch {
    return String(raw || '').split('#')[0]
  }
}

function installOneShotProtocol(
  ses: Session,
  targetUrl: string,
  response: DocumentInjectResponse,
): () => void {
  const target = navKey(targetUrl)
  const status = response.statusCode ?? 200
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    ...(response.headers || {}),
  }
  const body = response.body
  let used = false

  const handler = async (request: GlobalRequest): Promise<GlobalResponse> => {
    const key = navKey(request.url)
    if (used || key !== target) {
      // Prefer Session.fetch so we stay on the same partition + bypass handle.
      const sesFetch = (
        ses as Session & {
          fetch?: (input: string | Request, init?: RequestInit) => Promise<Response>
        }
      ).fetch
      if (typeof sesFetch === 'function') {
        return sesFetch.call(ses, request, {
          bypassCustomProtocolHandlers: true,
        } as RequestInit)
      }
      return net.fetch(request, { bypassCustomProtocolHandlers: true } as RequestInit)
    }
    used = true
    return new Response(body, { status, headers })
  }

  try {
    ses.protocol.unhandle('https')
  } catch {
    /* ignore */
  }
  try {
    ses.protocol.unhandle('http')
  } catch {
    /* ignore */
  }
  ses.protocol.handle('https', handler)
  ses.protocol.handle('http', handler)

  return () => {
    try {
      ses.protocol.unhandle('https')
    } catch {
      /* ignore */
    }
    try {
      ses.protocol.unhandle('http')
    } catch {
      /* ignore */
    }
  }
}

async function loadViaProtocol(
  wc: WebContents,
  url: string,
  response: DocumentInjectResponse,
  ses: Session,
): Promise<void> {
  const cleanup = installOneShotProtocol(ses, url, response)
  try {
    await wc.loadURL(url)
  } finally {
    cleanup()
  }
}

async function loadViaNative(
  wc: WebContents,
  url: string,
  response: DocumentInjectResponse,
): Promise<void> {
  const statusCode = response.statusCode ?? 200
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    ...(response.headers || {}),
  }
  await wc.loadURLWithResponse(url, {
    statusCode,
    headers,
    body: response.body,
  })
}

/**
 * Load `url` so address bar / origin match, but serve `response` as the main document.
 */
export async function loadDocumentWithResponse(
  wc: WebContents,
  url: string,
  response: DocumentInjectResponse,
  ses?: Session,
  opts?: LoadDocumentOptions,
): Promise<void> {
  const prefer = opts?.prefer ?? 'native'

  if (prefer === 'protocol') {
    if (!ses) {
      throw new Error('Session required for protocol.handle document inject')
    }
    await loadViaProtocol(wc, url, response, ses)
    return
  }

  // native (default): per-WC override when available
  if (hasLoadURLWithResponse(wc)) {
    await loadViaNative(wc, url, response)
    return
  }

  if (!ses) {
    throw new Error('loadURLWithResponse unavailable; Session required for protocol.handle fallback')
  }
  await loadViaProtocol(wc, url, response, ses)
}
