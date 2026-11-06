export type TaskDeclarationId='automation'|'plan'
export type TaskDeclarations={version:1;ids:TaskDeclarationId[]}
export type TaskConstraintSource={messageId?:string;queueId?:string;queueRevision?:number;documentId?:string;documentRevision?:number}
export type RuntimeTaskConstraints={version:1;phase:'plan'|'execute';declarations:TaskDeclarations;source?:TaskConstraintSource;inheritedFrom?:{chatId:string;runId:string}}
export const taskDeclarationDefinitions=[
  {id:'automation' as const,label:'自动化',detail:'按需使用工具完成任务',description:'按目标选择导航、读取、请求或其它工具；必要时才进行点击和输入，不要求每步移动鼠标。',icon:'robot',aliases:['automation','automate','自动化']},
  {id:'plan' as const,label:'计划',detail:'先制定方案，本条不实施',description:'形成方案、步骤和验收标准，可做获准的只读核对。本条不实施方案中的改动。',icon:'list-check',aliases:['plan','planning','计划','规划']},
] as const

/** Unknown semantics stay in draft storage, but never reach executable compilation. */
export function retainTaskDeclarations(value:unknown):unknown{
  if(value===undefined)return undefined
  let encoded:string|undefined
  try{encoded=JSON.stringify(value)}catch{throw Error('invalid_task_declarations')}
  if(!encoded||encoded.length>8192)throw Error('invalid_task_declarations')
  return JSON.parse(encoded)
}
export function normalizeTaskDeclarations(value:unknown=undefined):TaskDeclarations{
  if(value===undefined)return {version:1,ids:[]}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_task_declarations')
  const raw=value as Record<string,unknown>
  if(raw.version!==1)throw Error('task_declarations_version')
  if(Object.keys(raw).some(key=>key!=='version'&&key!=='ids')||!Array.isArray(raw.ids)||raw.ids.length>32)throw Error('invalid_task_declarations')
  if(raw.ids.some(id=>typeof id!=='string'||!taskDeclarationDefinitions.some(definition=>definition.id===id)))throw Error('task_declaration_unknown')
  return {version:1,ids:taskDeclarationDefinitions.filter(definition=>(raw.ids as string[]).includes(definition.id)).map(definition=>definition.id)}
}
export function taskDeclarationsSupported(value:unknown){try{normalizeTaskDeclarations(value);return true}catch{return false}}
export function hasTaskDeclarations(value:unknown){return normalizeTaskDeclarations(value).ids.length>0}
export function taskDeclarationsLabel(value:unknown){try{return normalizeTaskDeclarations(value).ids.map(id=>taskDeclarationDefinitions.find(definition=>definition.id===id)!.label).join('、')}catch{return '未知任务声明（需要兼容版本）'}}
export function deriveTaskConstraints(value:unknown,source?:TaskConstraintSource):RuntimeTaskConstraints{
  const declarations=normalizeTaskDeclarations(value)
  const safeSource:TaskConstraintSource={}
  if(source)for(const [key,field]of Object.entries(source)){
    if(['messageId','queueId','documentId'].includes(key)){if(typeof field!=='string'||!field||field.length>200)throw Error('invalid_task_constraint_source');(safeSource as Record<string,unknown>)[key]=field}
    else if(['queueRevision','documentRevision'].includes(key)){if(!Number.isSafeInteger(field)||Number(field)<0)throw Error('invalid_task_constraint_source');(safeSource as Record<string,unknown>)[key]=field}
    else throw Error('invalid_task_constraint_source')
  }
  return {version:1,phase:declarations.ids.includes('plan')?'plan':'execute',declarations,...(source?{source:safeSource}:{})}
}
