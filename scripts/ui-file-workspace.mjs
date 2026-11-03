import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-ui-workspace-'))
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error',plugins:[{name:'workspace-native-boundary',enforce:'pre',resolveId(source,importer){if(source==='./BrowserTabPanel.vue'&&importer?.includes('/FileWorkspace.vue'))return path.join(root,'scripts/fixtures/WorkspaceBrowserStub.vue')}}]})
try{
  await server.listen();const address=server.httpServer.address(),port=typeof address==='object'&&address?address.port:0
  const env={...process.env,NAVORA_WORKSPACE_URL:`http://127.0.0.1:${port}/scripts/fixtures/file-workspace.html`,NAVORA_WORKSPACE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE
  process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),['--no-sandbox','--force-device-scale-factor=1',path.join(root,'scripts/ui-file-workspace-entry.cjs')],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Workspace verification exceeded its deadline'))},90000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);resolve(code??1)})})
}finally{await server.close();const relative=path.relative(os.tmpdir(),profile);if(!relative.startsWith('navora-ui-workspace-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe test cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
