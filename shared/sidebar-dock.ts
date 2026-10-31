export type DockGroup = { id: string; panels: string[]; active: string; weight: number; collapsed: boolean }
export type SidebarDockLayout = { version: 1; groups: DockGroup[]; hidden: string[] }
export type DockPlacement = 'tab' | 'before' | 'after'
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)

/** Unknown panel IDs are retained so temporarily unavailable extensions keep their layout. */
export function normalizeDock(raw: unknown, registered: readonly string[]): SidebarDockLayout {
  const source = raw && typeof raw === 'object' ? raw as Partial<SidebarDockLayout> : {}
  const used = new Set<string>(), groupIds = new Set<string>()
  const groups: DockGroup[] = []
  for (const entry of Array.isArray(source.groups) ? source.groups.slice(0, 80) : []) {
    if (!entry || !Array.isArray(entry.panels)) continue
    const panels = entry.panels.filter((id): id is string => validId(id) && !used.has(id) && Boolean(used.add(id))).slice(0, 80)
    if (!panels.length) continue
    const base = validId(entry.id) ? entry.id : `group-${panels[0]}`
    let id = base, suffix = 1
    while (groupIds.has(id)) id = `${base.slice(0, 65)}-${suffix++}`
    groupIds.add(id)
    groups.push({ id, panels, active: panels.includes(entry.active) ? entry.active : panels[0]!, weight: Number.isFinite(entry.weight) ? Math.max(64, Math.min(4000, entry.weight)) : 180, collapsed: entry.collapsed === true })
  }
  for (const panel of registered) if (validId(panel) && !used.has(panel)) {
    let id = `group-${panel}`
    while (groupIds.has(id)) id += '-new'
    groupIds.add(id); used.add(panel)
    groups.push({ id, panels: [panel], active: panel, weight: panel === 'chats' ? 600 : 180, collapsed: false })
  }
  return { version: 1, groups, hidden: [...new Set((Array.isArray(source.hidden) ? source.hidden : []).filter(id => validId(id) && used.has(id)))] }
}

export function moveDockPanels(layout: SidebarDockLayout, panels: readonly string[], targetId: string, placement: DockPlacement): SidebarDockLayout {
  const result = normalizeDock(layout, [])
  const target = result.groups.find(group => group.id === targetId)
  const moving = [...new Set(panels)].filter(panel => result.groups.some(group => group.panels.includes(panel)))
  if (!target || !moving.length) return result
  if (placement !== 'tab' && target.panels.every(panel => moving.includes(panel))) return result
  // Reordering tabs within their own group is supported by dropping onto its center.
  const existing = [...target.panels]
  for (const group of result.groups) {
    group.panels = group.panels.filter(panel => !moving.includes(panel))
    if (!group.panels.includes(group.active)) group.active = group.panels[0] || ''
  }
  if (placement === 'tab') {
    target.panels.push(...moving)
    target.active = moving[0]!
    target.collapsed = false
  } else {
    let id = `group-${moving[0]}`
    while (result.groups.some(group => group.id === id)) id += '-new'
    const newGroup = { id, panels: moving, active: moving[0]!, weight: Math.max(80, target.weight / 2), collapsed: false }
    target.weight = Math.max(80, target.weight / 2)
    result.groups.splice(result.groups.indexOf(target) + (placement === 'after' ? 1 : 0), 0, newGroup)
  }
  result.groups = result.groups.filter(group => group.panels.length)
  result.hidden = result.hidden.filter(panel => !moving.includes(panel))
  // Keep the target's old tab order when a whole group is dropped onto itself.
  if (placement === 'tab' && existing.length === moving.length && existing.every(panel => moving.includes(panel))) target.panels = existing
  return result
}

export function splitDockPanel(layout: SidebarDockLayout, panel: string): SidebarDockLayout {
  const group = layout.groups.find(item => item.panels.includes(panel))
  return group && group.panels.length > 1 ? moveDockPanels(layout, [panel], group.id, 'after') : normalizeDock(layout, [])
}
