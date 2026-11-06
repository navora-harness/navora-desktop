import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {readPublicPlanUrl,writePlanArtifact} from './plan-tools'
import {WorkspaceFiles} from './workspace-files'
import {createDefaultConfig} from '../../shared/config'

test('public planning reads have no caller credentials, validate every redirect and bound decoded bytes',async t=>{
  const requests:{path:string;headers:http.IncomingHttpHeaders}[]=[],calls:RequestInit[]=[]
  const server=http.createServer((request,response)=>{
    requests.push({path:request.url||'',headers:request.headers})
    if(request.url==='/redirect'){response.writeHead(302,{Location:'/text'});response.end();return}
    if(request.url==='/blocked'){response.writeHead(302,{Location:'http://localhost:1/private'});response.end();return}
    response.writeHead(200,{'Content-Type':'text/plain','Set-Cookie':'fixture=private'});response.end('abcdefghij')
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
  const url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const options={allowlist:['127.0.0.1'],maxBytes:5,signal:new AbortController().signal,fetch:async(url:string,init:RequestInit)=>{calls.push(init);return fetch(url,init)}}
  const result=await readPublicPlanUrl(url+'/redirect',options)
  assert.equal(result.body,'abcde');assert.equal(result.bytes,5);assert.equal(result.truncated,true)
  assert.ok(calls.every(init=>init.credentials==='omit'&&init.redirect==='manual'&&init.method==='GET'&&init.referrerPolicy==='no-referrer'))
  assert.ok(requests.every(request=>!request.headers.cookie&&!request.headers.authorization&&!request.headers.referer))
  await assert.rejects(readPublicPlanUrl(url+'/blocked',options),/url_not_allowed/)
  assert.equal(requests.length,3)
  for(const bad of ['file:///C:/secret',url.replace('http://','http://user:secret@')])await assert.rejects(readPublicPlanUrl(bad,options),/invalid/)
})

test('planning artifacts use fresh run-scoped files and reject arbitrary paths, cancellation and junctions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-plan-artifact-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const files=new WorkspaceFiles(root,createDefaultConfig),signal=new AbortController().signal
  const first=writePlanArtifact(files,'chat','run_1',{title:'计划',content:'步骤与验收'},1000,signal),second=writePlanArtifact(files,'chat','run_1',{content:'第二份'},1000,signal)
  assert.notEqual(first.path,second.path);assert.match(first.path,/^plans\/run_1\/plan-[a-f0-9-]+\.md$/)
  assert.equal(fs.readFileSync(files.resolve('chat',first.path),'utf8'),'# 计划\n\n步骤与验收')
  for(const args of [{content:'x',path:'app.ts'},{content:'x',append:true}])assert.throws(()=>writePlanArtifact(files,'chat','run_1',args,1000,signal),/arbitrary_path/)
  assert.throws(()=>writePlanArtifact(files,'chat','../escape',{content:'x'},1000,signal),/run_required/)
  const aborted=new AbortController();aborted.abort();assert.throws(()=>writePlanArtifact(files,'chat','cancelled',{content:'x'},1000,aborted.signal),/abort/i)
  const target=files.resolve('chat','inside');fs.mkdirSync(target)
  fs.symlinkSync(target,files.resolve('chat','plans/linked'),'junction')
  assert.throws(()=>writePlanArtifact(files,'chat','linked',{content:'x'},1000,signal),/symlink_forbidden/)
  assert.equal(fs.readdirSync(target).length,0)
})
