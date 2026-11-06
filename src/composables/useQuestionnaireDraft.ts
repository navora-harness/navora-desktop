import {computed,onBeforeUnmount,ref,type Ref} from 'vue'
import {validateQuestionnaireAnswers,type QuestionnaireAnswer,type QuestionnaireRecord} from '@shared/questionnaire'

type DraftContent={answers:Record<string,QuestionnaireAnswer>;supplement:string}
type LocalDraft=DraftContent&{version:1;id:string;chatId:string;schemaRevision:number;baseRevision:number;updatedAt:number;dirty:boolean}
type Entry={local:LocalDraft;record:QuestionnaireRecord;conflict:QuestionnaireRecord|null;recovery:LocalDraft|null;error:string;saving:boolean;tail:Promise<boolean>|null;remote:QuestionnaireRecord|null}
const storageKey=(id:string)=>`navora.questionnaire-draft.v1:${id}`
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
const same=(left:DraftContent,right:DraftContent)=>JSON.stringify(left.answers)===JSON.stringify(right.answers)&&left.supplement===right.supplement
const compareRecords=(left:QuestionnaireRecord,right:QuestionnaireRecord)=>left.schemaRevision-right.schemaRevision||left.draft.revision-right.draft.revision||left.updatedAt-right.updatedAt

