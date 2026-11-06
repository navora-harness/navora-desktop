import {ANNOTATION_CHAT_EDIT,type AnnotationChatEdit} from '@shared/browser-annotation-chat'

// A workspace can mount its browser after the card click. Retain the intent until
// that page's editor is ready; changing chats cancels it instead of replaying it.
let pending:AnnotationChatEdit|undefined
export function requestAnnotationEdit(detail:AnnotationChatEdit){pending=detail;window.dispatchEvent(new Event(ANNOTATION_CHAT_EDIT))}
export function consumeAnnotationEdit(chatId:string,pageId:string){
  if(pending?.chatId!==chatId||pending.pageId!==pageId)return
  const detail=pending;pending=undefined;return detail
}
export function cancelAnnotationEdit(){pending=undefined}
