// Static Windows release verification. Never starts an application or installer.
// node scripts/verify-release.mjs --version 0.3.36 --write-manifest --report
// Run again without --write-manifest to independently check the saved summaries.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {electronRuntimePin,electronRuntimeRelease} from './electron-runtime-release.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const asar = require('@electron/asar'), yaml = require('js-yaml')
const runtimeVersion = electronRuntimePin.version
const runtimeArchiveSha256 = electronRuntimePin.archive.sha256
// Measured from electron.exe in the checksum-verified custom runtime archive.
// App resources and signatures can change, but packaging must preserve .text.
const runtimeCodeSha256 = electronRuntimePin.binaryCodeSha256
const nativeBindings = ['dispatchInputSequence', 'setAutomationOptions', 'getAutomationState', 'resetAutomationOptions', 'clickElement', 'setVirtualCursorImage', 'setVirtualCursorFrameRate', 'getAgentSnapshot', 'NativePanel', 'showPageInfoDialog']
const args = process.argv.slice(2), flags = new Set()
let version
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--version') version = args[++index]
  else if (['--runtime-only', '--skip-source', '--write-manifest', '--report'].includes(args[index])) flags.add(args[index])
  else throw Error(`Unknown argument: ${args[index]}`)
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function hashes(file) {
  const sha = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); sha512.update(chunk) }
  return { sha256: sha.digest('hex'), sha512: sha512.digest('base64') }
}
function regular(file) {
  const stat = fs.lstatSync(file)
  assert.equal(stat.isSymbolicLink(), false, `Linked artifact is not accepted: ${file}`)
  assert.equal(stat.isFile(), true, `Expected a regular file: ${file}`)
  return stat
}
function filesBelow(directory, prefix = '') {
  assert.equal(fs.lstatSync(directory).isSymbolicLink(), false, `Linked directory is not accepted: ${directory}`)
  return fs.readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    assert.equal(entry.isSymbolicLink(), false, `Linked artifact is not accepted: ${name}`)
    return entry.isDirectory() ? filesBelow(directory, name) : [name]
  }).sort()
}
function safeRelative(name) {
  const normalized = name.replaceAll('\\', '/').replace(/^\//, '')
  assert.ok(normalized && !/^(?:\/|[a-z]:)/i.test(normalized) && !normalized.split('/').some(part => part === '..'), `Unsafe archive path: ${name}`)
  return normalized
}
function forbiddenData(name) {
  const normalized = safeRelative(name)
  return /^(?:data|portable|secrets|chats|profile|profiles|user-data|probe-user-data)(?:\/|$)/i.test(normalized)
    || /(?:^|\/)(?:\.navora-portable|\.env(?:\.[^/]*)?|config\.ya?ml|secrets\.json|browser-workspace\.json|Cookies(?:-journal)?|Login Data|Local State)$/i.test(normalized)
    || /(?:^|\/)(?:Partitions|Session Storage|Local Storage|IndexedDB)(?:\/|$)/i.test(normalized)
}
function cleanPaths(names, label) {
  assert.deepEqual(names.filter(forbiddenData), [], `${label} contains a private-data path`)
}
function readPeIdentity(file) {
  regular(file)
  const bytes = fs.readFileSync(file)
  assert.ok(bytes.length >= 64 && bytes.readUInt16LE(0) === 0x5a4d, `Expected Windows PE: ${file}`)
  const pe = bytes.readUInt32LE(60)
  assert.ok(pe + 24 <= bytes.length && bytes.readUInt32LE(pe) === 0x4550, 'Invalid PE header')
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Expected x64 executable')
  const count = bytes.readUInt16LE(pe + 6), start = pe + 24 + bytes.readUInt16LE(pe + 20)
  assert.ok(count > 0 && count <= 96 && start + count * 40 <= bytes.length, 'Invalid PE section table')
  for (let index = 0; index < count; index++) {
    const at = start + index * 40, name = bytes.subarray(at, at + 8).toString().replace(/\0.*$/, '')
    if (name !== '.text') continue
    const size = bytes.readUInt32LE(at + 16), offset = bytes.readUInt32LE(at + 20)
    assert.ok(size > 0 && offset + size <= bytes.length, 'Invalid PE code section')
    const codeHash = sha256(bytes.subarray(offset, offset + size))
    assert.equal(codeHash, runtimeCodeSha256, 'Unexpected custom Electron runtime code identity')
    for (const binding of nativeBindings) assert.ok(bytes.includes(Buffer.from(binding)), `Missing native binding: ${binding}`)
    return { platform: 'win32', arch: 'x64', version: runtimeVersion, codeSha256: codeHash, nativeBindings }
  }
  throw Error('Executable has no .text section')
}
const runtimeDirectory = path.dirname(require('electron'))
assert.equal(electronRuntimeRelease(path.join(runtimeDirectory,'electron.exe')),runtimeVersion)
assert.equal(require('electron/package.json').version, runtimeVersion)
const runtime = readPeIdentity(path.join(runtimeDirectory, 'electron.exe'))
if (flags.has('--runtime-only')) {
  console.log(JSON.stringify({ ok: true, mode: 'runtime-static-only', runtime, runtimeRevision:electronRuntimePin.revision, runtimeArchiveSha256, runtimeBinarySha256:electronRuntimePin.binarySha256, limitation: 'Binary identity and binding presence do not certify physical OS input filtering or cursor compositor visibility.' }, null, 2))
  process.exit(0)
}
assert.ok(/^\d+\.\d+\.\d+$/.test(version || ''), 'Supply --version with a release version such as 0.3.36')
const directory = path.join(project, 'release', `v${version}`), unpacked = path.join(directory, 'win-unpacked')
assert.equal(fs.realpathSync(directory).toLowerCase(), directory.toLowerCase(), 'Release directory must not redirect outside the project')
const archivePath = path.join(unpacked, 'resources/app.asar')
regular(archivePath)
const entries = asar.listPackage(archivePath).map(safeRelative), leafNames = []
for (const name of entries) {
  const entry = asar.statFile(archivePath, path.normalize(name), false)
  assert.equal(typeof entry.link, 'undefined', `Linked ASAR entry is not accepted: ${name}`)
  if (!entry.files) leafNames.push(name)
}
cleanPaths(entries, 'app.asar')
const unpackedFiles = filesBelow(unpacked)
cleanPaths(unpackedFiles, 'win-unpacked')
const metadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'))
assert.equal(metadata.name, 'navora'); assert.equal(metadata.version, version)
assert.equal(metadata.main, 'dist-electron/main.js')
const allowedMainFiles = ['main.js', 'main.js.map', 'preload.js', 'preload.js.map', 'plugin-dev-prompt.md']
const appFiles = leafNames.filter(name => name.startsWith('dist/') || name.startsWith('dist-electron/')).sort()
for (const name of appFiles) if (name.startsWith('dist-electron/')) {
  const relative = name.slice('dist-electron/'.length)
  assert.ok(allowedMainFiles.includes(relative) || relative.startsWith('assets/'), `Unexpected packaged Electron entry or optional plugin: ${name}`)
}
let sourceFilesMatched = null, sourceFiles = []
if (!flags.has('--skip-source')) {
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).version, version, 'Project version changed after packaging')
  const expected = [...filesBelow(path.join(project, 'dist')).map(name => `dist/${name}`),
    ...allowedMainFiles.map(name => `dist-electron/${name}`),
    ...filesBelow(path.join(project, 'dist-electron/assets')).map(name => `dist-electron/assets/${name}`)].sort()
  assert.deepEqual(appFiles, expected, 'Packaged application file set differs from the selected build outputs')
  for (const name of expected) {
    const source = fs.readFileSync(path.join(project, name)), packed = asar.extractFile(archivePath, path.normalize(name))
    assert.ok(source.equals(packed), `Packaged source mismatch: ${name}`)
    sourceFiles.push({ name, bytes: source.length, sha256: sha256(source) })
  }
  sourceFilesMatched = sourceFiles.length
}
const packagedRuntime = readPeIdentity(path.join(unpacked, 'Navora.exe'))
const runtimeFiles = filesBelow(runtimeDirectory).filter(name => name.startsWith('locales/') || /\.(?:dll|pak|bin|dat)$/.test(name))
for (const name of runtimeFiles) {
  const source = path.join(runtimeDirectory, name), packed = path.join(unpacked, name)
  regular(packed)
  assert.equal((await hashes(packed)).sha256, (await hashes(source)).sha256, `Packaged runtime resource differs: ${name}`)
}
const artifacts = []
for (const name of [`Navora-${version}-Portable.exe`, `Navora-${version}-Setup.exe`, `Navora-${version}-Setup.exe.blockmap`]) {
  const file = path.join(directory, name), stat = regular(file)
  assert.ok(stat.size > (name.endsWith('.exe') ? 1_000_000 : 0), `Missing or incomplete release artifact: ${name}`)
  artifacts.push({ name, bytes: stat.size, ...await hashes(file) })
}
const latestPath = path.join(directory, 'latest.yml'), latest = yaml.load(fs.readFileSync(latestPath, 'utf8'))
const setup = artifacts.find(item => item.name.endsWith('-Setup.exe'))
assert.equal(latest.version, version); assert.equal(decodeURIComponent(latest.path), setup.name); assert.equal(latest.sha512, setup.sha512)
assert.equal(latest.files?.length, 1, 'Expected exactly one Windows update artifact')
assert.equal(decodeURIComponent(latest.files[0].url), setup.name)
assert.equal(latest.files[0].sha512, setup.sha512); assert.equal(latest.files[0].size, setup.bytes)
const report = { ok: true, mode: 'static-only', version, platform: 'win32', arch: 'x64', runtimeVersion,
  runtimeCodeSha256: packagedRuntime.codeSha256, runtimeArchiveSha256, runtimeResourcesMatched: runtimeFiles.length,
  createdAt: new Date().toISOString(), archive: { entries: entries.length, sha256: (await hashes(archivePath)).sha256, sourceFilesMatched, privatePaths: [] },
  sourceFiles, artifacts, updateMetadata: { name: 'latest.yml', ...await hashes(latestPath) },
  scope: 'Static packaged-file inspection. No application or installer was launched. Private-data path exclusions are not a scan for arbitrary hardcoded secrets. Installer/portable embedded payloads and installer interactions require separate verification.' }
