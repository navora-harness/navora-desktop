import {computed,ref,shallowReactive,watch} from 'vue'
import type {WindowFindAdapter,WindowFindOptions,WindowFindScope,WindowFindState} from '@shared/window-find'

const registrations=shallowReactive(new Map<number,WindowFindAdapter>())
let nextId=0,request=0,current:WindowFindAdapter|undefined
const opened=ref(false),query=ref(''),scope=ref<WindowFindScope>('chat'),focusRequest=ref(0),selected=ref(0)
const options=ref<WindowFindOptions>({caseSensitive:false,includeTools:false}),failure=ref('')
const targets=computed(()=>[...registrations].flatMap(([id,adapter])=>{const target=adapter.target();return target?[{id,adapter,target}]:[]}))
const active=computed(()=>targets.value.find(item=>item.id===selected.value&&item.target.scope===scope.value)||targets.value.find(item=>item.target.scope===scope.value)||targets.value[0])
const state=computed<WindowFindState>(()=>failure.value?{status:'error',total:0,ordinal:0,notice:failure.value}:active.value?.adapter.state()||{status:'unsupported',total:0,ordinal:0,notice:'当前没有可查找的内容'})
async function sync(){
  const generation=++request,adapter=opened.value?active.value?.adapter:undefined
  failure.value=''
  if(current&&current!==adapter)void Promise.resolve(current.stop()).catch(()=>{})
  current=adapter
  if(!adapter)return
  try{await adapter.setQuery(query.value,{...options.value})}catch(error){if(generation===request&&opened.value)failure.value=error instanceof Error?error.message:'查找暂时不可用，请重试'}
}
watch(()=>[opened.value,active.value?.id,active.value?.target.key,query.value,options.value.caseSensitive,options.value.includeTools],()=>void sync(),{flush:'post'})
watch(targets,value=>{if(opened.value&&!value.length)closeWindowFind()})

export function registerWindowFindTarget(adapter:WindowFindAdapter){
  const id=++nextId;registrations.set(id,adapter)
  return ()=>{registrations.delete(id);if(current===adapter){current=undefined;void Promise.resolve(adapter.stop()).catch(()=>{})}}
}
export function openWindowFind(preferred?:WindowFindScope){
  const target=targets.value.find(item=>item.target.scope===(preferred||scope.value))||targets.value[0]
  if(!target)return false
  scope.value=target.target.scope;selected.value=target.id;opened.value=true;focusRequest.value++;return true
}
export function setWindowFindScope(value:WindowFindScope){
  const target=targets.value.find(item=>item.target.scope===value);if(!target)return
  scope.value=value;selected.value=target.id;focusRequest.value++
}
export function closeWindowFind(){opened.value=false;request++;failure.value='';const previous=current;current=undefined;if(previous)void Promise.resolve(previous.stop()).catch(()=>{})}
export async function stepWindowFind(direction:1|-1){
  const adapter=active.value?.adapter,generation=request;if(!opened.value||!adapter)return
  try{await adapter.step(direction)}catch(error){if(generation===request)failure.value=error instanceof Error?error.message:'无法定位匹配项'}
}
export function useWindowFind(){return {opened,query,scope,options,focusRequest,targets,active,state,open:openWindowFind,close:closeWindowFind,step:stepWindowFind,setScope:setWindowFindScope}}
