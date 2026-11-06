import type {AnnotationChatEntry} from './browser-annotation-chat'

export const annotationStates=[{id:'all',label:'全部状态'},{id:'pending',label:'待处理'},{id:'review',label:'待核对'},{id:'resolved',label:'已解决'},{id:'draft',label:'已保存'},{id:'unsaved',label:'未保存'}] as const
export type AnnotationState=typeof annotationStates[number]['id']
export function annotationEntryState(entry:AnnotationChatEntry){return entry.note?.taskState||'unsaved'}
export function annotationEntryLabel(entry:AnnotationChatEntry){return annotationStates.find(state=>state.id===annotationEntryState(entry))?.label||'未保存'}
export function annotationEntrySelection(entry:AnnotationChatEntry){return entry.note?.selection||entry.target?.selection}
export function annotationEntryComment(entry:AnnotationChatEntry){return entry.note?.comment||entry.target?.comment||'尚未填写意见'}
export function filterConversationAnnotations(entries:readonly AnnotationChatEntry[],query:string,state:AnnotationState){
  const needle=query.trim().toLocaleLowerCase()
  return entries.filter(entry=>{
    const selection=annotationEntrySelection(entry)
    return (state==='all'||annotationEntryState(entry)===state)&&(!needle||[annotationEntryComment(entry),selection?.title,selection?.url,selection?.text].join('\n').toLocaleLowerCase().includes(needle))
  }).sort((a,b)=>b.createdAt-a.createdAt||a.key.localeCompare(b.key))
}
/** Current-chat view only; selecting never creates an Agent message or changes a note. */
export function conversationAnnotationsView(options:{entries:readonly AnnotationChatEntry[];query:string;state:AnnotationState;selectedKey:string;page:number}){
  const matches=filterConversationAnnotations(options.entries,options.query,options.state),pageSize=8,pages=Math.max(1,Math.ceil(matches.length/pageSize)),page=Math.max(0,Math.min(pages-1,options.page))
  const selected=matches.find(entry=>entry.key===options.selectedKey),visible=matches.slice(page*pageSize,(page+1)*pageSize)
  return {matches,selected,page,pages,visible}
}
