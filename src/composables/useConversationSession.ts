import {computed,reactive,watch,type Ref} from 'vue'
import type {WorkspaceResource} from '@shared/workspace-resources'
import type {AgentAskRequest,AgentEvent,AgentPhase,ChatSession,PermissionDecision,PermissionRequest,SubchatIndexItem} from '@shared/types'
import {clearDecisionDraft} from './useDecisionDraft'
import {submitDecision,deferDecisionCancellation,isDecisionSubmitting,type DecisionSubmissionStates} from '@shared/decision-submission'
import {replayConversationEvents,upsertConversationMessage,type ConversationFindViewState} from '@shared/conversation-session'

type SessionState={chat:ChatSession|null;loading:boolean;error:string;deleted:boolean;running:boolean;phase:AgentPhase;phaseDetail:string;liveText:string;reasoning:string;revision:number;readRevision:number;scrollTop:number;followBottom:boolean;request:number;statusRevision:number;events:AgentEvent[];expanded:string[];findState?:ConversationFindViewState;resources?:WorkspaceResource[];resourcesError?:string;resourceRequest?:number}
type IndexState={items:SubchatIndexItem[];loading:boolean;error:string;request:number}
const sessions=reactive(new Map<string,SessionState>()),indexes=reactive(new Map<string,IndexState>()),asks=reactive(new Map<string,AgentAskRequest>()),permissions=reactive(new Map<string,PermissionRequest>()),responses=reactive(new Set<string>())
const decisionStates=reactive<DecisionSubmissionStates>({})
const sessionUsers=new Map<string,number>(),viewArchive=new Map<string,Pick<SessionState,'readRevision'|'revision'|'scrollTop'|'followBottom'|'expanded'|'findState'>>()
const requestChanges=new Map<string,number>(),indexTimers=new Map<string,ReturnType<typeof setTimeout>>()
let bound:typeof window.navora,requestRevision=0
const off:Array<()=>void>=[]
function session(id:string):SessionState{
  let state=sessions.get(id)
  if(!state){
    // Keep transcripts bounded; lightweight reading/find state can outlive a cached body.
    if(sessions.size>=32)for(const [key,candidate]of sessions){if(key!==id&&!sessionUsers.get(key)&&!candidate.running&&!candidate.loading){viewArchive.set(key,{readRevision:candidate.readRevision,revision:candidate.revision,scrollTop:candidate.scrollTop,followBottom:candidate.followBottom,expanded:candidate.expanded,findState:candidate.findState});sessions.delete(key);break}}
    while(viewArchive.size>200)viewArchive.delete(viewArchive.keys().next().value!)
    state=reactive({chat:null,loading:false,error:'',deleted:false,running:false,phase:'idle' as AgentPhase,phaseDetail:'',liveText:'',reasoning:'',revision:0,readRevision:0,scrollTop:0,followBottom:true,request:0,statusRevision:0,events:[],expanded:[],...viewArchive.get(id)});sessions.set(id,state)
  }
  return state
}
function index(parentId:string){let state=indexes.get(parentId);if(!state){state=reactive({items:[],loading:false,error:'',request:0});indexes.set(parentId,state)}return state}
function invalidateIndexes(chatId:string,parentId?:string){for(const [id,state]of indexes)if(id===parentId||state.items.some(item=>item.id===chatId)){clearTimeout(indexTimers.get(id));indexTimers.set(id,setTimeout(()=>{indexTimers.delete(id);void refreshSubchatIndex(id)},100))}}
function rememberRequest(id:string){requestChanges.set(id,++requestRevision);if(requestChanges.size>2000)requestChanges.delete(requestChanges.keys().next().value!)}
function onEvent(event:AgentEvent){
  const state=sessions.get(event.chatId)
  if(state){
    if(event.type==='message'||event.type==='message_update'||event.type==='title'){state.events.push(event);if(!state.loading)state.events=state.events.slice(-32)}
    if(event.type==='message'||event.type==='message_update')state.revision=Math.max(state.revision,Number(event.message.meta?.subchatVersion)||state.revision+1)
    if(event.type==='message'||event.type==='message_update'){if(state.chat)state.chat={...state.chat,messages:upsertConversationMessage(state.chat.messages,event.message)}}
    else if(event.type==='title'){if(state.chat)state.chat={...state.chat,title:event.title}}
    else if(event.type==='status'){state.statusRevision++;state.running=event.running;if(!event.running){state.liveText='';state.reasoning=''}}
    else if(event.type==='phase'){state.phase=event.phase;state.phaseDetail=event.detail||''}
    else if(event.type==='answer_preview')state.liveText=event.content
    else if(event.type==='reasoning')state.reasoning=event.status==='clear'?'':event.content
    else if(event.type==='error')state.error=event.error
  }
  invalidateIndexes(event.chatId,'parentChatId'in event?event.parentChatId:undefined)
}
/** One subscription set per renderer; cache survives closing and reopening a workspace. */
export function ensureConversationSessionEvents(){
  const api=window.navora;if(!api||bound===api)return
  for(const unsubscribe of off.splice(0))unsubscribe();bound=api
  if(api.workspace.onChanged)off.push(api.workspace.onChanged(({chatId})=>{if(sessions.has(chatId))void loadConversationResources(chatId,true);invalidateIndexes(chatId)}))
  off.push(api.agent.onEvent(onEvent),api.chats.onChanged(event=>{
    if(event.type==='removed'){
      const state=sessions.get(event.chatId);if(state){state.request++;state.chat=null;state.loading=false;state.deleted=true;state.running=false}
      for(const [id,req]of asks)if(req.chatId===event.chatId){asks.delete(id);clearDecisionDraft(id);delete decisionStates[id]}
      for(const [id,req]of permissions)if(req.chatId===event.chatId)permissions.delete(id)
      invalidateIndexes(event.chatId)
    }else if(event.type==='upsert'){if(sessions.has(event.chatId))void loadConversationSession(event.chatId);invalidateIndexes(event.chatId)}
    else{for(const id of indexes.keys())void refreshSubchatIndex(id)}
  }),api.agent.onAsk(req=>{rememberRequest(req.id);asks.set(req.id,req);invalidateIndexes(req.chatId,req.parentChatId)}),api.agent.onAskCancel(({id})=>{const req=asks.get(id);if(deferDecisionCancellation(decisionStates,id))return;rememberRequest(id);asks.delete(id);if(!isDecisionSubmitting(id))clearDecisionDraft(id);delete decisionStates[id];if(req)invalidateIndexes(req.chatId,req.parentChatId)}),api.permission.onRequest(req=>{rememberRequest(req.id);permissions.set(req.id,req);invalidateIndexes(req.chatId)}),api.permission.onCancel(id=>{const req=permissions.get(id);if(deferDecisionCancellation(decisionStates,id))return;rememberRequest(id);permissions.delete(id);delete decisionStates[id];if(req)invalidateIndexes(req.chatId)}))
}
export async function loadConversationSession(id:string){
  ensureConversationSessionEvents();if(!id||!window.navora)return
  const state=session(id),token=++state.request,start=state.events.length,statusRevision=state.statusRevision
  state.loading=true;state.error=''
  try{
    const [chat,running]=await Promise.all([window.navora.chats.get(id),window.navora.agent.isRunning(id)])
    if(token!==state.request)return
    if(!chat){state.chat=null;state.deleted=true;return}
    state.chat=replayConversationEvents(chat,state.events.slice(start));state.deleted=false;state.revision=Math.max(state.revision,chat.subchatMessageVersion||chat.messages.length)
    if(state.statusRevision===statusRevision)state.running=running
    if(chat.pendingAsk&&!requestChanges.has(chat.pendingAsk.id))asks.set(chat.pendingAsk.id,chat.pendingAsk)
  }catch(error){if(token===state.request)state.error=error instanceof Error?error.message:'读取子对话失败'}
  finally{if(token===state.request){state.loading=false;state.events=state.events.slice(-32)}}
}
export async function refreshSubchatIndex(parentId:string){
  ensureConversationSessionEvents();if(!parentId||!window.navora)return
  const state=index(parentId),token=++state.request,revision=requestRevision;state.loading=true;state.error=''
  try{
    const [items,pending]=await Promise.all([window.navora.subchats.list(parentId),window.navora.subchats.pending(parentId)])
    if(token!==state.request)return
    state.items=items
    for(const req of pending.asks)if((requestChanges.get(req.id)||0)<=revision&&!requestChanges.has(req.id))asks.set(req.id,req)
    for(const req of pending.permissions)if((requestChanges.get(req.id)||0)<=revision&&!requestChanges.has(req.id))permissions.set(req.id,req)
  }catch(error){if(token===state.request)state.error=error instanceof Error?error.message:'读取子对话列表失败'}
  finally{if(token===state.request)state.loading=false}
}
export async function loadConversationResources(chatId:string,refresh=false){
  const state=session(chatId),request=(state.resourceRequest||0)+1;state.resourceRequest=request
  try{const snapshot=await window.navora!.workspace.resources(chatId,refresh);if(request!==state.resourceRequest)return;if(!snapshot.ok)throw Error(snapshot.error||'resource_index_failed');state.resources=snapshot.entries;state.resourcesError=undefined}catch{if(request===state.resourceRequest)state.resourcesError='暂时无法读取输出文件。'}
}
export function useSubchatIndex(parentId:Ref<string>){
  ensureConversationSessionEvents();watch(parentId,id=>{if(id)void refreshSubchatIndex(id)},{immediate:true})
  return computed(()=>{const value=index(parentId.value);return {...value,items:value.items.map(item=>({...item,unread:item.messageVersion>(sessions.get(item.id)?.readRevision||viewArchive.get(item.id)?.readRevision||0)}))}})
}
export function useSubchatSignals(parentId:Ref<string>){const index=useSubchatIndex(parentId);return computed(()=>({total:index.value.items.length,pending:index.value.items.reduce((n,item)=>n+item.pendingCount,0),unread:index.value.items.filter(item=>item.unread).length,loading:index.value.loading}))}
export function useConversationSession(chatId:Ref<string>){
  ensureConversationSessionEvents();watch(chatId,(id,_old,onCleanup)=>{if(id){sessionUsers.set(id,(sessionUsers.get(id)||0)+1);onCleanup(()=>{const count=(sessionUsers.get(id)||1)-1;if(count)sessionUsers.set(id,count);else sessionUsers.delete(id)});void loadConversationSession(id)}},{immediate:true})
  const state=computed(()=>session(chatId.value)),ownAsks=computed(()=>[...asks.values()].filter(req=>req.chatId===chatId.value)),ownPermissions=computed(()=>[...permissions.values()].filter(req=>req.chatId===chatId.value))
  async function respondAsk(id:string,answer:string,source:'option'|'custom'|'deny'){
    const req=asks.get(id);if(!req||req.chatId!==chatId.value||responses.has(id))return
    responses.add(id);try{await submitDecision(decisionStates,id,()=>window.navora!.agent.respondAsk(id,{answer,source}),()=>{rememberRequest(id);asks.delete(id);clearDecisionDraft(id);delete decisionStates[id]})}finally{responses.delete(id)}
  }
  async function respondPermission(id:string,decision:PermissionDecision){
    const req=permissions.get(id);if(!req||req.chatId!==chatId.value||responses.has(id))return
    responses.add(id);try{await submitDecision(decisionStates,id,()=>window.navora!.permission.respond(id,decision),()=>{rememberRequest(id);permissions.delete(id);delete decisionStates[id]})}finally{responses.delete(id)}
  }
  return {state,asks:ownAsks,permissions:ownPermissions,responses,decisionStates,dismissAsk:(id:string)=>{if(asks.get(id)?.chatId!==chatId.value)return;rememberRequest(id);asks.delete(id);clearDecisionDraft(id);delete decisionStates[id]},dismissPermission:(id:string)=>{if(permissions.get(id)?.chatId!==chatId.value)return;rememberRequest(id);permissions.delete(id);delete decisionStates[id]},respondAsk,respondPermission,reload:()=>loadConversationSession(chatId.value),markRead:()=>{state.value.readRevision=state.value.revision}}
}
