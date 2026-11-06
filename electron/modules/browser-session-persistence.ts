import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

export function browserWorkspaceV2Path(file:string):string{return file.endsWith('.json')?file.slice(0,-5)+'.v2.json':file+'.v2.json'}

/** Legacy state remains readable by older releases; shared state has its own versioned file. */
export function loadBrowserWorkspace(file:string):{records:Record<string,any>[];version:0|1|2;nextDisplayIndex?:number}{
  const v2=browserWorkspaceV2Path(file)
  if(fs.existsSync(v2)){
    const state=JSON.parse(fs.readFileSync(v2,'utf8'))
    if(!state||state.version!==2||!Array.isArray(state.sessions))throw Error('browser_workspace_version_invalid')
    return{records:state.sessions.filter((row:unknown)=>row&&typeof row==='object'&&!Array.isArray(row)),version:2,nextDisplayIndex:Number.isSafeInteger(state.nextDisplayIndex)&&state.nextDisplayIndex>=0?state.nextDisplayIndex:undefined}
  }
  if(!fs.existsSync(file))return{records:[],version:0}
  const records=JSON.parse(fs.readFileSync(file,'utf8'))
  if(!Array.isArray(records))throw Error('browser_workspace_legacy_invalid')
  const backup=file+'.v1-backup'
  try{fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
  return{records:records.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)),version:1}
}

function atomicWrite(file:string,value:unknown){
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`)
  try{fs.writeFileSync(temporary,JSON.stringify(value),'utf8');fs.renameSync(temporary,file)}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
}

export function saveBrowserWorkspace(file:string,records:readonly Record<string,unknown>[],nextDisplayIndex?:number){
  const v2=browserWorkspaceV2Path(file)
  const legacyPrevious=fs.existsSync(file)?fs.readFileSync(file):null
  const staged=path.join(path.dirname(v2),`.${path.basename(v2)}-${randomUUID()}.tmp`)
  let legacyCommitted=false
  try{
    // Stage the authoritative state first. A failed compatibility write must not
    // commit a new v2 while callers are rolling their in-memory change back.
    fs.writeFileSync(staged,JSON.stringify({version:2,sessions:records,...(Number.isSafeInteger(nextDisplayIndex)&&nextDisplayIndex!>=0?{nextDisplayIndex}: {})}),'utf8')
    if(fs.existsSync(v2))fs.copyFileSync(v2,v2+'.bak')
    // Never expose the public record to an old application that assumes one owner per session.
    atomicWrite(file,records.filter(record=>record.scope!=='default'));legacyCommitted=true
    fs.renameSync(staged,v2)
  }catch(error){
    if(legacyCommitted){
      if(legacyPrevious===null)fs.unlinkSync(file)
      else{
        const restore=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.restore`)
        try{fs.writeFileSync(restore,legacyPrevious);fs.renameSync(restore,file)}finally{if(fs.existsSync(restore))fs.unlinkSync(restore)}
      }
    }
    throw error
  }finally{if(fs.existsSync(staged))fs.unlinkSync(staged)}
}
