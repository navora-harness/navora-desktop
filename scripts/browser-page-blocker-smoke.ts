import {app,BrowserWindow} from 'electron'
import {createServer,type Server} from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {observePageBlocker} from '../electron/modules/page-blocker-observer'
import {getBrowserAutomationController} from '../electron/modules/browser-automation-controller'
import {captureBrowserIntentEpochs,coordinateBrowserTool} from '../electron/modules/browser-tool-coordination'
import {createDefaultBrowserAutomation} from '../shared/browser-automation'
import type {ToolExecContext} from '../electron/modules/browser-tools'
const profile=process.env.NAVORA_BLOCKER_PROFILE!,output=process.env.NAVORA_BLOCKER_OUTPUT!
assert.ok(path.isAbsolute(profile)&&path.isAbsolute(output))
app.setPath('userData',profile)
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const servers:Server[]=[]
const listen=async(server:Server)=>{servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as {port:number}).port}`}
const verification='<main class="captcha-panel"><h1>请完成安全验证</h1><p>请确认此网页操作行为确实出自您本人。</p><button aria-label="captcha challenge">由本人在这里完成</button></main>'
const page=(body:string)=>`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:18px sans-serif;background:#f4f7f5;color:#304b3f}main{padding:64px}button{padding:12px 24px;background:#d3e4d9;border:1px solid #8ba798;border-radius:9px}dialog{border:1px solid #bccbc2;border-radius:12px;padding:28px}</style>${body}`
const report:{ok:boolean;checks:Record<string,unknown>[];errors:string[]}={ok:false,checks:[],errors:[]}
void app.whenReady().then(async()=>{
let win:BrowserWindow|undefined
try{
  const frameOrigin=await listen(createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(page(req.url==='/nested'?`<iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" src="${frameOrigin}/verify"></iframe>`:verification))}))
  const origin=await listen(createServer((req,res)=>{
    const route=req.url?.split('?')[0]
    let content=route==='/verify'?verification:route==='/iframe'?`<h1>Underlying catalog</h1><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" src="${frameOrigin}/verify"></iframe>`:route==='/hidden'?`<main>Ordinary catalog</main><iframe style="display:none" src="${frameOrigin}/verify"></iframe>`:route==='/tiny'?`<main>Ordinary catalog</main><iframe style="width:1px;height:1px;border:0" src="${frameOrigin}/verify"></iframe>`:route==='/article'?'<main><h1>CAPTCHA 技术说明</h1><p>这是一篇讨论人机验证的普通文章。</p></main>':route==='/cookie'?'<main>Ordinary catalog</main><dialog open><p>Cookie choices</p><button>Accept all</button></dialog>':route==='/login'?'<main><h1>登录</h1><form><input placeholder="账号"><input type="password"><button>登录</button></form></main>':route==='/covered'?`${verification}<div style="position:fixed;inset:0;background:white;z-index:9999">Unrelated foreground content</div>`:route==='/large'?Array.from({length:600},(_,i)=>`<button>Product ${i}</button>`).join('')+`<div style="position:fixed;inset:0;background:#f4f7f5;z-index:9">${verification}</div>`:'<main><h1>Verification completed</h1><button id="remaining">Continue remaining step</button></main>'
    if(route==='/transparent')content='<main>Ordinary catalog</main><div style="position:fixed;inset:0;opacity:0;pointer-events:auto"></div>'
    if(route==='/nested')content=`<iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" src="${frameOrigin}/nested"></iframe>`
    res.setHeader('content-type','text/html;charset=utf-8');res.end(page(content))
  }))
  win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{sandbox:true,contextIsolation:true}})
  const wc=win.webContents
  const controller=getBrowserAutomationController(wc,{getSettings:()=>({...createDefaultBrowserAutomation(),show_virtual_cursor:false})})
  const record={windowId:'fixture',chatId:'fixture-chat',sessionId:'fixture-session',win:{webContents:wc,isDestroyed:()=>wc.isDestroyed(),activeOperations:0,manager:{flushLayout(){}}}}
  const registry={getTree:()=>[{sessionId:'fixture-session',windows:[{windowId:'fixture'}]}],getWindowRecord:()=>record,assertWindowOwned:()=>record,assertSessionUsable:()=>({windows:new Map([['fixture',record]])}),isPublicSession:()=>false}
  const context=()=>({chatId:'fixture-chat',signal:new AbortController().signal,registry,browserIntentEpochs:captureBrowserIntentEpochs(registry as never,'fixture-chat')} as unknown as ToolExecContext)
  const observe=()=>observePageBlocker(wc,{chatId:'fixture-chat',windowId:'fixture',documentEpoch:controller.captureDocumentEpoch(),controlEpoch:controller.captureEpoch()})
  for(const [route,state,kind,requiresUser] of [['verify','confirmed','human_verification',true],['iframe','confirmed','human_verification',true],['hidden','not_observed','unknown',false],['tiny','not_observed','unknown',false],['article','not_observed','unknown',false],['cookie','confirmed','site_dialog',false],['login','confirmed','login_required',true]] as const){
    await wc.loadURL(`${origin}/${route}`)
    const summary=await observe()
    report.checks.push({route,summary});assert.equal(summary.state,state,route);assert.equal(summary.kind,kind,route);assert.equal(summary.requiresUser,requiresUser,route)
  }
  await wc.loadURL(`${origin}/covered`)
  const covered=await observe();assert.notEqual(covered.state,'confirmed');report.checks.push({route:'covered',summary:covered})
  for(const route of ['transparent','nested']){
    await wc.loadURL(`${origin}/${route}`)
    const summary=await observe();assert.equal(summary.state,'unknown',route);assert.equal(summary.coverage,'partial',route);report.checks.push({route,summary})
  }
  await wc.loadURL(`${origin}/large`)
  const native=await wc.getAgentSnapshot({maxNodes:5,maxFrames:8,timeoutMs:1000,pierce:true})
  assert.equal(native.complete,false)
  const result=await coordinateBrowserTool('browser_get',{windowId:'fixture',what:'agent_snapshot'},context(),async()=>({ok:true,value:native})) as unknown as {pageBlocker:{state:string};ok:boolean}
  assert.equal(result.ok,true);assert.equal(result.pageBlocker.state,'confirmed');assert.equal(controller.snapshot().owner,'paused')
  fs.writeFileSync(path.join(output,'page-blocker-foreground.png'),(await wc.capturePage()).toPNG())
  let dispatched=0
  await assert.rejects(coordinateBrowserTool('browser_evaluate',{windowId:'fixture'},context(),async()=>{dispatched++;return {ok:true}}),{code:'browser_page_blocked'})
  const before=controller.snapshot()
  await controller.takeControl()
  await assert.rejects(controller.resume(),{code:'browser_page_blocked'})
  // This only simulates the user having completed their own local form; no verification action is automated.
  await wc.loadURL(`${origin}/clear`)
  await Promise.all([controller.resume(),controller.recheckBlocker()])
  assert.equal(controller.snapshot().owner,'ai');assert.equal(controller.snapshot().needsObservation,true);assert.equal(dispatched,0)
  report.checks.push({route:'large',nativeCoverage:{complete:native.complete,truncated:native.truncated,reasons:native.truncationReasons},pageBlocker:result.pageBlocker,before,after:controller.snapshot(),dispatched})
  report.ok=true
}catch(error){report.errors.push(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1}
finally{
  fs.writeFileSync(path.join(output,'page-blocker-smoke-report.json'),JSON.stringify(report,null,2))
  if(win&&!win.isDestroyed())win.destroy()
  await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))))
  console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,errors:report.errors}))
  app.exit(report.ok?0:1)
}
})
