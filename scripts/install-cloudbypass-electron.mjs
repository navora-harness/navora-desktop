import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const electronDir=path.join(root,'node_modules','electron')
const distDir=path.join(electronDir,'dist')
const packageInfo=JSON.parse(fs.readFileSync(path.join(electronDir,'package.json'),'utf8'))
const version='45.0.0-cloudbypass.3'
const archiveName=`electron-v${version}-win32-x64.zip`
const downloadUrl=`https://github.com/ChengHoward/edist/releases/download/v${version}/${archiveName}`
const expectedSha256='d5168ab311800e0feb739c1bd7bea50cea2ddb601975152de9f95ff1dd9ec82f'
const marker=path.join(distDir,'navora-cloudbypass-runtime.json')

if(packageInfo.version!==version)throw new Error(`Expected electron ${version}; found ${packageInfo.version}`)
if(process.platform!=='win32'||process.arch!=='x64')throw new Error(`${version} only ships a Windows x64 runtime`)
if(path.resolve(distDir)!==path.join(path.resolve(electronDir),'dist'))throw new Error('Refusing to replace an unexpected Electron runtime directory')
if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).version===version&&fs.existsSync(path.join(distDir,'electron.exe'))){
  console.log(`Electron ${version} runtime already installed`)
  process.exit(0)
}

const archivePath=path.join(os.tmpdir(),archiveName)
const hashFile=filePath=>crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
if(!fs.existsSync(archivePath)||hashFile(archivePath)!==expectedSha256){
  fs.rmSync(archivePath,{force:true})
  const size=168764808,parts=8,partPaths=Array.from({length:parts},(_,i)=>`${archivePath}.part-${i}`)
  try{
    await Promise.all(partPaths.map(async(partPath,i)=>{
      const start=Math.floor(size*i/parts),end=Math.floor(size*(i+1)/parts)-1
      const response=await fetch(downloadUrl,{headers:{Range:`bytes=${start}-${end}`},redirect:'follow'})
      const contentRange=response.headers.get('content-range')||''
      if(response.status!==206||!contentRange.includes(`${start}-${end}/${size}`))throw new Error(`Electron runtime range ${i} failed: HTTP ${response.status} (${contentRange})`)
      await fs.promises.writeFile(partPath,Buffer.from(await response.arrayBuffer()))
    }))
    const output=await fs.promises.open(archivePath,'w')
    try{for(const partPath of partPaths)await output.writeFile(await fs.promises.readFile(partPath))}finally{await output.close()}
  }finally{for(const partPath of partPaths)fs.rmSync(partPath,{force:true})}
}
const actualSha256=hashFile(archivePath)
if(actualSha256!==expectedSha256){fs.rmSync(archivePath,{force:true});throw new Error(`Electron runtime checksum mismatch: ${actualSha256}`)}

const archive=new AdmZip(archivePath)
const rootPath=path.resolve(electronDir)
if(path.resolve(distDir)===rootPath||!path.resolve(distDir).startsWith(`${rootPath}${path.sep}`))throw new Error('Refusing to replace a runtime outside node_modules/electron')
for(const entry of archive.getEntries()){
  const target=path.resolve(distDir,entry.entryName)
  if(target!==distDir&&!target.startsWith(`${distDir}${path.sep}`))throw new Error(`Unsafe Electron archive entry: ${entry.entryName}`)
  if(path.isAbsolute(entry.entryName)||target===rootPath)throw new Error(`Unsafe Electron archive entry: ${entry.entryName}`)
}

if(fs.existsSync(distDir)&&fs.lstatSync(distDir).isSymbolicLink())throw new Error('Refusing to replace a linked Electron runtime directory')
if(fs.existsSync(distDir))fs.rmSync(distDir,{recursive:true,force:true})
fs.mkdirSync(distDir,{recursive:true})
archive.extractAllTo(distDir,true)
if(!fs.existsSync(path.join(distDir,'electron.exe')))throw new Error('Electron runtime archive did not contain electron.exe')
fs.writeFileSync(path.join(distDir,'path.txt'),'electron.exe\n')
fs.writeFileSync(marker,JSON.stringify({version,platform:'win32',arch:'x64',sha256:actualSha256,source:downloadUrl},null,2)+'\n')
fs.rmSync(archivePath,{force:true})
console.log(JSON.stringify({version,platform:'win32',arch:'x64',sha256:actualSha256,installed:true}))
