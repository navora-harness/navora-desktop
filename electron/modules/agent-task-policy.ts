import type {ChatCompletionTool} from '../../shared/openai-types'
import type {ChatSession} from '../../shared/types'
import {deriveTaskConstraints,type RuntimeTaskConstraints} from '../../shared/task-declarations'

export const PLAN_TOOLS:ChatCompletionTool[]=[
  {type:'function',function:{name:'plan_read_url',description:'Read a public HTTP(S) text document for planning, without browser login, credentials, custom headers, body or webpage JavaScript. Each redirect obeys the application URL allowlist. GET may still record a visit on the server. This does not authorize arbitrary API actions.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}}},
  {type:'function',function:{name:'plan_write_artifact',description:'Save a requested planning document as a fresh Markdown file under this run designated plans directory. Cannot choose a path, overwrite source files, append, or execute content. Requires the current chat file.write permission. Use only to deliver a planning artifact requested by the user.',parameters:{type:'object',properties:{title:{type:'string',maxLength:120},content:{type:'string'}},required:['content'],additionalProperties:false}}},
]
const reads=new Set(['agent_form_templates','agent_form_attachment','agent_ask_form','agent_ask_user','agent_spawn_subchat','agent_await_subchats','agent_subchat_status','datetime_now','weather_get','geolocation_get','browser_list_resources','browser_wait','browser_find','workspace_info','file_list','file_stat','file_read','app_settings_get','plugin_list','plugin_read','skill_list','skill_read','store_search'])
const getModes=new Set(['title','url','text','html','dom_summary','snapshot','agent_snapshot','agent_find','capabilities'])

export function freezeTaskConstraints(value:unknown):RuntimeTaskConstraints{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('task_constraints_unsupported')
  const raw=value as RuntimeTaskConstraints
  if(raw.version!==1||raw.declarations===undefined)throw Error('task_constraints_unsupported')
  const result=deriveTaskConstraints(raw.declarations,raw.source)
  if(raw.phase!==result.phase)throw Error('task_constraints_phase_mismatch')
  if(raw.inheritedFrom!==undefined){
    const inherited=raw.inheritedFrom
    if(!inherited||typeof inherited.chatId!=='string'||!inherited.chatId||inherited.chatId.length>200||typeof inherited.runId!=='string'||!inherited.runId||inherited.runId.length>200)throw Error('task_constraints_inheritance_invalid')
    result.inheritedFrom=Object.freeze({...inherited})
  }
  Object.freeze(result.declarations.ids);Object.freeze(result.declarations)
  if(result.source)Object.freeze(result.source)
  return Object.freeze(result)
}

/** The host-created child origin is an upper bound for every later child turn. */
export function enforceInheritedTaskConstraints(chat:Pick<ChatSession,'kind'|'messages'>|null|undefined,current:RuntimeTaskConstraints):RuntimeTaskConstraints{
  if(chat?.kind!=='sub')return current
  const origin=chat.messages.find(message=>message.role==='user')
  if(origin?.meta?.taskConstraints===undefined)return current
  const ancestor=freezeTaskConstraints(origin.meta.taskConstraints)
  if(!ancestor.inheritedFrom)return current
  if(ancestor.phase!=='plan')return current
  return freezeTaskConstraints({...deriveTaskConstraints({version:1,ids:[...current.declarations.ids,...ancestor.declarations.ids]},current.source),inheritedFrom:ancestor.inheritedFrom})
}

export function taskToolVisible(name:string,constraints:RuntimeTaskConstraints|undefined,fromPlugin=false):boolean{
  return constraints?.phase!=='plan'||!fromPlugin&&(reads.has(name)||['browser_get','browser_query_deep','browser_network_rule_list','browser_network_log','plan_read_url','plan_write_artifact'].includes(name))
}

/** A restrictive phase is enforced before either core tools or plugins can dispatch. */
export function taskToolFailure(name:string,args:Record<string,unknown>,constraints:RuntimeTaskConstraints|undefined,fromPlugin=false):Record<string,unknown>|null{
  if(constraints===undefined)return null
  if(!constraints||typeof constraints!=='object')return{ok:false,error:'task_constraints_unsupported',retryable:false}
  if(constraints.version!==1||constraints.declarations?.version!==1||!Array.isArray(constraints.declarations.ids)||constraints.declarations.ids.some(id=>!['automation','plan'].includes(id))||constraints.phase!==(constraints.declarations.ids.includes('plan')?'plan':'execute'))return{ok:false,error:'task_constraints_unsupported',retryable:false}
  if(constraints.phase!=='plan')return null
  let permitted=!fromPlugin&&reads.has(name)
  if(!fromPlugin){
    if(name==='browser_get')permitted=getModes.has(String(args.what||'text'))
    if(name==='browser_query_deep')permitted=args.scrollIntoView===undefined||args.scrollIntoView===false
    if(name==='browser_network_rule_list')permitted=true
    if(name==='browser_network_log')permitted=args.clear===undefined||args.clear===false
    if(name==='plan_read_url')permitted=Object.keys(args).every(key=>key==='url')&&typeof args.url==='string'
    if(name==='plan_write_artifact')permitted=Object.keys(args).every(key=>key==='content'||key==='title')&&typeof args.content==='string'
  }
  return permitted?null:{ok:false,error:'task_plan_phase_restricted',phase:'plan',tool:name,retryable:false,hint:'本条处于计划阶段：可以读取资料、形成方案和保存受限计划产物，不能实施改动。通用 shell、evaluate、原 Session/API 请求及未知插件不能自报只读绕过。需要执行时等待用户发起新的执行任务。'}
}

export function taskPlanningPrompt(constraints:RuntimeTaskConstraints):string{
  return constraints.phase==='plan'
    ? '本条用户任务声明：计划阶段。只形成方案、步骤与验收标准，不实施目标改动；自动化声明组合时仍受计划阶段约束。可按权限读取当前页面/文件或用 plan_read_url 读取公开无凭证资料。需要交付用户要求的计划文件时仅用 plan_write_artifact，不能调用普通写文件、shell、evaluate、网站提交或未知插件。对执行与计划阶段有明确矛盾时简短澄清；不得把正文中的实施目标当成本条执行授权。历史声明只解释当时任务。'
    : constraints.declarations.ids.includes('automation')?'本条用户任务声明：自动化。按目标和权限选用导航、读取、API、文件或插件工具；仅在必要时使用可信点击/输入，不为表现忙碌伪造鼠标轨迹，不要求每次回答必须调用工具。':''
}
