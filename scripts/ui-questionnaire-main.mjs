import {build} from 'esbuild'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root=process.cwd(),require=createRequire(import.meta.url),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-questionnaire-main-'))
const output=path.resolve(process.env.NAVORA_UI_MAIN_OUTPUT||'../_planning/questionnaire-main-ui'),entry=path.join(root,'dist-electron','ui-questionnaire-main.mjs')
try{
  fs.mkdirSync(output,{recursive:true})
  await build({entryPoints:['scripts/ui-questionnaire-main-entry.ts'],outfile:entry,bundle:true,platform:'node',target:'node20',format:'esm',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}})
  for(const phase of ['seed','restart']){
    const env={...process.env,NAVORA_DATA_ROOT:profile,NAVORA_UI_OUTPUT:output,NAVORA_QUESTIONNAIRE_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
    const code=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[entry],{cwd:root,env,stdio:'inherit',windowsHide:true}),timeout=setTimeout(()=>{child.kill();reject(Error('Questionnaire application UI deadline exceeded'))},90000);child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('exit',code=>{clearTimeout(timeout);resolve(code??1)})})
    if(code!==0)throw Error('Questionnaire application UI failed: '+phase)
  }
}finally{
  fs.rmSync(entry,{force:true})
  const relative=path.relative(os.tmpdir(),profile)
  if(!relative.startsWith('navora-questionnaire-main-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe isolated questionnaire profile')
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250})
}
