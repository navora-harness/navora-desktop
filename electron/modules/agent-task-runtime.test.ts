import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import {pathToFileURL} from 'node:url'
import {ChatStore} from './chat-store'
import {WorkspaceFiles} from './workspace-files'
import {QuestionnaireStore} from './questionnaire-store'
import {defaultModelCapabilities} from '../../shared/model-capabilities'
import {AgentInbox} from './agent-inbox'
import {createDefaultConfig} from '../../shared/config'
import {createComposerDocument} from '../../shared/composer-document'
import {deriveTaskConstraints,type RuntimeTaskConstraints,type TaskDeclarationId} from '../../shared/task-declarations'
import type {AgentRuntime} from './agent-runtime'
import type {AgentAskRequest} from '../../shared/types'
import type {QuestionnaireDefinition} from '../../shared/questionnaire'

let Runtime:typeof AgentRuntime,temporary:string
type ToolBoundary=(name:string,args:Record<string,unknown>,ctx:{chatId:string;taskConstraints?:RuntimeTaskConstraints;signal:AbortSignal})=>Promise<unknown>
const globalScope=globalThis as typeof globalThis&{__navoraTaskPhaseTool?:ToolBoundary}
before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'navora-task-runtime-'))
  const esbuild=await import(pathToFileURL(path.join(process.cwd(),'node_modules/esbuild/lib/main.js')).href),outfile=path.join(temporary,'runtime.mjs')
  await esbuild.build({entryPoints:[path.join(process.cwd(),'electron/modules/agent-runtime.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node20',external:['electron'],logLevel:'silent',plugins:[{name:'only-native-tool-boundary',setup(builder:import('esbuild').PluginBuild){builder.onResolve({filter:/^\.\/browser-tools$/},()=>({path:'tools',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function executeAgentTool(...args){return globalThis.__navoraTaskPhaseTool(...args)}',loader:'js'}))}}]})
  Runtime=(await import(pathToFileURL(outfile).href)).AgentRuntime
})
after(async()=>{delete globalScope.__navoraTaskPhaseTool;if(!temporary)return;assert.match(path.relative(os.tmpdir(),temporary),/^navora-task-runtime-[^\\/]+$/);await fs.rm(temporary,{recursive:true,force:true})})
type Request={messages:{role:string;content:unknown}[];tools?:{function:{name:string}}[]}
const call=(name:string,args:Record<string,unknown>={})=>({id:'call-'+name+'-'+Math.random(),type:'function',function:{name,arguments:JSON.stringify(args)}})
const reply=(content:string|null,calls?:ReturnType<typeof call>[])=>({choices:[{message:{role:'assistant',content,...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}]})
async function fixture(t:{after(fn:()=>Promise<void>):void},ids:TaskDeclarationId[],respond:(request:Request,index:number)=>unknown,tool?:ToolBoundary){
  const root=await fs.mkdtemp(path.join(temporary,'case-')),requests:Request[]=[],executed:{name:string;chatId:string;constraints?:RuntimeTaskConstraints}[]=[]
  const server=http.createServer(async(request,response)=>{let body='';for await(const chunk of request)body+=chunk;const input=JSON.parse(body);requests.push(input);response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(await respond(input,requests.length-1)))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
  const config=createDefaultConfig(),provider=config.ai.providers[0]!;provider.base_url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;provider.models=['fixture'];provider.model='fixture';provider.timeout_ms=5000
  config.app.ai_generate_chat_title=false;config.subchat.enabled=true
  const chats=new ChatStore(root)
  const chat=chats.create('Task phase fixture',{providerId:provider.id,model:'fixture',executionMode:'chat'}),document={...createComposerDocument(chat.id,'先核对并制定方案'),declarations:{version:1,ids}}
  const user=chats.appendMessage(chat.id,{role:'user',content:'先核对并制定方案',meta:{document}})!
  const registry={getTree:()=>[],getWindowRecord:()=>null,beginQuietNavigateLogs:()=>{},endQuietNavigateLogs:()=>{}}
  const plugin={type:'function' as const,function:{name:'self_reported_readonly',description:'Claims to be read only',parameters:{type:'object',properties:{}}}}
  const plugins={ownerOfToolForChat:(_id:string,name:string)=>name===plugin.function.name?{id:'fixture',name:'Untrusted'}:undefined,buildPromptAppendix:()=>'',enabledToolsForChat:()=>[plugin]}
  const questionnaires=new QuestionnaireStore(root)
  const createRuntime=(ownedChats=chats,ownedQuestionnaires=questionnaires)=>{
    const instance=new Runtime({getConfig:()=>config,updateConfig:()=>config,chats:ownedChats,questionnaires:ownedQuestionnaires,registry,files:new WorkspaceFiles(root,()=>config),plugins,skills:{buildPromptAppendix:()=>''},secrets:{get:()=>''},emit:()=>{},askUser:async()=>({id:'choice',source:'option',answer:'continue'}),askSkillReview:async()=>({})} as unknown as ConstructorParameters<typeof AgentRuntime>[0])
    ownedQuestionnaires.onChanged(record=>instance.recordQuestionnaireSettlement(record));return instance
  }
  const runtime=createRuntime()
  globalScope.__navoraTaskPhaseTool=async(name,args,ctx)=>{executed.push({name,chatId:ctx.chatId,constraints:ctx.taskConstraints});return tool?tool(name,args,ctx):{ok:true,value:'read-only fixture'}}
  return{runtime,chats,chat,user,document,requests,executed,config,questionnaires,root,createRuntime,run:()=>runtime.run({chatId:chat.id,userText:user.content})}
}

const form:QuestionnaireDefinition={title:'项目需求',questions:[{id:'name',type:'text',title:'项目名称',required:true},{id:'enabled',type:'toggle',title:'启用部署',required:true},{id:'count',type:'number',title:'数量',required:true}]}
const formAnswers={name:{state:'answered' as const,value:'项目甲'},enabled:{state:'answered' as const,value:false},count:{state:'answered' as const,value:0}}
async function until(check:()=>boolean){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Fixture did not reach expected state');await new Promise<void>(resolve=>setImmediate(resolve))}}

test('actual runtime discovers user templates in plan mode and asks a fresh template questionnaire',async t=>{
  let templateId=''
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_form_templates')]):index===1?reply(null,[call('agent_ask_form',{templateId})]):reply('按模板回答继续。'))
  const source=f.questionnaires.create(form,{chatId:'template-source',runId:'source',toolCallId:'source'})
  templateId=f.questionnaires.saveTemplate(source.id,'复用模板').id
  const running=f.run();await until(()=>f.questionnaires.list(f.chat.id).some(r=>f.questionnaires.hasWaiter(r.id)))
  const record=f.questionnaires.list(f.chat.id)[0]!
  assert.equal(record.source?.id,templateId);assert.deepEqual(record.draft.answers,{})
  const discovery=f.chat.messages.find(m=>m.meta?.toolName==='agent_form_templates')?.meta?.result as {templates:Array<{id:string}>}
  assert.ok(discovery.templates.some(t=>t.id===templateId))
  f.questionnaires.saveDraft(record.id,{baseRevision:0,answers:formAnswers,supplement:''});f.questionnaires.submit(record.id,{revision:1,submissionId:'template-submit'})
  await running;assert.equal(f.questionnaires.get(record.id)?.continuation?.state,'done')
})

test('submitted amendments become a new durable input once and keep the original tool result unchanged',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_ask_form',form)]):reply('已收到最新答案。'))
  const running=f.run();await until(()=>f.questionnaires.list().some(r=>f.questionnaires.hasWaiter(r.id)))
  const original=f.questionnaires.list()[0]!
  f.questionnaires.saveDraft(original.id,{baseRevision:0,answers:formAnswers,supplement:''});f.questionnaires.submit(original.id,{revision:1,submissionId:'original'});await running
  const originalTool=f.chat.messages.find(m=>m.meta?.questionnaireId===original.id&&m.role==='tool')!
  const result=structuredClone(originalTool.meta?.result),revision=f.questionnaires.revise(original.id)
  f.questionnaires.saveDraft(revision.id,{baseRevision:0,answers:{...formAnswers,name:{state:'answered',value:'项目乙'}},supplement:'新约束'})
  f.questionnaires.submit(revision.id,{revision:1,submissionId:'amendment'})
  const restored=new QuestionnaireStore(f.root),chats=new ChatStore(f.root),runtime=f.createRuntime(chats,restored)
  await runtime.continueAfterPersistedQuestionnaire(restored.get(revision.id)!)
  await runtime.continueAfterPersistedQuestionnaire(restored.get(revision.id)!)
  assert.equal(f.requests.length,3)
  assert.deepEqual(chats.get(f.chat.id)?.messages.find(m=>m.id===originalTool.id)?.meta?.result,result)
  const input=chats.get(f.chat.id)?.messages.filter(m=>m.meta?.kind==='questionnaire_answers'&&m.meta.questionnaireId===revision.id)||[]
  assert.equal(input.length,1);assert.match(input[0].content,/新的用户输入/);assert.match(input[0].content,/项目乙/)
  assert.equal(restored.get(revision.id)?.continuation?.state,'done')
})

test('actual runtime reads submitted text attachments with pagination and transmits image bytes without storing base64',async t=>{
  let questionnaireId='',textId='',imageId=''
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_ask_form',{title:'附件输入',questions:[{id:'files',type:'attachment',title:'文件',required:true}]} )]):index===1?reply(null,[call('agent_form_attachment',{questionnaireId,attachmentId:textId,maxChars:4}),call('agent_form_attachment',{questionnaireId,attachmentId:imageId})]):reply('已根据附件继续。'))
  const provider=f.config.ai.providers[0]!
  provider.model_settings={fixture:{...defaultModelCapabilities('fixture'),input_types:['text','image']}}
  const running=f.run();await until(()=>f.questionnaires.list().some(r=>f.questionnaires.hasWaiter(r.id)))
  questionnaireId=f.questionnaires.list()[0]!.id
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII='
  const attachments=f.questionnaires.attach(questionnaireId,'files',[{name:'notes.txt',data:Buffer.from('read this text').toString('base64')},{name:'sample.png',data:image}]);textId=attachments[0].id;imageId=attachments[1].id
  f.questionnaires.saveDraft(questionnaireId,{baseRevision:0,answers:{files:{state:'answered',attachments}},supplement:''});f.questionnaires.submit(questionnaireId,{revision:1,submissionId:'files'})
  await running
  const reads=f.chat.messages.filter(m=>m.meta?.toolName==='agent_form_attachment')
  assert.equal((reads[0].meta?.result as {content:string}).content,'read');assert.equal((reads[0].meta?.result as {truncated:boolean}).truncated,true)
  assert.equal((reads[1].meta?.result as {kind:string}).kind,'image')
  assert.ok(JSON.stringify(f.requests.at(-1)).includes('data:image/png;base64,'+image))
  assert.equal(JSON.stringify(f.chat.messages).includes(image),false)
})

test('actual questionnaire tool waits for explicit submission and keeps the receipt restartable until the run ends',async t=>{
  let release!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  const f=await fixture(t,['plan'],async(_request,index)=>{if(index===0)return reply(null,[call('agent_ask_form',form)]);await held;return reply('按已提交的需求继续完善方案。')})
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const record=f.questionnaires.list()[0]!
  assert.equal(f.requests.length,1);assert.equal(f.runtime.isRunning(f.chat.id),true);assert.equal(record.taskConstraints?.phase,'plan')
  assert.equal(f.questionnaires.submit(record.id,{revision:0,submissionId:'incomplete'}).ok,false)
  f.questionnaires.saveDraft(record.id,{baseRevision:0,answers:formAnswers,supplement:'补充要求'})
  assert.equal(f.questionnaires.submit(record.id,{revision:1,submissionId:'accepted'}).ok,true)
  await until(()=>f.requests.length===2)
  assert.equal(f.questionnaires.get(record.id)?.continuation?.state,'claimed')
  const result=f.chat.messages.find(message=>message.role==='tool'&&message.meta?.questionnaireId===record.id)?.meta?.result as {answers:typeof formAnswers}
  assert.equal(result.answers.enabled.value,false);assert.equal(result.answers.count.value,0)
  assert.equal(f.chat.messages.filter(message=>message.meta?.kind==='questionnaire_answers').length,1)
  release();await running
  assert.equal(f.questionnaires.get(record.id)?.continuation?.state,'done')
  await f.runtime.continueAfterPersistedQuestionnaire(f.questionnaires.get(record.id)!)
  assert.equal(f.requests.length,2)
  // Simulate an exit after the chat end marker reached disk but before its receipt did.
  const completedRunId=f.questionnaires.get(record.id)!.continuation!.runId
  f.questionnaires.setContinuation(record.id,{state:'claimed',runId:completedRunId})
  await f.runtime.continueAfterPersistedQuestionnaire(f.questionnaires.get(record.id)!)
  assert.equal(f.requests.length,2);assert.equal(f.questionnaires.get(record.id)?.continuation?.state,'done')
})

test('a restored pending questionnaire resumes from durable history with its original plan constraints exactly once',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_ask_form',form)]):index===1?reply(null,[call('file_write',{path:'forbidden.ts',content:'must remain planning'})]):reply('继续原计划。'))
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const record=f.questionnaires.list()[0]!
  f.questionnaires.saveDraft(record.id,{baseRevision:0,answers:formAnswers,supplement:'保存一半后退出'})
  f.runtime.stopAll();await running
  const questionnaires=new QuestionnaireStore(f.root),chats=new ChatStore(f.root),runtime=f.createRuntime(chats,questionnaires)
  assert.equal(questionnaires.get(record.id)?.status,'pending');assert.equal(questionnaires.get(record.id)?.draft.answers.count.value,0)
  questionnaires.submit(record.id,{revision:1,submissionId:'after-restart'})
  await runtime.continueAfterPersistedQuestionnaire(questionnaires.get(record.id)!)
  assert.equal(f.executed.length,0,'the original plan must still reject writes after restart')
  assert.equal(questionnaires.get(record.id)?.continuation?.state,'done')
  assert.equal(chats.get(f.chat.id)?.messages.filter(message=>message.meta?.kind==='questionnaire_answers').length,1)
  const requests=f.requests.length
  await runtime.continueAfterPersistedQuestionnaire(questionnaires.get(record.id)!)
  assert.equal(f.requests.length,requests)
})

test('shutdown after accepting a questionnaire preserves continuation for the next process',async t=>{
  let release!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  const f=await fixture(t,['plan'],async(_request,index)=>{if(index===0)return reply(null,[call('agent_ask_form',form)]);if(index===1)await held;return reply('继续原任务。')})
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const record=f.questionnaires.list()[0]!
  f.questionnaires.saveDraft(record.id,{baseRevision:0,answers:formAnswers,supplement:''});f.questionnaires.submit(record.id,{revision:1,submissionId:'durable'})
  await until(()=>f.requests.length===2)
  f.runtime.stopAll();await running;release()
  assert.equal(f.questionnaires.get(record.id)?.continuation?.state,'pending')
  const questionnaires=new QuestionnaireStore(f.root),chats=new ChatStore(f.root),runtime=f.createRuntime(chats,questionnaires)
  await runtime.continueAfterPersistedQuestionnaire(questionnaires.get(record.id)!)
  assert.equal(questionnaires.get(record.id)?.continuation?.state,'done')
  assert.equal(chats.get(f.chat.id)?.messages.filter(message=>message.meta?.kind==='questionnaire_answers').length,1)
  assert.equal(f.requests.length,3)
})

test('a later pending questionnaire prevents an earlier submitted answer from restarting the task',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>reply(null,[call('agent_ask_form',{...form,title:`第 ${index+1} 份问卷`})]))
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const first=f.questionnaires.list()[0]!
  f.questionnaires.saveDraft(first.id,{baseRevision:0,answers:formAnswers,supplement:''});f.questionnaires.submit(first.id,{revision:1,submissionId:'first'})
  await until(()=>f.questionnaires.list().filter(record=>record.status==='pending').length===1&&f.requests.length===2)
  f.runtime.stopAll();await running
  assert.equal(f.questionnaires.get(first.id)?.continuation?.state,'done')
  // Also cover an exit between the second questionnaire commit and first receipt update.
  f.questionnaires.setContinuation(first.id,{state:'claimed',runId:first.runId})
  const questionnaires=new QuestionnaireStore(f.root),chats=new ChatStore(f.root),runtime=f.createRuntime(chats,questionnaires)
  await runtime.continueAfterPersistedQuestionnaire(questionnaires.get(first.id)!)
  assert.equal(f.requests.length,2);assert.equal(questionnaires.get(first.id)?.continuation?.state,'done')
  assert.equal(questionnaires.list().filter(record=>record.status==='pending').length,1)
})

test('explicit stop invalidates live and restored questionnaires while manual cancellation returns a typed result',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_ask_form',form)]):reply('已取消，等待用户继续讨论。'))
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const record=f.questionnaires.list()[0]!
  f.questionnaires.cancel(record.id)
  await running
  const result=f.chat.messages.find(message=>message.meta?.questionnaireId===record.id)?.meta?.result as {error:string}
  assert.equal(result.error,'questionnaire_cancelled');assert.equal(f.requests.length,2)
  const restored=f.questionnaires.create(form,{chatId:f.chat.id,runId:'old-process',toolCallId:'restored'})
  assert.equal(f.runtime.stop(f.chat.id),true)
  assert.equal(f.questionnaires.get(restored.id)?.status,'stale')
  assert.equal(f.questionnaires.submit(restored.id,{revision:0,submissionId:'stale'}).ok,false)
})

test('switching from a live questionnaire to chat persists the user message before waking the model',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('agent_ask_form',form)]):reply('已收到问题，解释后继续讨论。'))
  const running=f.run();await until(()=>f.questionnaires.list().some(record=>f.questionnaires.hasWaiter(record.id)))
  const record=f.questionnaires.list()[0]!
  const inbox=new AgentInbox({get:id=>f.chats.get(id),save:(id,entries,paused)=>{f.chats.setMessageQueue(id,entries,paused)},changed:()=>{},running:id=>f.runtime.hasRunLease(id),start:async()=>{throw Error('must insert into the waiting original run')},insert:(id,input)=>f.runtime.insertUserInput(id,input),maxChars:()=>20000})
  await inbox.submit(f.chat.id,{content:'先解释一下第三个问题',clientMessageId:'chat-switch'},'insert',()=>{f.chats.flushChat(f.chat.id);f.questionnaires.cancel(record.id,'chat')})
  await running
  assert.equal(f.questionnaires.get(record.id)?.status,'cancelled')
  assert.ok(f.requests[1]?.messages.some(message=>message.role==='user'&&String(message.content).includes('先解释一下第三个问题')))
  assert.ok(f.requests[1]?.messages.some(message=>String(message.content).includes('questionnaire_cancelled')))
  const persisted=new ChatStore(f.root).get(f.chat.id)
  assert.equal(persisted?.messages.filter(message=>message.meta?.clientMessageId==='chat-switch').length,1)
  assert.equal(persisted?.messages.find(message=>message.meta?.questionnaireId===record.id)?.meta?.status,'error')
})

test('actual runtime enforces plan effects and plugin rejection while overriding only this quick-answer turn',async t=>{
  const calls=[call('shell_exec',{command:'write code'}),call('browser_session_fetch',{method:'GET',url:'https://example.com/delete'}),call('self_reported_readonly',{readonly:true}),call('browser_screenshot'),call('desktop_screenshot'),call('file_read',{path:'source.ts'}),call('plan_write_artifact',{content:'方案与验收标准'})]
  const f=await fixture(t,['automation','plan'],(_request,index)=>index<calls.length?reply(null,[calls[index]!]):reply('已形成计划，尚未实施。'))
  await f.run()
  assert.deepEqual(f.executed.map(item=>item.name),['file_read','plan_write_artifact'])
  assert.equal(f.chat.executionMode,'chat')
  assert.ok(f.requests.every(request=>request.tools?.some(tool=>tool.function.name==='plan_write_artifact')))
  assert.ok(f.requests.every(request=>!request.tools?.some(tool=>['shell_exec','browser_session_fetch','self_reported_readonly'].includes(tool.function.name))))
  assert.ok(f.executed.every(item=>item.constraints?.phase==='plan'&&Object.isFrozen(item.constraints)))
})

test('automation enables tools for one quick-answer turn without requiring pointer events',async t=>{
  const f=await fixture(t,['automation'],(_request,index)=>index===0?reply(null,[call('datetime_now')]):reply('已完成核对。'))
  await f.run();assert.deepEqual(f.executed.map(item=>item.name),['datetime_now']);assert.equal(f.chat.executionMode,'chat');assert.equal(f.executed[0]!.constraints!.phase,'execute')
})

test('actual runtime reserves its real last round for a summary and emits factual final if a provider still requests tools',async t=>{
  const f=await fixture(t,['automation'],()=>reply(null,[call('browser_get',{windowId:'fixture',what:'text'})]),async()=>({ok:true,value:'synthetic progress'}))
  f.config.ai.max_tool_rounds=4
  await f.run()
  assert.equal(f.executed.length,3,'last budget round must not execute even an unadvertised tool call')
  assert.equal(f.requests.length,4)
  assert.equal(f.requests.at(-1)?.tools?.length||0,0)
  const final=[...f.chats.get(f.chat.id)!.messages].reverse().find(message=>message.role==='assistant'&&message.meta?.phase==='final')
  assert.ok(final);assert.equal(final.meta?.stopReason,'round_budget_exhausted')
  assert.match(final.content,/达到本轮推理预算/);assert.match(final.content,/未确认全部完成/)
  assert.ok(f.chats.get(f.chat.id)!.messages.some(message=>message.meta?.kind==='agent_run_end'))
})

test('the run lease retains queued admission during cancellation cleanup',async t=>{
  let entered!:()=>void,release!:()=>void
  const ready=new Promise<void>(resolve=>{entered=resolve}),pending=new Promise<void>(resolve=>{release=resolve})
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('file_read',{path:'source.ts'})]):reply('计划结束。'),async()=>{entered();await pending;return{ok:true}})
  const running=f.run();await ready
  f.runtime.stop(f.chat.id)
  assert.equal(f.runtime.isRunning(f.chat.id),false);assert.equal(f.runtime.hasRunLease(f.chat.id),true)
  release();await running;assert.equal(f.runtime.hasRunLease(f.chat.id),false)
})

