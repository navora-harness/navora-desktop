/** Shared by chat, file, and browser tabs, including detached windows. */
export const WORKSPACE_TAB_GEOMETRY = {
  minimumWidth: 112,
  idealWidth: 220,
  maximumWidth: 260,
  height: 36,
  pinnedWidth: 36,
  gap: 4,
} as const

export const WORKSPACE_TAB_CSS_VARIABLES = {
  '--workspace-tab-min-width': `${WORKSPACE_TAB_GEOMETRY.minimumWidth}px`,
  '--workspace-tab-ideal-width': `${WORKSPACE_TAB_GEOMETRY.idealWidth}px`,
  '--workspace-tab-max-width': `${WORKSPACE_TAB_GEOMETRY.maximumWidth}px`,
  '--workspace-tab-height': `${WORKSPACE_TAB_GEOMETRY.height}px`,
  '--workspace-tab-gap': `${WORKSPACE_TAB_GEOMETRY.gap}px`,
} as const

export function workspaceTabStripWidth(count: number, pinnedCount = 0): number {
  const total = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
  const pinned = Math.min(total, Math.max(0, Math.floor(Number.isFinite(pinnedCount) ? pinnedCount : 0)))
  return (total - pinned) * WORKSPACE_TAB_GEOMETRY.idealWidth + pinned * WORKSPACE_TAB_GEOMETRY.pinnedWidth + Math.max(0, total - 1) * WORKSPACE_TAB_GEOMETRY.gap
}

/** Allocate ordinary slots on a host resize or a change in tab structure.
 * Selecting another tab may replace the adjacent tools; that only changes the
 * scroll viewport, rather than reflowing every tab under the pointer.
 */
export function workspaceTabSlotWidth(count: number, pinnedCount: number, availableWidth: number): number {
  const total = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
  const pinned = Math.min(total, Math.max(0, Math.floor(Number.isFinite(pinnedCount) ? pinnedCount : 0)))
  const ordinary = total - pinned
  if (!ordinary || !Number.isFinite(availableWidth)) return WORKSPACE_TAB_GEOMETRY.idealWidth
  const room = (availableWidth - pinned * WORKSPACE_TAB_GEOMETRY.pinnedWidth - Math.max(0, total - 1) * WORKSPACE_TAB_GEOMETRY.gap) / ordinary
  return Math.min(WORKSPACE_TAB_GEOMETRY.idealWidth, Math.max(WORKSPACE_TAB_GEOMETRY.minimumWidth, room))
}
