import { AsyncLocalStorage } from 'node:async_hooks'
import type { WebContents } from 'electron'
import { getBrowserAutomationController, type BrowserAutomationOperation } from './browser-automation-controller'

const contexts = new AsyncLocalStorage<ReadonlyMap<number, BrowserAutomationOperation>>()

/** Keep each page's operation identity across awaits and nested multi-page tool calls. */
export function withBrowserInputOperation<T>(wc: WebContents, operation: BrowserAutomationOperation, action: () => T): T {
  const next = new Map(contexts.getStore())
  next.set(wc.id, operation)
  return contexts.run(next, action)
}

export function currentBrowserInputOperation(wc: WebContents): BrowserAutomationOperation | undefined {
  return contexts.getStore()?.get(wc.id)
}

export function assertBrowserInputCurrent(wc: WebContents): void {
  const operation = currentBrowserInputOperation(wc)
  if (operation) {
    operation.assertCurrent()
    if (getBrowserAutomationController(wc).captureDocumentEpoch() !== operation.documentEpoch) throw new Error('browser_document_changed')
  }
  else {
    const controller = getBrowserAutomationController(wc)
    controller.assertEpoch(controller.captureEpoch())
  }
}

/** Committed native work stays owned until its real promise settles after caller cancellation. */
export function commitTrustedInput<T>(wc: WebContents, action: () => Promise<T>): Promise<T> {
  assertBrowserInputCurrent(wc)
  return currentBrowserInputOperation(wc)?.commit(action) ?? action()
}
