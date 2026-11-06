import test from 'node:test'
import assert from 'node:assert/strict'
import {observeSubmittedText,rememberSubmissionObservation,observePendingSubmission} from './browser-submission-observation'
const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
const element=(patch:Partial<Electron.AgentElement>={})=>({target,visible:true,tagName:'input',value:'updated',text:'',...patch} as Electron.AgentElement)
const snapshot=(elements:Electron.AgentElement[])=>({complete:true,truncated:false,truncationReasons:[],frames:[{processId:2,routingId:3,documentId:4,status:'covered',url:'https://local.invalid'}],elements} as Electron.AgentSnapshot)
test('only complete same-frame snapshots with changed noneditable matching text reconcile a hidden/removed editor',()=>{
  const before=snapshot([element()]),rendered=element({tagName:'label',value:undefined,text:'updated',target:{...target,backendNodeId:6}})
  for(const old of [[],[element({visible:false})]])assert.equal(observeSubmittedText(before,snapshot([...old,rendered]),target,'updated').status,'observed')
  for(const after of [snapshot([]),snapshot([element(),rendered]),snapshot([{...rendered,target:{...rendered.target,routingId:9}}]),{...snapshot([rendered]),truncated:true},{...snapshot([rendered]),complete:false}])assert.equal(observeSubmittedText(before,after,target,'updated').status,'unknown')
  assert.equal(observeSubmittedText(snapshot([element(),rendered]),snapshot([rendered]),target,'updated').status,'unknown','preexisting matching text is not result evidence')
  assert.equal(observeSubmittedText(before,snapshot([rendered]),target,'other').status,'unknown')
  assert.equal(observeSubmittedText({...before,frames:[{...before.frames[0]!,status:'partial'}]},snapshot([rendered]),target,'updated').status,'unknown')
})
test('deferred full snapshot reconciliation is host-bound to original input, transient and read-bounded',()=>{
  const page={},other={},before=snapshot([element()]),rendered=element({tagName:'label',value:undefined,text:'updated',target:{...target,backendNodeId:6}})
  rememberSubmissionObservation(page,before,target,'updated')
  assert.equal(observePendingSubmission(other,snapshot([rendered])),undefined)
  assert.equal(observePendingSubmission(page,snapshot([element()]))?.status,'unknown')
  const observed=observePendingSubmission(page,snapshot([rendered]))!
  assert.equal(observed.status,'observed');assert.deepEqual(observed.inputTarget,target)
  assert.equal(observePendingSubmission(page,snapshot([rendered])),undefined)
  rememberSubmissionObservation(page,before,target,'updated')
  for(let index=0;index<3;index++)assert.equal(observePendingSubmission(page,snapshot([]))?.status,'unknown')
  assert.equal(observePendingSubmission(page,snapshot([rendered])),undefined)
})
test('preexisting matching text rebuilt under a new backend ID cannot certify submission, including deferred reads',()=>{
  const existing=element({tagName:'label',value:undefined,text:'updated',target:{...target,backendNodeId:6}})
  const rebuilt={...existing,target:{...target,backendNodeId:7}}
  const before=snapshot([element(),existing]),after=snapshot([element({visible:false}),rebuilt])
  assert.equal(observeSubmittedText(before,after,target,'updated').status,'unknown')
  const page={};rememberSubmissionObservation(page,before,target,'updated')
  assert.equal(observePendingSubmission(page,after)?.status,'unknown')
  assert.equal(observeSubmittedText(snapshot([element()]),after,target,'updated').status,'observed','genuinely new matching visible text remains eligible')
  const unrelated={...existing,target:{...existing.target,webContentsId:99}}
  assert.equal(observeSubmittedText(snapshot([element(),unrelated]),after,target,'updated').status,'observed','a different page does not contaminate this baseline')
})
