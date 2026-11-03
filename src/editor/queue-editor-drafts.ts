import {normalizeComposerDocument,type ComposerDocument} from '../../shared/composer-document'
import type {QueuedMessage} from '../../shared/types'
export type QueueEditorDraft={chatId:string;entry:QueuedMessage;document:ComposerDocument;baseRevision?:number;updatedAt:number}
const storageKey='navora.queue-editor-drafts.v1',drafts=new Map<string,QueueEditorDraft>(),unreadable=new Map<string,QueueEditorDraft>()
let storageUnreadable=false
const key=(chatId:string,id:string)=>JSON.stringify([chatId,id])
try{const saved:unknown=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))for(const row of saved){if(!row||typeof row!=='object')continue;const item=row as QueueEditorDraft;if(typeof item.chatId!=='string'||typeof item.entry?.id!=='string')continue;try{const document=normalizeComposerDocument(item.document,item.chatId);drafts.set(key(item.chatId,item.entry.id),{...item,document})}catch{unreadable.set(key(item.chatId,item.entry.id),item)}}else storageUnreadable=true}catch{storageUnreadable=true}
function persist(){if(storageUnreadable)return;try{localStorage.setItem(storageKey,JSON.stringify([...unreadable.values(),...[...drafts.values()].sort((a,b)=>a.updatedAt-b.updatedAt).slice(-20)]))}catch{/* Retain the in-memory copy if local storage is full. */}}
export function queueEditorDraft(chatId:string,id?:string){const values=[...drafts.values()].filter(item=>item.chatId===chatId&&(!id||item.entry.id===id)).sort((a,b)=>b.updatedAt-a.updatedAt);return values[0]}
export function queueEditorDraftUnsupported(chatId:string,id:string){return unreadable.has(key(chatId,id))}
export function saveQueueEditorDraft(draft:QueueEditorDraft){if(unreadable.has(key(draft.chatId,draft.entry.id)))return;drafts.set(key(draft.chatId,draft.entry.id),JSON.parse(JSON.stringify({...draft,baseRevision:draft.entry.revision||0})));persist()}
export function removeQueueEditorDraft(chatId:string,id:string){drafts.delete(key(chatId,id));persist()}
