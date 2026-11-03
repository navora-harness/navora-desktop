import type {NativePanelContent} from './native-ui'
import type {ModelUsage} from './model-usage'

export type ComposerNativePanelKind='model'|'usage'|'mode'|'permission'
export interface ComposerNativeModelOption {
  key:string;providerId:string;model:string;label:string;providerLabel:string;hasKey:boolean;capabilities:string
}
export interface ComposerNativeChoice {id:string;label:string;description:string;icon?:string}
export interface ComposerNativePanelState {
  modelOptions:ComposerNativeModelOption[];modelKey:string;modelQuery:string;modelLoading:boolean;modelError:string;modelInvalid:boolean;modelBusy:boolean
  reasoningLevels:{id:string;label:string}[];reasoningLevel:string
  modes:ComposerNativeChoice[];mode:string;modeBusy:boolean
  permissionOptions:ComposerNativeChoice[];permission:string;permissionBusy?:boolean
  usage:{estimated:number;history:number;draft:number;window:number;maxOutput:number;actual?:ModelUsage;actualModel?:string}
}
const text=(id:string,value:string,muted=false):NativePanelContent=>({id,type:'text',text:value,muted})
const action=(id:string,label:string,extra:Partial<NativePanelContent>={}):NativePanelContent=>({id,type:'button',text:label,...extra})
export function composerNativeModelControlId(key:string):string {
  // IDs depend on the model identity rather than its current search position.
  // Both halves of the UTF-16 unit are mixed, keeping the wire ID short even
  // when a custom model uses a long URL as its name.
  let first=0x811c9dc5,second=0x9e3779b9
  for(let index=0;index<key.length;index++){const unit=key.charCodeAt(index);first=Math.imul(first^unit,0x01000193);second=Math.imul(second^(unit+index),0x85ebca6b)}
  return `model:${(first>>>0).toString(16)}:${(second>>>0).toString(16)}`
}
export function composerNativeModelMatches(option:ComposerNativeModelOption,query:string):boolean {
  const needle=query.trim().toLocaleLowerCase()
  return !needle||(option.label+' '+option.model+' '+option.providerLabel).toLocaleLowerCase().includes(needle)
}
export function composerNativePanelContent(kind:ComposerNativePanelKind,state:ComposerNativePanelState):NativePanelContent {
  const children:NativePanelContent[]=[]
  if(kind==='model'){
    children.push(text('model:title','模型与思考等级'),{id:'model:search',type:'input',value:state.modelQuery,placeholder:'搜索模型或服务商',maxLength:512})
    if(state.modelLoading)children.push(text('model:loading','正在读取模型…',true))
    if(state.modelError)children.push(text('model:error',state.modelError),action('model:retry','重试'))
    else if(state.modelInvalid)children.push(text('model:invalid','原服务商已移除，请重新选择模型。',true))
    const groups=new Map<string,{label:string;options:ComposerNativeModelOption[]}>()
    for(const option of state.modelOptions.filter(item=>composerNativeModelMatches(item,state.modelQuery))){let group=groups.get(option.providerId);if(!group){group={label:option.providerLabel,options:[]};groups.set(option.providerId,group)}group.options.push(option)}
    const models:NativePanelContent[]=[]
    for(const [providerId,group] of groups){
      const groupId=composerNativeModelControlId(providerId)
      models.push(text(`${groupId}:provider`,group.label,true))
      for(const option of group.options){const id=composerNativeModelControlId(option.key);models.push({id:`${id}:row`,type:'column',gap:3,children:[action(id,`${option.key===state.modelKey?'✓  ':''}${option.label}`,{disabled:state.modelBusy,tooltip:`${option.providerLabel} · ${option.model}\n${option.capabilities}${option.hasKey?'':' · 未保存密钥（本地端点可能无需密钥）'}`}),text(`${id}:detail`,option.capabilities+(option.hasKey?'':' · 未保存密钥'),true)]})}
    }
    if(!models.length&&!state.modelLoading&&!state.modelError)models.push(text('model:empty',state.modelOptions.length?'没有匹配的模型':'暂无模型，请到设置添加',true))
    children.push({id:'model:list',type:'list',height:260,gap:8,children:models})
    if(state.reasoningLevels.length)children.push({id:'model:separator',type:'separator'},text('model:reasoning-title','思考等级'),{id:'model:reasoning',type:'option',value:state.reasoningLevel,disabled:state.modelBusy,items:state.reasoningLevels.map(level=>({id:level.id,value:level.id,label:level.label}))})
  }else if(kind==='usage'){
    const usage=state.usage,ratio=usage.estimated/Math.max(1,usage.window),count=(value:number)=>Math.max(0,Math.round(value)).toLocaleString()
    children.push(text('usage:title',`上下文估算 ${Math.round(ratio*100)}%`),text('usage:budget',`~${count(usage.estimated)} / ${count(usage.window)} token`),{id:'usage:progress',type:'progress',value:Math.max(0,Math.min(1,ratio))})
    for(const [id,label,value] of [['system','系统提示词','未计入'],['tools','工具定义','未计入'],['history','对话消息','~'+count(usage.history)],['draft','当前输入','~'+count(usage.draft)]])children.push({id:`usage:${id}`,type:'row',gap:10,children:[text(`usage:${id}:label`,label!),{...text(`usage:${id}:count`,value!),flex:1}]})
    children.push({id:'usage:separator',type:'separator'},text('usage:actual-title','最近一次服务返回'+(usage.actualModel?' · '+usage.actualModel:'')))
    if(usage.actual){children.push(text('usage:actual-io',`输入 / 输出  ${count(usage.actual.inputTokens)} / ${count(usage.actual.outputTokens)}`),text('usage:actual-total',`总用量  ${count(usage.actual.totalTokens)}`));if(usage.actual.cachedInputTokens!==undefined)children.push(text('usage:actual-cache',`缓存命中  ${count(usage.actual.cachedInputTokens)}`))}
    else children.push(text('usage:actual-empty','服务尚未返回用量数据',true))
    children.push(text('usage:note','按历史消息及当前输入的 UTF-8 字节粗略估算，不含系统提示词、工具定义、图片和文件内容。不会代表下一次请求的完整预算。',true),text('usage:output',`输出上限 ${count(usage.maxOutput)} token。`,true))
  }else{
    const permission=kind==='permission',items=permission?state.permissionOptions:state.modes,selected=permission?state.permission:state.mode,busy=permission?state.permissionBusy:state.modeBusy
    children.push(text(`${kind}:title`,permission?'本会话权限':'回答方式'))
    for(const item of items)children.push({id:`${kind}:${item.id}:row`,type:'column',gap:3,children:[{id:`${kind}:${item.id}:label`,type:'row',gap:6,children:[...(item.icon?[{id:`${kind}:${item.id}:icon`,type:'icon',icon:item.icon,width:16,height:16} as NativePanelContent]:[]),action(`${kind}:${item.id}`,`${selected===item.id?'✓  ':''}${item.label}`,{disabled:!!busy,tooltip:item.description,flex:1})]},text(`${kind}:${item.id}:description`,item.description,true)]})
  }
  return {id:`composer:${kind}`,type:'column',width:kind==='model'?360:330,padding:12,gap:9,children}
}
