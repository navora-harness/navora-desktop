import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {QuestionnaireStore} from './questionnaire-store'
import type {QuestionnaireDefinition} from '../../shared/questionnaire'

const definition:QuestionnaireDefinition={title:'需求',questions:[{id:'name',type:'text',title:'名称',required:true},{id:'switch',type:'toggle',title:'开关',required:true},{id:'count',type:'number',title:'数量',required:true}]}
const answers={name:{state:'answered' as const,value:'项目甲'},switch:{state:'answered' as const,value:false},count:{state:'answered' as const,value:0}}
function fixture(t:{after(fn:()=>void):void}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navora-questionnaire-store-'))
  t.after(()=>{assert.match(path.relative(os.tmpdir(),root),/^navora-questionnaire-store-[^\\/]+$/);fs.rmSync(root,{recursive:true,force:true})})
  const store=new QuestionnaireStore(root),record=store.create(definition,{chatId:'chat',runId:'run',toolCallId:'tool'})
  return{root,store,record}
}

test('drafts and conflicts survive restart while submissions are immutable and idempotent',t=>{
  const f=fixture(t),saved=f.store.saveDraft(f.record.id,{baseRevision:0,answers,supplement:'补充'})
  assert.equal(saved.ok,true);assert.equal(saved.record.draft.revision,1)
  const conflict=f.store.saveDraft(f.record.id,{baseRevision:0,answers:{name:{state:'answered',value:'另一份输入'}},supplement:''})
  assert.equal(conflict.ok,false);assert.equal(conflict.record.draft.answers.name.value,'项目甲');assert.equal(conflict.record.recoveries?.[0].answers.name.value,'另一份输入')
  const restored=new QuestionnaireStore(f.root)
  assert.deepEqual(restored.get(f.record.id),conflict.record)
  assert.equal(restored.submit(f.record.id,{revision:0,submissionId:'first'}).conflict,true)
  const submission=restored.submit(f.record.id,{revision:1,submissionId:'first',answers,supplement:'补充'})
  assert.equal(submission.ok,true);answers.name.value='外部修改'
  assert.equal(restored.get(f.record.id)?.submission?.answers.name.value,'项目甲');answers.name.value='项目甲'
  assert.equal(restored.submit(f.record.id,{revision:1,submissionId:'first',answers,supplement:'补充'}).ok,true)
  assert.equal(restored.submit(f.record.id,{revision:1,submissionId:'first',answers:{}}).error,'submission_id_conflict')
  assert.equal(restored.submit(f.record.id,{revision:1,submissionId:'second'}).ok,false)
  assert.equal(restored.saveDraft(f.record.id,{baseRevision:1,answers:{},supplement:''}).ok,false)
  assert.equal(new QuestionnaireStore(f.root).get(f.record.id)?.submission?.answers.switch.value,false)
})

test('accepted receipts are restartable until a durable run completion and explicit stop suppresses resumption',t=>{
  const f=fixture(t);f.store.saveDraft(f.record.id,{baseRevision:0,answers,supplement:''});f.store.submit(f.record.id,{revision:1,submissionId:'submit'})
  f.store.setContinuation(f.record.id,{state:'claimed',runId:'resumed'});assert.equal(new QuestionnaireStore(f.root).get(f.record.id)?.continuation?.state,'claimed')
  f.store.releaseRun('resumed');assert.equal(f.store.get(f.record.id)?.continuation?.state,'pending')
  f.store.setContinuation(f.record.id,{state:'claimed',runId:'second'});f.store.finishRun('different');assert.equal(f.store.get(f.record.id)?.continuation?.state,'claimed')
  f.store.finishRun('second');assert.equal(f.store.get(f.record.id)?.continuation?.state,'done')
  f.store.setContinuation(f.record.id,{state:'pending'});f.store.invalidateChat('chat','stopped');assert.equal(new QuestionnaireStore(f.root).get(f.record.id)?.continuation?.error,'stopped')
})

