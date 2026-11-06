import type {NativePanelContent} from './native-ui'
import type {WindowFindOptions,WindowFindState,WindowFindTarget} from './window-find'

export const WINDOW_FIND_SURFACE={contentInset:8,radius:20,shadow:false} as const

export function windowFindPanel(input:{width:number;query:string;target:WindowFindTarget;targets:readonly WindowFindTarget[];state:WindowFindState;options:WindowFindOptions;showOptions:boolean;includeValue?:boolean}):NativePanelContent{
  const {query,target,state,options}=input,hasQuery=!!query.trim(),busy=state.status==='searching'
  const scopes=windowFindScopeButtons(input.targets)
  const placeholder=target.scope==='chat'?'搜索当前聊天…':target.kind==='browser'?'搜索当前网页…':target.kind==='subchat'?'搜索当前子对话…':'搜索当前文件…'
  // Input precedes every interactive control so a newly created native popup
  // starts keyboard traversal here, including repeated explicit opens.
  const children:NativePanelContent[]=[{id:'find-main',type:'row',height:28,gap:4,children:[
    {id:'find-icon',type:'icon',icon:'magnifying-glass',width:16,height:16},
    {id:'find-query',type:'input',placeholder,accessibleName:'查找当前内容',invalid:hasQuery&&state.status==='ready'&&!state.total,...(hasQuery&&state.status==='ready'&&!state.total?{accessibleDescription:'没有匹配结果'}:{}),height:28,maxLength:1024,flex:1,style:{borderless:true,paddingTop:0,paddingBottom:0},...(input.includeValue?{value:query}:{})},
    ...scopes.map(item=>({id:`find-scope-${item.scope}`,type:'iconButton' as const,icon:item.scope==='chat'?'comments':item.kind==='browser'?'globe':'file-lines',accessibleName:`${item.scope==='chat'?'当前聊天':'当前工作区'}${item.scope===target.scope?'（已选择）':''}`,tooltip:`${item.scope==='chat'?'当前聊天':`当前工作区 · ${item.label.slice(0,120)}`}${item.scope===target.scope?'（已选择）':''}`,style:{borderless:true}})),
    ...(scopes.length?[{id:'find-close-divider',type:'separator' as const,width:1,height:16}]:[]),
    {id:'find-close',type:'iconButton',icon:'xmark',accessibleName:'关闭查找（Esc）',tooltip:'关闭查找（Esc）',style:{borderless:true}}
  ]}]
  if(hasQuery){
    const disabled=busy||!state.total||state.status!=='ready',count=busy?'查找中…':state.status==='ready'?`${state.total?`${state.ordinal} / `:''}${state.total}${state.truncated?'+':''} 个结果`:state.notice||'当前内容暂不可查找'
    children.push({id:'find-results',type:'row',height:26,gap:5,children:[
      {id:'find-previous',type:'iconButton',icon:'arrow-up',accessibleName:'上一个匹配项',disabled,width:30,height:30},
      {id:'find-next',type:'iconButton',icon:'arrow-down',accessibleName:'下一个匹配项（Enter）',disabled,width:30,height:30},
      {id:'find-count',type:'text',role:'status',text:count.slice(0,220),muted:true,flex:1,singleLine:true,style:{align:'end'}},
      ...(target.supportsCaseSensitive||target.supportsTools?[{id:'find-options',type:'iconButton' as const,icon:'sliders',accessibleName:input.showOptions?'收起查找选项':'查找选项',expanded:input.showOptions,width:30,height:30}]:[])
    ]})
    if(state.notice&&state.status==='ready')children.push({id:'find-notice',type:'text',text:state.notice.slice(0,240),muted:true})
    if(input.showOptions)children.push({id:'find-settings',type:'column',gap:4,children:[
      ...(target.supportsCaseSensitive?[{id:'find-case',type:'toggle' as const,height:24,text:'区分大小写',checked:options.caseSensitive}]:[]),
      ...(target.supportsTools?[{id:'find-tools',type:'toggle' as const,height:24,text:'包含工具与日志',checked:options.includeTools}]:[])
    ]})
  }
  for(const row of children)if(row.type==='row')for(const control of row.children||[])if(control.type==='iconButton'){control.width=26;control.height=26;if(control.style?.radius)control.style.radius=7}
  return {id:'window-find',type:'column',width:Math.max(160,Math.min(480,Math.round(input.width))),padding:0,style:{paddingLeft:8,paddingRight:8},gap:6,children}
}

/** A scope button switches to another searchable surface; a sole scope has no action to offer. */
export function windowFindScopeButtons(targets:readonly WindowFindTarget[]):WindowFindTarget[]{
  const scopes=[...new Map(targets.map(target=>[target.scope,target])).values()]
  return scopes.length>1?scopes:[]
}
