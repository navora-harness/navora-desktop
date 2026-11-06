// Read embedded archives with 7-Zip; never execute an installer/portable launcher.
// Reads payload files through stdout; NSIS inner archives use a temporary file.
// node scripts/verify-release-payloads.mjs --version 0.3.36 --seven-zip <cached 7za.exe> --report
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let version, sevenZip, reportRequested = false
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--version') version = args[++index]
  else if (args[index] === '--seven-zip') sevenZip = args[++index]
  else if (args[index] === '--report') reportRequested = true
  else throw Error(`Unknown argument: ${args[index]}`)
}
assert.match(version || '', /^\d+\.\d+\.\d+$/)
assert.ok(sevenZip && fs.lstatSync(sevenZip).isFile() && !fs.lstatSync(sevenZip).isSymbolicLink(), 'Supply an existing cached extractor with --seven-zip')
const directory = path.join(project, 'release', `v${version}`), unpacked = path.join(directory, 'win-unpacked')
assert.equal(fs.realpathSync(directory).toLowerCase(), directory.toLowerCase())
function walk(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, `Linked packaged file: ${entry.name}`)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? walk(root, name) : [name]
  }).sort()
}
async function fileHash(file) {
  const sha = crypto.createHash('sha256'); let crc = 0, bytes = 0
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); crc = crc32(chunk, crc); bytes += chunk.length }
  return { sha256: sha.digest('hex'), crc32: crc.toString(16).padStart(8, '0').toUpperCase(), bytes }
}
function normalize(name) {
  const normalized = name.replaceAll('\\', '/')
  assert.ok(normalized && !/^(?:\/|[a-z]:)/i.test(normalized) && !normalized.split('/').includes('..'), `Unsafe archive path: ${name}`)
  return normalized
}
function command(args, onData) {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(Error('Embedded archive verification timed out')) }, 120000)
    child.stdout.on('data', onData); child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(stderr) : reject(Error(`Extractor exited ${code}: ${stderr}`)) })
  })
}
const expected = new Map()
for (const name of walk(unpacked)) expected.set(name, await fileHash(path.join(unpacked, name)))
async function archiveRecords(file) {
  let listing = ''
  await command(['l', '-slt', '-bd', file], chunk => { listing += chunk; assert.ok(listing.length < 2_000_000, 'Unexpectedly large package listing') })
  const divider = listing.indexOf('----------')
  assert.ok(divider >= 0, 'Extractor did not find an embedded archive')
  return listing.slice(divider + 10).split(/\r?\n\r?\n/).flatMap(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).filter(line => line.includes(' = ')).map(line => { const at = line.indexOf(' = '); return [line.slice(0, at), line.slice(at + 3)] }))
    if (!fields.Path) return []
    const normalized = normalize(fields.Path)
    assert.ok(!/L/.test(fields.Attributes || ''), `Linked embedded entry: ${normalized}`)
    if (/D/.test(fields.Attributes || '')) return []
    return [{ name: normalized, bytes: Number(fields.Size), crc32: fields.CRC }]
  })
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-payload-check-'))
let results
try {
results = await Promise.all(['Portable', 'Setup'].map(async kind => {
  const name = `Navora-${version}-${kind}.exe`, file = path.join(directory, name)
  let archiveFile = file, records = await archiveRecords(file), container = 'direct-archive'
  const inner = records.find(record => record.name === '$PLUGINSDIR/app-64.7z')
  if (inner) {
    // Some 7-Zip versions expose the NSIS envelope instead of opening its
    // embedded application archive. Inspect that archive with the same strict
    // file-set and hash checks, without running either distribution launcher.
    assert.ok(inner.bytes > 1_000_000 && inner.bytes <= fs.statSync(file).size, 'Unexpected embedded application archive size')
    archiveFile = path.join(temporary, `${kind}.7z`)
    const descriptor = fs.openSync(archiveFile, 'wx')
    try { await command(['e', '-so', '-bd', '-bso0', '-bsp0', '-y', file, path.normalize(inner.name)], chunk => fs.writeSync(descriptor, chunk)) }
    finally { fs.closeSync(descriptor) }
    assert.equal(fs.statSync(archiveFile).size, inner.bytes, 'Embedded application archive was truncated')
    records = await archiveRecords(archiveFile)
    container = 'nsis-with-7z-payload'
  }
  assert.deepEqual(records.map(record => record.name).sort(), [...expected.keys()], `${kind} embedded file set differs from win-unpacked`)
  for (const record of records) {
    const local = expected.get(record.name)
    assert.equal(record.bytes, local.bytes, `Embedded size differs: ${kind}/${record.name}`)
    assert.equal(record.crc32, local.crc32, `Embedded CRC32 differs: ${kind}/${record.name}`)
  }
  const corePayload = []
  for (const entry of ['resources/app.asar', 'Navora.exe']) {
    const sha = crypto.createHash('sha256'); let bytes = 0
    await command(['e', '-so', '-bd', '-bso0', '-bsp0', '-y', archiveFile, path.normalize(entry)], chunk => { sha.update(chunk); bytes += chunk.length })
    const actual = { name: entry, bytes, sha256: sha.digest('hex') }, local = expected.get(entry)
    assert.equal(actual.bytes, local.bytes, `Embedded core size differs: ${kind}/${entry}`)
    assert.equal(actual.sha256, local.sha256, `Embedded core SHA256 differs: ${kind}/${entry}`)
    corePayload.push(actual)
  }
  return { name, container, fileEntries: records.length, crc32FilesMatched: records.length, corePayload }
}))
} finally {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary))
  assert.ok(relative.startsWith('navora-payload-check-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Unsafe payload temporary directory')
  fs.rmSync(temporary, {recursive:true,force:true})
}
const report = { ok: true, version, checkedAt: new Date().toISOString(), artifacts: results,
  scope: 'Both embedded application archives have the same file names, sizes and CRC32 as win-unpacked; app.asar and Navora.exe also match SHA256. NSIS inner compressed archives are temporarily extracted for inspection and removed; no application payload files, launcher or installer are executed. CRC32 is an integrity check, not cryptographic authentication.' }
if (reportRequested) fs.writeFileSync(path.join(directory, 'payload-verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
