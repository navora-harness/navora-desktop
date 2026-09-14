/// <reference types="vite/client" />

import type { NavoraApi } from '../electron/preload'

declare global {
  interface Window {
    /** Present only in Electron preload; absent in web remote. */
    navoraElectron?: boolean
    navora?: NavoraApi
  }
}

export {}
