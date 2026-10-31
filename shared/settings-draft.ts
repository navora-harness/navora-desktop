/** Rebase edited fields, matching catalog entries by ID; scalar arrays stay atomic. */
export function rebaseSettingsDraft<T>(base: T, draft: T, saved: T): T {
  if (JSON.stringify(base) === JSON.stringify(draft)) return clone(saved)
  if (Array.isArray(base) && Array.isArray(draft) && Array.isArray(saved)) {
    const keyed = (rows: unknown[]): rows is Array<Record<string, unknown> & {id:string}> => rows.every(row => !!row && typeof row === 'object' && typeof (row as {id?:unknown}).id === 'string') && new Set(rows.map(row => (row as {id:string}).id)).size === rows.length
    if (keyed(base) && keyed(draft) && keyed(saved)) {
      const original = new Map(base.map(row => [row.id,row]))
      const latest = new Map(saved.map(row => [row.id,row]))
      const next = draft.flatMap(row => {
        const old = original.get(row.id), current = latest.get(row.id)
        if (old && !current && JSON.stringify(old) === JSON.stringify(row)) return []
        return [old && current ? rebaseSettingsDraft(old,row,current) : clone(row)]
      })
      const ids = new Set([...base,...draft].map(row => row.id))
      next.push(...saved.filter(row => !ids.has(row.id)).map(clone))
      return next as T
    }
  }
  if (base && draft && saved && typeof base === 'object' && typeof draft === 'object' && typeof saved === 'object' && !Array.isArray(draft)) {
    const out = { ...saved } as Record<string, unknown>
    const a = base as Record<string, unknown>, b = draft as Record<string, unknown>, c = saved as Record<string, unknown>
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue
      if (!(key in b)) delete out[key]
      else out[key] = rebaseSettingsDraft(a[key], b[key], c[key])
    }
    return out as T
  }
  return clone(draft)
}

function clone<T>(value: T): T { return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) as T : value }
