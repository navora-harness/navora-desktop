/** Shared plugin package contract (loadable from disk). */

import type { ChatCompletionTool } from './openai-types'
import type { PermissionCapability } from './types'

/** Zip package hard limit (bytes). Folder/link imports are unlimited. */
export const PLUGIN_ZIP_MAX_BYTES = 200 * 1024 * 1024

export type PluginManifest = {
  /** Stable id (unique). */
  id: string
  name: string
  description: string
  version: string
  /** Entry file relative to plugin dir (CJS; prefer .cjs under "type":"module" packages). Default main.cjs */
  main?: string
  /** First-install default. */
  defaultEnabled?: boolean
  /**
   * Shipped with the app and synced into dataRoot.
   * Cannot be deleted from Settings (only disabled).
   */
  bundled?: boolean
  /**
   * Plugin suite id (kebab-case). At most one installed package
   * in the same suite may exist; enabling one disables other suite members.
   * Used by Settings import and future plugin marketplace.
   */
  suite?: string
}

export type PluginInstallKind = 'bundled' | 'installed' | 'linked' | 'session'

export type PluginRecord = {
  id: string
  dirName: string
  name: string
  description: string
  version?: string
  enabled: boolean
  bundled: boolean
  /** Absolute path of the plugin folder (installed dir or linked source). */
  path: string
  /**
   * bundled = synced seed; installed = copied under dataRoot/plugins;
   * linked = external folder (dev), not copied.
   */
  kind: PluginInstallKind
  /** Short origin label: 随附 / 开发外链 / 压缩包安装 */
  source: string
  /** Path, archive name, or other detail under source. */
  sourceDetail?: string
  /** Tool / interface names contributed when enabled. */
  tools: string[]
  /** Plugin root has README.md / docs.md for in-app docs viewer. */
  hasReadme: boolean
  /** Suite id from plugin.json (if any). */
  suite?: string
  error?: string
}

export type PluginImportMode = 'link' | 'zip'

/** Display mode for import UI (suite zip → pick one variant). */
export type PluginImportDisplayMode = 'single' | 'suite'

/** One variant listed inside a suite zip (`suite.json`). */
export type PluginSuitePackagePreview = {
  id: string
  name: string
  description: string
  version: string
  defaultEnabled?: boolean
}

/**
 * Root manifest for a multi-variant suite zip:
 *   suite.json + packages/<packageId>/{plugin.json,main.cjs,…}
 */
export type PluginSuiteManifest = {
  schemaVersion: 1
  kind: 'plugin-suite'
  id: string
  name: string
  version: string
  description?: string
  suite?: string
  packages: Array<{
    id: string
    name: string
    description?: string
    version: string
    path: string
    defaultEnabled?: boolean
  }>
}

export type PluginImportPreview = {
  id: string
  name: string
  description: string
  version: string
  main: string
  sourcePath: string
  sourceLabel: string
  /** Folder → link (dev); .zip → install into dataRoot/plugins. */
  mode: PluginImportMode
  /** Human origin for confirm UI, e.g. 开发外链 / 压缩包 */
  source: string
  /** Zip file size when mode=zip. */
  sizeBytes?: number
  /** From plugin.json; shared by profile packs (e.g. crypto-suite). */
  suite?: string
  /** `suite` when zip is a multi-variant suite bundle. */
  displayMode?: PluginImportDisplayMode
  /** Suite product id (zip root); differs from selected package `id`. */
  productId?: string
  /** Suite product display name. */
  productName?: string
  /** Suite product description (file install suite zip). */
  productDescription?: string
  /** Variants inside a suite zip (file install only). */
  packages?: PluginSuitePackagePreview[]
  existing?: {
    id: string
    name: string
    version?: string
    kind?: PluginInstallKind
    source?: string
  }
  /**
   * Other installed/linked plugins in the same suite.
   * Import must pass replaceSuite to remove them first.
   */
  suiteConflicts?: Array<{
    id: string
    name: string
    version?: string
    kind?: PluginInstallKind
    source?: string
    enabled?: boolean
    bundled?: boolean
  }>
}

export type PluginImportProgress = {
  phase: 'replace_suite' | 'verify' | 'extract' | 'import'
  label: string
}

export type PluginImportOptions = {
  overwrite?: boolean
  /** Remove other packages in the same suite before import. */
  replaceSuite?: boolean
  /**
   * When importing a suite zip, which variant package to install.
   * Ignored for single-package zips / folder links.
   */
  packageId?: string
  onProgress?: (p: PluginImportProgress) => void
}

export type PluginParseOptions = {
  /** Select a variant when parsing a suite zip. */
  packageId?: string
}

export type PluginsIndexEntry = {
  id: string
  enabled: boolean
  /** Absolute path to external plugin folder (dev link). Absent = under dataRoot/plugins. */
  linkPath?: string
  /** Original zip file name when installed from archive. */
  sourceArchive?: string
}

export type PluginsIndex = {
  version: 1
  plugins: PluginsIndexEntry[]
}

export function emptyPluginsIndex(): PluginsIndex {
  return { version: 1, plugins: [] }
}

export type PluginPermissionPlan = {
  capabilities: PermissionCapability[]
}

/** Extra context for planPermissions (read-only peek). */
export type PluginPermissionPlanContext = {
  /** Current chat already has ≥1 browser session. */
  hasSession: boolean
}

/**
 * Runtime module exported by plugin main (CJS `module.exports` / `exports.default`).
 * One plugin may register many Agent tools (interfaces).
 */
export type NavoraPluginModule = {
  tools: ChatCompletionTool[]
  /**
   * Permission plan for a specific tool call.
   * Required for execution: missing or empty capabilities → deny.
   */
  planPermissions: (
    toolName: string,
    args: Record<string, unknown>,
    planCtx: PluginPermissionPlanContext,
  ) => PluginPermissionPlan
  execute: (
    toolName: string,
    args: Record<string, unknown>,
    api: PluginHostApi,
  ) => Promise<unknown>
}

/**
 * Host surface passed into plugin execute.
 * No bare ToolExecContext — registry/runTool are capability-gated.
 */
export type PluginHostApi = {
  chatId: string
  signal: AbortSignal
  /** Capabilities approved for this invocation (after PermissionGate). */
  approvedCapabilities: readonly PermissionCapability[]
  helpers: PluginHostHelpers
  getConfig: () => { browser: { url_allowlist?: string[] | null } } & Record<string, unknown>
  registry: PluginHostRegistry
  /**
   * Call a core Agent tool. Required capabilities must already be in
   * `approvedCapabilities` (from planPermissions); otherwise returns error.
   */
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

export type PluginHostRegistry = {
  createSession: (chatId: string, opts?: Record<string, unknown>) => { sessionId: string }
  createWindow: (
    sessionId: string,
    opts?: Record<string, unknown>,
  ) => { windowId: string }
  closeWindow: (windowId: string) => void
  closeSession: (sessionId: string, clear?: boolean) => Promise<void> | void
  assertSessionOwned: (chatId: string, sessionId: string) => unknown
  assertWindowOwned: (chatId: string, windowId: string) => { win: unknown }
  getSessionRecord: (sessionId: string) => { ses: unknown } | null | undefined
  getTree: (chatId: string) => Array<{ sessionId: string }>
  setUserAgent: (sessionId: string, ua: string) => void
  setProxy: (sessionId: string, proxy: string | null) => Promise<void> | void
}

export type PluginHostHelpers = {
  isUrlAllowed: (url: string, allowlist?: string[] | null) => boolean
}
