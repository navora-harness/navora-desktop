import type {QuestionnaireTemplate} from './questionnaire'

export const BUILTIN_QUESTIONNAIRE_TEMPLATES: QuestionnaireTemplate[] = [
  {id:'requirements',title:'需求澄清',builtin:true,updatedAt:0,questions:[
    {id:'goal',type:'textarea',title:'希望解决什么问题？',required:true},
    {id:'audience',type:'text',title:'主要由谁使用？',required:true},
    {id:'constraints',type:'textarea',title:'有哪些限制或验收要求？',allowUnknown:true},
    {id:'references',type:'attachment',title:'参考文件或图片',maxFiles:5},
  ]},
  {id:'project-init',title:'项目初始化',builtin:true,updatedAt:0,questions:[
    {id:'name',type:'text',title:'项目名称',required:true},
    {id:'platform',type:'single',title:'目标平台',required:true,options:[{id:'web',label:'网页'},{id:'desktop',label:'桌面应用'},{id:'other',label:'其他'}]},
    {id:'platformDetail',type:'text',title:'请说明目标平台',required:true,showWhen:{questionId:'platform',equals:'other'}},
    {id:'schedule',type:'dateRange',title:'计划起止日期',allowUnknown:true},
  ]},
  {id:'execution',title:'执行参数',builtin:true,updatedAt:0,questions:[
    {id:'input',type:'attachment',title:'输入文件',maxFiles:5},
    {id:'output',type:'text',title:'期望的输出格式',required:true},
    {id:'deadline',type:'date',title:'期望完成日期',allowUnknown:true},
    {id:'constraints',type:'textarea',title:'执行约束与注意事项'},
  ]},
]