test('cancel, abort, invalidation and deletion release waiters and reject stale submissions',async t=>{
  const f=fixture(t),waiting=f.store.wait(f.record.id,new AbortController().signal)
  assert.throws(()=>f.store.create(definition,{chatId:'chat',runId:'run',toolCallId:'second'}),/already_pending/)
  f.store.cancel(f.record.id,'chat');assert.equal((await waiting).cancelReason,'chat');assert.equal(f.store.hasWaiter(f.record.id),false)
  assert.equal(f.store.submit(f.record.id,{revision:0,submissionId:'stale'}).ok,false)
  const next=f.store.create(definition,{chatId:'chat',runId:'run',toolCallId:'next'}),controller=new AbortController(),aborted=f.store.wait(next.id,controller.signal)
  controller.abort();await assert.rejects(aborted,/aborted/);assert.equal(f.store.hasWaiter(next.id),false)
  f.store.invalidateChat('chat');assert.equal(f.store.get(next.id)?.status,'stale')
  f.store.removeChat('chat');assert.equal(f.store.list().length,0);assert.equal(new QuestionnaireStore(f.root).list().length,0)
})

test('failed writes never replace the last durable draft or publish a successful update',t=>{
  const f=fixture(t),directory=path.join(f.root,'questionnaires'),backup=path.join(f.root,'questionnaires-backup');let published=0
  f.store.onChanged(()=>{published++});fs.renameSync(directory,backup);fs.writeFileSync(directory,'blocked directory')
  assert.throws(()=>f.store.saveDraft(f.record.id,{baseRevision:0,answers,supplement:''}))
  assert.equal(f.store.get(f.record.id)?.draft.revision,0);assert.equal(published,0)
  fs.unlinkSync(directory);fs.renameSync(backup,directory);assert.equal(new QuestionnaireStore(f.root).get(f.record.id)?.draft.revision,0)
})

test('managed attachments survive restart, reject forgery and retain bytes after source changes',t=>{
  const f=fixture(t);f.store.cancel(f.record.id)
  const record=f.store.create({title:'附件',questions:[{id:'files',type:'attachment',title:'参考',required:true,accept:['.png'],maxFileBytes:8,maxFiles:2}]},{chatId:'chat',runId:'r',toolCallId:'t'})
  const files=f.store.attach(record.id,'files',[{name:'图.png',data:Buffer.from('bytes').toString('base64')}])
  assert.equal(fs.readFileSync(files[0].path,'utf8'),'bytes')
  const answers={files:{state:'answered' as const,attachments:files}}
  assert.throws(()=>f.store.saveDraft(record.id,{baseRevision:0,answers:{files:{state:'answered',attachments:[{...files[0],path:'C:\\secret.png'}]}},supplement:''}),/not_owned/)
  for(const file of [{name:'../file.png',data:''},{name:'file.txt',data:''},{name:'large.png',data:Buffer.alloc(9).toString('base64')},{name:'x.png',data:'not base64'}])assert.throws(()=>f.store.attach(record.id,'files',[file]))
  f.store.saveDraft(record.id,{baseRevision:0,answers,supplement:''})
  const restored=new QuestionnaireStore(f.root)
  assert.equal(restored.get(record.id)?.draft.answers.files.attachments?.[0].name,'图.png')
  assert.throws(()=>restored.readSubmittedAttachment('chat',record.id,files[0].id),/access_denied/)
  fs.unlinkSync(files[0].path);assert.throws(()=>restored.submit(record.id,{revision:1,submissionId:'missing'}),/missing/)
  fs.writeFileSync(files[0].path,'bytes');assert.equal(restored.submit(record.id,{revision:1,submissionId:'ok'}).ok,true)
  assert.throws(()=>restored.readSubmittedAttachment('another-chat',record.id,files[0].id),/access_denied/)
  assert.equal(restored.readSubmittedAttachment('chat',record.id,files[0].id).data.toString(),'bytes')
  fs.writeFileSync(files[0].path,'other');assert.throws(()=>restored.readSubmittedAttachment('chat',record.id,files[0].id),/changed/)
  restored.removeChat('chat');assert.equal(fs.existsSync(files[0].path),false)
})

