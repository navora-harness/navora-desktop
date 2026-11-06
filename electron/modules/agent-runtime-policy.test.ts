import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import {pathToFileURL} from 'node:url'
import {createDefaultConfig} from '../../shared/config'
import type {AgentRuntime} from './agent-runtime'
import type {ChatMessage,ChatSession,AgentAskRequest} from '../../shared/types'
import {QuestionnaireStore} from './questionnaire-store'
import {EventEmitter} from 'node:events'
import type {WebContents} from 'electron'
import {getBrowserAutomationController} from './browser-automation-controller'
import {automationTestApi} from './browser-automation-test-api'
import type {AgentRoundBudget} from '../../shared/agent-progress-policy'

let Runtime:typeof AgentRuntime
let tempRoot:string
type FixtureTool=(name:string,args:Record<string,unknown>,ctx:{signal:AbortSignal;browserRunId?:string;toolCallId?:string;pluginRuntimeReceipts?:import('../../shared/plugins').PluginRuntimeReceipt[];pluginRequestAdmission?:()=>Record<string,unknown>|null;isToolRunCurrent?:()=>boolean})=>Promise<unknown>
const scope=globalThis as typeof globalThis&{__navoraRuntimePolicyTool?:FixtureTool}

before(async()=>{
  tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'navora-runtime-policy-'))
  // Exercise the actual run loop and HTTP client. Stub only the native tool
  // boundary; these tests never load Electron, personal data or remote models.
  const esbuild=await import(pathToFileURL(path.join(process.cwd(),'node_modules/esbuild/lib/main.js')).href)
  const outfile=path.join(tempRoot,'runtime.mjs')
  await esbuild.build({entryPoints:[path.join(process.cwd(),'electron/modules/agent-runtime.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],logLevel:'silent',plugins:[{
    name:'native-tool-fixture',setup(builder:import('esbuild').PluginBuild){
      builder.onResolve({filter:/^\.\/browser-tools$/},()=>({path:'tools',namespace:'fixture'}))
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function executeAgentTool(...args) { return globalThis.__navoraRuntimePolicyTool(...args) }',loader:'js'}))
    },
  }]})
  Runtime=(await import(pathToFileURL(outfile).href)).AgentRuntime
})
after(async()=>{
  delete scope.__navoraRuntimePolicyTool
  if(!tempRoot)return
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(tempRoot))
  assert.match(relative,/^navora-runtime-policy-[^\\/]+$/u)
  await fs.rm(tempRoot,{recursive:true,force:true})
})

type Request={messages:{role:string;content:unknown}[];tools?:unknown[]}
function call(name:string,args:Record<string,unknown>={}){return {id:`call-${name}-${Math.random()}`,type:'function',function:{name,arguments:JSON.stringify(args)}}}
const reply=(content:string|null,tool_calls?:ReturnType<typeof call>[])=>({choices:[{message:{role:'assistant',content,...(tool_calls?{tool_calls}:{})},finish_reason:tool_calls?'tool_calls':'stop'}]})

