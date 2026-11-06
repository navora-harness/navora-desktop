import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {electronRuntimePin as pin,electronRuntimeDirectoryName,electronRuntimeExecutableEntry,verifyElectronArchive,verifyPinnedElectronBinary,electronRuntimeRelease} from './electron-runtime-release.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const electronDir=path.join(root,'node_modules','electron')
const packageInfo=JSON.parse(fs.readFileSync(path.join(electronDir,'package.json'),'utf8'))
const version=pin.version
// Keep running earlier distributions intact while installing a new release.
const runtimeBase=path.join(electronDir,'dist')
const distDir=path.join(runtimeBase,electronRuntimeDirectoryName)
const executableEntry=electronRuntimeExecutableEntry
const archiveName=pin.archive.name
const downloadUrl=pin.archive.url
const expectedSha256=pin.archive.sha256
const expectedBinarySha256=pin.binarySha256
const expectedTypesSha256=pin.typesSha256
const marker=path.join(distDir,'navora-cloudbypass-runtime.json')
const runtimePath=path.join(electronDir,'path.txt')
const requiredResources=['resources.pak','icudtl.dat','version','chrome_100_percent.pak','chrome_200_percent.pak']
const hashFile=filePath=>crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
function writeRuntimeEntry(){
  const temporary=path.join(electronDir,`.path-${crypto.randomUUID()}.txt`)
  try{fs.writeFileSync(temporary,executableEntry);fs.renameSync(temporary,runtimePath)}
  finally{fs.rmSync(temporary,{force:true})}
}
function installedRuntimeValid(){
  try{return electronRuntimeRelease(path.join(distDir,'electron.exe'))===version&&requiredResources.every(name=>fs.statSync(path.join(distDir,name)).isFile())}catch{return false}
}

if(packageInfo.version!==version)throw new Error(`Expected electron ${version}; found ${packageInfo.version}`)
if(hashFile(path.join(electronDir,'electron.d.ts'))!==expectedTypesSha256)throw new Error('Installed Electron public types failed the published checksum')
if(process.platform!=='win32'||process.arch!=='x64')throw new Error(`${version} only ships a Windows x64 runtime`)
if(fs.lstatSync(electronDir).isSymbolicLink())throw new Error('Refusing to install into a linked Electron package')
if(path.resolve(distDir)!==path.join(path.resolve(electronDir),'dist',electronRuntimeDirectoryName))throw new Error('Refusing to replace an unexpected Electron runtime directory')
if(fs.existsSync(runtimeBase)&&fs.lstatSync(runtimeBase).isSymbolicLink())throw new Error('Refusing to install beneath a linked Electron runtime directory')
if(fs.existsSync(distDir)&&fs.lstatSync(distDir).isSymbolicLink())throw new Error('Refusing to use a linked Electron runtime directory')
if(installedRuntimeValid()){
  // Electron's npm entry reads this file at package root, with no trim().
  writeRuntimeEntry()
  console.log(`Electron ${version} ${pin.revision} runtime already installed`)
  process.exit(0)
}
// Immutable distributions may be in use by an existing process. Never move or
// overwrite one, including a same-version directory that failed verification.
if(fs.existsSync(distDir))throw new Error(`Pinned runtime directory exists but failed verification; retained unchanged: ${distDir}`)