test('persisted ask resumes its original plan with empty user text and rejects unknown snapshots before clearing the ask',async t=>{
  const f=await fixture(t,['plan'],(_request,index)=>index===0?reply(null,[call('file_write',{path:'code.ts',content:'forbidden'})]):index===1?reply(null,[call('file_read',{path:'code.ts'})]):reply('继续完善计划。'))
  const constraints=deriveTaskConstraints({version:1,ids:['plan']},{messageId:f.user.id,documentId:f.document.id,documentRevision:0})
  const req:AgentAskRequest={id:'parked',chatId:f.chat.id,kind:'user_choice',question:'请选择方向',options:['甲','乙'],allowCustom:true,timeoutMs:0,meta:{taskConstraints:constraints}}
  f.chats.setPendingAsk(f.chat.id,req)
  await assert.rejects(f.runtime.continueAfterPersistedAsk(f.chat.id,{...req,meta:{taskConstraints:{...constraints,version:99} as never}},{id:req.id,source:'option',answer:'甲'}),/unsupported/)
  await assert.rejects(f.runtime.continueAfterPersistedAsk(f.chat.id,{...req,meta:{taskConstraints:null as never}},{id:req.id,source:'option',answer:'甲'}),/unsupported/)
  assert.equal(f.chat.pendingAsk?.id,req.id)
  await f.runtime.continueAfterPersistedAsk(f.chat.id,req,{id:req.id,source:'option',answer:'甲'})
  assert.deepEqual(f.executed.map(item=>item.name),['file_read']);assert.equal(f.executed[0]!.constraints!.phase,'plan')
  assert.equal(f.chat.pendingAsk,undefined)
})