async function fixture(t:{after(fn:()=>Promise<void>):void},userText:string,respond:(request:Request,index:number)=>unknown,tool?:FixtureTool,maxRounds=24,answerContinuation?:()=>string,runtimeOverrides?:Partial<ConstructorParameters<typeof AgentRuntime>[0]>){
  const requests:Request[]=[],executed:{name:string;args:Record<string,unknown>}[]=[],asks:unknown[]=[]
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk
    const request=JSON.parse(body);requests.push(request)
    const response=respond(request,requests.length-1) as {httpStatus?:number}
    res.writeHead(response.httpStatus||200,{'Content-Type':'application/json'});res.end(JSON.stringify(response))
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
  const cfg=createDefaultConfig(),provider=cfg.ai.providers[0]!
  provider.base_url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`
  provider.model='fixture';provider.models=['fixture'];provider.timeout_ms=5000
  cfg.ai.max_tool_rounds=maxRounds;cfg.app.ai_generate_chat_title=false
  const chat:ChatSession={id:'chat',title:'fixture',createdAt:1,updatedAt:1,executionMode:'agent',messages:[{id:'user',role:'user',content:userText,createdAt:1}]}
  const chats={get:(id:string)=>id===chat.id?chat:undefined,setPendingAsk:(_id:string,value:AgentAskRequest|null)=>{chat.pendingAsk=value||undefined},listChildren:()=>[],resolvePluginScopeChatId:()=>chat.id,beginSubchatRun:()=>{},flushChat:()=>{},setProvisionalTitleFromFirstUser:()=>null,
    appendMessage:(_id:string,message:Omit<ChatMessage,'id'|'createdAt'>)=>{const row={...message,id:`m${chat.messages.length}`,createdAt:Date.now()};chat.messages.push(row);return row},
    updateMessage:(_id:string,id:string,patch:Partial<ChatMessage>)=>{const row=chat.messages.find(item=>item.id===id);if(row)Object.assign(row,{...patch,...(patch.meta?{meta:{...row.meta,...patch.meta}}:{})});return row},
  }
  const registry={getTree:()=>[],getWindowRecord:()=>null,beginQuietNavigateLogs:()=>{},endQuietNavigateLogs:()=>{}}
  const plugins={ownerOfToolForChat:()=>undefined,buildPromptAppendix:()=>'',enabledToolsForChat:()=>[]}
  const runtime=new Runtime({getConfig:()=>cfg,updateConfig:()=>cfg,chats,registry,plugins,skills:{buildPromptAppendix:()=>''},secrets:{get:()=>''},emit:()=>{},askUser:async(request:unknown)=>{asks.push(request);return{id:'ask',source:'option',answer:answerContinuation?.()??'停止'}},askSkillReview:async()=>({}),...runtimeOverrides} as unknown as ConstructorParameters<typeof AgentRuntime>[0])
  scope.__navoraRuntimePolicyTool=async(name,args,ctx)=>{
    executed.push({name,args})
    return tool?tool(name,args,ctx):{ok:true,value:{step:executed.length}}
  }
  return {runtime,chat,cfg,requests,executed,asks,registry,run:()=>runtime.run({chatId:'chat',userText}),end:()=>[...chat.messages].reverse().find(message=>message.meta?.kind==='agent_run_end')}
}

test('actual runtime completes a ten-step action despite old six/eight-call stopping thresholds',async t=>{
  const names=['browser_open','browser_get','browser_get','browser_type','browser_get','browser_get','browser_mouse','browser_click','browser_back','browser_get']
  const f=await fixture(t,'随机选择网站，自动化键鼠连贯测试操作',(request,index)=>{
    const forced=request.messages.some(message=>message.role==='system'&&/禁止继续 navigate|强制停止浏览/u.test(String(message.content)))
    if(forced)return reply('工具调用已达到上限，需要用户说继续。')
    return index<names.length?reply(null,[call(names[index]!,{windowId:'page',what:'agent_find',step:index})]):reply('已完成输入、提交、核验、滚动、点击与返回。')
  })
  await f.run()
  assert.equal(f.executed.length,10);assert.equal(f.requests.length,11);assert.equal(f.asks.length,0)
  assert.equal(f.end()?.meta?.stopReason,'model_final')
  assert.equal([...f.chat.messages].reverse().find(message=>message.role==='assistant')?.content,'已完成输入、提交、核验、滚动、点击与返回。')
})

test('actual auto/chat follow-up carries durable previous execution with independent current zero and no tools',async t=>{
  const f=await fixture(t,'自动化填写任务',(request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',text:'private-input'})]):reply('已回读字段值。'),async()=>({ok:true,input:{effect:'confirmed'}}))
  await f.run()
  const prior=f.end()!.meta!.executionEvidence as {runId:string;counts:{inputsDispatched:number}}
  assert.equal(prior.counts.inputsDispatched,1)
  for(const mode of ['auto','chat'] as const){
    f.chat.executionMode=mode
    f.chat.messages.push({id:`followup-${mode}`,role:'user',content:'刚才为什么失败？',createdAt:Date.now()})
    await f.runtime.run({chatId:'chat',userText:'刚才为什么失败？'})
    const request=f.requests.at(-1)!,currentRow=request.messages.find(message=>String(message.content).startsWith('[当前运行事实]'))!,historyRow=request.messages.find(message=>String(message.content).startsWith('[历史运行事实]'))!
    const current=JSON.parse(String(currentRow.content).split('\n').slice(1).join('\n')),history=JSON.parse(String(historyRow.content).split('\n').slice(1).join('\n'))
    assert.equal(current.counts.inputsDispatched,0);assert.notEqual(current.runId,prior.runId)
    assert.equal(history.runs.find((run:{runId:string})=>run.runId===prior.runId).counts.inputsDispatched,1)
    assert.equal(request.tools?.length||0,0);assert.equal(f.executed.length,1)
    assert.doesNotMatch(JSON.stringify(history),/private-input/)
  }
})

test('actual full Agent follow-up retains partial successes and invalidated/stale errors without inventing a cause',async t=>{
  const f=await fixture(t,'自动化填写并测试',(request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',text:'private'}),call('browser_click',{windowId:'page',ref:'old'}),call('browser_get',{windowId:'page',what:'agent_find'})]):reply('部分步骤已派发，页面已失效，原因未确认。'),async name=>name==='browser_type'?{ok:true,input:{effect:'confirmed'}}:name==='browser_click'?{ok:false,error:'browser_operation_invalidated'}:{ok:false,error:'ref_not_found'})
  await f.run();f.chat.messages.push({id:'explain','role':'user',content:'解释刚才的失败',createdAt:Date.now()})
  await f.runtime.run({chatId:'chat',userText:'解释刚才的失败'})
  const facts=String(f.requests.at(-1)!.messages.find(message=>String(message.content).startsWith('[历史运行事实]'))!.content)
  assert.match(facts,/browser_operation_invalidated/);assert.match(facts,/ref_not_found/);assert.match(facts,/inputsDispatched\":1/)
  assert.doesNotMatch(facts,/control_changed|user_takeover|private/)
})

test('actual safe-digest provider retry carries current and historical host facts',async t=>{
  let rejecting=false
  const f=await fixture(t,'自动化输入并核验',(request,index)=>!rejecting&&index===0?reply(null,[call('browser_type',{windowId:'page',text:'secret'})]):rejecting&&request.tools?.length?reply('The request was rejected because it was considered high risk'):reply('已核对宿主事实。'),async()=>({ok:true,input:{effect:'confirmed'}}))
  await f.run();rejecting=true;f.chat.messages.push({id:'retry-user',role:'user',content:'核对之前执行事实',createdAt:Date.now()})
  await f.runtime.run({chatId:'chat',userText:'核对之前执行事实'})
  const retry=f.requests.at(-1)!
  assert.ok(retry.messages.some(message=>String(message.content).startsWith('[当前运行事实]')))
  assert.ok(retry.messages.some(message=>String(message.content).startsWith('[历史运行事实]')))
  assert.equal(retry.tools?.length||0,0)
})

test('actual runtime persists trusted fragments, scoped inserted instructions and ended summary',async t=>{
  let f:Awaited<ReturnType<typeof fixture>>
  f=await fixture(t,'自动化填写',(_request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',text:'secret'})]):index===1?reply(null,[call('browser_press',{windowId:'page',key:'Tab'})]):reply('已完成回读。'),async name=>{
    if(name==='browser_type'){assert.equal(f.runtime.insertUserInput('chat',{content:'继续核对焦点'}),true);return {ok:true,input:{effect:'confirmed'}}}
    return {ok:true,keyboardEffect:{state:'confirmed',event:'tab',evidenceSource:'host_readback',sameDocument:true,sameTarget:false}}
  })
  await f.run()
  const inserted=f.chat.messages.find(message=>message.meta?.inserted)!,press=f.chat.messages.find(message=>message.meta?.toolName==='browser_press')!
  assert.equal(press.meta?.turnId,inserted.id)
  const summary=f.end()!.meta!.executionEvidence as {state:string;evidence:{turnId:string;toolName:string;keyboardEffect?:{state:string}}[]}
  assert.equal(summary.state,'ended');assert.equal(summary.evidence.find(row=>row.toolName==='browser_press')!.turnId,inserted.id)
  assert.equal(summary.evidence.find(row=>row.toolName==='browser_press')!.keyboardEffect?.state,'confirmed')
  assert.doesNotMatch(JSON.stringify(summary),/secret/)
})

test('actual runtime retains page handoff facts in end and quick-answer history without captcha text',async t=>{
  const f=await fixture(t,'自动化读取资料',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'page',what:'agent_snapshot'})]):reply('当前页面需要你完成验证，已保留现场。'),async()=>({ok:true,value:{elements:[]},pageBlocker:{version:1,state:'confirmed',chatId:'chat',windowId:'page',observationId:'probe-1',kind:'human_verification',coverage:'partial',scope:'visible_viewport',requiresUser:true,blocksInteraction:'yes',followup:'user_handoff',reasonCodes:['VISIBLE_CHALLENGE'],evidence:[{kind:'visible_challenge_control',documentId:3}],question:'private-captcha-payload'}}))
  await f.run()
  const summary=f.end()!.meta!.executionEvidence as {pageBlocker?:{state:string;reasonCodes:string[]}}
  assert.equal(summary.pageBlocker?.state,'confirmed');assert.deepEqual(summary.pageBlocker?.reasonCodes,['VISIBLE_CHALLENGE'])
  assert.equal(f.end()!.meta!.stopReason,'waiting_for_user')
  assert.equal(f.chat.messages.filter(message=>message.meta?.kind==='page_blocker_detected').length,1)
  f.chat.executionMode='chat';f.chat.messages.push({id:'why-blocked',role:'user',content:'为什么停下了？',createdAt:Date.now()})
  await f.runtime.run({chatId:'chat',userText:'为什么停下了？'})
  const history=String(f.requests.at(-1)!.messages.find(message=>String(message.content).startsWith('[历史运行事实]'))!.content)
  assert.match(history,/human_verification/);assert.match(history,/VISIBLE_CHALLENGE/);assert.doesNotMatch(history,/private-captcha-payload/)
})

test('actual runtime resumes a blocked checkpoint once only after an explicit user request, without replaying old input',async t=>{
  const f=await fixture(t,'自动化填写资料',(_request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',text:'one-time-value'}),call('browser_get',{windowId:'page',what:'agent_snapshot'})]):reply('页面需要你验证，已保存进度。'),async name=>name==='browser_type'?{ok:true,input:{effect:'confirmed'}}:{ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'page',observationId:'blocked',requiresUser:true}})
  await f.run();const original=f.end()!,originalId=original.meta!.runId
  f.registry.getWindowRecord=(()=>({win:{isDestroyed:()=>false}})) as unknown as typeof f.registry.getWindowRecord
  assert.equal(f.requests.length,2,'restoring control alone starts no request')
  f.chat.messages.push({id:'resume-user',role:'user',content:'我已完成验证，继续',createdAt:Date.now()});await f.runtime.run({chatId:'chat',userText:'我已完成验证，继续'})
  const resumed=f.end()!.meta!.executionEvidence as {resumesRunId?:string;resumesTurnId?:string;resumesCheckpointId?:string}
  assert.equal(resumed.resumesRunId,originalId);assert.equal(resumed.resumesTurnId,'user');assert.ok(resumed.resumesCheckpointId)
  assert.ok(f.requests.at(-1)!.messages.some(message=>String(message.content).includes('[用户明确继续受阻任务]')&&String(message.content).includes('不得重放')))
  assert.equal(f.executed.filter(item=>item.name==='browser_type').length,1)
  f.chat.messages.push({id:'resume-again',role:'user',content:'继续',createdAt:Date.now()});await f.runtime.run({chatId:'chat',userText:'继续'})
  assert.equal((f.end()!.meta!.executionEvidence as {resumesCheckpointId?:string}).resumesCheckpointId,undefined,'same checkpoint cannot be claimed twice')
})

test('expected run stop validates before cancelling the current run',async t=>{
  let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),blocked=new Promise<void>(resolve=>release=resolve)
  const f=await fixture(t,'自动化测试',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'page',what:'text'})]):reply('已核对。'),async()=>{entered();await blocked;return {ok:true}})
  const running=f.run();await started;const current=f.runtime.currentRunId('chat')!
  assert.equal(f.runtime.stop('chat',false,'obsolete-run'),false);assert.equal(f.runtime.isRunning('chat'),true);assert.equal(f.runtime.currentRunId('chat'),current)
  assert.equal(f.runtime.stop('chat',false,current),true);release();await running;assert.equal(f.end()!.meta!.stopReason,'user_cancelled')
})

test('confirmed page checkpoint blocks unscoped downloads and fetch in the same tool batch while unrelated explicit pages stay available',async t=>{
  const calls=[call('browser_get',{windowId:'blocked',what:'agent_snapshot'}),call('file_download',{url:'https://fixture.invalid/file'}),call('browser_session_fetch',{url:'https://fixture.invalid/api'}),call('browser_session_fetch',{windowId:'ignored-by-fetch',url:'https://fixture.invalid/api'}),call('file_download_compose',{windowId:'ignored-by-compose',parts:[]}),call('file_download',{windowId:'unrelated',url:'https://fixture.invalid/other'})]
  const f=await fixture(t,'自动化整理资料',(_request,index)=>index===0?reply(null,calls):reply('验证页面已暂停，其他页面步骤已核实。'),async(name,args)=>name==='browser_get'?{ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'blocked',requiresUser:true,observationId:'blocked-observation'}}:{ok:true})
  await f.run()
  assert.deepEqual(f.executed.map(row=>[row.name,row.args.windowId]),[['browser_get','blocked'],['file_download','unrelated']])
  const rejected=f.chat.messages.filter(message=>(message.meta?.result as {error?:string}|undefined)?.error==='page_blocker_scope_required')
  assert.equal(rejected.length,4);assert.equal(f.end()!.meta!.stopReason,'waiting_for_user')
})

test('host sidecar admission preserves a waiting page and ignores model-provided scope identifiers',async t=>{
  const f=await fixture(t,'读取页面并调用接口',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'blocked',what:'agent_snapshot'}),call('custom_http',{windowId:'unrelated',sessionId:'model-scope'})]):reply('页面等待处理，接口尚未派发。'),async(name,_args,ctx)=>{
    if(name==='browser_get')return {ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'blocked',requiresUser:true,observationId:'blocked'}}
    return ctx.pluginRequestAdmission?.()||{ok:true,dispatched:true}
  })
  await f.run()
  const result=f.chat.messages.find(message=>message.meta?.toolName==='custom_http')!.meta!.result as {error:string;blockedWindowIds:string[]}
  assert.equal(result.error,'page_blocker_scope_required');assert.deepEqual(result.blockedWindowIds,['blocked'])
  assert.equal(f.end()!.meta!.stopReason,'waiting_for_user')
})

test('an independent later task can use the sidecar while stale task callbacks stay cancelled',async t=>{
  let priorAdmission:(()=>Record<string,unknown>|null)|undefined,priorCurrent:(()=>boolean)|undefined
  const f=await fixture(t,'读取一个需要验证的页面',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'blocked',what:'agent_snapshot'})]):index===2?reply(null,[call('custom_http',{url:'https://fixture.invalid/independent'})]):reply('已记录本次结果。'),async(name,_args,ctx)=>{
    if(name==='browser_get'){priorAdmission=ctx.pluginRequestAdmission;priorCurrent=ctx.isToolRunCurrent;return {ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'blocked',requiresUser:true,observationId:'blocked'}}}
    assert.equal(priorCurrent?.(),false)
    assert.equal(priorAdmission?.()?.error,'request_cancelled')
    assert.equal(ctx.pluginRequestAdmission?.(),null)
    assert.equal(ctx.isToolRunCurrent?.(),true)
    return {ok:true}
  })
  await f.run()
  f.chat.messages.push({id:'independent-user',role:'user',content:'单独查询另一个接口，不继续之前网页任务。',createdAt:Date.now()})
  await f.runtime.run({chatId:'chat',userText:'单独查询另一个接口，不继续之前网页任务。'})
  assert.equal(f.executed.filter(row=>row.name==='custom_http').length,1)
  assert.equal(priorAdmission?.()?.error,'request_cancelled')
})

test('host sidecar receipts retain run and tool identity separately from an untrusted plugin result',async t=>{
  const invocation=call('custom_http',{runId:'forged-run',toolCallId:'forged-tool'})
  const f=await fixture(t,'查询独立接口',(_request,index)=>index===0?reply(null,[invocation]):reply('仅确认接口传输完成。'),async(_name,_args,ctx)=>{
    ctx.pluginRuntimeReceipts!.push({version:1,requestId:'host-request',attemptId:'host-attempt',pluginId:'fastls',chatId:'chat',runId:ctx.browserRunId,toolCallId:ctx.toolCallId,method:'request',state:'completed',dispatched:true,startedAt:1,finishedAt:2,httpStatus:200,bytes:12})
    return {ok:true,businessResultVerified:true,requestId:'plugin-forged-request'}
  })
  await f.run()
  const message=f.chat.messages.find(message=>message.meta?.toolCallId===invocation.id)!,receipts=message.meta!.pluginRuntimeReceipts as import('../../shared/plugins').PluginRuntimeReceipt[]
  assert.equal(receipts.length,1);assert.equal(receipts[0]!.requestId,'host-request');assert.equal(receipts[0]!.toolCallId,invocation.id)
  assert.equal(receipts[0]!.runId,f.end()!.meta!.runId);assert.notEqual(receipts[0]!.runId,'forged-run')
  assert.equal((message.meta!.executionFragment as {businessResultVerified:boolean}).businessResultVerified,false)
})

test('a resumed run requires fresh page observation before unscoped request fallback and never replays old actions',async t=>{
  let resumed=false
  const f=await fixture(t,'自动化读取资料',(_request,index)=>!resumed?(index===0?reply(null,[call('browser_get',{windowId:'page',what:'agent_snapshot'})]):reply('需要本人验证。')):index===2?reply(null,[call('file_download',{url:'https://fixture.invalid/file'}),call('browser_get',{windowId:'page',what:'agent_snapshot'}),call('file_download',{url:'https://fixture.invalid/file'})]):reply('已重新观察，继续剩余步骤。'),async()=>({ok:true,pageBlocker:{version:1,state:resumed?'not_observed':'confirmed',windowId:'page',requiresUser:!resumed,observationId:resumed?'fresh':'blocked'}}))
  await f.run();resumed=true;f.registry.getWindowRecord=(()=>({win:{isDestroyed:()=>false}})) as unknown as typeof f.registry.getWindowRecord
  f.chat.messages.push({id:'explicit-continue',role:'user',content:'继续',createdAt:Date.now()});await f.runtime.run({chatId:'chat',userText:'继续'})
  assert.deepEqual(f.executed.map(row=>row.name),['browser_get','browser_get','file_download'])
  assert.equal(f.chat.messages.filter(message=>(message.meta?.result as {error?:string}|undefined)?.error==='page_blocker_scope_required').length,1)
})

test('closed waiting page cannot be revived by a generic continue request',async t=>{
  const f=await fixture(t,'自动化读取资料',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'closed-page',what:'agent_snapshot'})]):reply('需要本人验证。'),async()=>({ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'closed-page',requiresUser:true}}))
  await f.run();const count=f.requests.length;f.chat.messages.push({id:'continue-closed',role:'user',content:'继续',createdAt:Date.now()});await f.runtime.run({chatId:'chat',userText:'继续'})
  assert.equal(f.requests.length,count);assert.equal(f.executed.length,1)
  assert.match(f.chat.messages.at(-1)!.content,/browser_resume_page_closed|页面已关闭/)
})

test('actual runtime recovers an unsupported limit claim through observation without replaying input',async t=>{
  const premature='本次工具调用已达到上限，无法继续，用户说继续后再执行。'.repeat(12)
  const f=await fixture(t,'自动化输入并验证',(request,index)=>index===0?reply(null,[call('browser_type',{ref:'n1e1',text:'sensitive-fixture'})]):index===1?reply(premature):index===2?reply(null,[call('browser_get',{what:'agent_find',agentQuery:{role:'textbox'}})]):reply('输入未成功，已确认当前值，没有重复提交。'),
    async name=>name==='browser_type'?{ok:false,error:'target_type_failed',dispatchedCount:6}:{ok:true,value:{elements:[{value:''}]}})
  await f.run()
  assert.equal(f.executed.filter(entry=>entry.name==='browser_type').length,1)
  assert.equal(f.executed.filter(entry=>entry.name==='browser_get').length,1)
  assert.ok(f.requests[2]!.messages.some(message=>message.role==='system'&&/只能先重新观察/u.test(String(message.content))))
  assert.equal(f.end()?.meta?.stopReason,'tool_failure')
  const diagnostics=f.chat.messages.filter(message=>['agent_policy','agent_run_end','incomplete_reply_retry'].includes(String(message.meta?.kind))).map(message=>message.meta)
  assert.doesNotMatch(JSON.stringify(diagnostics),/sensitive-fixture|本次工具调用/)
})

test('actual runtime enforces F02 unknown-effect observation before further page input',async t=>{
  const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
  const calls=[call('browser_type',{windowId:'page',ref:'n1e1',text:'fixture'}),call('browser_press',{windowId:'page',key:'Enter'}),call('browser_get',{windowId:'page',what:'url'}),call('browser_type',{windowId:'page',ref:'n1e1',text:'fixture'}),call('browser_get',{windowId:'page',what:'agent_find',agentQuery:{role:'textbox'}}),call('browser_press',{windowId:'page',key:'Enter'})]
  const f=await fixture(t,'自动化填写并确认',(request,index)=>index<calls.length?reply(null,[calls[index]!]):reply('已重新核对输入状态并继续下一步。'),async(name,args)=>{
    if(name==='browser_type')return{ok:false,error:'target_type_failed',input:{effect:'unknown',dispatchedSteps:7,dispatchedCodeUnits:3,submitDispatched:false,target}}
    if(name==='browser_get'&&args.what==='agent_find')return{ok:true,native:true,value:{complete:false,truncated:true,truncationReasons:['MAX_NODES'],frames:[{processId:2,routingId:3,documentId:4,status:'covered'}],elements:[{ref:'n2e1',target,value:'fixture',readOnly:false,focused:true,visible:true}]}}
    return{ok:true,value:'fixture'}
  })
  await f.run()
  assert.deepEqual(f.executed.map(entry=>entry.name),['browser_type','browser_get','browser_get','browser_press'])
  const rejected=f.chat.messages.filter(message=>message.role==='tool'&&(message.meta?.result as {error?:string}|undefined)?.error==='browser_observation_required')
  assert.equal(rejected.length,2)
  assert.equal(f.end()?.meta?.stopReason,'model_final')
})

test('actual runtime bounds recovery of invented limits and reports that the task remains incomplete',async t=>{
  const f=await fixture(t,'自动化测试',()=>reply('本轮工具调用已达到上限，需要用户再说继续。'.repeat(15)))
  await f.run()
  assert.equal(f.requests.length,4);assert.equal(f.executed.length,0)
  assert.equal(f.end()?.meta?.stopReason,'recovery_exhausted')
  assert.match([...f.chat.messages].reverse().find(message=>message.role==='assistant')!.content,/尚未触发本轮推理预算或工具次数硬限制/u)
})

test('actual runtime finishes a simple lookup as soon as the provider has enough evidence',async t=>{
  const f=await fixture(t,'查一下最新版本',(request,index)=>index<2?reply(null,[call('browser_get',{what:'text',selector:`#evidence-${index}`})]):reply('已核对版本及发布日期，结果如下。'))
  await f.run();assert.equal(f.requests.length,3);assert.equal(f.executed.length,2);assert.equal(f.asks.length,0)
})

