/** Once delivery is partial or unknown, Flow must return the receipt before any retry. */
export function browserInputMustNotReplay(result: unknown, seen = new Set<object>()): boolean {
  if (!result || typeof result !== 'object' || seen.has(result)) return false
  seen.add(result)
  if (Array.isArray(result)) return result.some(value => browserInputMustNotReplay(value, seen))
  const value = result as Record<string, unknown>
  const cleanup=value.cleanup as {failed?:number}|undefined
  const failed = value.ok === false || value.status === 'failed' || value.status === 'cancelled'
  if (value.status === 'cancelled' || (typeof value.deliveryWarning === 'string' && value.deliveryWarning)
    || (typeof cleanup?.failed === 'number' && cleanup.failed > 0)
    || String(value.reason || '').includes('PARTIAL_CLICK_SEQUENCE')
    || (failed && (value.dispatchedCount === null || typeof value.dispatchedCount === 'number' && value.dispatchedCount > 0))
    || (value.status === 'failed' && value.stage === 'event-dispatch')
    || (failed && value.error === 'target_click_failed')) return true
  return ['dispatch','clickDispatch','steps','failedResult','result','results']
    .some(key => browserInputMustNotReplay(value[key], seen))
}