const archivePath=process.env.NAVORA_ELECTRON_ARCHIVE||path.join(os.tmpdir(),archiveName)
if(!fs.existsSync(archivePath)||fs.statSync(archivePath).size!==pin.archive.size||hashFile(archivePath)!==expectedSha256){
  if(process.env.NAVORA_ELECTRON_ARCHIVE)throw new Error('Supplied Electron archive failed the published checksum')
  fs.rmSync(archivePath,{force:true})
  const size=pin.archive.size,parts=8,partPaths=Array.from({length:parts},(_,i)=>`${archivePath}.part-${i}`)
  try{
    const results=await Promise.allSettled(partPaths.map(async(partPath,i)=>{
      const start=Math.floor(size*i/parts),end=Math.floor(size*(i+1)/parts)-1
      const response=await fetch(downloadUrl,{headers:{Range:`bytes=${start}-${end}`},redirect:'follow',signal:AbortSignal.timeout(120000)})
      const contentRange=response.headers.get('content-range')||''
      if(response.status!==206||contentRange!==`bytes ${start}-${end}/${size}`)throw new Error(`Electron runtime range ${i} failed: HTTP ${response.status} (${contentRange})`)
      const bytes=Buffer.from(await response.arrayBuffer())
      if(bytes.length!==end-start+1)throw new Error(`Electron runtime range ${i} has an incomplete body`)
      await fs.promises.writeFile(partPath,bytes)
    }))
    const failed=results.find(result=>result.status==='rejected')
    if(failed)throw failed.reason
    const output=await fs.promises.open(archivePath,'w')
    try{for(const partPath of partPaths)await output.writeFile(await fs.promises.readFile(partPath))}finally{await output.close()}
  }finally{for(const partPath of partPaths)fs.rmSync(partPath,{force:true})}
}
const actualSha256=hashFile(archivePath)
if(actualSha256!==expectedSha256){if(!process.env.NAVORA_ELECTRON_ARCHIVE)fs.rmSync(archivePath,{force:true});throw new Error(`Electron runtime checksum mismatch: ${actualSha256}`)}
verifyElectronArchive(archivePath)

const archive=new AdmZip(archivePath)
const rootPath=path.resolve(electronDir)
if(path.resolve(distDir)===rootPath||!path.resolve(distDir).startsWith(`${rootPath}${path.sep}`))throw new Error('Refusing to replace a runtime outside node_modules/electron')
for(const entry of archive.getEntries()){
  const target=path.resolve(distDir,entry.entryName)
  if(target!==distDir&&!target.startsWith(`${distDir}${path.sep}`))throw new Error(`Unsafe Electron archive entry: ${entry.entryName}`)
  if(path.isAbsolute(entry.entryName)||target===rootPath)throw new Error(`Unsafe Electron archive entry: ${entry.entryName}`)
}

// Extract and verify before switching the atomic package-root path pointer.
const staging=path.join(rootPath,`.dist-staging-${crypto.randomUUID()}`)
if(path.dirname(path.resolve(staging))!==rootPath)throw new Error('Unsafe runtime staging directory')
let placed=false
try{
  fs.mkdirSync(staging)
  archive.extractAllTo(staging,true)
  const binary=path.join(staging,'electron.exe')
  verifyPinnedElectronBinary(binary)
  for(const resource of requiredResources)if(!fs.existsSync(path.join(staging,resource)))throw new Error(`Electron runtime archive missing ${resource}`)
  // The Chromium AppContainer renderer needs read/execute access to the runtime.
  // A runtime extracted by a sandboxed desktop host may otherwise inherit only
  // that host's package SID, preventing Chromium from starting its renderers.
  const acl=spawnSync('icacls.exe',[staging,'/grant','*S-1-15-2-1:(OI)(CI)(RX)','/T','/C'],{encoding:'utf8',windowsHide:true})
  if(acl.error||acl.status!==0)throw new Error(`Unable to grant renderer read/execute access to the staged runtime: ${acl.error?.message||acl.stderr}`)
  fs.writeFileSync(path.join(staging,path.basename(marker)),JSON.stringify({version,revision:pin.revision,platform:pin.platform,arch:pin.arch,sha256:actualSha256,binarySha256:expectedBinarySha256,binaryCodeSha256:pin.binaryCodeSha256,source:downloadUrl},null,2)+'\n')
  fs.mkdirSync(runtimeBase,{recursive:true})
  fs.renameSync(staging,distDir);placed=true
  // A failed atomic pointer replacement leaves the old path.txt and all old
  // runtimes intact. Keep the verified new directory for a safe later retry.
  writeRuntimeEntry()
}finally{
  if(!placed&&fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true})
}
if(!process.env.NAVORA_ELECTRON_ARCHIVE)fs.rmSync(archivePath,{force:true})
console.log(JSON.stringify({version,revision:pin.revision,platform:pin.platform,arch:pin.arch,sha256:actualSha256,directory:distDir,installed:true}))
