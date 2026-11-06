import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {ChatMessage} from '../../shared/types'
import {createRunEvidence,addExecutionReceipt,normalizeExecutionReceipt,finishRunEvidence} from '../../shared/agent-execution-evidence'
import {recoverRunEvidence,buildEvidenceHistory,buildEvidenceConversation,pendingResumeCheckpoints,explicitResumeRequest} from './agent-evidence-history'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ChatStore} from './chat-store'
const row=(id:string,role:ChatMessage['role'],meta:ChatMessage['meta']={},content='fixture'):ChatMessage=>({id,role,content,meta,createdAt:1})
const current=()=>createRunEvidence({chatId:'chat',runId:'current',turnId:'new-user',at:5})
function previous(){
  let summary=createRunEvidence({chatId:'chat',runId:'previous',turnId:'old-user',at:1})
  for(let i=0;i<12;i++)summary=addExecutionReceipt(summary,normalizeExecutionReceipt({runId:'previous',turnId:'old-user',messageId:`tool-${i}`,toolCallId:`call-${i}`,toolName:i===11?'browser_click':'browser_type',args:{windowId:'page'},result:i===11?{ok:false,error:'browser_operation_invalidated'}:{ok:true,input:{effect:'confirmed'}},at:2}))
  summary=finishRunEvidence(summary,{at:3,stopReason:'tool_blocked',settlement:{status:'confirmed',retainedPages:1}})
  return summary
}
test('history scopes previous nonzero execution separately from current zero',()=>{
  const prior=previous(),messages=[row('old-user','user'),row('end','log',{runId:'previous',kind:'agent_run_end',executionEvidence:prior})]
  const result=buildEvidenceHistory({chatId:'chat',messages,current:current(),userText:'刚才执行了吗'})
  assert.deepEqual(result.runIds,['previous'])
  const text=JSON.stringify(result.messages);assert.match(text,/historical_runs/);assert.match(text,/inputsDispatched\\?\":11/);assert.match(text,/browser_operation_invalidated/);assert.match(text,/current_run/);assert.match(text,/不否定/)
})
test('more than thirty later transcript rows cannot evict a task goal and receipts',()=>{
  const messages=[row('old-user','user',{},'原始任务目标'),row('end','log',{runId:'previous',kind:'agent_run_end',executionEvidence:previous()}),...Array.from({length:60},(_,i)=>row(`f${i}`,i%2?'assistant':'user',{},'闲聊'))]
  const output=buildEvidenceConversation({chatId:'chat',messages,current:current(),userText:'为什么失败'})
  assert.ok(output.some(message=>message.content==='原始任务目标'));assert.ok(output.length<=31)
})

test('legacy zero-tool explanation rounds cannot displace the latest run with execution facts',()=>{
  const messages=[row('end','log',{kind:'agent_run_end',runId:'previous',executionEvidence:previous()}),...Array.from({length:5},(_,i)=>row(`explanation-${i}`,'log',{kind:'agent_run_end',runId:`explanation-${i}`,completionEvidence:{actionsReportedDispatched:0,fieldValuesConfirmed:0,failedTools:0,unresolvedInputs:0},policy:{toolCalls:0}}))]
  const result=buildEvidenceHistory({chatId:'chat',messages,current:current(),userText:'之前操作过吗'})
  assert.ok(result.runIds.includes('previous'))
})

test('page checkpoint contains references only and is claimed once by a new run or cancelled explicitly',()=>{
  const initial=createRunEvidence({chatId:'chat',runId:'blocked',turnId:'old-user',at:1,taskSourceMessageId:'old-user'})
  const summary=addExecutionReceipt(initial,normalizeExecutionReceipt({runId:'blocked',turnId:'old-user',messageId:'read',toolCallId:'probe',toolName:'browser_get',args:{windowId:'page'},at:2,result:{ok:true,pageBlocker:{version:1,state:'confirmed',windowId:'page',observationId:'observation',requiresUser:true,question:'secret'}}}))
  const messages=[row('end','log',{kind:'agent_run_end',runId:'blocked',executionEvidence:summary})],pending=pendingResumeCheckpoints('chat',messages)
  assert.equal(pending.length,1);assert.equal(pending[0]!.pendingSteps,'unknown_requires_observation');assert.equal(pending[0]!.taskSourceMessageId,'old-user');assert.doesNotMatch(JSON.stringify(pending),/secret|question|args|queue/)
  const continued=createRunEvidence({chatId:'chat',runId:'new',at:3,resumesRunId:'blocked',resumesCheckpointId:pending[0]!.id})
  assert.equal(pendingResumeCheckpoints('chat',[...messages,row('start','log',{kind:'agent_run_start',executionEvidence:continued})]).length,0)
  assert.equal(pendingResumeCheckpoints('chat',[...messages,row('cancel','log',{kind:'page_resume_cancelled',checkpointIds:[pending[0]!.id]})]).length,0)
  const cleared=addExecutionReceipt(summary,normalizeExecutionReceipt({runId:'blocked',messageId:'recheck',toolCallId:'recheck',toolName:'browser_get',args:{windowId:'page'},at:3,result:{ok:true,pageBlocker:{version:1,state:'not_observed',windowId:'page'}}}))
  assert.equal(cleared.resumeCheckpoints![0]!.state,'cleared');assert.equal(summary.resumeCheckpoints![0]!.state,'waiting_for_user')
})

test('resume classifier accepts explicit task continuation but not questions, page prose or unrelated work',()=>{
  for(const text of ['继续','请继续原任务','我已完成验证，继续','已经登录，继续原任务'])assert.equal(explicitResumeRequest(text),true,text)
  for(const text of ['为什么不能继续？','是否需要继续','页面说继续','继续创建新的项目','查看其他任务','我已完成验证'])assert.equal(explicitResumeRequest(text),false,text)
})
test('restart with persisted fragments and no end is interrupted and never presumed complete',()=>{
  const messages=[row('old-user','user'),row('start','log',{runId:'previous',kind:'agent_run_start',executionEvidence:createRunEvidence({chatId:'chat',runId:'previous',turnId:'old-user',at:1})}),row('tool','tool',{runId:'previous',toolCallId:'call',toolName:'browser_type',status:'done',result:{ok:true,input:{effect:'confirmed'}}}),row('pending','tool',{runId:'previous',toolCallId:'pending',toolName:'browser_press',status:'running'})]
  const recovered=recoverRunEvidence('chat',messages)[0]!
  assert.equal(recovered.state,'interrupted');assert.equal(recovered.counts.toolsStarted,2);assert.equal(recovered.counts.toolsSettled,1);assert.equal(recovered.counts.inputsDispatched,1);assert.equal(recovered.hasUnresolvedSideEffects,'unknown')
})
test('duplicate legacy receipts deduplicate; missing run IDs stay within consecutive user boundaries',()=>{
  const tool=row('tool','tool',{toolCallId:'same',toolName:'browser_type',status:'done',result:{ok:true}})
  const recovered=recoverRunEvidence('chat',[row('one','user'),tool,{...tool,id:'duplicate'},row('two','user'),{...tool,id:'new-task'}])
  assert.equal(recovered.length,2);assert.equal(recovered[0]!.counts.toolsSettled,1);assert.equal(recovered[1]!.counts.toolsSettled,1)
  assert.notEqual(recovered[0]!.legacyGroupId,recovered[1]!.legacyGroupId)
})
test('legacy aggregate evaluate-inclusive actions do not become a physical input count',()=>{
  const recovered=recoverRunEvidence('chat',[row('end','log',{kind:'agent_run_end',runId:'old',stopReason:'tool_blocked',completionEvidence:{actionsReportedDispatched:11,fieldValuesConfirmed:3,failedTools:2,unresolvedInputs:0},policy:{toolCalls:19}})])[0]!
  assert.equal(recovered.counts.inputsDispatched,'unknown');assert.equal(recovered.counts.fieldValuesVerified,3);assert.equal(recovered.counts.toolsStarted,19)
})
test('budget compression retains nonzero counts, failure codes and durable references',()=>{
  const messages=[row('end','log',{runId:'previous',kind:'agent_run_end',executionEvidence:previous()})]
  const result=buildEvidenceHistory({chatId:'chat',messages,current:current(),userText:'刚才',historyTokenBudget:900})
  const historical=JSON.parse(String(result.messages.find(message=>String(message.content).startsWith('[历史运行事实]'))!.content).split('\n').slice(1).join('\n'))
  assert.equal(historical.runs[0].counts.inputsDispatched,11);assert.ok(historical.runs[0].errorCodes.includes('browser_operation_invalidated'));assert.ok(historical.runs[0].evidenceReferences.length)
  assert.throws(()=>buildEvidenceHistory({chatId:'chat',messages,current:current(),userText:'',historyTokenBudget:10}),/history_evidence_unavailable:context_budget/)
})
test('unknown stored version degrades to receipt reconstruction without rewriting original',()=>{
  const messages=[row('tool','tool',{runId:'old',executionEvidence:{version:99,secret:'bad'},toolName:'browser_evaluate',toolCallId:'e',status:'done',result:{ok:true,value:'not trusted'}})],before=JSON.stringify(messages)
  const result=recoverRunEvidence('chat',messages)
  assert.equal(result[0]!.counts.inputsDispatched,0);assert.equal(result[0]!.evidence[0]!.state,'script_completed');assert.equal(JSON.stringify(messages),before)
})

test('actual ChatStore persists per-tool evidence atomically and recovers interrupted runs after reopening',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-evidence-store-'))
  try{
    const store=new ChatStore(root),chat=store.create('合成测试'),started=createRunEvidence({chatId:chat.id,runId:'persisted',turnId:'user',at:1})
    store.appendMessage(chat.id,row('user','user'));store.appendMessage(chat.id,row('start','log',{kind:'agent_run_start',runId:'persisted',executionEvidence:started}))
    const result={ok:true,input:{effect:'confirmed'}},fragment=normalizeExecutionReceipt({runId:'persisted',turnId:'user',messageId:'tool',toolCallId:'call',toolName:'browser_type',args:{windowId:'page'},result,at:2})
    store.appendMessage(chat.id,row('tool','tool',{runId:'persisted',toolCallId:'call',toolName:'browser_type',status:'done',executionFragment:fragment,result}));store.flushAll()
    const reopened=new ChatStore(root),saved=reopened.get(chat.id)!,recovered=recoverRunEvidence(chat.id,saved.messages)[0]!
    assert.equal(recovered.state,'interrupted');assert.equal(recovered.counts.inputsDispatched,1);assert.equal(recovered.counts.fieldValuesVerified,1)
    assert.deepEqual(fs.readdirSync(path.join(root,'chats')),[`${chat.id}.json`])
    const priorFile=fs.readFileSync(path.join(root,'chats',`${chat.id}.json`),'utf8')
    // Simulate an incomplete temporary write left by a terminated process. It
    // cannot replace or be loaded instead of the last complete conversation.
    fs.writeFileSync(path.join(root,'chats',`.${chat.id}.interrupted.tmp`),'{broken')
    assert.equal(new ChatStore(root).get(chat.id)!.messages.length,saved.messages.length)
    assert.equal(fs.readFileSync(path.join(root,'chats',`${chat.id}.json`),'utf8'),priorFile)
    store.flushAll();reopened.flushAll()
  }finally{const relative=path.relative(os.tmpdir(),root);assert.match(relative,/^navora-evidence-store-[^\\/]+$/u);fs.rmSync(root,{recursive:true,force:true})}
})