const manifestPath = path.join(directory, 'release-manifest.json'), sumsPath = path.join(directory, 'SHA256SUMS.txt')
if (flags.has('--write-manifest')) {
  assert.equal(flags.has('--skip-source'), false, 'Do not publish a new manifest while skipping source comparison')
  fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(sumsPath, artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n')
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
for (const field of ['version', 'platform', 'arch', 'runtimeVersion', 'runtimeCodeSha256', 'runtimeArchiveSha256']) assert.equal(manifest[field], report[field], `Release manifest mismatch: ${field}`)
assert.equal(manifest.archive.sha256, report.archive.sha256); assert.deepEqual(manifest.archive.privatePaths, [])
assert.equal(manifest.artifacts.length, artifacts.length)
for (const item of artifacts) assert.deepEqual(manifest.artifacts.find(saved => saved.name === item.name), item, `Manifest artifact mismatch: ${item.name}`)
if (manifest.sourceFiles) {
  if (!flags.has('--skip-source')) assert.deepEqual(manifest.sourceFiles, sourceFiles, 'Manifest source list mismatch')
  else {
    assert.deepEqual(manifest.sourceFiles.map(item => item.name).sort(), appFiles, 'Manifest packaged source file set mismatch')
    for (const item of manifest.sourceFiles) {
      const packed = asar.extractFile(archivePath, path.normalize(item.name))
      assert.equal(packed.length, item.bytes, `Manifest source size mismatch: ${item.name}`)
      assert.equal(sha256(packed), item.sha256, `Manifest source hash mismatch: ${item.name}`)
    }
  }
}
if (manifest.updateMetadata) assert.deepEqual(manifest.updateMetadata, report.updateMetadata, 'Manifest update metadata mismatch')
const sums = fs.readFileSync(sumsPath, 'utf8').trim().split(/\r?\n/).map(line => {
  const match = /^([a-f0-9]{64}) {2}([^\\/\r\n]+)$/.exec(line)
  assert.ok(match, `Malformed SHA256SUMS record: ${line}`)
  return { name: match[2], sha256: match[1] }
})
assert.deepEqual(sums, artifacts.map(({ name, sha256 }) => ({ name, sha256 })), 'SHA256SUMS does not exactly match this release')
if (flags.has('--report')) fs.writeFileSync(path.join(directory, 'package-verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, sourceFiles: undefined }, null, 2))