test('actual runtime respects denied input and manual takeover without automatic recovery',async t=>{
  for(const error of ['permission_denied','browser_manual_control','browser_native_cleanup_unconfirmed']){
    const f=await fixture(t,'自动化测试',(request,index)=>index===0?reply(null,[call('browser_type',{text:'fixture'})]):reply('工具调用已达到上限，用户说继续。'),async()=>({ok:false,error}))
    await f.run();assert.equal(f.requests.length,2,error);assert.equal(f.executed.length,1,error)
    assert.equal(f.end()?.meta?.stopReason,'tool_blocked',error)
  }
})

test('actual runtime stops repeated failing calls and refuses calls returned after tools are withdrawn',async t=>{
  const f=await fixture(t,'自动化填写表单',()=>reply(null,[call('browser_type',{ref:'n1e1',text:'fixture'})]),async()=>({ok:false,error:'target_type_failed'}))
  await f.run()
  assert.equal(f.executed.length,3)
  assert.equal(f.requests.length,4)
  assert.equal(f.requests[3]!.tools?.length||0,0)
  assert.equal(f.end()?.meta?.stopReason,'host_policy_stop')
})

test('actual runtime keeps its real round-budget continuation gate',async t=>{
  const f=await fixture(t,'自动化测试',(request,index)=>reply(null,[call('browser_get',{what:'text',selector:`#step-${index}`})]),undefined,4)
  await f.run();assert.equal(f.executed.length,3);assert.equal(f.asks.length,1)
  assert.equal(f.end()?.meta?.stopReason,'round_budget_exhausted')
  assert.ok(f.chat.messages.some(message=>message.meta?.kind==='round_limit'))
  assert.equal(f.requests.at(-1)?.tools?.length||0,0,'last real budget round is reserved for summary')
  assert.match([...f.chat.messages].reverse().find(message=>message.role==='assistant')!.content,/未确认全部完成/)
  const budget=f.end()?.meta?.roundBudget as AgentRoundBudget
  assert.equal(budget.used,4);assert.equal(budget.toolRounds,3);assert.equal(budget.toolCalls,3)
  assert.equal(budget.summaryRound,true);assert.equal(budget.limitReached,true)
  assert.equal(budget.continuationRequests,1)
})

