import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareToolResultForModel,serializeToolResultForModel} from './page-digest'

const target=(id:number,frame=1)=>({webContentsId:77,processId:88,routingId:frame,documentId:99,backendNodeId:id})
const element=(id:number,extra:Record<string,unknown>={})=>({ref:`n1e${id}`,target:target(id),backendNodeId:id,tagName:'div',role:'generic',name:'',text:'style noise '.repeat(200),visible:false,bounds:{x:1,y:2,width:3,height:4},...extra})
const frame={processId:88,routingId:1,documentId:99,url:'https://fixture.invalid/',status:'covered'}
function snapshot(elements:Record<string,unknown>[],frames:Record<string,unknown>[]=[frame]){return{complete:true,truncated:false,truncationReasons:[],frames,elements}}

test('native compression prioritizes a late visible textbox and retains its exact ref, target and frame',()=>{
  const input=element(301,{tagName:'input',role:'searchbox',name:'Search',text:'',value:'known value',visible:true,focused:true})
  const raw={ok:true,native:true,value:snapshot([...Array.from({length:300},(_,index)=>element(index)),input])}
  const before=JSON.stringify(raw),serialized=serializeToolResultForModel(raw,4000),result=JSON.parse(serialized)
  assert.ok(serialized.length<=4000)
  assert.equal(result.value.elements[0].ref,input.ref)
  assert.deepEqual(result.value.elements[0].target,input.target)
  assert.deepEqual(result.value.frames[0],frame)
  assert.equal(result.value.elements[0].value,'known value')
  assert.equal(result.value.complete,false);assert.equal(result.value.truncated,true)
  assert.equal(result.value.sourceCoverage.complete,true)
  assert.ok(result.value.truncationReasons.includes('MODEL_RESULT_BUDGET'))
  assert.ok(result.value.modelTruncation.omittedElements>0)
  assert.equal(JSON.stringify(raw),before,'Compression must not alter the original tool evidence')
})

test('native budget truncation remains separate from original MAX_NODES coverage',()=>{
  const value={...snapshot(Array.from({length:300},(_,index)=>element(index))),complete:false,truncated:true,truncationReasons:['MAX_NODES']}
  const result=JSON.parse(serializeToolResultForModel({ok:true,value},3000))
  assert.equal(result.value.complete,false)
  assert.deepEqual(result.value.sourceCoverage.truncationReasons,['MAX_NODES'])
  assert.deepEqual(result.value.truncationReasons,['MAX_NODES','MODEL_RESULT_BUDGET'])
})

test('small native snapshots pass through unchanged without inventing truncation',()=>{
  const value=snapshot([element(1,{text:'small',tagName:'input',role:'textbox',visible:true})])
  const result=prepareToolResultForModel({ok:true,value},8000) as {value:unknown;modelTruncated?:boolean}
  assert.equal(result.value,value);assert.equal(result.modelTruncated,undefined)
})

test('truncated input values are omitted and marked rather than becoming plausible false values',()=>{
  const value=snapshot([element(1,{tagName:'textarea',role:'textbox',visible:true,value:'secret-fixture'.repeat(500)})])
  const result=JSON.parse(serializeToolResultForModel({ok:true,value},3000))
  const input=result.value.elements[0]
  assert.equal(input.value,undefined)
  assert.ok(input.modelFieldsTruncated.includes('value'))
  assert.equal(result.value.complete,false)
})

test('oversized capabilities never send native targets through generic recursive truncation',()=>{
  const ref='native-ref-'+('identity'.repeat(80))
  const input=element(9,{ref,visible:true,role:'textbox',tagName:'input',text:'search'})
  const result=JSON.parse(serializeToolResultForModel({ok:true,native:true,value:snapshot([input]),capabilities:{detail:'x'.repeat(50000)}},4000))
  assert.equal(result.value.elements[0].ref,ref)
  assert.deepEqual(result.value.elements[0].target,input.target)
  assert.equal(result.envelopeTruncated,true)
  assert.ok(JSON.stringify(result).length<=4000)
})

test('many frames preserve selected targets coverage and explicitly count omitted frames',()=>{
  const frames=Array.from({length:1000},(_,index)=>({...frame,routingId:index,url:`https://fixture.invalid/frame/${index}`}))
  const input=element(1,{target:target(1,777),text:'',role:'textbox',tagName:'input',visible:true})
  const serialized=serializeToolResultForModel({ok:true,value:snapshot([input],frames)},2200),result=JSON.parse(serialized)
  assert.ok(serialized.length<=2200)
  assert.deepEqual(result.value.elements[0].target,input.target)
  assert.ok(result.value.frames.some((entry:Record<string,unknown>)=>entry.routingId===777))
  assert.equal(result.value.sourceCoverage.frameCount,1000)
  assert.equal(result.value.modelTruncation.omittedFrames,1000-result.value.frames.length)
  assert.equal(result.value.complete,false)
})