/** Persist each edit locally and serialize versioned saves, including edits made during a save. */
export function useQuestionnaireDraft(owner:Ref<string>){
  const entries=new Map<string,Entry>(),current=ref<Entry|null>(null),tick=ref(0)
  const timers=new Map<string,ReturnType<typeof setTimeout>>()
  const changed=()=>{tick.value++}
  const entry=()=>{void tick.value;return current.value}
  function store(value:LocalDraft){try{localStorage.setItem(storageKey(value.id),JSON.stringify(value));return true}catch{return false}}
  function read(record:QuestionnaireRecord):LocalDraft|null{
    try{const raw=JSON.parse(localStorage.getItem(storageKey(record.id))||'null') as Partial<LocalDraft>|null
      if(raw?.version===1&&raw.id===record.id&&raw.chatId===record.chatId&&Number.isSafeInteger(raw.baseRevision)&&raw.baseRevision!>=0&&Number.isSafeInteger(raw.schemaRevision)&&raw.schemaRevision!>=0&&typeof raw.updatedAt==='number'&&Number.isFinite(raw.updatedAt)&&typeof raw.dirty==='boolean'&&typeof raw.supplement==='string'&&raw.answers&&typeof raw.answers==='object'&&!Array.isArray(raw.answers)&&Object.values(raw.answers).every(value=>value&&typeof value==='object'&&['unanswered','answered','unknown','delegate','skip'].includes(value.state)))return raw as LocalDraft
    }catch{/* The durable service copy remains available if the cache cannot be read. */}
    return null
  }
  const fromRecord=(record:QuestionnaireRecord):LocalDraft=>({version:1,id:record.id,chatId:record.chatId,schemaRevision:record.schemaRevision,baseRevision:record.draft.revision,answers:clone(record.draft.answers),supplement:record.draft.supplement,updatedAt:record.draft.updatedAt,dirty:false})
  function load(record:QuestionnaireRecord){
    let item=entries.get(record.id)
    if(!item){
      const cached=read(record),local=cached?.dirty&&!same(cached,record.draft)?cached:fromRecord(record)
      let recovery:LocalDraft|null=null
      try{const raw=JSON.parse(localStorage.getItem(`${storageKey(record.id)}:recovery`)||'null') as LocalDraft|null;if(raw?.version===1&&raw.id===record.id&&raw.chatId===record.chatId)recovery=raw}catch{/* Keep service recovery available. */}
      const serviceRecovery=record.recoveries?.at(-1)
      if(!recovery&&serviceRecovery)recovery={...fromRecord(record),answers:clone(serviceRecovery.answers),supplement:serviceRecovery.supplement,baseRevision:serviceRecovery.baseRevision,updatedAt:serviceRecovery.savedAt,dirty:true}
      item={local,record,conflict:null,recovery,error:'',saving:false,tail:null,remote:null};entries.set(record.id,item)
      if(cached?.dirty&&(cached.baseRevision!==record.draft.revision||cached.schemaRevision!==record.schemaRevision)&&!same(cached,record.draft))item.conflict=record
    }else acceptRemote(record)
    current.value=item;changed()
    if(item.local.dirty&&!item.conflict)schedule(item.local.id)
  }
  function edit(answers:Record<string,QuestionnaireAnswer>,supplement:string){
    const item=entries.get(owner.value);if(!item||item.record.status!=='pending')return
    item.local={...item.local,answers:clone(answers),supplement,updatedAt:Date.now(),dirty:true};item.error=''
    if(!store(item.local))item.error='本地草稿暂时无法保存，正在尝试同步。'
    changed();schedule(item.local.id)
  }
  function clearTimer(id:string){clearTimeout(timers.get(id));timers.delete(id)}
  function schedule(id:string){clearTimer(id);timers.set(id,setTimeout(()=>{timers.delete(id);void save(id)},350))}
  async function save(id:string):Promise<boolean>{
    const item=entries.get(id);if(!item)return true
    if(item.tail){await item.tail;return !item.local.dirty&&!item.conflict}
    if(item.record.status!=='pending')return store(item.local)
    if(item.conflict)return false
    if(!item.local.dirty)return true
    item.saving=true;changed()
    const snapshot=clone(item.local)
    const task=(async()=>{
      try{
        const result=await window.navora!.questionnaires.saveDraft(id,{baseRevision:snapshot.baseRevision,answers:snapshot.answers,supplement:snapshot.supplement})
        if(compareRecords(result.record,item.record)>=0)item.record=result.record
        if(!result.ok){item.conflict=item.record;item.error='草稿在另一处有更新，两份内容均已保留。';store(item.local);return false}
        item.local.baseRevision=Math.max(item.local.baseRevision,result.record.draft.revision)
        if(same(item.local,snapshot)){item.local.dirty=false;item.local.updatedAt=result.record.draft.updatedAt;item.error=''}
        store(item.local);return !item.local.dirty
      }catch{item.error='草稿暂时无法同步，当前输入已保留。';store(item.local);return false}
      finally{
        item.saving=false
        const remote=item.remote;item.remote=null
        if(remote)acceptRemote(remote)
        changed()
      }
    })()
    item.tail=task
    try{return await task}finally{item.tail=null;if(item.local.dirty&&!item.conflict&&!item.error)schedule(id)}
  }
  async function flush(id=owner.value):Promise<boolean>{
    clearTimer(id)
    const item=entries.get(id);if(!item)return true
    if(item.tail)await item.tail
    if(item.record.status!=='pending')return store(item.local)
    if(item.conflict)return false
    if(item.local.dirty)await save(id)
    if(item.local.dirty&&!item.conflict&&!item.error)await save(id)
    return !item.local.dirty&&!item.conflict
  }
  function acceptRemote(record:QuestionnaireRecord){
    const item=entries.get(record.id);if(!item)return
    if(compareRecords(record,item.record)<0||record.schemaRevision===item.local.schemaRevision&&record.draft.revision<item.local.baseRevision)return
    item.record=record
    if(item.saving){if(!item.remote||compareRecords(record,item.remote)>=0)item.remote=record;changed();return}
    if(item.local.dirty){
      if(same(item.local,record.draft)){item.local=fromRecord(record);item.conflict=null;item.error='';store(item.local)}
      else if(record.draft.revision!==item.local.baseRevision||record.schemaRevision!==item.local.schemaRevision){item.conflict=record;store(item.local)}
    }else{item.local=fromRecord(record);store(item.local)}
    changed()
  }
  async function resolveConflict(useLocal:boolean):Promise<boolean>{
    const item=entries.get(owner.value);if(item?.tail)await item.tail
    const remote=item?.conflict;if(!item||!remote)return true
    if(item.record.status!=='pending')return false
    const retained=useLocal&&item.local.schemaRevision===remote.schemaRevision?fromRecord(remote):clone(item.local)
    try{localStorage.setItem(`${storageKey(remote.id)}:recovery`,JSON.stringify(retained));item.recovery=retained}catch{item.error='暂时无法保存冲突副本，请稍后重试。';changed();return false}
    if(useLocal){
      if(item.local.schemaRevision!==remote.schemaRevision){item.error='题目已更新，请使用同步版本；原输入已保留在恢复副本中。';changed();return false}
      item.local.baseRevision=remote.draft.revision;item.local.dirty=true
    }else item.local=fromRecord(remote)
    item.record=remote;item.conflict=null;item.error='';store(item.local);changed()
    return useLocal?flush():true
  }
  async function restoreRecovery():Promise<boolean>{
    const item=entries.get(owner.value);if(item?.tail)await item.tail
    const recovery=item?.recovery;if(!item||!recovery||item.record.status!=='pending')return false
    if(recovery.schemaRevision!==item.record.schemaRevision||validateQuestionnaireAnswers(item.record.questions,recovery.answers,recovery.supplement,false).length){item.error='题目已更新，恢复副本仍保留，请按当前题目填写。';changed();return false}
    try{localStorage.setItem(`${storageKey(recovery.id)}:recovery`,JSON.stringify(item.local))}catch{item.error='暂时无法保存当前版本，请稍后重试。';changed();return false}
    const previous=clone(item.local)
    item.local={...clone(recovery),baseRevision:item.record.draft.revision,updatedAt:Date.now(),dirty:true};item.recovery=previous;item.conflict=null;item.error='';store(item.local);changed()
    return flush()
  }
  const beforeUnload=()=>{for(const item of entries.values())if(item.local.dirty){store(item.local);void save(item.local.id)}}
  window.addEventListener('beforeunload',beforeUnload)
  onBeforeUnmount(()=>{for(const timer of timers.values())clearTimeout(timer);timers.clear();window.removeEventListener('beforeunload',beforeUnload);beforeUnload()})
  return {
    record:computed(()=>entry()?.record||null),
    answers:computed(()=>entry()?.local.answers||{}),supplement:computed(()=>entry()?.local.supplement||''),
    revision:computed(()=>entry()?.local.baseRevision||0),conflict:computed(()=>entry()?.conflict||null),recovery:computed(()=>entry()?.recovery||null),error:computed(()=>entry()?.error||''),
    state:computed(()=>{const item=entry();return !item?'loading':item.conflict?'conflict':item.saving?'saving':item.error?'error':item.local.dirty?'pending':'saved'}),
    load,edit,flush,acceptRemote,resolveConflict,restoreRecovery,
  }
}
