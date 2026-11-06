import {createApp,h,nextTick,ref} from 'vue'
import QuestionnairePanel from '../../src/components/QuestionnairePanel.vue'
import ChatMarkdown from '../../src/components/ChatMarkdown.vue'
import ReplyArtifacts from '../../src/components/ReplyArtifacts.vue'
import {appearancePalette} from '../../shared/appearance'
import {emptyFileTabs,openQuestionnaireTab,type WorkspaceQuestionnaireTab} from '../../shared/file-tabs'
import {validateQuestionnaireAnswers,type QuestionnaireRecord,type QuestionnaireDraftInput,type QuestionnaireSubmitInput} from '../../shared/questionnaire'
import type {NavoraApi} from '../../electron/preload'
import type {WorkspaceResource} from '../../shared/workspace-resources'
import '../../src/styles/control-system.css'
import '../../src/styles/appearance-themes.css'
import '../../src/styles/appearance-hover.css'

const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value))
const calls:unknown[]=[],errors:string[]=[],events=new Set<(record:QuestionnaireRecord)=>void>(),workspaceEvents=new Set<(event:{chatId:string})=>void>()
const tabs=ref(emptyFileTabs()),mounted=ref(true),fileView=ref(false),collectionView=ref(false),panel=ref<InstanceType<typeof QuestionnairePanel>|null>(null)
let failSave=false,failSubmit=false,saveDelay=0,menuSelection:string|undefined
const now=Date.now()
const collectionFiles=ref<WorkspaceResource[]>([
  {id:'report',ownerChatId:'chat-a',path:'docs/商品整理.md',name:'商品整理.md',kind:'document',size:4900,mtimeMs:now,revision:'1'},
  ...['肩包.jpg','手提包.jpg','丝巾.jpg','手链.jpg','鞋履.jpg','香水.jpg'].map((name,index)=>({id:'image-'+index,ownerChatId:'chat-a',path:'images/'+name,name,kind:'image' as const,size:10000*(index+1),mtimeMs:now,revision:'1'})),
  {id:'other-owner',ownerChatId:'chat-b',path:'docs/商品整理.md',name:'商品整理.md',kind:'document',size:300,mtimeMs:now,revision:'1'},
])
function makeRecord(id:string,chatId:string):QuestionnaireRecord{return {id,chatId,chatTitle:chatId==='chat-a'?'产品需求讨论':'发布准备',runId:'run-'+id,toolCallId:'tool-'+id,schemaRevision:1,status:'pending',title:chatId==='chat-a'?'一起确定你的新项目':'发布前的最后几个确认',description:'把关键选择集中在这里。你可以补充想法，也可以把不确定的问题交给 Agent。',createdAt:now,updatedAt:now,draft:{revision:0,answers:{},supplement:'',updatedAt:now},questions:[
  {id:'kind',type:'single',title:'你想先构建什么？',description:'选择一个起点，后续可以继续调整。',required:true,allowOther:true,allowNote:true,options:[{id:'desktop',label:'桌面应用',description:'适合需要本地文件和工作区的体验。',recommended:true},{id:'web',label:'网页应用'}]},
  {id:'features',type:'multi',title:'首版需要哪些能力？',required:true,allowOther:true,options:[{id:'draft',label:'自动保存草稿',recommended:true},{id:'theme',label:'跟随软件主题'},{id:'search',label:'内容检索'}]},
  {id:'notify',type:'toggle',title:'完成后发送提醒？',allowUnknown:true},
  {id:'name',type:'text',title:'项目名称',required:true,allowDelegate:true,placeholder:'例如：灵感工作台'},
  {id:'notes',type:'textarea',title:'还有哪些使用场景？',allowSkip:true,allowNote:true,placeholder:'描述你平时会怎么使用…'},
  {id:'days',type:'number',title:'期望多少天完成首版？',min:0,max:90,unit:'天',allowUnknown:true},
]}}
const records=new Map<string,QuestionnaireRecord>(['q-a','q-b'].map((id,index)=>{const raw=localStorage.getItem('questionnaire-probe-service:'+id);return [id,raw?JSON.parse(raw):makeRecord(id,index?'chat-b':'chat-a')]}))
const roots=new Map([['chat-a','D:\\Navora Workspaces\\产品讨论'],['chat-b','E:\\Release Workspace']])
function persist(record:QuestionnaireRecord){records.set(record.id,clone(record));localStorage.setItem('questionnaire-probe-service:'+record.id,JSON.stringify(record))}
function broadcast(record:QuestionnaireRecord){for(const callback of events)callback(clone(record))}
const api={app:{platform:'win32'},nativeUi:{capabilities:async()=>({menus:true,panels:false,menuAppearance:true}),popupMenu:async(value:unknown)=>{calls.push(['file-menu',clone(value)]);const selectedId=menuSelection;menuSelection=undefined;return {supported:true,selectedId}},closeMenu:async()=>{}},questionnaires:{
  list:async()=>clone([...records.values()]),get:async(id:string)=>clone(records.get(id)||null),
  saveDraft:async(id:string,input:QuestionnaireDraftInput)=>{calls.push(['save',id,clone(input)]);if(failSave)throw Error('Isolated simulated save failure');const record=clone(records.get(id)!);if(input.baseRevision!==record.draft.revision)return {ok:false,record};record.draft={revision:record.draft.revision+1,answers:clone(input.answers),supplement:input.supplement,updatedAt:Date.now()};record.updatedAt=Date.now();persist(record);const reply=clone(record);if(saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));calls.push(['save-response',id,reply.draft.revision]);return {ok:true,record:reply}},
  submit:async(id:string,input:QuestionnaireSubmitInput)=>{calls.push(['submit',id,clone(input)]);if(failSubmit)throw Error('Isolated simulated submit failure');const record=clone(records.get(id)!);const invalid=validateQuestionnaireAnswers(record.questions,input.answers,input.supplement);if(invalid.length)return {ok:false,record,errors:invalid};if(input.revision!==record.draft.revision)return {ok:false,record,error:'草稿版本已更新'};record.status='submitted';record.submission={submissionId:input.submissionId,submittedAt:Date.now(),revision:input.revision,answers:clone(input.answers||{}),supplement:input.supplement||''};persist(record);return {ok:true,record:clone(record)}},
  cancel:async(id:string,reason?:string)=>{calls.push(['cancel',id,reason]);const record=clone(records.get(id)!);record.status='cancelled';persist(record);return {ok:true,record}},onChanged:(callback:(record:QuestionnaireRecord)=>void)=>{events.add(callback);return ()=>events.delete(callback)},
},workspace:{info:async(chatId:string)=>{calls.push(['root',chatId]);return {ok:true,absolutePath:roots.get(chatId)||''}},fileAction:async(chatId:string,path:string,action:string,options?:unknown)=>{calls.push(['file-action',chatId,path,action,clone(options||{})]);return {ok:true,capabilities:{revision:'2',directory:false,openWith:true,copyContent:true}}},onChanged:(callback:(event:{chatId:string})=>void)=>{workspaceEvents.add(callback);return ()=>workspaceEvents.delete(callback)}}}
window.navora=api as unknown as NavoraApi
function theme(id='mist',mode='light'){const palette=appearancePalette(id,mode,false),root=document.documentElement;root.dataset.navoraTheme=palette.id;root.dataset.navoraColorScheme=palette.dark?'dark':'light';root.style.colorScheme=palette.dark?'dark':'light';for(const [key,value] of Object.entries(palette))if(typeof value==='string')root.style.setProperty('--appearance-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value)}
theme()
async function select(id:string){if(panel.value&&!await panel.value.flushDraft())return false;tabs.value=openQuestionnaireTab(tabs.value,{chatId:records.get(id)!.chatId,questionnaireId:id});fileView.value=false;mounted.value=true;await nextTick();return true}
async function remount(){mounted.value=false;await nextTick();mounted.value=true;await nextTick()}
const probe={calls,errors,select,remount,theme,records:()=>clone([...records.values()]),tabs:()=>clone(tabs.value),failSave:(value:boolean)=>{failSave=value},failSubmit:(value:boolean)=>{failSubmit=value},saveDelay:(value:number)=>{saveDelay=value},flush:()=>panel.value?.flushDraft(),files:()=>{fileView.value=true;collectionView.value=false},collections:()=>{fileView.value=true;collectionView.value=true},refreshCollection:()=>{collectionFiles.value=collectionFiles.value.map(file=>({...file,revision:'2'}));collectionFiles.value.push({...collectionFiles.value[0],id:'duplicate',revision:'2'},{id:'extra',ownerChatId:'chat-a',path:'docs/补充说明.md',name:'补充说明.md',kind:'document',size:1024,mtimeMs:now,revision:'1'})},nextFileMenuAction:(action:string)=>{menuSelection=action},listeners:()=>events.size,remote:(id:string,value='来自另一窗口')=>{const record=clone(records.get(id)!);record.draft.revision++;record.draft.answers.name={state:'answered',value};record.updatedAt=Date.now();persist(record);broadcast(record);return clone(record)},changeRoot:(id:string,root:string)=>{roots.set(id,root);for(const callback of workspaceEvents)callback({chatId:id})}}
;(window as any).questionnaireProbe=probe
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Microsoft YaHei,sans-serif;background:var(--navora-background);color:var(--navora-ink)}#app,.probe-shell{height:100vh;min-height:0}.probe-shell{display:flex;flex-direction:column}.probe-tabs{display:flex;align-items:center;flex:none;height:44px;padding:0 16px;border-bottom:1px solid var(--navora-stroke);background:var(--navora-header)}.probe-tab{height:34px;padding:8px 18px;border:1px solid var(--navora-stroke);border-radius:7px 7px 0 0;background:var(--navora-surface);font-size:12px}.probe-tabs small{margin-left:auto;color:var(--navora-muted);font-size:11px}.probe-files{padding:28px;overflow:auto}.probe-files h2{font-size:18px;font-weight:550}.probe-files .msg-body{background:var(--navora-surface);color:var(--navora-ink);border-color:var(--navora-stroke)}.probe-files a{color:var(--navora-accent)!important}';document.head.append(style)
createApp({setup(){return ()=>{const tab=tabs.value.tabs.find(item=>item.kind==='questionnaire') as WorkspaceQuestionnaireTab|undefined;return h('main',{class:'probe-shell navora-app'},[h('nav',{class:'probe-tabs','aria-label':'工作区标签'},[...(tab?[h('div',{class:'probe-tab',role:'tab','aria-selected':'true'},'问卷')]:[]),h('small',{},'工作区')]),fileView.value?h('section',{class:'probe-files'},[
  h('h2',{},'对话输出文件'),h(ChatMarkdown,{chatId:'chat-a',content:'已生成 [规划文档](docs/项目规划.md)。\n\n![预览](images/预览.png)',onOpenFile:(value:string)=>calls.push(['open-markdown','chat-a',value])}),
  collectionView.value?h(ReplyArtifacts,{replyId:'collection-reply',files:collectionFiles.value,onOpen:(value:string,chatId:string)=>calls.push(['open-collection',chatId,value])}):h(ReplyArtifacts,{replyId:'file-preview-reply',files:[{id:'a',ownerChatId:'chat-a',path:'docs/项目规划.md',name:'项目规划.md',kind:'document',size:2300,mtimeMs:now,revision:'1'},{id:'b',ownerChatId:'chat-b',path:'release.txt',name:'release.txt',kind:'file',size:90,mtimeMs:now,revision:'1'}],onOpen:(value:string,chatId:string)=>calls.push(['open-artifact',chatId,value])})
]):mounted.value&&tab?h(QuestionnairePanel,{ref:panel,questionnaireId:tab.questionnaireId,chatId:tab.chatId,onSubmitted:(record:QuestionnaireRecord)=>calls.push(['submitted',record.id]),onCancelled:(record:QuestionnaireRecord)=>calls.push(['cancelled',record.id]),onReturnToChat:(value:unknown)=>calls.push(['return',value])}):null])}}}).mount('#app')
await select('q-a')