test('hidden answers stay in durable drafts but never enter an accepted snapshot or idempotent retry',t=>{
  const f=fixture(t);f.store.cancel(f.record.id)
  const record=f.store.create({title:'分支',questions:[{id:'toggle',type:'toggle',title:'前题',required:true},{id:'detail',type:'text',title:'细节',required:true,showWhen:{questionId:'toggle',equals:true}}]},{chatId:'chat',runId:'r',toolCallId:'t'})
  const answers={toggle:{state:'answered' as const,value:false},detail:{state:'answered' as const,value:'隐藏草稿'}}
  f.store.saveDraft(record.id,{baseRevision:0,answers,supplement:''})
  assert.equal(f.store.submit(record.id,{revision:1,submissionId:'one',answers}).ok,true)
  assert.equal(f.store.submit(record.id,{revision:1,submissionId:'one',answers}).ok,true)
  const restored=new QuestionnaireStore(f.root).get(record.id)!
  assert.equal(restored.draft.answers.detail.value,'隐藏草稿');assert.equal(restored.submission?.answers.detail,undefined)
})

test('amendments retain original snapshots, persist a separate draft and avoid duplicate revisions',t=>{
  const f=fixture(t);f.store.saveDraft(f.record.id,{baseRevision:0,answers,supplement:'原说明'});f.store.submit(f.record.id,{revision:1,submissionId:'original'})
  assert.throws(()=>f.store.revise(f.record.id),/处理完成/)
  f.store.setContinuation(f.record.id,{state:'done'})
  const original=f.store.get(f.record.id),revision=f.store.revise(f.record.id)
  assert.equal(f.store.revise(f.record.id).id,revision.id);assert.notEqual(revision.toolCallId,f.record.toolCallId)
  assert.equal(revision.source?.id,f.record.id);assert.deepEqual(revision.draft.answers,answers)
  const changed={...answers,name:{state:'answered' as const,value:'新答案'}}
  f.store.saveDraft(revision.id,{baseRevision:0,answers:changed,supplement:'新说明'})
  const restored=new QuestionnaireStore(f.root)
  assert.equal(restored.get(revision.id)?.draft.answers.name.value,'新答案');assert.deepEqual(restored.get(f.record.id),original)
  restored.submit(revision.id,{revision:1,submissionId:'new'});assert.throws(()=>restored.revise(f.record.id),/更新版本/)
  assert.equal(restored.get(revision.id)?.continuation?.state,'pending')
})

test('templates copy only definitions, persist independently of chats and start with fresh answers across tasks',t=>{
  const f=fixture(t);f.store.saveDraft(f.record.id,{baseRevision:0,answers,supplement:'不能带入'})
  const template=f.store.saveTemplate(f.record.id,'我的需求模板')
  const restored=new QuestionnaireStore(f.root)
  assert.equal(restored.listTemplates().length,4)
  const reused=restored.useTemplate(template.id,{chatId:'another-chat',runId:'r',toolCallId:'t'})
  assert.deepEqual(reused.draft.answers,{});assert.deepEqual(reused.files,[]);assert.equal(reused.draft.supplement,'');assert.equal(reused.source?.kind,'template')
  assert.deepEqual(reused.questions,definition.questions);restored.removeChat('chat');assert.equal(restored.getTemplate(template.id).title,'我的需求模板')
  assert.throws(()=>restored.deleteTemplate('requirements'))
  restored.deleteTemplate(template.id);assert.equal(new QuestionnaireStore(f.root).listTemplates().length,3)
  assert.deepEqual(restored.get(reused.id)?.questions,definition.questions)
})
