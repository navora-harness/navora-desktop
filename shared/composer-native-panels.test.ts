import test from 'node:test'
import assert from 'node:assert/strict'
import type {NativePanelContent} from './native-ui'
import {composerNativeModelControlId,composerNativePanelContent,type ComposerNativePanelState} from './composer-native-panels'

function state():ComposerNativePanelState{return {
  modelOptions:[
    {key:'first::alpha',providerId:'first',model:'alpha',label:'Alpha',providerLabel:'服务商甲',hasKey:true,capabilities:'128K 上下文 · 思考'},
    {key:'second::beta',providerId:'second',model:'beta',label:'Beta',providerLabel:'服务商乙',hasKey:false,capabilities:'64K 上下文'},
  ],modelKey:'first::alpha',modelQuery:'',modelLoading:false,modelError:'',modelInvalid:false,modelBusy:false,
  reasoningLevels:[{id:'low',label:'低'},{id:'high',label:'高'}],reasoningLevel:'high',
  modes:[{id:'auto',label:'自动',description:'自动决定',icon:'robot'}],mode:'auto',modeBusy:false,
  permissionOptions:[{id:'balanced',label:'均衡',description:'常用能力较顺畅',icon:'shield-halved'}],permission:'balanced',
  usage:{estimated:150,history:100,draft:50,window:100,maxOutput:256},
}}
function controls(node:NativePanelContent):NativePanelContent[]{return [node,...(node.children||[]).flatMap(controls)]}
const get=(node:NativePanelContent,id:string)=>controls(node).find(item=>item.id===id)
test('model filtering keeps surviving controls and the native search input identities stable',()=>{
  const initial=state(),full=composerNativePanelContent('model',initial),filtered=composerNativePanelContent('model',{...initial,modelQuery:'服务商乙'})
  const beta=composerNativeModelControlId('second::beta')
  assert.equal(get(full,beta)?.text,'Beta');assert.equal(get(filtered,beta)?.text,'Beta')
  assert.equal(get(filtered,'model:search')?.value,'服务商乙')
  assert.equal(get(filtered,composerNativeModelControlId('first::alpha')),undefined)
  assert.equal(get(filtered,'model:reasoning')?.value,'high')
  for(const content of [full,filtered])assert.equal(new Set(controls(content).map(item=>item.id)).size,controls(content).length)
})
test('busy and unavailable models keep explanatory states while disabling mutations',()=>{
  const content=composerNativePanelContent('model',{...state(),modelBusy:true,modelInvalid:true})
  assert.equal(get(content,'model:invalid')?.text,'原服务商已移除，请重新选择模型。')
  assert.equal(get(content,composerNativeModelControlId('first::alpha'))?.disabled,true)
  assert.equal(get(content,'model:reasoning')?.disabled,true)
  const failure=composerNativePanelContent('model',{...state(),modelError:'连接失败'})
  assert.equal(get(failure,'model:error')?.text,'连接失败');assert.equal(get(failure,'model:retry')?.type,'button')
  const empty=composerNativePanelContent('model',{...state(),modelQuery:'not available'})
  assert.equal(get(empty,'model:empty')?.text,'没有匹配的模型')
})
test('context panel separates estimates from provider results and clamps only the progress display',()=>{
  const snapshot=state();snapshot.usage.actual={inputTokens:0,outputTokens:0,totalTokens:0,cachedInputTokens:0}
  const content=composerNativePanelContent('usage',snapshot)
  assert.equal(get(content,'usage:title')?.text,'上下文估算 150%')
  assert.equal(get(content,'usage:progress')?.value,1)
  assert.equal(get(content,'usage:system:count')?.text,'未计入')
  assert.equal(get(content,'usage:actual-total')?.text,'总用量  0')
  assert.equal(get(content,'usage:actual-cache')?.text,'缓存命中  0')
  assert.match(get(content,'usage:note')?.text||'',/不会代表下一次请求的完整预算/)
  const unknown=composerNativePanelContent('usage',state())
  assert.equal(get(unknown,'usage:actual-empty')?.text,'服务尚未返回用量数据')
  assert.equal(get(unknown,'usage:actual-total'),undefined)
})
test('reply and permission panels preserve selected labels, icons and explanatory text',()=>{
  const snapshot=state();snapshot.modeBusy=true;snapshot.permissionBusy=true
  const mode=composerNativePanelContent('mode',snapshot),permission=composerNativePanelContent('permission',snapshot)
  assert.equal(get(mode,'mode:auto')?.text,'✓  自动');assert.equal(get(mode,'mode:auto')?.disabled,true)
  assert.equal(get(mode,'mode:auto:icon')?.icon,'robot')
  assert.equal(get(permission,'permission:balanced')?.disabled,true)
  assert.equal(get(permission,'permission:balanced:description')?.text,'常用能力较顺畅')
})
test('custom model strings remain plain text and do not become URLs, markup or action code',()=>{
  const snapshot=state(),name='<script>doBad()</script> https://example.test/'+('x'.repeat(4000))
  snapshot.modelOptions[0]!.label=name;snapshot.modelOptions[0]!.key=name;snapshot.modelKey=name
  const content=composerNativePanelContent('model',snapshot),id=composerNativeModelControlId(name)
  assert.ok(id.length<50);assert.equal(get(content,id)?.text,'✓  '+name)
  assert.ok(controls(content).every(node=>!('image' in node)&&!('url' in node)&&!('html' in node)))
})
