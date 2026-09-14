import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Portable / beside-exe data lives under this folder (not loose next to the .exe). */
export const PORTABLE_DATA_DIRNAME = 'data'

export function isDevRuntime(): boolean {
  return Boolean(process.env.VITE_DEV_SERVER_URL)
}

/** True when running the electron-builder portable package or a marked portable folder. */
export function isPortableRuntime(): boolean {
  if (process.env.NAVORA_DATA_ROOT) return true
  if (process.env.PORTABLE_EXECUTABLE_DIR) return true
  if (isDevRuntime()) return true

  const execDir = path.dirname(process.execPath)
  const isElectronBinary =
    /electron(\.exe)?$/i.test(process.execPath) ||
    /[/\\]node_modules[/\\]\.bin[/\\]/i.test(process.execPath)
  if (isElectronBinary) return false

  const nested = path.join(execDir, PORTABLE_DATA_DIRNAME)
  const nestedMarker = path.join(nested, '.navora-portable')
  const legacyMarker = path.join(execDir, '.navora-portable')
  return fs.existsSync(nestedMarker) || fs.existsSync(legacyMarker)
}

/**
 * dataRoot:
 * - portable: <exeDir>/data/ (or PORTABLE_EXECUTABLE_DIR/data) — config/chats/secrets here
 * - installed (NSIS): Electron default userData (%APPDATA%/Navora) — config/chats/secrets here
 * - dev: <project>/portable
 */
export function resolveDataRoot(): string {
  const envRoot = process.env.NAVORA_DATA_ROOT
  if (envRoot) {
    return ensurePortableRoot(path.resolve(envRoot))
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return ensurePortableRoot(
      path.join(path.resolve(process.env.PORTABLE_EXECUTABLE_DIR), PORTABLE_DATA_DIRNAME),
    )
  }

  if (isDevRuntime()) {
    const projectRoot = path.resolve(__dirname, '..')
    return ensurePortableRoot(path.join(projectRoot, 'portable'))
  }

  const execDir = path.dirname(process.execPath)
  const isElectronBinary =
    /electron(\.exe)?$/i.test(process.execPath) ||
    /[/\\]node_modules[/\\]\.bin[/\\]/i.test(process.execPath)

  if (!isElectronBinary) {
    const nested = path.join(execDir, PORTABLE_DATA_DIRNAME)
    const nestedMarker = path.join(nested, '.navora-portable')
    const legacyMarker = path.join(execDir, '.navora-portable')
    if (fs.existsSync(nestedMarker) || fs.existsSync(legacyMarker)) {
      return ensurePortableRoot(nested)
    }
    // NSIS / installed build: keep config + workspace under default userData
    return app.getPath('userData')
  }

  const projectRoot = path.resolve(__dirname, '..')
  return ensurePortableRoot(path.join(projectRoot, 'portable'))
}

/** Ensure directory exists and carries the portable marker (never call on AppData userData). */
export function ensurePortableRoot(dataRoot: string): string {
  fs.mkdirSync(dataRoot, { recursive: true })
  const marker = path.join(dataRoot, '.navora-portable')
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, '', 'utf8')
  }
  return dataRoot
}

/**
 * For portable/dev: redirect Electron userData (session/persist) into dataRoot.
 * For installed NSIS: leave the default %APPDATA%/Navora path untouched.
 */
export function applyUserDataPath(dataRoot: string): void {
  if (!isPortableRuntime() && !process.env.NAVORA_DATA_ROOT) {
    return
  }
  const marker = path.join(dataRoot, '.navora-portable')
  const forcePortable =
    Boolean(process.env.PORTABLE_EXECUTABLE_DIR) ||
    fs.existsSync(marker) ||
    Boolean(process.env.NAVORA_DATA_ROOT) ||
    isDevRuntime()

  if (forcePortable) {
    try {
      app.setPath('userData', dataRoot)
    } catch (e) {
      console.warn('[navora] setPath userData failed', e)
    }
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}
