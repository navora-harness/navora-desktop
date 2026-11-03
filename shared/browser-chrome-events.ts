/** Coordinate host controls without changing a page's automation ownership. */
export const BROWSER_CHROME_OPEN = 'navora:browser-chrome-open'
export function requestBrowserChromeOpen(id: string): void {
  const browser = globalThis as unknown as {
    dispatchEvent(event: unknown): boolean
    Event: new (type: string) => unknown
    CustomEvent: new (type: string, options: {detail: string}) => unknown
  }
  browser.dispatchEvent(new browser.Event('navora:tab-hover-dismiss'))
  browser.dispatchEvent(new browser.CustomEvent(BROWSER_CHROME_OPEN, {detail: id}))
}