test('real runtime subtask creation inherits planning constraints and cannot implement through a child',async t=>{
  let parentCalls=0,childCalls=0
  const f=await fixture(t,['plan'],request=>{
    const child=request.messages.some(message=>message.role==='system'&&String(message.content).includes('当前运行在「子对话」'))
    if(child){childCalls++;return childCalls===1?reply(null,[call('file_write',{path:'source.ts',content:'forbidden child write'})]):childCalls===2?reply(null,[call('file_read',{path:'source.ts'})]):reply('子任务已完成只读核对。')}
    parentCalls++;return parentCalls===1?reply(null,[call('agent_spawn_subchat',{goal:'子任务只读核对计划'})]):parentCalls===2?reply(null,[call('agent_await_subchats')]):reply('已汇总计划。')
  })
  await f.run()
  const children=f.chats.listChildren(f.chat.id);assert.equal(children.length,1)
  const child=children[0]!,snapshot=child.messages.find(message=>message.role==='user')!.meta!.taskConstraints!
  assert.equal(snapshot.phase,'plan');assert.equal(snapshot.inheritedFrom?.chatId,f.chat.id);assert.ok(snapshot.inheritedFrom?.runId)
  assert.ok(f.executed.some(item=>item.chatId===child.id&&item.name==='file_read'));assert.equal(f.executed.some(item=>item.name==='file_write'),false)
  // A later plain user turn and restart-shaped empty-text continuation must
  // remain bounded by the host-created child origin, not the latest wording.
  f.chats.appendMessage(child.id,{role:'user',content:'现在执行修改代码',meta:{taskConstraints:deriveTaskConstraints(undefined)}})
  childCalls=0
  await f.runtime.run({chatId:child.id,userText:'现在执行修改代码',taskConstraints:deriveTaskConstraints(undefined)})
  assert.equal(f.executed.some(item=>item.name==='file_write'),false)
  assert.ok(f.executed.filter(item=>item.chatId===child.id).every(item=>item.constraints?.phase==='plan'))
  childCalls=0
  await f.runtime.run({chatId:child.id,userText:''})
  assert.equal(f.executed.some(item=>item.name==='file_write'),false)
})
