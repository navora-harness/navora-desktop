import {createServer} from 'vite'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'navora-annotations-ui-'))
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
try{
 const report=path.resolve(root,'../_planning/annotation-list-fallback-ui/completed.json');fs.rmSync(report,{force:true})
 await server.listen();const address=server.httpServer.address(),port=typeof address==='object'&&address?address.port:0,env={...process.env,NAVORA_ANNOTATIONS_URL:`http://127.0.0.1:${port}/scripts/fixtures/conversation-annotations.html`,NAVORA_ANNOTATIONS_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE
 process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[path.join(root,'scripts/ui-conversation-annotations-entry.cjs')],{cwd:root,env,stdio:'inherit',windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Annotation fallback verification exceeded 60s'))},60000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)})})
 if(!process.exitCode&&!fs.existsSync(report))throw Error('Annotation UI exited without completing checks')
}finally{await server.close();const relative=path.relative(os.tmpdir(),profile);if(!relative.startsWith('navora-annotations-ui-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe annotation fixture cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
