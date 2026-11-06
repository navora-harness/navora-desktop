import assert from 'node:assert/strict'
import {afterEach,beforeEach,test} from 'node:test'
import {nextTick,ref} from 'vue'
import {registerWindowFindTarget,useWindowFind} from '../src/composables/useWindowFind'
import type {WindowFindAdapter,WindowFindOptions,WindowFindScope,WindowFindState,WindowFindTarget} from './window-find'

const find=useWindowFind(),unregister:Array<()=>void>=[]
async function settle(){await nextTick();await Promise.resolve();await nextTick()}
async function reset(){find.close();for(const remove of unregister.splice(0))remove();find.query.value='';find.options.value={caseSensitive:false,includeTools:false};await settle()}
beforeEach(reset);afterEach(reset)
function target(scope:WindowFindScope,key=scope){
  const details=ref<WindowFindTarget|null>({key,scope,kind:scope==='chat'?'chat':'browser',label:key}),state=ref<WindowFindState>({status:'ready',total:scope==='chat'?3:2,ordinal:1})
  const queries:Array<{query:string;options:WindowFindOptions}>=[],steps:number[]=[]
  let stops=0,queryHandler:WindowFindAdapter['setQuery']=()=>{},stepHandler:WindowFindAdapter['step']=()=>{}
  const adapter:WindowFindAdapter={target:()=>details.value,state:()=>state.value,setQuery:(query,options)=>{queries.push({query,options:{...options}});return queryHandler(query,options)},step:direction=>{steps.push(direction);return stepHandler(direction)},stop:()=>{stops++}}
  const remove=registerWindowFindTarget(adapter);unregister.push(remove)
  return {details,state,queries,steps,remove,get stops(){return stops},setQueryHandler:(handler:WindowFindAdapter['setQuery'])=>{queryHandler=handler},setStepHandler:(handler:WindowFindAdapter['step'])=>{stepHandler=handler}}
}
function pending(){let reject!:(error:Error)=>void;const promise=new Promise<void>((_resolve,fail)=>{reject=fail});return {promise,reject}}

test('opening a requested scope sends the current query and options to that target',async()=>{
  const chat=target('chat'),workspace=target('workspace')
  find.query.value='部署';find.options.value={caseSensitive:true,includeTools:true}
  assert.equal(find.open('workspace'),true);await settle()
  assert.equal(find.opened.value,true);assert.equal(find.scope.value,'workspace');assert.equal(find.active.value?.target.key,'workspace')
  assert.deepEqual(workspace.queries,[{query:'部署',options:{caseSensitive:true,includeTools:true}}]);assert.equal(chat.queries.length,0)
  assert.equal(find.state.value.total,2)
})

test('each explicit open requests fresh focus without replaying an unchanged search',async()=>{
  const chat=target('chat'),before=find.focusRequest.value
  assert.equal(find.open('chat'),true);await settle()
  assert.equal(find.focusRequest.value,before+1);assert.equal(chat.queries.length,1)
  assert.equal(find.open('chat'),true);await settle()
  assert.equal(find.focusRequest.value,before+2);assert.equal(chat.queries.length,1)
  find.close();await settle();assert.equal(chat.stops,1)
  find.open('chat');await settle();assert.equal(find.focusRequest.value,before+3);assert.equal(chat.queries.length,2)
})

test('switching targets stops the old adapter and ignores its late failure and results',async()=>{
  const chat=target('chat'),workspace=target('workspace'),oldQuery=pending()
  chat.setQueryHandler(()=>oldQuery.promise);find.query.value='原输入';find.open('chat');await settle()
  const focus=find.focusRequest.value
  find.setScope('workspace');await settle()
  assert.equal(chat.stops,1);assert.equal(find.focusRequest.value,focus+1)
  assert.deepEqual(workspace.queries,[{query:'原输入',options:{caseSensitive:false,includeTools:false}}])
  chat.state.value={status:'ready',total:999,ordinal:998};oldQuery.reject(new Error('旧目标失败'));await settle()
  assert.equal(find.active.value?.target.key,'workspace');assert.equal(find.state.value.status,'ready');assert.equal(find.state.value.total,2)
  await find.step(-1);assert.deepEqual(workspace.steps,[-1]);assert.deepEqual(chat.steps,[])
})

test('editing query/options updates the active target and reports only its current failure',async()=>{
  const chat=target('chat');find.open('chat');await settle()
  chat.setQueryHandler(()=>{throw new Error('当前查找失败')})
  find.query.value='新输入';find.options.value={caseSensitive:true,includeTools:false};await settle()
  assert.deepEqual(chat.queries.at(-1),{query:'新输入',options:{caseSensitive:true,includeTools:false}})
  assert.equal(find.state.value.status,'error');assert.equal(find.state.value.notice,'当前查找失败')
  chat.setQueryHandler(()=>{});find.query.value='重试';await settle();assert.equal(find.state.value.status,'ready')
})

test('closing stops search once and late query/navigation failures cannot reopen it',async()=>{
  const chat=target('chat'),query=pending(),step=pending()
  chat.setQueryHandler(()=>query.promise);chat.setStepHandler(()=>step.promise)
  find.open('chat');await settle();const stepping=find.step(1)
  find.close();query.reject(new Error('关闭后的查询失败'));step.reject(new Error('关闭后的定位失败'));await stepping;await settle()
  assert.equal(find.opened.value,false);assert.equal(chat.stops,1);assert.equal(find.state.value.status,'ready')
  await find.step(1);assert.deepEqual(chat.steps,[1]);find.close();await settle();assert.equal(chat.stops,1)
})

test('unmounting the final target stops its adapter, closes search and clears registration',async()=>{
  const chat=target('chat'),query=pending();chat.setQueryHandler(()=>query.promise)
  find.open('chat');await settle();chat.remove();await settle()
  query.reject(new Error('已卸载的查询失败'));await settle()
  assert.equal(find.opened.value,false);assert.equal(chat.stops,1);assert.equal(find.targets.value.length,0)
  assert.equal(find.state.value.status,'unsupported');assert.equal(find.open('workspace'),false)
})