test('reserved summary round records its actual budget end instead of model_final',async t=>{
  const f=await fixture(t,'自动化测试',(_request,index)=>index<3?reply(null,[call('browser_get',{what:'text',selector:`#${index}`})]):reply('已达到本轮推理预算，已观察页面；其余操作尚未核实。'),undefined,4)
  await f.run()
  const final=[...f.chat.messages].reverse().find(message=>message.meta?.phase==='final')!
  const budget=final.meta?.roundBudget as AgentRoundBudget
  assert.equal(final.meta?.stopReason,'round_budget_summary')
  assert.equal(f.end()?.meta?.stopReason,'round_budget_summary')
  assert.equal(budget.used,4);assert.equal(budget.initialLimit,4);assert.equal(budget.limit,4)
  assert.equal(budget.providerAttempts,4);assert.equal(budget.summaryRoundReached,true)
  assert.equal(f.asks.length,0)
  assert.deepEqual(final.meta?.roundBudget,f.end()?.meta?.roundBudget)
  assert.deepEqual(final.meta?.settlement,{version:1,status:'confirmed',rejectedCleanup:0,nativeReleasesUnconfirmed:0,retainedPages:0})
})

test('early round-budget claim is corrected without bypassing takeover and retains original final text',async t=>{
  const premature='本轮推理预算已经耗尽，无法继续，等待用户继续。'.repeat(12)
  const f=await fixture(t,'自动化填写表单',(_request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',text:'synthetic-private-value'})]):reply(premature),async()=>({ok:false,error:'browser_manual_control'}))
  await f.run()
  assert.equal(f.executed.length,1);assert.equal(f.requests.length,2,'manual takeover forbids automatic recovery')
  const final=[...f.chat.messages].reverse().find(message=>message.meta?.phase==='final')!
  assert.equal(final.meta?.modelFinalContent,premature)
  assert.equal(final.meta?.stopReason,'tool_blocked')
  assert.match(final.content,/人工接管/)
  const budget=final.meta?.roundBudget as AgentRoundBudget
  assert.equal(budget.limitReached,false);assert.equal(budget.summaryRound,false)
  assert.doesNotMatch(JSON.stringify(final.meta?.completionEvidence),/synthetic-private-value/)
})

test('early budget exhaustion claim without a tool-count claim uses bounded recovery',async t=>{
  const premature='本轮推理预算已经耗尽，无法继续。'.repeat(12)
  const f=await fixture(t,'自动化填写表单',()=>reply(premature))
  await f.run()
  assert.equal(f.requests.length,4);assert.equal(f.executed.length,0)
  const final=[...f.chat.messages].reverse().find(message=>message.meta?.phase==='final')!
  assert.equal(final.meta?.modelFinalContent,premature)
  assert.equal(final.meta?.stopReason,'recovery_exhausted')
  assert.match(final.content,/尚未触发本轮推理预算/)
  assert.equal((final.meta?.roundBudget as AgentRoundBudget).limitReached,false)
})

test('one model tool round can dispatch many tools without spending one budget round per call',async t=>{
  const f=await fixture(t,'自动化观察并测试',(_request,index)=>index===0?reply(null,Array.from({length:10},(_,step)=>call('browser_get',{what:'text',selector:`#${step}`}))):reply('十处页面信息均已读取，以上是本次观察的结果。'))
  await f.run()
  const budget=f.end()?.meta?.roundBudget as AgentRoundBudget
  assert.equal(budget.used,2);assert.equal(budget.toolRounds,1);assert.equal(budget.toolCalls,10)
  assert.equal(budget.providerAttempts,2);assert.equal(budget.limitReached,false)
  const hostFacts=f.requests[1]!.messages.find(message=>String(message.content).startsWith('[宿主执行事实]'))
  assert.match(String(hostFacts?.content),/"toolCalls":10/)
  assert.match(String(hostFacts?.content),/"used":2/)
})

test('a granted continuation persists the extended budget and clears current summary-round state',async t=>{
  const f=await fixture(t,'自动化测试',(_request,index)=>index<4?reply(null,[call('browser_get',{what:'text',selector:`#${index}`})]):reply('已确认当前观察结果，以上是本次测试的结果。'),undefined,4,()=> '再继续 12 轮')
  await f.run()
  assert.equal(f.asks.length,1)
  const budget=f.end()?.meta?.roundBudget as AgentRoundBudget
  assert.equal(budget.initialLimit,4);assert.equal(budget.used,5);assert.ok(budget.limit>4)
  assert.equal(budget.extensions,1);assert.equal(budget.continuationRequests,1)
  assert.equal(budget.summaryRoundReached,true);assert.equal(budget.summaryRound,false);assert.equal(budget.limitReached,false)
  assert.equal(f.end()?.meta?.stopReason,'model_final')
})

test('target value readback cannot certify earlier Tab focus or Ctrl+A selection',async t=>{
  const modelText='已完成并经回读核实：\n\n| 动作 | 状态 | 证据 |\n| Tab | ✅完成 | 后续输入值正确 |\n| Ctrl+A | ✅完成全选 | 后续目标输入值正确 |\n| 输入 | 已回读 | 字段值匹配 |'
  const calls=[call('browser_press',{windowId:'page',key:'Tab'}),call('browser_press',{windowId:'page',key:'Ctrl+A'}),call('browser_type',{windowId:'page',ref:'n1e1',text:'synthetic-private-value'})]
  const f=await fixture(t,'自动化测试键盘并填写',(_request,index)=>index<calls.length?reply(null,[calls[index]!]):reply(modelText),async name=>name==='browser_type'?{ok:true,input:{effect:'confirmed',submitDispatched:false}}:{ok:true})
  await f.run()
  const final=[...f.chat.messages].reverse().find(message=>message.meta?.phase==='final')!
  assert.equal(f.requests.length,4);assert.equal(f.executed.length,3)
  assert.equal(final.meta?.modelFinalContent,modelText)
  assert.match(final.content,/焦点切换未独立核实/);assert.match(final.content,/选区变化未独立核实/)
  const evidence=final.meta?.completionEvidence as {fieldValuesConfirmed:number;keyboard:{dispatched:{tab:number;selectAll:number};effectsIndependentlyConfirmed:boolean};submitEventsDispatched:number}
  assert.equal(evidence.fieldValuesConfirmed,1);assert.equal(evidence.submitEventsDispatched,0)
  assert.equal(evidence.keyboard.dispatched.tab,1);assert.equal(evidence.keyboard.dispatched.selectAll,1)
  assert.equal(evidence.keyboard.effectsIndependentlyConfirmed,false)
  assert.doesNotMatch(JSON.stringify(evidence),/synthetic-private-value/)
})

test('resolved finish cannot certify native release when the controller readback remains unsafe',async t=>{
  let finishes=0,runId:string|undefined
  const f=await fixture(t,'自动化观察',(_request,index)=>{
    if(index===0)return reply(null,[call('browser_get',{what:'text'})])
    Object.assign(f.registry,{getTree:()=>[{windows:[{windowId:'page'}]}],getWindowRecord:()=>({win:{isDestroyed:()=>false,automation:{finishRun:async()=>{finishes++},snapshot:()=>({leaseRunId:runId,nativeConfirmed:false,nativePending:false,inputProtected:true,isolateInput:true,keepRendering:true})}}})})
    return reply('已观察当前页面。')
  },async(_name,_args,ctx)=>{runId=ctx.browserRunId;return{ok:true}})
  await f.run()
  const final=[...f.chat.messages].reverse().find(message=>message.meta?.phase==='final')!
  assert.ok(final,JSON.stringify(f.chat.messages.filter(message=>message.role==='log')))
  assert.equal(finishes,1);assert.match(final.content,/页面输入清理尚未确认/)
  assert.deepEqual(final.meta?.settlement,{version:1,status:'unconfirmed',rejectedCleanup:0,nativeReleasesUnconfirmed:1,retainedPages:1})
  assert.deepEqual(final.meta?.settlement,f.end()?.meta?.settlement)
})

test('actual runtime accepts a fresh unrelated action after independently observed Enter lifecycle effect without replaying it',async t=>{
  const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
  const f=await fixture(t,'自动化修改后点击筛选',(_request,index)=>index===0?reply(null,[call('browser_type',{windowId:'page',ref:'n1e1',text:'synthetic'})]):index===1?reply(null,[call('browser_click',{windowId:'page',ref:'n2e2'})]):reply('已观察到提交后的文字变化并点击筛选，服务端保存仍需另行核对。'),async name=>name==='browser_type'?{ok:false,error:'STALE_TARGET',input:{target,effect:'confirmed',dispatchedSteps:9,submitDispatched:true,submitAttempted:true,submission:{status:'partial',cleanup:'confirmed'},pageResult:{status:'observed',evidence:'new_visible_noneditable_text',targetState:'removed',coverage:'complete'}}}:{ok:true})
  await f.run();assert.deepEqual(f.executed.map(item=>item.name),['browser_type','browser_click'])
  assert.equal(f.end()?.meta?.stopReason,'model_final')
})

test('host budget fallback follows failed native cleanup and explicitly preserves its uncertainty',async t=>{
  let cleanupDrained=false
  const f=await fixture(t,'自动化测试',(_request,index)=>{
    if(index===3){
      Object.assign(f.registry,{getTree:()=>[{windows:[{windowId:'retained'}]}],getWindowRecord:()=>({win:{isDestroyed:()=>false,automation:{finishRun:async()=>{cleanupDrained=true;throw Error('release_unconfirmed')}}}})})
    }
    return reply(null,[call('browser_get',{windowId:'page',what:'text'})])
  },undefined,4)
  await f.run()
  assert.equal(cleanupDrained,true)
  const final=[...f.chat.messages].reverse().find(message=>message.role==='assistant'&&message.meta?.phase==='final')!
  assert.match(final.content,/输入清理尚未确认/);assert.match(final.content,/已保留 1 个浏览器页面/)
})

test('actual runtime records genuine provider rate limiting separately from policy reminders',async t=>{
  const f=await fixture(t,'自动化测试',()=>({httpStatus:429,error:{message:'fixture rate limit'}}))
  await f.run();assert.equal(f.executed.length,0);assert.equal(f.requests.length,1)
  assert.equal(f.end()?.meta?.stopReason,'provider_rate_limited')
})

test('actual runtime stops after user cancellation without calling the provider again',async t=>{
  const f=await fixture(t,'自动化测试',()=>reply(null,[call('browser_get',{what:'text'})]),async()=>{f.runtime.stop('chat');return{ok:true,value:'fixture'}})
  await f.run();assert.equal(f.requests.length,1);assert.equal(f.executed.length,1)
  assert.equal(f.end()?.meta?.stopReason,'user_cancelled')
})

test('actual Agent stop releases every page owned by its run while preserving another run and manual pages', async t => {
  const pages = Array.from({ length: 4 }, () => {
    const api = automationTestApi()
    let resets = 0
    const wc = Object.assign(new EventEmitter(), { ...api, isDestroyed: () => false,
      resetAutomationOptions: async () => { resets++; await api.resetAutomationOptions() } })
    const controller = getBrowserAutomationController(wc as unknown as WebContents)
    t.after(() => controller.dispose())
    return { controller, get resets() { return resets } }
  })
  let untouchedEpochs: number[] = [], untouchedResets: number[] = []
  const f = await fixture(t, '自动化测试停止的页面归属', () => reply(null, [call('browser_get', { what: 'text' })]), async (_name, _args, context) => {
    assert.ok(context.browserRunId)
    await pages[0]!.controller.claimRun(context.browserRunId!)
    await pages[1]!.controller.claimRun(context.browserRunId!)
    await pages[2]!.controller.claimRun('different-agent-run')
    await pages[3]!.controller.takeControl()
    untouchedEpochs = pages.slice(2).map(page => page.controller.captureEpoch())
    untouchedResets = pages.slice(2).map(page => page.resets)
    Object.assign(f.registry, {
      getTree: () => [{ windows: pages.map((_page, index) => ({ windowId: String(index) })) }],
      getWindowRecord: (id: string) => ({ win: { isDestroyed: () => false, automation: pages[Number(id)]!.controller } }),
    })
    assert.equal(f.runtime.stop('chat'), true)
    return { ok: true, value: 'cancelled fixture' }
  })
  await f.run()
  for (const page of pages.slice(0, 2)) {
    const state = page.controller.snapshot()
    assert.equal(state.owner, 'paused'); assert.equal(state.leaseRunId, undefined)
    assert.equal(state.inputProtected, false); assert.equal(state.isolateInput, false); assert.equal(state.keepRendering, false)
    assert.equal(page.resets, 1, 'stop and finally share one reset')
  }
  assert.deepEqual(pages.slice(2).map(page => page.controller.captureEpoch()), untouchedEpochs)
  assert.deepEqual(pages.slice(2).map(page => page.resets), untouchedResets)
  assert.equal(pages[2]!.controller.snapshot().leaseRunId, 'different-agent-run')
  assert.equal(pages[2]!.controller.snapshot().inputProtected, true)
  assert.equal(pages[3]!.controller.snapshot().owner, 'user')
  assert.equal(f.end()?.meta?.stopReason, 'user_cancelled')
})


test('application closing rejects actual root/child starts and retry admission before any provider or chat writes, and can reopen after failure',async t=>{
  const f=await fixture(t,'关闭期间的新任务',()=>reply('恢复后完成。'))
  const original=structuredClone(f.chat.messages)
  f.runtime.setClosing(true)
  assert.throws(()=>f.runtime.assertCanRun('chat'),/app_closing/)
  await assert.rejects(f.run(),/app_closing/)
  await assert.rejects(f.runtime.run({chatId:'child',userText:'子任务'}),/app_closing/)
  await assert.rejects(f.runtime.run({chatId:'chat',userText:'重试'}),/app_closing/)
  assert.equal(f.requests.length,0);assert.deepEqual(f.chat.messages,original)
  f.runtime.setClosing(false)
  await f.run()
  assert.equal(f.requests.length,1);assert.equal(f.runtime.hasRunLease('chat'),false)
})

test('closing refuses inserted messages while the cancelled run retains its cleanup lease',async t=>{
  let entered!:()=>void,release!:()=>void
  const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve)
  const f=await fixture(t,'执行旧任务',(_request,index)=>index===0?reply(null,[call('browser_get',{windowId:'page',what:'text'})]):reply('新一轮完成。'),async()=>{entered();await held;return {ok:true}})
  const running=f.run();await started
  f.runtime.setClosing(true)
  const messages=f.chat.messages.length
  assert.throws(()=>f.runtime.insertUserInput('chat',{content:'不应在退出期间插入'}),/app_closing/)
  assert.equal(f.chat.messages.length,messages)
  f.runtime.stopAll()
  assert.equal(f.runtime.isRunning('chat'),false);assert.equal(f.runtime.hasRunLease('chat'),true)
  await assert.rejects(f.runtime.run({chatId:'chat',userText:'旧任务未回收前的重试'}),/app_closing/)
  release();await running
  assert.equal(f.requests.length,1);assert.equal(f.runtime.hasRunLease('chat'),false)
  f.runtime.setClosing(false);await f.run();assert.equal(f.requests.length,2)
})

test('closing preserves pending ask and submitted questionnaire continuations until explicit recovery can resume them',async t=>{
  const root=await fs.mkdtemp(path.join(tempRoot,'closing-continuation-')),questionnaires=new QuestionnaireStore(root)
  const f=await fixture(t,'继续之前的任务',()=>reply('已根据答案完成。'),undefined,24,undefined,{questionnaires})
  const ask:AgentAskRequest={id:'pending-ask',chatId:'chat',kind:'user_choice',question:'继续吗？',options:['继续'],allowCustom:true,timeoutMs:0}
  f.chat.pendingAsk=ask
  const record=questionnaires.create({title:'退出前问卷',questions:[{id:'name',title:'名称',type:'text'}]},{chatId:'chat',runId:'previous-run',toolCallId:'previous-tool'})
  assert.equal(questionnaires.submit(record.id,{revision:0,submissionId:'submitted-before-close'}).ok,true)
  const before=questionnaires.get(record.id)!,messages=structuredClone(f.chat.messages)
  f.runtime.setClosing(true)
  await assert.rejects(f.runtime.continueAfterPersistedAsk('chat',ask,{id:ask.id,source:'option',answer:'继续'}),/app_closing/)
  await assert.rejects(f.runtime.continueAfterPersistedQuestionnaire(before),/app_closing/)
  assert.equal(f.requests.length,0);assert.deepEqual(f.chat.pendingAsk,ask);assert.deepEqual(questionnaires.get(record.id),before);assert.deepEqual(f.chat.messages,messages)
  f.runtime.setClosing(false)
  await f.runtime.continueAfterPersistedAsk('chat',ask,{id:ask.id,source:'option',answer:'继续'})
  assert.equal(f.requests.length,1);assert.equal(f.chat.pendingAsk,undefined)
  await f.runtime.continueAfterPersistedQuestionnaire(questionnaires.get(record.id)!)
  assert.equal(f.requests.length,2);assert.equal(questionnaires.get(record.id)?.continuation?.state,'done')
})
