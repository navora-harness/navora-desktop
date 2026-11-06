import assert from 'node:assert/strict'
import test from 'node:test'
import type {WebContents} from 'electron'
import {clickElementBySelector,hasClickElement,querySelectorAcrossDocuments,queryAcrossDocumentsAgentSnapshot} from './deep-dom'

test('selector adapter uses one .8 object and preserves a partial native click receipt',async()=>{
  const calls:unknown[]=[]
  const receipt={status:'failed',stage:'mouse-release',stages:['mouse-press','mouse-release'],reason:'RELEASE_FAILED',deliveryWarning:'PARTIAL_CLICK_SEQUENCE'}
  const wc={clickElement:async(options:unknown)=>{calls.push(options);return receipt}} as unknown as WebContents
  assert.equal(hasClickElement(wc),true)
  assert.equal(await clickElementBySelector(wc,'#save',{button:'right',clickCount:2}),receipt)
  assert.deepEqual(calls,[{selector:'#save',button:'right',clickCount:2,pierce:true,scrollIntoView:true}])
})

test('legacy agentInfo keeps only the exact first frame-hop target and preserves incomplete coverage',async()=>{
  const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
  const matched={target,tagName:'INPUT'}
  const snapshot={complete:false,truncated:true,truncationReasons:['maxNodes'],frames:[{processId:2,routingId:3,status:'partial',url:'https://frame.test/'}],elements:[
    {target:{...target,routingId:6},tagName:'INPUT'},matched,{target:{...target,documentId:9},tagName:'INPUT'},
  ]}
  const queries:unknown[]=[];const reads:unknown[]=[]
  const wc={
    querySelectorAcrossDocuments:async(...args:unknown[])=>{queries.push(args);return {target,backendNodeId:5,tagName:'INPUT',x:1,y:2,width:3,height:4}},
    getAgentSnapshot:async(options:unknown)=>{reads.push(options);return snapshot},
  } as unknown as WebContents
  const result=await queryAcrossDocumentsAgentSnapshot(wc,'iframe >>> input',{scrollIntoView:true})
  assert.deepEqual(queries,[['iframe >>> input',{pierce:true,scrollIntoView:true}]])
  assert.equal('selector' in (reads[0] as object),false,'Frame-hop syntax never becomes a per-document CSS selector')
  assert.deepEqual(result.elements,[matched])
  assert.equal(result.frames,snapshot.frames)
  assert.equal(result.complete,false);assert.equal(result.truncated,true)
  assert.equal(result.truncationReasons,snapshot.truncationReasons)
})

test('across-document geometry keeps the routing target and never forwards agentInfo',async()=>{
  const target={webContentsId:1,processId:2,routingId:3,documentId:4,backendNodeId:5}
  const calls:unknown[]=[]
  const wc={querySelectorAcrossDocuments:async(...args:unknown[])=>{calls.push(args);return {backendNodeId:5,tagName:'BUTTON',x:1.25,y:2.5,width:20,height:30,target}}} as unknown as WebContents
  const result=await querySelectorAcrossDocuments(wc,'iframe #save')
  assert.deepEqual(result?.target,target)
  assert.notEqual(result?.target,target)
  assert.deepEqual(calls,[['iframe #save',{pierce:true,scrollIntoView:false}]])
})
