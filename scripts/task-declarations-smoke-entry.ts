import {app,session} from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createDefaultConfig} from '../shared/config'
import {deriveTaskConstraints} from '../shared/task-declarations'
import {freezeTaskConstraints} from '../electron/modules/agent-task-policy'
import {executeAgentTool,type ToolExecContext} from '../electron/modules/browser-tools'
import {WorkspaceFiles} from '../electron/modules/workspace-files'
import {PermissionGate} from '../electron/modules/permission-gate'

const root=process.env.NAVORA_TASK_DECLARATIONS_ROOT!
if(!root||!path.isAbsolute(root)||!path.basename(root).startsWith('navora-task-declarations-'))throw Error('An isolated temporary profile is required')
fs.mkdirSync(path.join(root,'profile'),{recursive:true});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration()
void app.whenReady().then(async()=>{
  let checks=0,server:http.Server|undefined
  const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;console.log('[task-declarations]',label)}
  try{
    const received:{url:string;cookie?:string;authorization?:string;referer?:string;method?:string}[]=[]
    server=http.createServer((request,response)=>{
      received.push({url:request.url||'',cookie:request.headers.cookie,authorization:request.headers.authorization,referer:request.headers.referer,method:request.method})
      if(request.url==='/redirect'){response.writeHead(302,{Location:'/echo','Set-Cookie':'redirect-secret=forbidden'});response.end();return}
      if(request.url==='/redirect-block'){response.writeHead(302,{Location:`http://localhost:${(server!.address() as import('node:net').AddressInfo).port}/blocked`});response.end();return}
      if(request.url==='/hold'){response.writeHead(200,{'Content-Type':'text/plain'});response.write('pending');return}
      if(request.url==='/binary'){response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(Buffer.alloc(32));return}
      response.writeHead(200,{'Content-Type':'text/plain','Set-Cookie':'read-secret=forbidden'});response.end(request.url==='/large'?'x'.repeat(1000):JSON.stringify(received.at(-1)))
    })
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,config=createDefaultConfig()
    config.permissions.preset='custom';config.permissions.modes['network.request']='allow';config.permissions.modes['file.write']='allow';config.browser.url_allowlist=['127.0.0.1']
    const files=new WorkspaceFiles(root,()=>config),gate=new PermissionGate(()=>config,async()=>new Promise(()=>{}))
    const context:ToolExecContext={chatId:'chat_fixture',browserRunId:'fixture_run',taskConstraints:freezeTaskConstraints(deriveTaskConstraints({version:1,ids:['automation','plan']})),files,gate,getConfig:()=>config,signal:new AbortController().signal,registry:{getTree:()=>[]} as unknown as ToolExecContext['registry']} as ToolExecContext
    const run=(name:string,args:Record<string,unknown>={},extra:Partial<ToolExecContext>={},skipPermission=false)=>executeAgentTool(name,args,{...context,...extra},{skipPermission}) as Promise<any>
    await session.defaultSession.cookies.set({url:origin,name:'default-secret',value:'must-not-leak'})
    const read=await run('plan_read_url',{url:origin+'/redirect'})
    check(read.ok&&read.status===200&&received.length===2&&received.every(request=>!request.cookie&&!request.authorization&&!request.referer&&request.method==='GET'),'Real Electron host reads and redirects omit default-session cookies, auth and referrer')
    check((await session.defaultSession.cookies.get({url:origin})).every(cookie=>cookie.name==='default-secret'),'Credentials omit also prevents redirect/final Set-Cookie from entering the browser store')
    await assert.rejects(run('plan_read_url',{url:origin+'/redirect-block'}),/url_not_allowed/)
    check(!received.some(request=>request.url==='/blocked'),'Each redirect is checked before the next forbidden destination is contacted')
    config.browser.fetch_max_body_bytes=8;const bounded=await run('plan_read_url',{url:origin+'/large'});check(bounded.bytes===8&&bounded.body==='xxxxxxxx'&&bounded.truncated,'A real response is bounded while streaming, before buffering the full body')
    await assert.rejects(run('plan_read_url',{url:origin+'/binary'}),/text_response_required/);checks++
    for(const args of [{url:origin+'/echo',headers:{Authorization:'not-allowed'}},{url:origin+'/echo',method:'POST',body:'not-allowed'}])check((await run('plan_read_url',args)).error==='task_plan_phase_restricted','Custom request parameters cannot widen a planning read')
    const beforeDenied=received.length;config.permissions.modes['network.request']='deny'
    check((await run('plan_read_url',{url:origin+'/echo'},{},true)).ok===false&&received.length===beforeDenied,'Network permission denial is respected even by an already-approved nested dispatch')
    config.permissions.modes['network.request']='allow';const abort=new AbortController(),held=run('plan_read_url',{url:origin+'/hold'},{signal:abort.signal})
    setTimeout(()=>abort.abort(),40);await assert.rejects(held,/abort/i);checks++
    const first=await run('plan_write_artifact',{title:'计划',content:'仅生成步骤和验收标准'}),original=fs.readFileSync(files.resolve(context.chatId,first.path),'utf8')
    check(first.ok&&first.path.startsWith('plans/fixture_run/')&&original.includes('仅生成步骤'),'Requested plan output uses a fresh file inside the current run designated directory')
    check((await run('plan_write_artifact',{path:first.path,content:'overwrite'})).ok===false&&fs.readFileSync(files.resolve(context.chatId,first.path),'utf8')===original,'An existing artifact cannot be overwritten through a caller-selected same name')
    const target=files.resolve(context.chatId,'inside');fs.mkdirSync(target)
    fs.symlinkSync(target,files.resolve(context.chatId,'plans/linked_run'),'junction')
    await assert.rejects(run('plan_write_artifact',{content:'must not follow junction'},{browserRunId:'linked_run'}),/symlink_forbidden/)
    check(fs.readdirSync(target).length===0,'A symbolic-link parent is rejected without writing into its target')
    config.permissions.modes['file.write']='deny'
    check((await run('plan_write_artifact',{content:'denied'},{browserRunId:'denied_run'},true)).ok===false&&!fs.existsSync(files.resolve(context.chatId,'plans/denied_run')),'Plan selection never grants file.write or overrides a current permission denial')
    config.permissions.modes['file.write']='ask';const cancel=new AbortController(),waiting=run('plan_write_artifact',{content:'cancelled'},{browserRunId:'cancelled_run',signal:cancel.signal});cancel.abort()
    check((await waiting).ok===false&&!fs.existsSync(files.resolve(context.chatId,'plans/cancelled_run')),'Cancellation during approval cannot create an artifact')
    for(const name of ['shell_exec','file_write','browser_evaluate','browser_session_fetch','browser_screenshot','desktop_screenshot'])check((await run(name,{path:'code.ts',content:'blocked',readonly:true})).error==='task_plan_phase_restricted',`Central native dispatch rejects ${name} in planning`)
    console.log(`[task-declarations] ${checks} checks passed using ${process.versions.electron}`)
    server.closeAllConnections();server.close();app.exit(0)
  }catch(error){console.error(error);server?.closeAllConnections();server?.close();app.exit(1)}
})
