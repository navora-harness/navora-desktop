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

  interface JsDialogDetails {
    type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
    message: string
    defaultPrompt?: string
    url?: string
    isMainFrame?: boolean
  }

  interface JsDialogResponse {
    accept: boolean
    promptText?: string
  }

  interface WebContents {
    loadURLWithResponse(url: string, response: LoadURLWithResponseOptions): Promise<void>
    /**
     * Unofficial: intercept alert/confirm/prompt/beforeunload without CDP or page inject.
     * Return a response to handle immediately, or null/undefined to fall through.
     */
    setJsDialogHandler?(
      handler:
        | ((details: JsDialogDetails) => JsDialogResponse | null | undefined)
        | null,
    ): void
    /** Unofficial: timeout after js-dialog preventDefault without respond(). */
    setJsDialogTimeout?(ms: number): void
    /**
     * Unofficial: set files on `<input type=file>` without debugger
     * (CDP DOM.setFileInputFiles equivalent).
     */
    setFileInputFiles?(
      selector: string,
      files: string[],
      options?: { pierce?: boolean },
    ): Promise<void>
    setFileInputFiles?(
      target: { backendNodeId: number; selector?: string; pierce?: boolean },
      files: string[],
    ): Promise<void>
  }

  interface BrowserWindow {
    loadURLWithResponse?(url: string, response: LoadURLWithResponseOptions): Promise<void>
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
