export type SidebarRailState = {version: 2; active: string}

/** Recover the selected entry from the former combined rail without restoring groups. */
export function normalizeRail(raw: unknown, registered: readonly string[]): SidebarRailState {
  const saved = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (saved.active === '') return {version: 2, active: ''}
  if (saved.version === 2 && typeof saved.active === 'string' && registered.includes(saved.active)) {
    return {version: 2, active: saved.active}
  }
  if (Array.isArray(saved.groups)) {
    const group = saved.groups.find(item => item && item.id === saved.active)
    const panel = Array.isArray(group?.panels) ? group.panels.find((id: unknown) => typeof id === 'string' && registered.includes(id)) : undefined
    if (panel) return {version: 2, active: panel}
  }
  return {version: 2, active: registered[0] || ''}
}
