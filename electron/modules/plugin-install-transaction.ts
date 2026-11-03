import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

type Journal = { version: 1; target: string; existed: boolean; oldIndex: string | null; removed: string[]; committed?: boolean }
function child(root: string, name: string): string {
  if (!name || name.startsWith('.') || /[/\\:]/.test(name) || name === 'index.json') throw new Error('invalid_install_target')
  return path.join(root, name)
}
function rollback(root: string, dir: string, j: Journal): void {
  for (const name of j.removed) {
    const backup = child(path.join(dir, 'backup'), name), dest = child(root, name)
    if (fs.existsSync(backup)) {
      fs.rmSync(dest, { recursive: true, force: true })
      fs.renameSync(backup, dest)
    }
  }
  if (!j.existed) fs.rmSync(child(root, j.target), { recursive: true, force: true })
  const index = path.join(root, 'index.json')
  if (j.oldIndex === null) fs.rmSync(index, { force: true })
  else fs.writeFileSync(index, j.oldIndex, 'utf8')
}
export function recoverPluginTransactions(root: string): void {
  const transactions = path.join(root, '.transactions')
  if (!fs.existsSync(transactions)) return
  for (const name of fs.readdirSync(transactions)) {
    if (!/^[a-f0-9-]{36}$/.test(name)) throw new Error('invalid_install_journal')
    const dir = path.join(transactions, name), file = path.join(dir, 'journal.json')
    if (!fs.existsSync(file)) { fs.rmSync(dir, { recursive: true, force: true }); continue }
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal
    if (j.version !== 1 || !Array.isArray(j.removed)) throw new Error('invalid_install_journal')
    child(root, j.target)
    for (const item of j.removed) child(root, item)
    if (!j.committed) rollback(root, dir, j)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
/** Caller validates the staged package first. Same-volume renames; recoverable index + directory transaction. */
export function commitPluginInstall(root: string, stage: string, target: string, remove: string[], applyAndValidate: () => void): void {
  const dest = child(root, target)
  const dir = path.join(root, '.transactions', randomUUID()), backup = path.join(dir, 'backup')
  fs.mkdirSync(backup, { recursive: true })
  const index = path.join(root, 'index.json')
  const j: Journal = { version: 1, target, existed: fs.existsSync(dest), removed: [...new Set([...remove, target])],
    oldIndex: fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : null }
  const journal = path.join(dir, 'journal.json')
  fs.writeFileSync(journal, JSON.stringify(j), { flag: 'wx' })
  try {
    for (const name of j.removed) {
      const source = child(root, name)
      if (fs.existsSync(source)) fs.renameSync(source, child(backup, name))
    }
    fs.renameSync(stage, dest)
    applyAndValidate()
    const done = path.join(dir, 'committed.json')
    fs.writeFileSync(done, JSON.stringify({ ...j, committed: true }))
    fs.renameSync(done, journal)
  } catch (error) {
    try { rollback(root, dir, j) } catch { throw new Error('install_rollback_failed') }
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
  // A failure removing backups must not undo a committed installation.
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Recovered at startup. */ }
}
