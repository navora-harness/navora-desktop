import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = path.resolve(project, '../_planning')
const temp = fs.mkdtempSync(path.join(temporaryRoot, 'navora-real-plugin-faults-'))
const results = []
try {
  const helper = path.join(temp, 'transaction.mjs')
  await build({ entryPoints: [path.join(project, 'electron/modules/plugin-install-transaction.ts')], outfile: helper,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' })
  const { commitPluginInstall, writePluginIndexAtomic, recoverPluginTransactions } = await import(pathToFileURL(helper).href)
  if (process.platform !== 'win32') results.push({ case: 'windows-lock-and-readonly', status: 'not_run', reason: 'requires Windows' })
  else for (const kind of ['exclusive-index-handle', 'readonly-index']) {
    const root = path.join(temp, kind), index = path.join(root, 'index.json')
    for (const name of ['target', 'sibling', '.staging/new']) {
      fs.mkdirSync(path.join(root, name), { recursive: true })
      fs.writeFileSync(path.join(root, name, 'value'), name === '.staging/new' ? 'new-target' : `old-${name}`)
    }
    fs.writeFileSync(index, 'old-index')
    let holder, exit, unlocked = false
    const unlock = async () => {
      if (unlocked) return
      unlocked = true
      if (holder) { holder.stdin.end('\n'); await exit }
      else fs.chmodSync(index, 0o666)
    }
    try {
      if (kind === 'readonly-index') fs.chmodSync(index, 0o444)
      else {
        const script = `$ErrorActionPreference='Stop'; $stream=[System.IO.File]::Open($env:NAVORA_TEST_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); [void][Console]::ReadLine() } finally { $stream.Dispose() }`
        holder = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NAVORA_TEST_LOCK_FILE: index } })
        let stderr = ''
        holder.stderr.on('data', data => { stderr += data })
        exit = new Promise((resolve, reject) => { holder.once('error', reject); holder.once('exit', code => code === 0 ? resolve() : reject(Error(`lock holder exited ${code}: ${stderr}`))) })
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('lock holder deadline')), 10_000)
          let text = ''
          holder.stdout.on('data', data => { text += data; if (text.includes('locked')) { clearTimeout(timer); resolve() } })
          exit.then(() => { clearTimeout(timer); reject(Error('lock holder exited before ready')) }, error => { clearTimeout(timer); reject(error) })
        })
      }
      assert.throws(() => commitPluginInstall(root, path.join(root, '.staging/new'), 'target', ['sibling'],
        () => writePluginIndexAtomic(index, 'new-index')), /install_rollback_failed/)
      const blocked = recoverPluginTransactions(root)
      assert.equal(blocked.blocked, true)
      assert.equal(blocked.issues[0]?.kind, 'retryable')
      const pending = fs.readdirSync(path.join(root, '.transactions'))[0]
      assert.equal(fs.readFileSync(path.join(root, '.transactions', pending, 'backup/target/value'), 'utf8'), 'old-target')
      await unlock()
      const recovered = recoverPluginTransactions(root)
      assert.equal(recovered.blocked, false)
      assert.equal(fs.readFileSync(path.join(root, 'target/value'), 'utf8'), 'old-target')
      assert.equal(fs.readFileSync(path.join(root, 'sibling/value'), 'utf8'), 'old-sibling')
      assert.equal(fs.readFileSync(index, 'utf8'), 'old-index')
      assert.equal(recoverPluginTransactions(root).recovered, 0)
      results.push({ case: kind, status: 'passed', ioCode: blocked.issues[0].error, immutableBackupRetained: true, retryAfterRelease: 'passed', idempotent: true })
    } finally { await unlock() }
  }
  const report = { ok: true, platform: process.platform, arch: process.arch, node: process.version, results,
    boundary: 'Actual Windows exclusive file handle and readonly attribute. Disk exhaustion, ACL changes, device failure and power loss are not tested.' }
  if (process.env.NAVORA_PLUGIN_FAULT_REPORT) fs.writeFileSync(path.resolve(process.env.NAVORA_PLUGIN_FAULT_REPORT), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  if (path.dirname(temp) !== temporaryRoot || !path.basename(temp).startsWith('navora-real-plugin-faults-')) throw Error('unsafe_test_cleanup')
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
