import type {BrowserAnnotation,BrowserAnnotationDraft,BrowserAnnotationTarget,BrowserDraftCopy} from './browser-workspace'

export type AnnotationChatEntry={key:string;createdAt:number;note?:BrowserAnnotation;target?:BrowserAnnotationTarget;draft?:BrowserAnnotationDraft;copies:BrowserDraftCopy[]}
export type AnnotationChatAction='edit'|'send'|'locate'|'evidence'|'resolve'|'delete'|'discard'|'copy'|'latest'
export const ANNOTATION_CHAT_EDIT='navora:annotation-chat-edit'
export const ANNOTATION_CHAT_SAVED='navora:annotation-chat-saved'
export type AnnotationChatEdit={chatId:string;pageId:string;noteId?:string;targetId?:string;copyId?:string;latest?:boolean}

export function annotationChatEntries(notes:readonly BrowserAnnotation[],targets:readonly BrowserAnnotationTarget[],drafts:readonly BrowserAnnotationDraft[]=[],copies:readonly BrowserDraftCopy[]=[]):AnnotationChatEntry[]{
  const committed=new Set(notes.map(note=>note.sourceTargetId)),seen=new Set<string>()
  return [
    ...notes.map(note=>({key:`annotation:${note.id}`,createdAt:note.createdAt,note,draft:drafts.find(draft=>draft.annotationId===note.id&&!draft.deleted),copies:copies.filter(copy=>copy.annotationId===note.id)})),
    ...targets.filter(target=>!committed.has(target.id)).map(target=>({key:`annotation-target:${target.id}`,createdAt:target.createdAt,target,copies:[]})),
  ].filter(entry=>{if(seen.has(entry.key))return false;seen.add(entry.key);return true}).sort((a,b)=>a.createdAt-b.createdAt||a.key.localeCompare(b.key))
}
