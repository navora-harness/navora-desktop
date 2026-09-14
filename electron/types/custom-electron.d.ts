/**
 * Type augmentations for unofficial Electron APIs.
 */
export {}

declare module 'electron' {
  interface LoadURLWithResponseOptions {
    statusCode?: number
    headers?: Record<string, string>
    body?: string | Buffer
  }

  interface WebContents {
    loadURLWithResponse(url: string, response: LoadURLWithResponseOptions): Promise<void>
  }

  interface BrowserWindow {
    loadURLWithResponse(url: string, response: LoadURLWithResponseOptions): Promise<void>
  }

  interface Session {
    fetch(
      input: string | Request,
      init?: RequestInit & {
        bypassCustomProtocolHandlers?: boolean
        headerOrder?: string[]
      },
    ): Promise<Response>
  }
}
