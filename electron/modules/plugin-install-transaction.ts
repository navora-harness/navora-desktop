import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PluginRecoveryStatus } from '../../shared/plugins'

type Journal = { version: 2; target: string | null; existing: string[]; removed: string[]; oldIndex: string | null; committed: boolean }
export type PluginRecoveryReport = PluginRecoveryStatus
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024

function child(root: string, name: string): string {
  if (typeof name !== 'string' || !name || name.startsWith('.') || name === 'index.json' || name.length > 255
    || /[/\\:\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('invalid_install_target')
  const result = path.resolve(root, name)
  if (path.dirname(result) !== path.resolve(root)) throw new Error('invalid_install_target')
  return result
}
function directory(dir: string): void {
  const st = fs.lstatSync(dir)
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('invalid_install_path')
}
function syncDirectory(dir: string): void {
  // Windows does not expose directory fsync through Node. File fsync still applies.
  let fd: number | undefined
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd) }
  catch (e) { if (process.platform !== 'win32') throw e }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}
export function writePluginIndexAtomic(file: string, value: string): void {
  const dir = path.dirname(file)
  directory(dir)
  const tmp = path.join(dir, `.${path.basename(file)}-${randomUUID()}.tmp`)
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try { fs.writeFileSync(fd, value, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, file)
    syncDirectory(dir)
  } finally { fs.rmSync(tmp, { force: true }) }
}
function validateJournal(raw: unknown, root: string): Journal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_install_journal')
  const o = raw as Record<string, unknown>
  const legacy = o.version === 1
  if (!legacy && o.version !== 2) throw new Error('invalid_install_journal')
  const allowed = legacy ? ['version', 'target', 'existed', 'removed', 'oldIndex', 'committed'] : ['version', 'target', 'existing', 'removed', 'oldIndex', 'committed']
  if (Object.keys(o).some(k => !allowed.includes(k)) || (o.target !== null && typeof o.target !== 'string')
    || !Array.isArray(o.removed) || o.removed.length > 10_000 || (o.oldIndex !== null && typeof o.oldIndex !== 'string')
    || (typeof o.oldIndex === 'string' && Buffer.byteLength(o.oldIndex) > MAX_JOURNAL_BYTES / 2)
    || (o.committed !== undefined && typeof o.committed !== 'boolean') || (!legacy && typeof o.committed !== 'boolean')
    || (legacy && (typeof o.existed !== 'boolean' || typeof o.target !== 'string'))
    || (!legacy && !Array.isArray(o.existing))) throw new Error('invalid_install_journal')
  const removed = o.removed as string[]
  const existing = legacy ? (o.existed ? [o.target as string] : []) : o.existing as string[]
  for (const name of [...removed, ...existing]) child(root, name)
  if (new Set(removed.map(n => n.toLowerCase())).size !== removed.length || new Set(existing).size !== existing.length
    || existing.some(n => !removed.includes(n)) || (o.target !== null && !removed.includes(o.target as string))) throw new Error('invalid_install_journal')
  // V1 backed up every removed directory even though only target existence was recorded.
  return { version: 2, target: o.target as string | null, removed, existing, oldIndex: o.oldIndex as string | null, committed: o.committed === true }
}
function rollback(root: string, dir: string, j: Journal): void {
  const backupRoot = path.join(dir, 'backup')
  directory(backupRoot)
  for (const name of j.removed) {
    const backup = child(backupRoot, name), dest = child(root, name)
    if (fs.existsSync(backup)) {
      directory(backup)
      // Keep the backup immutable until the entire rollback succeeds. Repeating
      // recovery after an interruption therefore cannot consume its only copy.
      const restoring = path.join(dir, `restore-${randomUUID()}`)
      try {
        fs.cpSync(backup, restoring, { recursive: true, dereference: false })
        fs.rmSync(dest, { recursive: true, force: true })
        fs.renameSync(restoring, dest)
      } finally {
        try { fs.rmSync(restoring, { recursive: true, force: true }) } catch { /* Retain the backup if cleanup is denied. */ }
      }
      syncDirectory(root)
    } else if (j.target === name && !j.existing.includes(name)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  }
  const index = path.join(root, 'index.json')
  if (j.oldIndex === null) { fs.rmSync(index, { force: true }); syncDirectory(root) }
  else writePluginIndexAtomic(index, j.oldIndex)
}
function readJournal(root: string, dir: string): Journal {
  directory(dir)
  const file = path.join(dir, 'journal.json')
  const st = fs.lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_JOURNAL_BYTES) throw new Error('invalid_install_journal')
  return validateJournal(JSON.parse(fs.readFileSync(file, 'utf8')), root)
}
function recoveryError(error: unknown): { error: string; kind: 'retryable' | 'invalid' } {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code && code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ELOOP') return { error: code, kind: 'retryable' }
  // Do not expose JSON parser messages: they may include index or plugin content.
  return { error: 'invalid_install_journal', kind: 'invalid' }
}
export function recoverPluginTransactions(root: string, retryQuarantined = false): PluginRecoveryReport {
  const report: PluginRecoveryReport = { recovered: 0, issues: [], blocked: false }
  const quarantine = path.join(root, '.transaction-quarantine')
  const transactions = path.join(root, '.transactions')
  const issue = (file: string, error: unknown) => { report.issues.push({ path: file, ...recoveryError(error) }); report.blocked = true }
  try {
    directory(root)
    if (fs.existsSync(quarantine)) {
      directory(quarantine)
      const entries = fs.readdirSync(quarantine)
      for (const name of entries) {
        const dir = path.join(quarantine, name)
        // Paired diagnostic files are evidence, not executable recovery records.
        if (name.endsWith('.diagnostic.json') && entries.includes(name.slice(0, -16))) continue
        try {
          if (!UUID.test(name)) throw new Error('invalid_install_journal')
          const j = readJournal(root, dir)
          if (!retryQuarantined) {
            report.issues.push({ path: dir, error: 'install_recovery_required', kind: 'retryable' }); report.blocked = true
            continue
          }
          if (!j.committed) rollback(root, dir, j)
          fs.rmSync(dir, { recursive: true, force: true })
          fs.rmSync(`${dir}.diagnostic.json`, { force: true })
          report.recovered++
        } catch (error) { issue(dir, error) }
      }
    }
    if (fs.existsSync(transactions)) {
      directory(transactions)
      for (const name of fs.readdirSync(transactions)) {
        const dir = path.join(transactions, name)
        let validated = false
        try {
          if (!UUID.test(name)) throw new Error('invalid_install_journal')
          const j = readJournal(root, dir)
          validated = true
          if (!j.committed) rollback(root, dir, j)
          fs.rmSync(dir, { recursive: true, force: true })
          report.recovered++
        } catch (error) {
          // An IO failure is not corruption. Keep the transaction and immutable
          // backups in place so freeing space/unlocking permits a direct retry.
          if (validated || recoveryError(error).kind === 'retryable') { issue(dir, error); continue }
          let evidence = dir
          try {
            fs.mkdirSync(quarantine, { recursive: true }); directory(quarantine)
            evidence = path.join(quarantine, randomUUID())
            fs.renameSync(dir, evidence)
            writePluginIndexAtomic(`${evidence}.diagnostic.json`, JSON.stringify({ source: name, error: 'invalid_install_journal' }))
          } catch (ioError) { issue(evidence, ioError); continue }
          issue(evidence, error)
        }
      }
    }
  } catch (error) { issue(root, error) }
  if (report.blocked) report.diagnosticDirectory = root
  return report
}
function commit(root: string, stage: string | null, target: string | null, remove: string[], applyAndValidate: () => void): void {
  directory(root)
  const removed = [...new Set([...remove, ...(target ? [target] : [])])]
  for (const name of removed) child(root, name)
  if (stage) {
    const staging = path.join(root, '.staging')
    directory(staging); directory(stage)
    if (path.dirname(path.resolve(stage)) !== path.resolve(staging) || fs.realpathSync(stage) !== path.resolve(stage)) throw new Error('invalid_install_stage')
  }
  const index = path.join(root, 'index.json')
  const existing = removed.filter(name => fs.existsSync(child(root, name)))
  for (const name of existing) directory(child(root, name))
  const j: Journal = { version: 2, target, existing, removed, oldIndex: fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : null, committed: false }
  validateJournal(j, root)
  const transactions = path.join(root, '.transactions')
  fs.mkdirSync(transactions, { recursive: true }); directory(transactions)
  const dir = path.join(transactions, randomUUID()), backup = path.join(dir, 'backup')
  fs.mkdirSync(backup, { recursive: true })
  const journal = path.join(dir, 'journal.json')
  try { writePluginIndexAtomic(journal, JSON.stringify(j)) }
  catch (error) {
    // No live directory has moved yet. A failed preparation can be removed
    // without destroying the only recoverable copy of any package.
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Leave evidence if cleanup itself is denied. */ }
    throw error
  }
  try {
    for (const name of existing) { fs.renameSync(child(root, name), child(backup, name)); syncDirectory(root); syncDirectory(backup) }
    if (stage && target) { fs.renameSync(stage, child(root, target)); syncDirectory(root) }
    applyAndValidate()
    writePluginIndexAtomic(journal, JSON.stringify({ ...j, committed: true }))
  } catch (error) {
    try { rollback(root, dir, j) } catch { throw new Error('install_rollback_failed') }
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Committed; startup retries cleanup. */ }
}
/** Caller validates candidate first; stage must be a direct child of root/.staging. */
export function commitPluginInstall(root: string, stage: string, target: string, remove: string[], applyAndValidate: () => void): void {
  commit(root, stage, target, remove, applyAndValidate)
}
/** Index-only link switching and uninstall use the same retained-directory rollback. */
export function commitPluginMutation(root: string, remove: string[], applyAndValidate: () => void): void {
  commit(root, null, null, remove, applyAndValidate)
}
