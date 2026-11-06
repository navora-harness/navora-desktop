import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'

const require=createRequire(import.meta.url)
export const electronRuntimePin=JSON.parse(fs.readFileSync(new URL('./electron-runtime-manifest.json',import.meta.url),'utf8'))
const digest=/^[a-f0-9]{64}$/u
if(!/^\d+\.\d+\.\d+-cloudbypass\.\d+$/u.test(electronRuntimePin.version)||!/^(replacement|release)-[a-f0-9]{12}$/u.test(electronRuntimePin.revision)||electronRuntimePin.platform!=='win32'||electronRuntimePin.arch!=='x64')throw Error('Invalid pinned Electron runtime identity')
for(const field of ['binarySha256','binaryCodeSha256','typesSha256'])if(!digest.test(electronRuntimePin[field]||''))throw Error(`Invalid pinned Electron ${field}`)
const assetPrefix=electronRuntimePin.revision.startsWith('replacement-')?`${electronRuntimePin.revision}-`:''
const manifestName=electronRuntimePin.provenance.manifest.name.slice(assetPrefix.length)
if(!['automation-build-manifest.json','native-panel-build-manifest.json'].includes(manifestName))throw Error('Invalid pinned Electron provenance manifest')
for(const [asset,name] of [[electronRuntimePin.archive,`electron-v${electronRuntimePin.version}-win32-x64.zip`],[electronRuntimePin.npm,`electron-${electronRuntimePin.version}.tgz`],[electronRuntimePin.provenance.manifest,manifestName],[electronRuntimePin.provenance.releaseNotes,'release-notes.md']]){
  if(!asset||asset.name!==assetPrefix+name||path.basename(asset.name)!==asset.name||!Number.isSafeInteger(asset.size)||asset.size<=0||!digest.test(asset.sha256||'')||asset.url!==`https://github.com/ChengHoward/edist/releases/download/v${electronRuntimePin.version}/${asset.name}`)throw Error('Invalid pinned Electron asset')
}
if(!/^sha512-[A-Za-z0-9+/]{86}==$/u.test(electronRuntimePin.npm.integrity||''))throw Error('Invalid pinned Electron npm integrity')
export const electronRuntimeDirectoryName=`${electronRuntimePin.version}-${electronRuntimePin.archive.sha256.slice(0,12)}`
export const electronRuntimeExecutableEntry=`${electronRuntimeDirectoryName}/electron.exe`
export function electronFileSha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
export function verifyElectronArchive(file){
  const stat=fs.lstatSync(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==electronRuntimePin.archive.size||electronFileSha256(file)!==electronRuntimePin.archive.sha256)throw Error('Electron runtime archive failed the pinned size/checksum')
}
export function electronBinaryIdentity(executable){
  const stat=fs.lstatSync(executable)
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Electron runtime requires a regular executable')
  const bytes=fs.readFileSync(executable),binarySha256=crypto.createHash('sha256').update(bytes).digest('hex')
  if(bytes.length<64||bytes.readUInt16LE(0)!==0x5a4d)throw Error('Invalid Electron PE executable')
  const pe=bytes.readUInt32LE(60)
  if(pe+24>bytes.length||bytes.readUInt32LE(pe)!==0x4550||bytes.readUInt16LE(pe+4)!==0x8664)throw Error('Expected x64 Electron PE executable')
  const count=bytes.readUInt16LE(pe+6),start=pe+24+bytes.readUInt16LE(pe+20)
  if(count<1||count>96||start+count*40>bytes.length)throw Error('Invalid Electron PE sections')
  for(let index=0;index<count;index++){
    const at=start+index*40
    if(bytes.subarray(at,at+8).toString().replace(/\0.*$/u,'')!=='.text')continue
    const size=bytes.readUInt32LE(at+16),offset=bytes.readUInt32LE(at+20)
    if(!size||offset+size>bytes.length)throw Error('Invalid Electron code section')
    return {binarySha256,codeSha256:crypto.createHash('sha256').update(bytes.subarray(offset,offset+size)).digest('hex')}
  }
  throw Error('Electron executable has no code section')
}
export function verifyPinnedElectronBinary(executable){
  const identity=electronBinaryIdentity(executable)
  if(identity.binarySha256!==electronRuntimePin.binarySha256||identity.codeSha256!==electronRuntimePin.binaryCodeSha256)throw Error('Electron runtime executable failed the pinned full/code checksum')
  return identity
}

/** Resolve identity beside the selected binary, including versioned runtime directories and overrides. */
export function electronRuntimeRelease(executable){
  if(!path.isAbsolute(executable)||!fs.statSync(executable).isFile())throw Error('Electron smoke requires an existing absolute executable path')
  const packagePath=require.resolve('electron/package.json'),installedVersion=JSON.parse(fs.readFileSync(packagePath,'utf8')).version
  if(installedVersion!==electronRuntimePin.version||electronFileSha256(path.join(path.dirname(packagePath),'electron.d.ts'))!==electronRuntimePin.typesSha256)throw Error('Installed Electron package/types differ from the pinned runtime')
  const marker=JSON.parse(fs.readFileSync(path.join(path.dirname(executable),'navora-cloudbypass-runtime.json'),'utf8'))
  if(marker.version!==installedVersion)throw Error(`Selected Electron runtime ${marker.version} differs from installed public types ${installedVersion}`)
  if(marker.revision!==electronRuntimePin.revision||marker.sha256!==electronRuntimePin.archive.sha256||marker.binarySha256!==electronRuntimePin.binarySha256||marker.binaryCodeSha256!==electronRuntimePin.binaryCodeSha256||marker.source!==electronRuntimePin.archive.url)throw Error('Selected Electron runtime does not match the pinned installation revision')
  verifyPinnedElectronBinary(executable)
  return marker.version
}
